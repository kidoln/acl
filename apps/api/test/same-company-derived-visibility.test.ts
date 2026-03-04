import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthzModelConfig, DecisionEffect } from '@acl/shared-types';

import { app } from '../src/main';
import instanceFixtureRaw from './fixtures/same-company-derived.instances.json';
import modelFixtureRaw from './fixtures/same-company-derived.model.json';

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
  };
}

interface FixtureDecisionCase {
  name: string;
  input: FixtureDecisionInput;
  expected_effect: DecisionEffect;
  expected_same_company: boolean;
  expected_subject_company: string;
  expected_object_company: string;
  expected_object_owner_ref?: string;
}

interface InstanceFixture {
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
  decision_cases: FixtureDecisionCase[];
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
  const instanceFixture = instanceFixtureRaw as InstanceFixture;
  const baseModel = modelFixtureRaw as AuthzModelConfig;

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('loads model file and evaluates subject/object instances correctly', async () => {
    const suffix = nextId('same_company_case');
    const namespace = `${instanceFixture.namespace_prefix}.${suffix}`;
    const publishId = nextId('pub_same_company');

    const model = structuredClone(baseModel);
    model.model_meta.model_id = `${baseModel.model_meta.model_id}_${suffix}`;
    model.model_meta.tenant_id = instanceFixture.route.tenant_id;
    model.model_meta.version = `2026.03.04.${Math.floor(Math.random() * 10000)}`;

    expect(model.relations.subject_relations).toEqual([]);
    expect(model.relations.object_relations).toEqual([]);
    expect(model.relations.subject_object_relations).toEqual([]);

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
        system_id: instanceFixture.catalog_registration.system_id,
        namespace,
        catalogs: instanceFixture.catalog_registration.catalogs,
      },
    });
    expect(registerCatalog.statusCode).toBe(200);

    const upsertObjects = await app.inject({
      method: 'POST',
      url: '/control/objects:upsert',
      payload: {
        namespace,
        objects: instanceFixture.objects,
      },
    });
    expect(upsertObjects.statusCode).toBe(200);

    const relationEvents = await app.inject({
      method: 'POST',
      url: '/control/relations:events',
      payload: {
        namespace,
        events: instanceFixture.relation_events,
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
            tenant_id: instanceFixture.route.tenant_id,
            environment: instanceFixture.route.environment,
            model_id: model.model_meta.model_id,
            model_version: model.model_meta.version,
            publish_id: publishId,
            operator: 'ops_test',
          },
        ],
      },
    });
    expect(upsertRoute.statusCode).toBe(200);

    for (const testCase of instanceFixture.decision_cases) {
      const evaluate = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: {
            namespace,
            tenant_id: instanceFixture.route.tenant_id,
            environment: instanceFixture.route.environment,
          },
          input: testCase.input,
        },
      });
      expect(evaluate.statusCode).toBe(200);

      const evaluateBody = evaluate.json() as DecisionEvaluateResponse;
      expect(evaluateBody.decision.final_effect).toBe(testCase.expected_effect);

      const inferenceRule = evaluateBody.relation_inference?.rules?.[0];
      expect(evaluateBody.relation_inference?.applied).toBe(true);
      expect(inferenceRule?.id).toBe('infer_same_company');
      expect(inferenceRule?.matched).toBe(testCase.expected_same_company);
      expect(inferenceRule?.subject_values).toContain(testCase.expected_subject_company);
      expect(inferenceRule?.object_values).toContain(testCase.expected_object_company);

      if (testCase.expected_object_owner_ref) {
        expect(inferenceRule?.object_owner_ref).toBe(testCase.expected_object_owner_ref);
      }
    }
  });
});
