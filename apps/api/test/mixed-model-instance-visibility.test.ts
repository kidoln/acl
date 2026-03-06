import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthzModelConfig, DecisionEffect } from '@acl/shared-types';

import expectedFixtureRaw from './fixtures/mixed-model-instance-hybrid.expected.json';
import modelFixtureRaw from './fixtures/mixed-model-instance-hybrid.model.json';
import setupFixtureRaw from './fixtures/mixed-model-instance-hybrid.setup.json';

let app: FastifyInstance;
let previousPersistenceDriver: string | undefined;

interface PublishSubmitResponse {
  status: string;
}

interface FixtureDecisionInput {
  action: string;
  subject: {
    id: string;
    type?: string;
    attributes?: Record<string, unknown>;
  };
  object: {
    id: string;
    type?: string;
    sensitivity?: string;
    attributes?: Record<string, unknown>;
  };
  context?: Record<string, unknown>;
}

interface FixtureDecisionInputCase {
  name: string;
  mode: 'inline_model' | 'model_route';
  input: FixtureDecisionInput;
  options?: {
    relation_inference?: {
      enabled?: boolean;
      namespace?: string;
      max_relations_scan?: number;
    };
  };
}

interface SetupFixture {
  route: {
    tenant_id: string;
    environment: string;
  };
  namespace_prefix: string;
  objects: Array<{
    object_id: string;
    object_type: string;
    owner_ref: string;
    sensitivity: string;
  }>;
  relation_events: Array<{
    from: string;
    to: string;
    relation_type: string;
    operation: 'upsert' | 'delete';
  }>;
  decision_inputs: FixtureDecisionInputCase[];
}

interface FixtureExpectedRelationInference {
  enabled: boolean;
  applied?: boolean;
  reason?: string;
  rule_matches?: Record<string, boolean>;
}

interface FixtureDecisionExpectation {
  name: string;
  expected_effect: DecisionEffect;
  expected_matched_rule: string;
  expected_trace_matched_rules?: string[];
  expected_relation_inference: FixtureExpectedRelationInference;
  expected_context_values?: Record<string, unknown>;
}

interface ExpectedFixture {
  decision_expectations: FixtureDecisionExpectation[];
}

interface DecisionEvaluateResponse {
  decision: {
    final_effect: DecisionEffect;
    matched_rules: string[];
    request: {
      context?: Record<string, unknown>;
    };
  };
  traces?: Array<{
    rule_id: string;
    status: 'matched' | 'not_matched' | 'indeterminate';
  }>;
  relation_inference?: {
    applied: boolean;
    enabled: boolean;
    reason?: string;
    rules?: Array<{
      id: string;
      matched: boolean;
    }>;
  };
}

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

async function publishModel(input: {
  publishId: string;
  model: AuthzModelConfig;
}): Promise<void> {
  const submit = await app.inject({
    method: 'POST',
    url: '/publish/submit',
    payload: {
      publish_id: input.publishId,
      profile: 'baseline',
      submitted_by: 'test_operator',
      model: input.model,
      options: {
        available_obligation_executors: ['audit_write'],
      },
    },
  });
  expect(submit.statusCode).toBe(200);

  const submitBody = submit.json() as PublishSubmitResponse;
  if (submitBody.status === 'review_required') {
    const review = await app.inject({
      method: 'POST',
      url: '/publish/review',
      payload: {
        publish_id: input.publishId,
        decision: 'approve',
        reviewer: 'test_reviewer',
        reason: 'approve for mixed model-instance fixture e2e',
        expires_at: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(review.statusCode).toBe(200);
  } else {
    expect(['approved', 'published']).toContain(submitBody.status);
  }

  const activate = await app.inject({
    method: 'POST',
    url: '/publish/activate',
    payload: {
      publish_id: input.publishId,
      operator: 'release_bot',
    },
  });
  expect(activate.statusCode).toBe(200);
}

describe('mixed model-instance visibility e2e', () => {
  const expectedFixture = expectedFixtureRaw as ExpectedFixture;
  const baseModel = modelFixtureRaw as AuthzModelConfig;
  const setupFixture = setupFixtureRaw as SetupFixture;

  beforeEach(async () => {
    previousPersistenceDriver = process.env.ACL_PERSISTENCE_DRIVER;
    process.env.ACL_PERSISTENCE_DRIVER = 'memory';
    vi.resetModules();
    const moduleRef = await import('../src/main');
    app = moduleRef.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (previousPersistenceDriver === undefined) {
      delete process.env.ACL_PERSISTENCE_DRIVER;
    } else {
      process.env.ACL_PERSISTENCE_DRIVER = previousPersistenceDriver;
    }
  });

  it('supports mixed model and instance evaluation modes with deterministic precedence', async () => {
    const suffix = nextId('mixed_model_instance_case');
    const namespace = `${setupFixture.namespace_prefix}.${suffix}`;
    const publishId = nextId('pub_mixed_model_instance');

    const model = structuredClone(baseModel);
    model.model_meta.model_id = `${baseModel.model_meta.model_id}_${suffix}`;
    model.model_meta.tenant_id = setupFixture.route.tenant_id;
    model.model_meta.version = `2026.03.06.${Math.floor(Math.random() * 10000)}`;

    const validate = await app.inject({
      method: 'POST',
      url: '/models:validate',
      payload: {
        model,
        options: {
          available_obligation_executors: ['audit_write'],
        },
      },
    });
    expect(validate.statusCode).toBe(200);
    const validateBody = validate.json() as {
      valid: boolean;
      issues: Array<{ code: string }>;
    };
    expect(validateBody.valid).toBe(true);
    expect(validateBody.issues).toHaveLength(0);

    const expectedByCaseName = new Map(
      expectedFixture.decision_expectations.map((item) => [item.name, item]),
    );
    expect(expectedByCaseName.size).toBe(setupFixture.decision_inputs.length);

    const inlineCases = setupFixture.decision_inputs.filter((item) => item.mode === 'inline_model');
    const routedCases = setupFixture.decision_inputs.filter((item) => item.mode === 'model_route');
    expect(inlineCases.length).toBeGreaterThan(0);
    expect(routedCases.length).toBeGreaterThan(0);

    for (const testCase of inlineCases) {
      const expectedCase = expectedByCaseName.get(testCase.name);
      expect(expectedCase, `missing expected fixture for decision input: ${testCase.name}`).toBeDefined();
      if (!expectedCase) {
        continue;
      }

      const evaluate = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model,
          input: testCase.input,
          options: testCase.options,
        },
      });
      expect(evaluate.statusCode).toBe(200);

      const evaluateBody = evaluate.json() as DecisionEvaluateResponse;
      expect(evaluateBody.decision.final_effect).toBe(expectedCase.expected_effect);
      expect(evaluateBody.decision.matched_rules).toContain(expectedCase.expected_matched_rule);
      expect(evaluateBody.relation_inference?.enabled).toBe(
        expectedCase.expected_relation_inference.enabled,
      );

      if (expectedCase.expected_relation_inference.reason !== undefined) {
        expect(evaluateBody.relation_inference?.reason).toBe(
          expectedCase.expected_relation_inference.reason,
        );
      }
    }

    const upsertObjects = await app.inject({
      method: 'POST',
      url: '/control/objects:upsert',
      payload: {
        namespace,
        objects: setupFixture.objects,
      },
    });
    expect(upsertObjects.statusCode).toBe(200);

    const relationEvents = await app.inject({
      method: 'POST',
      url: '/control/relations:events',
      payload: {
        namespace,
        events: setupFixture.relation_events,
      },
    });
    expect(relationEvents.statusCode).toBe(200);

    await publishModel({
      publishId,
      model,
    });

    const upsertRoute = await app.inject({
      method: 'POST',
      url: '/control/model-routes:upsert',
      payload: {
        namespace,
        routes: [
          {
            tenant_id: setupFixture.route.tenant_id,
            environment: setupFixture.route.environment,
            model_id: model.model_meta.model_id,
            model_version: model.model_meta.version,
            publish_id: publishId,
            operator: 'ops_test',
          },
        ],
      },
    });
    expect(upsertRoute.statusCode).toBe(200);

    for (const testCase of routedCases) {
      const expectedCase = expectedByCaseName.get(testCase.name);
      expect(expectedCase, `missing expected fixture for decision input: ${testCase.name}`).toBeDefined();
      if (!expectedCase) {
        continue;
      }

      const evaluate = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: {
            namespace,
            tenant_id: setupFixture.route.tenant_id,
            environment: setupFixture.route.environment,
          },
          input: testCase.input,
          options: testCase.options,
        },
      });
      expect(evaluate.statusCode).toBe(200);

      const evaluateBody = evaluate.json() as DecisionEvaluateResponse;
      expect(evaluateBody.decision.final_effect).toBe(expectedCase.expected_effect);
      expect(evaluateBody.decision.matched_rules).toContain(expectedCase.expected_matched_rule);
      expect(evaluateBody.relation_inference?.enabled).toBe(
        expectedCase.expected_relation_inference.enabled,
      );

      if (expectedCase.expected_relation_inference.applied !== undefined) {
        expect(evaluateBody.relation_inference?.applied).toBe(
          expectedCase.expected_relation_inference.applied,
        );
      }

      if (expectedCase.expected_relation_inference.reason !== undefined) {
        expect(evaluateBody.relation_inference?.reason).toBe(
          expectedCase.expected_relation_inference.reason,
        );
      }

      if (expectedCase.expected_relation_inference.rule_matches) {
        const ruleById = new Map((evaluateBody.relation_inference?.rules ?? []).map((rule) => [rule.id, rule]));
        for (const [ruleId, expectedMatched] of Object.entries(
          expectedCase.expected_relation_inference.rule_matches,
        )) {
          expect(ruleById.get(ruleId)?.matched).toBe(expectedMatched);
        }
      }

      if (expectedCase.expected_trace_matched_rules) {
        const matchedTraceRules = (evaluateBody.traces ?? [])
          .filter((trace) => trace.status === 'matched')
          .map((trace) => trace.rule_id);

        expectedCase.expected_trace_matched_rules.forEach((ruleId) => {
          expect(matchedTraceRules).toContain(ruleId);
        });
      }

      if (expectedCase.expected_context_values) {
        for (const [contextKey, contextValue] of Object.entries(expectedCase.expected_context_values)) {
          expect(evaluateBody.decision.request.context?.[contextKey]).toEqual(contextValue);
        }
      }
    }
  });
});
