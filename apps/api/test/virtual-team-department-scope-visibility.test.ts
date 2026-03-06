import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthzModelConfig, DecisionEffect } from '@acl/shared-types';

import expectedFixtureRaw from './fixtures/virtual-team-department-scope.expected.json';
import modelFixtureRaw from './fixtures/virtual-team-department-scope.model.json';
import setupFixtureRaw from './fixtures/virtual-team-department-scope.setup.json';

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

interface FixtureRuleExpectation {
  matched: boolean;
  subject_values_contains?: string[];
  object_values_contains?: string[];
  object_owner_ref?: string;
}

interface FixtureDecisionExpectation {
  name: string;
  expected_effect: DecisionEffect;
  expected_any_rule_matched: boolean;
  expected_rules: Record<string, FixtureRuleExpectation>;
}

interface SetupFixture {
  route: {
    tenant_id: string;
    environment: string;
  };
  namespace_prefix: string;
  catalog_registration: {
    system_id: string;
    catalogs: {
      action_catalog: string[];
      object_type_catalog: string[];
      relation_type_catalog: string[];
    };
  };
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
        reason: 'approve for virtual-team department visibility e2e',
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

describe('virtual-team department-scoped visibility e2e', () => {
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

  it('loads model file and evaluates virtual-team and department-scoped instances', async () => {
    const suffix = nextId('virtual_team_dept_case');
    const namespace = `${setupFixture.namespace_prefix}.${suffix}`;
    const publishId = nextId('pub_virtual_team_dept');

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

    const registerCatalog = await app.inject({
      method: 'POST',
      url: '/control/catalogs:register',
      payload: {
        system_id: setupFixture.catalog_registration.system_id,
        namespace,
        catalogs: setupFixture.catalog_registration.catalogs,
      },
    });
    expect(registerCatalog.statusCode).toBe(200);

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
          item.from === 'user:bob'
          && item.to === 'virtual_team:project_neo'
          && item.relation_type === 'member_of_virtual_team',
      ),
    ).toBe(true);
    expect(
      relationListBody.items.some(
        (item) =>
          item.from === 'virtual_team:project_neo'
          && item.to === 'user:alice'
          && item.relation_type === 'virtual_team_created_by',
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
      expect(
        evaluateBody.decision.final_effect,
        `unexpected effect for case: ${testCase.name}`,
      ).toBe(expectedCase.expected_effect);

      expect(evaluateBody.relation_inference?.applied).toBe(true);
      const ruleList = evaluateBody.relation_inference?.rules ?? [];
      const ruleById = new Map(ruleList.map((rule) => [rule.id, rule]));
      const matchedAnyRule = ruleList.some((rule) => rule.matched);
      expect(matchedAnyRule).toBe(expectedCase.expected_any_rule_matched);

      for (const [ruleId, ruleExpectation] of Object.entries(expectedCase.expected_rules)) {
        const rule = ruleById.get(ruleId);
        expect(rule, `missing inference rule response: ${ruleId}`).toBeDefined();
        expect(rule?.matched).toBe(ruleExpectation.matched);

        const expectedSubjectValues = ruleExpectation.subject_values_contains ?? [];
        expectedSubjectValues.forEach((value) => {
          expect(rule?.subject_values ?? []).toContain(value);
        });

        const expectedObjectValues = ruleExpectation.object_values_contains ?? [];
        expectedObjectValues.forEach((value) => {
          expect(rule?.object_values ?? []).toContain(value);
        });

        if (ruleExpectation.object_owner_ref !== undefined) {
          expect(rule?.object_owner_ref).toBe(ruleExpectation.object_owner_ref);
        }
      }
    }
  });
});
