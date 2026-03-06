import fs from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthzModelConfig, DecisionEffect } from '@acl/shared-types';

type DecisionMode = 'inline_model' | 'model_route';

interface PublishSubmitResponse {
  status: string;
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
    owner_ref?: string;
    sensitivity?: string;
    labels?: string[];
  }>;
  relation_events: Array<{
    from: string;
    to: string;
    relation_type: string;
    operation: 'upsert' | 'delete';
    scope?: string;
    source?: string;
  }>;
  decision_inputs: Array<{
    name: string;
    mode?: DecisionMode;
    input: {
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
    };
    options?: {
      relation_inference?: {
        enabled?: boolean;
        namespace?: string;
        max_relations_scan?: number;
      };
    };
  }>;
}

interface ExpectedRuleAssertion {
  matched: boolean;
  subject_values_contains: string[];
  object_values_contains: string[];
  object_owner_ref?: string;
}

interface ExpectedRelationInferenceAssertion {
  enabled: boolean | null;
  applied: boolean | null;
  reason: string | null;
}

interface FixtureDecisionExpectation {
  name: string;
  mode: DecisionMode;
  expected_effect: DecisionEffect;
  expected_any_rule_matched: boolean;
  expected_rules: Record<string, ExpectedRuleAssertion>;
  expected_matched_rules_contains: string[];
  expected_trace_matched_rules_contains: string[];
  expected_relation_inference: ExpectedRelationInferenceAssertion;
  expected_context_values: Record<string, unknown>;
}

interface ExpectedFixture {
  required_relations: Array<{
    from: string;
    to: string;
    relation_type: string;
  }>;
  decision_expectations: FixtureDecisionExpectation[];
}

interface ControlRelationListResponse {
  items: Array<{
    from: string;
    to: string;
    relation_type: string;
  }>;
  total_count: number;
}

interface DecisionEvaluateResponse {
  decision: {
    final_effect: DecisionEffect;
    matched_rules?: string[];
    request?: {
      context?: Record<string, unknown>;
    };
  };
  traces?: Array<{
    rule_id: string;
    status: 'matched' | 'not_matched' | 'indeterminate';
  }>;
  relation_inference?: {
    enabled?: boolean;
    applied?: boolean;
    reason?: string;
    rules?: Array<{
      id: string;
      matched: boolean;
      subject_values?: string[];
      object_values?: string[];
      object_owner_ref?: string;
    }>;
  };
}

interface FixtureBundle {
  id: string;
  setupFileName: string;
  modelFileName: string;
  expectedFileName: string;
}

let app: FastifyInstance;
let previousPersistenceDriver: string | undefined;

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

function fixtureDir(): string {
  return path.resolve(__dirname, 'fixtures');
}

function listFixtureBundles(): FixtureBundle[] {
  const fixtureDirectory = fixtureDir();
  const setupFileNames = fs
    .readdirSync(fixtureDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.setup.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return setupFileNames.map((setupFileName) => {
    const fixtureId = setupFileName.replace(/\.setup\.json$/u, '');
    const modelFileName = `${fixtureId}.model.json`;
    const expectedFileName = `${fixtureId}.expected.json`;

    const modelPath = path.resolve(fixtureDirectory, modelFileName);
    const expectedPath = path.resolve(fixtureDirectory, expectedFileName);
    expect(
      fs.existsSync(modelPath),
      `missing model fixture for ${fixtureId}: ${modelFileName}`,
    ).toBe(true);
    expect(
      fs.existsSync(expectedPath),
      `missing expected fixture for ${fixtureId}: ${expectedFileName}`,
    ).toBe(true);

    return {
      id: fixtureId,
      setupFileName,
      modelFileName,
      expectedFileName,
    };
  });
}

async function publishModel(input: {
  publishId: string;
  model: AuthzModelConfig;
  reason: string;
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
        reason: input.reason,
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

function assertRelationInference(
  evaluateBody: DecisionEvaluateResponse,
  expectation: FixtureDecisionExpectation,
): void {
  const relationRules = evaluateBody.relation_inference?.rules ?? [];
  const relationRuleById = new Map(relationRules.map((rule) => [rule.id, rule]));

  const matchedAnyRule = relationRules.some((rule) => rule.matched);
  expect(matchedAnyRule).toBe(expectation.expected_any_rule_matched);

  if (expectation.expected_relation_inference.enabled !== null) {
    expect(evaluateBody.relation_inference?.enabled).toBe(
      expectation.expected_relation_inference.enabled,
    );
  }

  if (expectation.expected_relation_inference.applied !== null) {
    expect(evaluateBody.relation_inference?.applied).toBe(
      expectation.expected_relation_inference.applied,
    );
  }

  if (expectation.expected_relation_inference.reason !== null) {
    expect(evaluateBody.relation_inference?.reason).toBe(
      expectation.expected_relation_inference.reason,
    );
  }

  for (const [ruleId, ruleExpectation] of Object.entries(expectation.expected_rules)) {
    const rule = relationRuleById.get(ruleId);
    expect(rule, `missing relation inference rule: ${ruleId}`).toBeDefined();
    if (!rule) {
      continue;
    }

    expect(rule.matched).toBe(ruleExpectation.matched);

    ruleExpectation.subject_values_contains.forEach((value) => {
      expect(rule.subject_values ?? []).toContain(value);
    });

    ruleExpectation.object_values_contains.forEach((value) => {
      expect(rule.object_values ?? []).toContain(value);
    });

    if (ruleExpectation.object_owner_ref !== undefined) {
      expect(rule.object_owner_ref).toBe(ruleExpectation.object_owner_ref);
    }
  }
}

function assertDecisionPayload(
  evaluateBody: DecisionEvaluateResponse,
  expectation: FixtureDecisionExpectation,
): void {
  expect(evaluateBody.decision.final_effect).toBe(expectation.expected_effect);

  const matchedRules = evaluateBody.decision.matched_rules ?? [];
  expectation.expected_matched_rules_contains.forEach((ruleId) => {
    expect(matchedRules).toContain(ruleId);
  });

  if (expectation.expected_trace_matched_rules_contains.length > 0) {
    const matchedTraceRules = (evaluateBody.traces ?? [])
      .filter((trace) => trace.status === 'matched')
      .map((trace) => trace.rule_id);

    expectation.expected_trace_matched_rules_contains.forEach((ruleId) => {
      expect(matchedTraceRules).toContain(ruleId);
    });
  }

  for (const [key, value] of Object.entries(expectation.expected_context_values)) {
    expect(evaluateBody.decision.request?.context?.[key]).toEqual(value);
  }
}

async function evaluateCase(input: {
  fixtureId: string;
  setupFixture: SetupFixture;
  model: AuthzModelConfig;
  namespace: string;
  testCase: SetupFixture['decision_inputs'][number];
  expectation: FixtureDecisionExpectation;
}): Promise<void> {
  const isInlineModel = input.expectation.mode === 'inline_model';
  const payload: Record<string, unknown> = {
    input: input.testCase.input,
  };

  if (input.testCase.options !== undefined) {
    payload.options = input.testCase.options;
  }

  if (isInlineModel) {
    payload.model = input.model;
  } else {
    payload.model_route = {
      namespace: input.namespace,
      tenant_id: input.setupFixture.route.tenant_id,
      environment: input.setupFixture.route.environment,
    };
  }

  const evaluate = await app.inject({
    method: 'POST',
    url: '/decisions:evaluate',
    payload,
  });
  expect(
    evaluate.statusCode,
    `[${input.fixtureId}] evaluation failed for case: ${input.testCase.name}`,
  ).toBe(200);

  const evaluateBody = evaluate.json() as DecisionEvaluateResponse;
  assertDecisionPayload(evaluateBody, input.expectation);
  assertRelationInference(evaluateBody, input.expectation);
}

const fixtureBundles = listFixtureBundles();

describe('fixtures e2e suite', () => {
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

  for (const bundle of fixtureBundles) {
    it(`runs fixture: ${bundle.id}`, async () => {
      const setupFixturePath = path.resolve(fixtureDir(), bundle.setupFileName);
      const modelFixturePath = path.resolve(fixtureDir(), bundle.modelFileName);
      const expectedFixturePath = path.resolve(fixtureDir(), bundle.expectedFileName);

      const setupFixture = readJsonFile<SetupFixture>(setupFixturePath);
      const baseModel = readJsonFile<AuthzModelConfig>(modelFixturePath);
      const expectedFixture = readJsonFile<ExpectedFixture>(expectedFixturePath);

      const suffix = nextId(`${bundle.id}_case`);
      const namespace = `${setupFixture.namespace_prefix}.${suffix}`;
      const publishId = nextId(`pub_${bundle.id}`);

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

      const inlineCases: SetupFixture['decision_inputs'] = [];
      const routedCases: SetupFixture['decision_inputs'] = [];
      setupFixture.decision_inputs.forEach((testCase) => {
        const expectedCase = expectedByCaseName.get(testCase.name);
        expect(
          expectedCase,
          `[${bundle.id}] missing expected fixture for decision input: ${testCase.name}`,
        ).toBeDefined();
        if (!expectedCase) {
          return;
        }

        if (expectedCase.mode === 'inline_model') {
          inlineCases.push(testCase);
        } else {
          routedCases.push(testCase);
        }
      });

      for (const testCase of inlineCases) {
        const expectedCase = expectedByCaseName.get(testCase.name);
        if (!expectedCase) {
          continue;
        }

        await evaluateCase({
          fixtureId: bundle.id,
          setupFixture,
          model,
          namespace,
          testCase,
          expectation: expectedCase,
        });
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

      const listRelations = await app.inject({
        method: 'GET',
        url: `/control/relations?namespace=${encodeURIComponent(namespace)}&limit=100&offset=0`,
      });
      expect(listRelations.statusCode).toBe(200);
      const relationListBody = listRelations.json() as ControlRelationListResponse;
      expect(relationListBody.total_count).toBeGreaterThanOrEqual(
        setupFixture.relation_events.length,
      );

      expectedFixture.required_relations.forEach((relation) => {
        expect(
          relationListBody.items.some(
            (item) =>
              item.from === relation.from
              && item.to === relation.to
              && item.relation_type === relation.relation_type,
          ),
          `[${bundle.id}] required relation not found: ${relation.from} -${relation.relation_type}-> ${relation.to}`,
        ).toBe(true);
      });

      await publishModel({
        publishId,
        model,
        reason: `approve for fixture e2e: ${bundle.id}`,
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
        if (!expectedCase) {
          continue;
        }

        await evaluateCase({
          fixtureId: bundle.id,
          setupFixture,
          model,
          namespace,
          testCase,
          expectation: expectedCase,
        });
      }
    });
  }
});
