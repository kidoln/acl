import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthzModelConfig, DecisionEffect } from '@acl/shared-types';

import expectedFixtureRaw from './fixtures/same-company-derived.expected.json';
import modelFixtureRaw from './fixtures/same-company-derived.model.json';
import setupFixtureRaw from './fixtures/same-company-derived.setup.json';

let app: FastifyInstance;
let previousPersistenceDriver: string | undefined;

interface PublishSubmitResponse {
  status: string;
}

interface RelationInferenceRuleResponse {
  id: string;
  matched: boolean;
  subject_values: string[];
  object_values: string[];
  object_owner_ref?: string;
}

interface DecisionEvaluateResponse {
  decision: {
    final_effect: DecisionEffect;
  };
  relation_inference?: {
    applied: boolean;
    rules?: RelationInferenceRuleResponse[];
  };
}

interface ControlRelationListResponse {
  items: Array<{
    from: string;
    to: string;
    relation_type: string;
  }>;
  total_count: number;
}

interface FixtureDecisionInput {
  action: string;
  subject: {
    id: string;
    type: string;
  };
  object: {
    id: string;
    type: string;
    sensitivity: string;
    attributes?: Record<string, unknown>;
  };
}

interface FixtureDecisionInputCase {
  name: string;
  input: FixtureDecisionInput;
}

interface FixtureDecisionExpectation {
  name: string;
  expected_effect: DecisionEffect;
  expected_same_company: boolean;
  expected_subject_company: string;
  expected_object_company: string;
  expected_object_owner_ref?: string;
  expected_rule_matches: Record<string, boolean>;
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

interface ExpectedFixture {
  decision_expectations: FixtureDecisionExpectation[];
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
        reason: 'approve for same-company visibility e2e',
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

describe('same-company derived resource visibility e2e', () => {
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

  it('loads model file and evaluates subject/object instances correctly', async () => {
    const suffix = nextId('same_company_case');
    const namespace = `${setupFixture.namespace_prefix}.${suffix}`;
    const publishId = nextId('pub_same_company');

    const model = structuredClone(baseModel);
    model.model_meta.model_id = `${baseModel.model_meta.model_id}_${suffix}`;
    model.model_meta.tenant_id = setupFixture.route.tenant_id;
    model.model_meta.version = `2026.03.04.${Math.floor(Math.random() * 10000)}`;

    expect((model.catalogs.relation_type_catalog ?? []).includes('in_company')).toBe(false);
    expect(
      setupFixture.relation_events.some((event) => event.relation_type === 'in_company'),
    ).toBe(false);

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

    const listRelations = await app.inject({
      method: 'GET',
      url: `/control/relations?namespace=${encodeURIComponent(namespace)}&limit=100&offset=0`,
    });
    expect(listRelations.statusCode).toBe(200);
    const relationListBody = listRelations.json() as ControlRelationListResponse;
    expect(relationListBody.total_count).toBeGreaterThanOrEqual(setupFixture.relation_events.length);
    expect(
      relationListBody.items.some(
        (item) =>
          item.from === 'user:alice'
          && item.to === 'department:rnd'
          && item.relation_type === 'belongs_to_department',
      ),
    ).toBe(true);
    expect(
      relationListBody.items.some(
        (item) =>
          item.from === 'department:rnd'
          && item.to === 'company:acme'
          && item.relation_type === 'belongs_to_company',
      ),
    ).toBe(true);
    expect(
      relationListBody.items.some(
        (item) =>
          item.from === 'department:legal'
          && item.to === 'company:acme'
          && item.relation_type === 'belongs_to_company',
      ),
    ).toBe(true);

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

    const expectedByCaseName = new Map(
      expectedFixture.decision_expectations.map((item) => [item.name, item]),
    );
    expect(expectedByCaseName.size).toBe(setupFixture.decision_inputs.length);

    for (const testCase of setupFixture.decision_inputs) {
      const expectedCase = expectedByCaseName.get(testCase.name);
      expect(
        expectedCase,
        `missing expected fixture for decision input: ${testCase.name}`,
      ).toBeDefined();
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
        },
      });
      expect(evaluate.statusCode).toBe(200);

      const evaluateBody = evaluate.json() as DecisionEvaluateResponse;
      expect(evaluateBody.decision.final_effect).toBe(expectedCase.expected_effect);

      expect(evaluateBody.relation_inference?.applied).toBe(true);
      const ruleList = evaluateBody.relation_inference?.rules ?? [];
      const ruleById = new Map(ruleList.map((rule) => [rule.id, rule]));
      const matchedAnyRule = ruleList.some((rule) => rule.matched);
      expect(matchedAnyRule).toBe(expectedCase.expected_same_company);

      for (const [ruleId, expectedMatched] of Object.entries(expectedCase.expected_rule_matches)) {
        const rule = ruleById.get(ruleId);
        expect(rule?.matched).toBe(expectedMatched);
        expect(rule?.subject_values).toContain(expectedCase.expected_subject_company);
        if (expectedMatched) {
          expect(rule?.object_values).toContain(expectedCase.expected_object_company);
        }
      }

      if (expectedCase.expected_object_owner_ref) {
        const directRule = ruleById.get('infer_same_company_direct');
        expect(directRule?.object_owner_ref).toBe(expectedCase.expected_object_owner_ref);
      }
    }
  });
});
