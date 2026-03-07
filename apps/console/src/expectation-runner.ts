import fs from 'node:fs';
import path from 'node:path';

import { AclApiClient } from './acl-api-client';
import type {
  DecisionEvaluateResponse,
  ExpectationRunCaseResult,
  ExpectationRunMode,
  ExpectationRunReport,
} from './types';

export interface SetupDecisionInput {
  name: string;
  mode?: ExpectationRunMode;
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
}

interface UploadedSetupFixture {
  route?: {
    tenant_id: string;
    environment: string;
  };
  namespace_prefix?: string;
  decision_inputs: SetupDecisionInput[];
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
  mode: ExpectationRunMode;
  expected_effect: string;
  expected_any_rule_matched: boolean;
  expected_rules: Record<string, ExpectedRuleAssertion>;
  expected_matched_rules_contains: string[];
  expected_trace_matched_rules_contains: string[];
  expected_relation_inference: ExpectedRelationInferenceAssertion;
  expected_context_values: Record<string, unknown>;
}

interface ExpectedFixture {
  required_relations?: Array<{
    from: string;
    to: string;
    relation_type: string;
  }>;
  decision_expectations: FixtureDecisionExpectation[];
}


export interface AppliedExpectationExecutionPlan {
  fixture_id?: string;
  tenant_id?: string;
  environment?: string;
  decision_inputs: SetupDecisionInput[];
}

interface RunExpectationInput {
  client: AclApiClient;
  namespace: string;
  tenant_id?: string;
  environment?: string;
  fixture_id?: string;
  execution_plan?: AppliedExpectationExecutionPlan;
  expectation_json: string;
  expectation_file_name?: string;
}

interface RunExpectationResult {
  ok: true;
  report: ExpectationRunReport;
}

interface RunExpectationFailure {
  ok: false;
  error: string;
}

const MODEL_ROUTE_UNAVAILABLE_ERROR =
  'model route not found or mapped published model is unavailable';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function readFixtureDirectory(): string {
  return path.resolve(__dirname, '../../api/test/fixtures');
}

function buildRunId(): string {
  return `exp_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function parseJsonObject(
  raw: string,
  fieldName: string,
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid json';
    return {
      ok: false,
      error: `${fieldName} 解析失败: ${message}`,
    };
  }

  const record = asRecord(parsed);
  if (!record) {
    return {
      ok: false,
      error: `${fieldName} 必须是 JSON Object`,
    };
  }

  return {
    ok: true,
    data: record,
  };
}

function parseSetupFixture(raw: Record<string, unknown>): UploadedSetupFixture | null {
  const routeRecord = asRecord(raw.route);
  const routeTenantId = normalizeString(routeRecord?.tenant_id);
  const routeEnvironment = normalizeString(routeRecord?.environment);
  const route =
    routeTenantId && routeEnvironment
      ? {
          tenant_id: routeTenantId,
          environment: routeEnvironment,
        }
      : undefined;

  const decisionInputs = Array.isArray(raw.decision_inputs)
    ? raw.decision_inputs.reduce<SetupDecisionInput[]>((acc, item) => {
        const record = asRecord(item);
        const inputRecord = asRecord(record?.input);
        const subjectRecord = asRecord(inputRecord?.subject);
        const objectRecord = asRecord(inputRecord?.object);
        if (!record || !inputRecord || !subjectRecord || !objectRecord) {
          return acc;
        }

        const name = normalizeString(record.name);
        const action = normalizeString(inputRecord.action);
        const subjectId = normalizeString(subjectRecord.id);
        const objectId = normalizeString(objectRecord.id);
        if (!name || !action || !subjectId || !objectId) {
          return acc;
        }

        const optionRecord = asRecord(record.options);
        const relationInferenceRecord = asRecord(optionRecord?.relation_inference);
        acc.push({
          name,
          mode:
            record.mode === 'inline_model' || record.mode === 'model_route'
              ? record.mode
              : undefined,
          input: {
            action,
            subject: {
              id: subjectId,
              type: normalizeString(subjectRecord.type),
              attributes: asRecord(subjectRecord.attributes) ?? undefined,
            },
            object: {
              id: objectId,
              type: normalizeString(objectRecord.type),
              sensitivity: normalizeString(objectRecord.sensitivity),
              attributes: asRecord(objectRecord.attributes) ?? undefined,
            },
            context: asRecord(inputRecord.context) ?? undefined,
          },
          options: relationInferenceRecord
            ? {
                relation_inference: {
                  enabled:
                    typeof relationInferenceRecord.enabled === 'boolean'
                      ? relationInferenceRecord.enabled
                      : undefined,
                  namespace: normalizeString(relationInferenceRecord.namespace),
                  max_relations_scan:
                    typeof relationInferenceRecord.max_relations_scan === 'number'
                      ? relationInferenceRecord.max_relations_scan
                      : undefined,
                },
              }
            : undefined,
        });
        return acc;
      }, [])
    : [];

  if (decisionInputs.length === 0) {
    return null;
  }

  return {
    route,
    namespace_prefix: normalizeString(raw.namespace_prefix),
    decision_inputs: decisionInputs,
  };
}

function parseExpectedFixture(raw: Record<string, unknown>): ExpectedFixture | null {
  const decisionExpectations = Array.isArray(raw.decision_expectations)
    ? raw.decision_expectations.reduce<FixtureDecisionExpectation[]>((acc, item) => {
        const record = asRecord(item);
        const relationInferenceRecord = asRecord(record?.expected_relation_inference);
        const expectedRulesRecord = asRecord(record?.expected_rules);
        if (!record || !relationInferenceRecord || !expectedRulesRecord) {
          return acc;
        }

        const name = normalizeString(record.name);
        const mode = record.mode === 'inline_model' || record.mode === 'model_route'
          ? record.mode
          : undefined;
        const expectedEffect = normalizeString(record.expected_effect);
        if (
          !name
          || !mode
          || !expectedEffect
          || typeof record.expected_any_rule_matched !== 'boolean'
        ) {
          return acc;
        }

        const expectedRules = Object.entries(expectedRulesRecord).reduce<
          Record<string, ExpectedRuleAssertion>
        >((ruleAcc, [ruleId, ruleValue]) => {
          const ruleRecord = asRecord(ruleValue);
          if (!ruleRecord || typeof ruleRecord.matched !== 'boolean') {
            return ruleAcc;
          }
          ruleAcc[ruleId] = {
            matched: ruleRecord.matched,
            subject_values_contains: normalizeStringArray(
              ruleRecord.subject_values_contains,
            ),
            object_values_contains: normalizeStringArray(
              ruleRecord.object_values_contains,
            ),
            object_owner_ref: normalizeString(ruleRecord.object_owner_ref),
          };
          return ruleAcc;
        }, {});

        acc.push({
          name,
          mode,
          expected_effect: expectedEffect,
          expected_any_rule_matched: record.expected_any_rule_matched,
          expected_rules: expectedRules,
          expected_matched_rules_contains: normalizeStringArray(
            record.expected_matched_rules_contains,
          ),
          expected_trace_matched_rules_contains: normalizeStringArray(
            record.expected_trace_matched_rules_contains,
          ),
          expected_relation_inference: {
            enabled:
              typeof relationInferenceRecord.enabled === 'boolean'
                ? relationInferenceRecord.enabled
                : null,
            applied:
              typeof relationInferenceRecord.applied === 'boolean'
                ? relationInferenceRecord.applied
                : null,
            reason:
              relationInferenceRecord.reason === null
              || typeof relationInferenceRecord.reason === 'string'
                ? (relationInferenceRecord.reason as string | null)
                : null,
          },
          expected_context_values: asRecord(record.expected_context_values) ?? {},
        });
        return acc;
      }, [])
    : [];

  if (decisionExpectations.length === 0) {
    return null;
  }

  return {
    decision_expectations: decisionExpectations,
  };
}

function loadFixtureJsonById(
  fixtureId: string,
  suffix: '.setup.json' | '.model.json',
): Record<string, unknown> | null {
  const trimmedId = fixtureId.trim();
  if (trimmedId.length === 0 || !/^[a-zA-Z0-9._-]+$/u.test(trimmedId)) {
    return null;
  }

  const filePath = path.resolve(readFixtureDirectory(), `${trimmedId}${suffix}`);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}


export function loadExecutionPlanFromFixtureId(
  fixtureId: string,
): AppliedExpectationExecutionPlan | null {
  const setupFromFixture = loadFixtureJsonById(fixtureId, '.setup.json');
  const setupFixture = setupFromFixture ? parseSetupFixture(setupFromFixture) : null;
  if (!setupFixture) {
    return null;
  }

  return {
    fixture_id: fixtureId,
    tenant_id: setupFixture.route?.tenant_id,
    environment: setupFixture.route?.environment,
    decision_inputs: setupFixture.decision_inputs,
  };
}

function assertDecisionPayload(
  body: DecisionEvaluateResponse,
  expectation: FixtureDecisionExpectation,
): string[] {
  const errors: string[] = [];
  if (body.decision.final_effect !== expectation.expected_effect) {
    errors.push(
      `final_effect 期望 ${expectation.expected_effect}，实际 ${body.decision.final_effect}`,
    );
  }

  const matchedRules = Array.isArray(body.decision.matched_rules)
    ? body.decision.matched_rules
    : [];
  const matchedAnyRule = matchedRules.length > 0;
  if (matchedAnyRule !== expectation.expected_any_rule_matched) {
    errors.push(
      `matched_any_rule 期望 ${String(expectation.expected_any_rule_matched)}，实际 ${String(matchedAnyRule)}`,
    );
  }

  expectation.expected_matched_rules_contains.forEach((ruleId) => {
    if (!matchedRules.includes(ruleId)) {
      errors.push(`matched_rules 缺少 ${ruleId}`);
    }
  });

  const traceMatchedRules = Array.isArray(body.traces)
    ? body.traces
        .filter((item) => item.status === 'matched')
        .map((item) => item.rule_id)
    : [];
  expectation.expected_trace_matched_rules_contains.forEach((ruleId) => {
    if (!traceMatchedRules.includes(ruleId)) {
      errors.push(`traces.matched 缺少 ${ruleId}`);
    }
  });

  const actualContext = asRecord(body.decision.request?.context) ?? {};
  Object.entries(expectation.expected_context_values).forEach(([key, value]) => {
    if (actualContext[key] !== value) {
      errors.push(
        `context.${key} 期望 ${JSON.stringify(value)}，实际 ${JSON.stringify(actualContext[key])}`,
      );
    }
  });

  return errors;
}

function assertRelationInference(
  body: DecisionEvaluateResponse,
  expectation: FixtureDecisionExpectation,
): string[] {
  const errors: string[] = [];
  const actual = body.relation_inference ?? {};

  if (
    expectation.expected_relation_inference.enabled !== null
    && actual.enabled !== expectation.expected_relation_inference.enabled
  ) {
    errors.push(
      `relation_inference.enabled 期望 ${String(expectation.expected_relation_inference.enabled)}，实际 ${String(actual.enabled)}`,
    );
  }

  if (
    expectation.expected_relation_inference.applied !== null
    && actual.applied !== expectation.expected_relation_inference.applied
  ) {
    errors.push(
      `relation_inference.applied 期望 ${String(expectation.expected_relation_inference.applied)}，实际 ${String(actual.applied)}`,
    );
  }

  if (
    expectation.expected_relation_inference.reason !== null
    && actual.reason !== expectation.expected_relation_inference.reason
  ) {
    errors.push(
      `relation_inference.reason 期望 ${expectation.expected_relation_inference.reason}，实际 ${actual.reason ?? 'undefined'}`,
    );
  }

  const actualRules = Array.isArray(actual.rules) ? actual.rules : [];
  Object.entries(expectation.expected_rules).forEach(([ruleId, ruleExpectation]) => {
    const matchedRule = actualRules.find((item) => item.id === ruleId);
    if (!matchedRule) {
      errors.push(`relation_inference.rules 缺少 ${ruleId}`);
      return;
    }

    if (matchedRule.matched !== ruleExpectation.matched) {
      errors.push(
        `${ruleId}.matched 期望 ${String(ruleExpectation.matched)}，实际 ${String(matchedRule.matched)}`,
      );
    }

    const subjectValues = Array.isArray(matchedRule.subject_values)
      ? matchedRule.subject_values
      : [];
    ruleExpectation.subject_values_contains.forEach((value) => {
      if (!subjectValues.includes(value)) {
        errors.push(`${ruleId}.subject_values 缺少 ${value}`);
      }
    });

    const objectValues = Array.isArray(matchedRule.object_values)
      ? matchedRule.object_values
      : [];
    ruleExpectation.object_values_contains.forEach((value) => {
      if (!objectValues.includes(value)) {
        errors.push(`${ruleId}.object_values 缺少 ${value}`);
      }
    });

    if (
      ruleExpectation.object_owner_ref
      && matchedRule.object_owner_ref !== ruleExpectation.object_owner_ref
    ) {
      errors.push(
        `${ruleId}.object_owner_ref 期望 ${ruleExpectation.object_owner_ref}，实际 ${matchedRule.object_owner_ref ?? 'undefined'}`,
      );
    }
  });

  return errors;
}

function buildSkippedCase(input: {
  name: string;
  mode: ExpectationRunMode;
  expected_effect: string;
  error: string;
}): ExpectationRunCaseResult {
  return {
    name: input.name,
    mode: input.mode,
    status: 'skipped',
    expected_effect: input.expected_effect,
    assertion_errors: [input.error],
  };
}

function buildMissingRouteGuidance(input: {
  namespace: string;
  tenantId: string;
  environment: string;
}): string {
  return (
    `当前 namespace=${input.namespace} 下未找到 tenant_id=${input.tenantId} / environment=${input.environment} 的 model route。`
    + '批量 Setup 只会写入对象与关系，不会自动绑定 route；'
    + '请先在“高级运维 > Model Route Upsert”绑定已发布模型后，再执行 expectation 演练。'
  );
}

function buildUnavailableRouteGuidance(input: {
  namespace: string;
  tenantId: string;
  environment: string;
}): string {
  return (
    `当前 namespace=${input.namespace} 下 tenant_id=${input.tenantId} / environment=${input.environment} 的 model route 不可用，`
    + '可能是尚未绑定 route，或 route 指向的已发布模型不可用。'
    + '请在“高级运维 > Model Route Upsert”确认该 route 已绑定到可用的已发布模型后重试。'
  );
}

function normalizeEvaluateError(
  rawError: string,
  input: {
    namespace: string;
    tenantId?: string;
    environment?: string;
  },
): string {
  if (
    rawError === MODEL_ROUTE_UNAVAILABLE_ERROR
    && input.tenantId
    && input.environment
  ) {
    return buildUnavailableRouteGuidance({
      namespace: input.namespace,
      tenantId: input.tenantId,
      environment: input.environment,
    });
  }

  return rawError;
}

export async function runExpectationSimulation(
  input: RunExpectationInput,
): Promise<RunExpectationResult | RunExpectationFailure> {
  const expectationParsed = parseJsonObject(input.expectation_json, 'expectation_json');
  if (!expectationParsed.ok) {
    return expectationParsed;
  }
  const expectedFixture = parseExpectedFixture(expectationParsed.data);
  if (!expectedFixture) {
    return {
      ok: false,
      error: 'expectation_json 缺少有效的 decision_expectations',
    };
  }

  const executionPlan = input.execution_plan;
  if (!executionPlan || executionPlan.decision_inputs.length === 0) {
    return {
      ok: false,
      error: '当前 namespace 没有已应用的 setup 执行计划，请先执行“批量 Setup”后再运行 expectation 演练',
    };
  }

  const setupSource: ExpectationRunReport['source']['setup_source'] = 'fixture';
  const modelSource: ExpectationRunReport['source']['model_source'] = 'route';

  const setupByCase = new Map(
    executionPlan.decision_inputs.map((item) => [item.name, item]),
  );

  const tenantId = input.tenant_id ?? executionPlan.tenant_id;
  const environment = input.environment ?? executionPlan.environment;
  const cases: ExpectationRunCaseResult[] = [];
  const hasModelRouteCases = expectedFixture.decision_expectations.some((item) => {
    const matchedCase = setupByCase.get(item.name);
    const mode = matchedCase?.mode ?? item.mode;
    return mode === 'model_route';
  });

  if (hasModelRouteCases && tenantId && environment) {
    const routeListResult = await input.client.listModelRoutes({
      namespace: input.namespace,
      tenant_id: tenantId,
      environment,
      limit: 1,
      offset: 0,
    });

    if (routeListResult.ok && routeListResult.data.total_count === 0) {
      return {
        ok: false,
        error: buildMissingRouteGuidance({
          namespace: input.namespace,
          tenantId,
          environment,
        }),
      };
    }
  }

  for (const expectation of expectedFixture.decision_expectations) {
    const testCase = setupByCase.get(expectation.name);
    if (!testCase) {
      cases.push(
        buildSkippedCase({
          name: expectation.name,
          mode: expectation.mode,
          expected_effect: expectation.expected_effect,
          error: 'setup 中未找到同名 decision_input',
        }),
      );
      continue;
    }

    const mode = testCase.mode ?? expectation.mode;
    if (mode === 'model_route') {
      if (!tenantId || !environment) {
        cases.push(
          buildSkippedCase({
            name: expectation.name,
            mode,
            expected_effect: expectation.expected_effect,
            error: 'model_route 模式缺少 tenant_id/environment',
          }),
        );
        continue;
      }

      const evaluateResult = await input.client.evaluateDecision({
        model_route: {
          namespace: input.namespace,
          tenant_id: tenantId,
          environment,
        },
        input: testCase.input,
        options: testCase.options,
      });

      if (!evaluateResult.ok) {
        const reason = normalizeEvaluateError(evaluateResult.error, {
          namespace: input.namespace,
          tenantId,
          environment,
        });
        cases.push({
          name: expectation.name,
          mode,
          status: 'failed',
          expected_effect: expectation.expected_effect,
          reason,
          assertion_errors: [`API 调用失败: ${reason}`],
        });
        continue;
      }

      const assertionErrors = [
        ...assertDecisionPayload(evaluateResult.data, expectation),
        ...assertRelationInference(evaluateResult.data, expectation),
      ];
      const traceMatchedRules = Array.isArray(evaluateResult.data.traces)
        ? evaluateResult.data.traces
            .filter((item) => item.status === 'matched')
            .map((item) => item.rule_id)
        : [];

      cases.push({
        name: expectation.name,
        mode,
        status: assertionErrors.length === 0 ? 'passed' : 'failed',
        expected_effect: expectation.expected_effect,
        actual_effect: evaluateResult.data.decision.final_effect,
        decision_id: evaluateResult.data.decision_id,
        reason: evaluateResult.data.decision.reason,
        matched_rules: evaluateResult.data.decision.matched_rules,
        trace_matched_rules: traceMatchedRules,
        relation_inference: {
          enabled: evaluateResult.data.relation_inference?.enabled,
          applied: evaluateResult.data.relation_inference?.applied,
          reason: evaluateResult.data.relation_inference?.reason,
        },
        assertion_errors: assertionErrors,
      });
      continue;
    }

    cases.push(
      buildSkippedCase({
        name: expectation.name,
        mode,
        expected_effect: expectation.expected_effect,
        error: '控制台 expectation 演练仅支持 model_route；inline_model 属于测试夹具模式，不属于实际系统调用模拟',
      }),
    );
  }

  const passedCount = cases.filter((item) => item.status === 'passed').length;
  const failedCount = cases.filter((item) => item.status === 'failed').length;
  const skippedCount = cases.filter((item) => item.status === 'skipped').length;

  return {
    ok: true,
    report: {
      run_id: buildRunId(),
      fixture_id: input.fixture_id,
      namespace: input.namespace,
      tenant_id: tenantId,
      environment,
      generated_at: new Date().toISOString(),
      summary: {
        total_count: cases.length,
        passed_count: passedCount,
        failed_count: failedCount,
        skipped_count: skippedCount,
      },
      source: {
        expectation_file_name: input.expectation_file_name,
        setup_source: setupSource,
        model_source: modelSource,
      },
      cases,
    },
  };
}
