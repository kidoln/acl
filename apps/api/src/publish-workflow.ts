import type { PublishGateResult } from '@acl/gate';
import type { AuthzModelConfig } from '@acl/shared-types';
import type { PersistedPublishRequestRecord } from '@acl/persistence';

export type PublishWorkflowStatus =
  | 'blocked'
  | 'review_required'
  | 'approved'
  | 'rejected'
  | 'published';

export interface PublishReviewItem {
  decision: 'approve' | 'reject';
  reviewer: string;
  reason: string;
  reviewed_at: string;
  expires_at?: string;
}

export interface PublishActivationItem {
  operator: string;
  activated_at: string;
}

export interface PublishWorkflowPayload {
  submitted_by: string;
  submitted_at: string;
  gate_result: PublishGateResult;
  model_snapshot?: AuthzModelConfig;
  reviews: PublishReviewItem[];
  exemptions: Array<{
    code: string;
    rule_id: string;
    reason: string;
    reviewer: string;
    expires_at?: string;
  }>;
  activation?: PublishActivationItem;
}

interface ReviewGateFailure {
  code: string;
  rule_id: string;
  level: string;
  passed?: boolean;
}

function parseTime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return timestamp;
}

function collectReviewGateFailures(payload: PublishWorkflowPayload): ReviewGateFailure[] {
  return payload.gate_result.gates.filter(
    (gate) =>
      (gate.level === 'P1' || gate.level === 'P2') &&
      (gate as { passed?: boolean }).passed !== true,
  );
}

function isExpired(expiresAt: string | undefined, now: number): boolean {
  const timestamp = parseTime(expiresAt);
  if (timestamp === null) {
    return expiresAt !== undefined;
  }
  return timestamp <= now;
}

function normalizePayload(input: Record<string, unknown>): PublishWorkflowPayload {
  const gateResult = input.gate_result;
  const modelSnapshot = input.model_snapshot;
  const reviews = input.reviews;
  const exemptions = input.exemptions;
  const activation = input.activation;

  return {
    submitted_by: typeof input.submitted_by === 'string' ? input.submitted_by : 'system',
    submitted_at: typeof input.submitted_at === 'string' ? input.submitted_at : new Date().toISOString(),
    gate_result: (gateResult ?? {}) as PublishGateResult,
    model_snapshot:
      modelSnapshot && typeof modelSnapshot === 'object'
        ? (modelSnapshot as AuthzModelConfig)
        : undefined,
    reviews: Array.isArray(reviews) ? (reviews as PublishReviewItem[]) : [],
    exemptions: Array.isArray(exemptions)
      ? (exemptions as PublishWorkflowPayload['exemptions'])
      : [],
    activation:
      activation && typeof activation === 'object'
        ? (activation as PublishActivationItem)
        : undefined,
  };
}

function deriveInitialStatus(result: PublishGateResult): PublishWorkflowStatus {
  if (result.final_result === 'blocked') {
    return 'blocked';
  }

  if (result.final_result === 'review_required') {
    return 'review_required';
  }

  return 'approved';
}

export function buildPublishRequestRecord(input: {
  gate_result: PublishGateResult;
  submitted_by: string;
  model_snapshot?: AuthzModelConfig;
  now: string;
}): PersistedPublishRequestRecord {
  const payload: PublishWorkflowPayload = {
    submitted_by: input.submitted_by,
    submitted_at: input.now,
    gate_result: input.gate_result,
    model_snapshot: input.model_snapshot,
    reviews: [],
    exemptions: [],
  };

  return {
    publish_id: input.gate_result.publish_id,
    profile: input.gate_result.profile,
    status: deriveInitialStatus(input.gate_result),
    final_result: input.gate_result.final_result,
    created_at: input.now,
    updated_at: input.now,
    payload: payload as unknown as Record<string, unknown>,
  };
}

export function applyPublishReview(input: {
  record: PersistedPublishRequestRecord;
  review: {
    decision: 'approve' | 'reject';
    reviewer: string;
    reason: string;
    expires_at?: string;
  };
  now: string;
}): PersistedPublishRequestRecord {
  if (input.record.status !== 'review_required') {
    throw new Error('publish request is not in review_required status');
  }
  if (input.review.expires_at !== undefined && parseTime(input.review.expires_at) === null) {
    throw new Error('review expires_at must be a valid ISO datetime');
  }

  const payload = normalizePayload(input.record.payload);
  const failedReviewGates = collectReviewGateFailures(payload);
  const now = parseTime(input.now) ?? Date.now();

  if (input.review.decision === 'approve') {
    if (failedReviewGates.length === 0) {
      throw new Error('no review gates available for approval');
    }
    if (input.review.expires_at === undefined) {
      throw new Error('review approval must provide expires_at');
    }
    const expiresAt = parseTime(input.review.expires_at);
    if (expiresAt === null || expiresAt <= now) {
      throw new Error('review expires_at must be later than review time');
    }
  }

  const reviewItem: PublishReviewItem = {
    decision: input.review.decision,
    reviewer: input.review.reviewer,
    reason: input.review.reason,
    reviewed_at: input.now,
    expires_at: input.review.expires_at,
  };

  const nextStatus: PublishWorkflowStatus =
    input.review.decision === 'approve' ? 'approved' : 'rejected';

  const nextPayload: PublishWorkflowPayload = {
    ...payload,
    reviews: [...payload.reviews, reviewItem],
    exemptions:
      input.review.decision === 'approve'
        ? failedReviewGates
            .map((gate) => ({
              code: gate.code,
              rule_id: gate.rule_id,
              reason: input.review.reason,
              reviewer: input.review.reviewer,
              expires_at: input.review.expires_at,
            }))
        : payload.exemptions,
  };

  return {
    ...input.record,
    status: nextStatus,
    updated_at: input.now,
    payload: nextPayload as unknown as Record<string, unknown>,
  };
}

export function applyPublishActivation(input: {
  record: PersistedPublishRequestRecord;
  operator: string;
  now: string;
}): PersistedPublishRequestRecord {
  if (input.record.status !== 'approved') {
    throw new Error('publish request is not in approved status');
  }

  const now = parseTime(input.now) ?? Date.now();
  const payload = normalizePayload(input.record.payload);

  if (payload.gate_result.final_result === 'review_required') {
    const hasValidReview = payload.reviews.some(
      (review) => review.decision === 'approve' && !isExpired(review.expires_at, now),
    );
    if (!hasValidReview) {
      throw new Error('publish request review approval is missing or expired');
    }

    const failedReviewGates = collectReviewGateFailures(payload);
    const uncovered = failedReviewGates.filter((gate) => {
      const matched = payload.exemptions.find(
        (item) => item.code === gate.code && item.rule_id === gate.rule_id,
      );
      if (!matched) {
        return true;
      }

      const expiresAt = parseTime(matched.expires_at);
      if (expiresAt === null || isExpired(matched.expires_at, now)) {
        return true;
      }

      return false;
    });

    if (uncovered.length > 0) {
      const details = uncovered.map((gate) => `${gate.code}:${gate.rule_id}`).join(', ');
      throw new Error(`publish request exemptions are missing or expired: ${details}`);
    }

    const hasAnyExemption = payload.exemptions.some(
      (item) => parseTime(item.expires_at) !== null && !isExpired(item.expires_at, now),
    );
    if (!hasAnyExemption) {
      throw new Error('publish request exemptions are missing or expired');
    }
  }

  const nextPayload: PublishWorkflowPayload = {
    ...payload,
    activation: {
      operator: input.operator,
      activated_at: input.now,
    },
  };

  return {
    ...input.record,
    status: 'published',
    updated_at: input.now,
    payload: nextPayload as unknown as Record<string, unknown>,
  };
}
