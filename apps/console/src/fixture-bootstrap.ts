import type { AclApiClient } from "./acl-api-client";
import { loadModelFixtureById } from "./setup-fixtures";

interface FixtureRouteInput {
  tenant_id: string;
  environment: string;
}

export interface FixtureBootstrapSummary {
  publish_id: string;
  publish_status: string;
  model_id: string;
  model_version?: string;
  tenant_id: string;
  environment: string;
  auto_reviewed: boolean;
  auto_activated: boolean;
}

export type FixtureBootstrapResult =
  | {
      ok: true;
      route: {
        tenant_id: string;
        environment: string;
        model_id: string;
        model_version?: string;
        publish_id: string;
        operator: string;
      };
      summary: FixtureBootstrapSummary;
    }
  | {
      ok: false;
      step:
        | "load_model_fixture"
        | "publish_submit"
        | "publish_review"
        | "publish_activate"
        | "model_meta";
      error: string;
    };

const FIXTURE_SETUP_SUBMITTER = "console_fixture_setup";
const FIXTURE_SETUP_OPERATOR = "console_fixture_setup";
const AUTO_REVIEW_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readModelMeta(model: Record<string, unknown>): {
  model_id: string;
  tenant_id: string;
  version?: string;
} | null {
  const meta = asRecord(model.model_meta);
  const modelId = normalizeString(meta?.model_id);
  const tenantId = normalizeString(meta?.tenant_id);
  const version = normalizeString(meta?.version);
  if (!modelId || !tenantId) {
    return null;
  }
  return {
    model_id: modelId,
    tenant_id: tenantId,
    version,
  };
}

function buildFixturePublishId(fixtureId: string, namespace: string): string {
  const normalizedNamespace = namespace
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  const suffix = normalizedNamespace.length > 0 ? normalizedNamespace : "default";
  return `fixture_${fixtureId}_${suffix}`;
}

export async function bootstrapFixtureRoute(input: {
  client: AclApiClient;
  fixtureId: string;
  namespace: string;
  route: FixtureRouteInput;
}): Promise<FixtureBootstrapResult> {
  const loadedModel = loadModelFixtureById(input.fixtureId);
  if (!loadedModel) {
    return {
      ok: false,
      step: "load_model_fixture",
      error: `fixture model 不存在或格式非法: ${input.fixtureId}`,
    };
  }

  const modelMeta = readModelMeta(loadedModel.model);
  if (!modelMeta) {
    return {
      ok: false,
      step: "model_meta",
      error: "fixture model 缺少有效的 model_meta.model_id / tenant_id",
    };
  }

  if (modelMeta.tenant_id !== input.route.tenant_id) {
    return {
      ok: false,
      step: "model_meta",
      error:
        `fixture model tenant_id=${modelMeta.tenant_id} 与 setup route tenant_id=${input.route.tenant_id} 不一致`,
    };
  }

  const publishId = buildFixturePublishId(input.fixtureId, input.namespace);
  const submitResult = await input.client.submitPublishRequest({
    model: loadedModel.model,
    publish_id: publishId,
    profile: "baseline",
    submitted_by: FIXTURE_SETUP_SUBMITTER,
  });

  if (!submitResult.ok) {
    return {
      ok: false,
      step: "publish_submit",
      error: submitResult.error,
    };
  }

  let publishStatus =
    typeof submitResult.data.status === "string"
      ? submitResult.data.status
      : "unknown";
  const resolvedPublishId =
    typeof submitResult.data.publish_id === "string"
      ? submitResult.data.publish_id
      : publishId;
  let autoReviewed = false;
  let autoActivated = false;

  if (publishStatus === "review_required") {
    const reviewResult = await input.client.reviewPublishRequest({
      publish_id: resolvedPublishId,
      decision: "approve",
      reviewer: FIXTURE_SETUP_OPERATOR,
      reason: `fixture setup auto approve: ${input.fixtureId}`,
      expires_at: new Date(Date.now() + AUTO_REVIEW_EXPIRE_MS).toISOString(),
    });
    if (!reviewResult.ok) {
      return {
        ok: false,
        step: "publish_review",
        error: reviewResult.error,
      };
    }
    publishStatus = reviewResult.data.status;
    autoReviewed = true;
  }

  if (publishStatus === "approved") {
    const activateResult = await input.client.activatePublishRequest({
      publish_id: resolvedPublishId,
      operator: FIXTURE_SETUP_OPERATOR,
    });
    if (!activateResult.ok) {
      return {
        ok: false,
        step: "publish_activate",
        error: activateResult.error,
      };
    }
    publishStatus = activateResult.data.status;
    autoActivated = true;
  }

  if (publishStatus !== "published") {
    return {
      ok: false,
      step: "publish_activate",
      error: `fixture model 发布后状态异常: ${publishStatus}`,
    };
  }

  return {
    ok: true,
    route: {
      tenant_id: input.route.tenant_id,
      environment: input.route.environment,
      model_id: modelMeta.model_id,
      model_version: modelMeta.version,
      publish_id: resolvedPublishId,
      operator: FIXTURE_SETUP_OPERATOR,
    },
    summary: {
      publish_id: resolvedPublishId,
      publish_status: publishStatus,
      model_id: modelMeta.model_id,
      model_version: modelMeta.version,
      tenant_id: input.route.tenant_id,
      environment: input.route.environment,
      auto_reviewed: autoReviewed,
      auto_activated: autoActivated,
    },
  };
}
