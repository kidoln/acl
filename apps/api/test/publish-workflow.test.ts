import { describe, expect, it } from 'vitest';

import type { PublishGateResult } from '@acl/gate';

import {
  applyPublishActivation,
  applyPublishReview,
  buildPublishRequestRecord,
} from '../src/publish-workflow';

function mockGateResult(finalResult: PublishGateResult['final_result']): PublishGateResult {
  return {
    publish_id: 'pub_20260304_001',
    profile: 'baseline',
    final_result: finalResult,
    gates:
      finalResult === 'review_required'
        ? [
            {
              level: 'P2',
              rule_id: 'p2_indeterminate_rate',
              code: 'INDETERMINATE_RATE_TOO_HIGH',
              passed: false,
              decision: 'review_business_owner',
              detail: 'indeterminate rate must be <= 0.02',
            },
          ]
        : [],
    review_required: finalResult === 'review_required',
    tickets: [],
    metrics: {
      schema: { valid: true },
      semantic: {
        selector_parse_error_count: 0,
        selector_type_mismatch_count: 0,
        unregistered_action_count: 0,
        unknown_relation_type_count: 0,
        duplicate_rule_id_count: 0,
      },
      conflict: { unresolved_count: 0 },
      security: {
        sod_violation_count: 0,
        cardinality_exceeded_count: 0,
        high_sensitivity_eventual_count: 0,
        high_sensitivity_weak_staleness_count: 0,
        mandatory_obligation_missing_count: 0,
      },
      lifecycle: {
        required_handler_missing_count: 0,
        takeover_queue_backlog_count: 0,
        takeover_queue_max_pending_hours: 0,
      },
      onboarding: {
        default_profile_exists: true,
        profile_include_hard_required: true,
        strict_mode_violation_count: 0,
      },
      execution: {
        mandatory_obligation_static_unexecutable_count: 0,
        mandatory_obligation_pass_rate: 1,
      },
      attribute: {
        untrusted_source_count: 0,
        stale_count: 0,
      },
      simulation: {
        indeterminate_rate: 0,
      },
      quality: {
        unreachable_rule_ratio: 0,
        priority_collision_ratio: 0,
      },
    },
  };
}

function mockGateResultWithTwoReviewFailures(): PublishGateResult {
  return {
    ...mockGateResult('review_required'),
    gates: [
      {
        level: 'P1',
        rule_id: 'p1_attribute_source',
        code: 'ATTRIBUTE_SOURCE_UNTRUSTED',
        passed: false,
        decision: 'review_data_governance',
        detail: 'attribute source must be trusted',
      },
      {
        level: 'P2',
        rule_id: 'p2_indeterminate_rate',
        code: 'INDETERMINATE_RATE_TOO_HIGH',
        passed: false,
        decision: 'review_business_owner',
        detail: 'indeterminate rate must be <= 0.02',
      },
    ],
  };
}

describe('publish workflow', () => {
  it('creates review_required request for review gate result', () => {
    const record = buildPublishRequestRecord({
      gate_result: mockGateResult('review_required'),
      submitted_by: 'ops_admin',
      now: '2026-03-04T00:00:00.000Z',
    });

    expect(record.status).toBe('review_required');
  });

  it('approves and adds exemption for review gate failures', () => {
    const initial = buildPublishRequestRecord({
      gate_result: mockGateResult('review_required'),
      submitted_by: 'ops_admin',
      now: '2026-03-04T00:00:00.000Z',
    });

    const approved = applyPublishReview({
      record: initial,
      review: {
        decision: 'approve',
        reviewer: 'governance_lead',
        reason: 'temporary exception',
        expires_at: '2026-03-11T00:00:00.000Z',
      },
      now: '2026-03-04T01:00:00.000Z',
    });

    expect(approved.status).toBe('approved');
    expect((approved.payload.exemptions as unknown[]).length).toBe(1);
  });

  it('publishes from approved status', () => {
    const approved = {
      ...buildPublishRequestRecord({
        gate_result: mockGateResult('passed'),
        submitted_by: 'ops_admin',
        now: '2026-03-04T00:00:00.000Z',
      }),
      status: 'approved',
    };

    const published = applyPublishActivation({
      record: approved,
      operator: 'release_bot',
      now: '2026-03-04T02:00:00.000Z',
    });

    expect(published.status).toBe('published');
  });

  it('rejects activation when review exemption is expired', () => {
    const initial = buildPublishRequestRecord({
      gate_result: mockGateResult('review_required'),
      submitted_by: 'ops_admin',
      now: '2026-03-04T00:00:00.000Z',
    });
    const approved = applyPublishReview({
      record: initial,
      review: {
        decision: 'approve',
        reviewer: 'governance_lead',
        reason: 'temporary exception',
        expires_at: '2026-03-04T01:00:00.000Z',
      },
      now: '2026-03-04T00:30:00.000Z',
    });

    expect(() =>
      applyPublishActivation({
        record: approved,
        operator: 'release_bot',
        now: '2026-03-04T02:00:00.000Z',
      }),
    ).toThrow('publish request review approval is missing or expired');
  });

  it('rejects review when expires_at is invalid', () => {
    const initial = buildPublishRequestRecord({
      gate_result: mockGateResult('review_required'),
      submitted_by: 'ops_admin',
      now: '2026-03-04T00:00:00.000Z',
    });

    expect(() =>
      applyPublishReview({
        record: initial,
        review: {
          decision: 'approve',
          reviewer: 'governance_lead',
          reason: 'temporary exception',
          expires_at: 'not-a-date',
        },
        now: '2026-03-04T00:30:00.000Z',
      }),
    ).toThrow('review expires_at must be a valid ISO datetime');
  });

  it('rejects approve review without expires_at', () => {
    const initial = buildPublishRequestRecord({
      gate_result: mockGateResult('review_required'),
      submitted_by: 'ops_admin',
      now: '2026-03-04T00:00:00.000Z',
    });

    expect(() =>
      applyPublishReview({
        record: initial,
        review: {
          decision: 'approve',
          reviewer: 'governance_lead',
          reason: 'temporary exception',
        },
        now: '2026-03-04T00:30:00.000Z',
      }),
    ).toThrow('review approval must provide expires_at');
  });

  it('rejects activation when not all review gate failures are exempted', () => {
    const initial = buildPublishRequestRecord({
      gate_result: mockGateResultWithTwoReviewFailures(),
      submitted_by: 'ops_admin',
      now: '2026-03-04T00:00:00.000Z',
    });
    const approved = applyPublishReview({
      record: initial,
      review: {
        decision: 'approve',
        reviewer: 'governance_lead',
        reason: 'temporary exception',
        expires_at: '2026-03-11T00:00:00.000Z',
      },
      now: '2026-03-04T00:30:00.000Z',
    });

    const tampered = {
      ...approved,
      payload: {
        ...(approved.payload as Record<string, unknown>),
        exemptions: (approved.payload.exemptions as unknown[]).slice(0, 1),
      },
    };

    expect(() =>
      applyPublishActivation({
        record: tampered,
        operator: 'release_bot',
        now: '2026-03-04T02:00:00.000Z',
      }),
    ).toThrow('publish request exemptions are missing or expired');
  });
});
