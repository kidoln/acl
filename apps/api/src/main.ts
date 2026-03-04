import Fastify, { type FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';

import {
  evaluateDecision,
  makeObject,
  makeSubject,
  type DecisionInput,
  type DecisionObject,
  type DecisionSubject,
} from '@acl/engine';
import { evaluateConstraints } from '@acl/constraints';
import { runPublishGate, type GateMetrics, type GateProfile } from '@acl/gate';
import {
  executeSubjectRemovedLifecycle,
  type LifecycleObjectSnapshot,
} from '@acl/lifecycle';
import {
  createPersistenceFromEnv,
  nextDecisionId,
  nextLifecycleId,
  nextValidationId,
  type AclPersistence,
} from '@acl/persistence';
import { parseSelector, type SelectorScope } from '@acl/policy-dsl';
import type { AuthzModelConfig } from '@acl/shared-types';
import { validateModelConfig } from '@acl/validator';
import {
  applyPublishActivation,
  applyPublishReview,
  buildPublishRequestRecord,
} from './publish-workflow';

interface SelectorParseBody {
  selector: string;
  scope: SelectorScope;
}

interface ModelValidateBody {
  model: unknown;
  options?: {
    available_obligation_executors?: string[];
    cardinality_counts?: Record<string, number>;
  };
}

interface DecisionEvaluateBody {
  model: unknown;
  input: {
    action: string;
    subject: Partial<DecisionSubject> & { id: string };
    object: Partial<DecisionObject> & { id: string };
    context?: Record<string, unknown>;
  };
  options?: {
    available_obligation_executors?: string[];
    cardinality_counts?: Record<string, number>;
    strict_validation?: boolean;
  };
}

interface PublishGateCheckBody {
  model: unknown;
  profile?: GateProfile;
  publish_id?: string;
  metrics_override?: Partial<GateMetrics>;
  options?: {
    available_obligation_executors?: string[];
    cardinality_counts?: Record<string, number>;
    lifecycle_takeover_backlog_count?: number;
    lifecycle_takeover_max_pending_hours?: number;
  };
}

interface PublishSubmitBody extends PublishGateCheckBody {
  submitted_by?: string;
}

interface PublishReviewBody {
  publish_id: string;
  decision: 'approve' | 'reject';
  reviewer: string;
  reason: string;
  expires_at?: string;
}

interface PublishActivateBody {
  publish_id: string;
  operator?: string;
}

interface PublishRequestListQuery {
  status?: string;
  profile?: string;
  limit?: string;
  offset?: string;
}

interface LifecycleSubjectRemovedBody {
  model: unknown;
  event: {
    target: string;
    operator?: string;
    occurred_at?: string;
  };
  object_snapshots?: LifecycleObjectSnapshot[];
  options?: {
    fallback_owner?: string;
  };
}

interface ControlCatalogRegisterBody {
  system_id: string;
  namespace: string;
  catalogs: {
    action_catalog: string[];
    object_type_catalog: string[];
    relation_type_catalog: string[];
  };
}

interface ControlObjectUpsertBody {
  namespace: string;
  objects: Array<{
    object_id: string;
    object_type: string;
    sensitivity?: string;
    owner_ref?: string;
    labels?: string[];
    updated_at?: string;
  }>;
}

interface ControlCatalogListQuery {
  system_id?: string;
  namespace?: string;
  limit?: string;
  offset?: string;
}

interface ControlObjectListQuery {
  namespace?: string;
  object_type?: string;
  sensitivity?: string;
  limit?: string;
  offset?: string;
}

interface ControlRelationEventBody {
  namespace: string;
  events: Array<{
    from: string;
    to: string;
    relation_type: string;
    operation?: 'upsert' | 'delete';
    scope?: string;
    source?: string;
    occurred_at?: string;
  }>;
}

interface ControlRelationListQuery {
  namespace?: string;
  relation_type?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

interface ControlAuditListQuery {
  namespace?: string;
  event_type?: string;
  limit?: string;
  offset?: string;
}

interface SimulationReportListQuery {
  publish_id?: string;
  profile?: string;
  limit?: string;
  offset?: string;
}

interface SimulationScenarioSubject {
  id: string;
  type?: string;
  state?: string;
  attributes?: Record<string, unknown>;
  relations?: Array<{
    relation: string;
    args?: Record<string, string>;
  }>;
}

interface SimulationScenarioObject {
  id: string;
  type?: string;
  sensitivity?: string;
  attributes?: Record<string, unknown>;
  relations?: Array<{
    relation: string;
    args?: Record<string, string>;
  }>;
}

interface PublishSimulateBody extends PublishGateCheckBody {
  baseline_model?: unknown;
  baseline_publish_id?: string;
  sample_subjects?: SimulationScenarioSubject[];
  sample_objects?: SimulationScenarioObject[];
  actions?: string[];
  top_n?: number;
}

interface ObjectOnboardingCheckBody {
  model: unknown;
  object: Record<string, unknown>;
  profile?: string;
}

interface IdParams {
  id: string;
}

const PUBLISH_WORKFLOW_STATUSES = new Set([
  'blocked',
  'review_required',
  'approved',
  'rejected',
  'published',
]);

export const app = Fastify({ logger: true });

let persistence: AclPersistence;
let persistenceDriver: 'memory' | 'postgres';

try {
  const bootstrap = createPersistenceFromEnv(process.env);
  persistence = bootstrap.persistence;
  persistenceDriver = bootstrap.driver;
} catch (error) {
  if (process.env.ACL_PERSISTENCE_DRIVER === 'postgres') {
    throw error;
  }
  const fallback = createPersistenceFromEnv({ ...process.env, ACL_PERSISTENCE_DRIVER: 'memory' });
  persistence = fallback.persistence;
  persistenceDriver = fallback.driver;
  app.log.error({ err: error }, 'persistence bootstrap failed, fallback to memory');
}

function nextControlAuditId(): string {
  return `ctrl_audit_${randomUUID()}`;
}

function nextSimulationId(): string {
  return `sim_${randomUUID()}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isGateProfile(value: unknown): value is GateProfile {
  return value === 'baseline' || value === 'strict_compliance';
}

function isPublishWorkflowStatus(value: unknown): value is string {
  return typeof value === 'string' && PUBLISH_WORKFLOW_STATUSES.has(value);
}

function parseListNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return Number.NaN;
  }
  return parsed;
}

function buildControlCatalogKey(systemId: string, namespace: string): string {
  return `${systemId}::${namespace}`;
}

function buildRelationKey(from: string, to: string, relationType: string, scope?: string): string {
  return `${from}|${to}|${relationType}|${scope ?? ''}`;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function normalizeTopN(topN: number | undefined): number {
  if (!Number.isInteger(topN)) {
    return 10;
  }
  const value = Number(topN);
  return Math.min(Math.max(value, 1), 50);
}

function setNestedValue(root: Record<string, unknown>, segments: string[], value: string): void {
  if (segments.length === 0) {
    return;
  }
  let cursor: Record<string, unknown> = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const next = cursor[key];
    if (!isRecord(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

function normalizeSimulationRelations(
  value: SimulationScenarioSubject['relations'] | SimulationScenarioObject['relations'],
): Array<{ relation: string; args?: Record<string, string> }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is { relation: string; args?: Record<string, string> } =>
      typeof item?.relation === 'string' && item.relation.length > 0,
    )
    .map((item) => ({
      relation: item.relation,
      args: isRecord(item.args)
        ? Object.fromEntries(
            Object.entries(item.args)
              .filter(([, argValue]) => typeof argValue === 'string')
              .map(([argKey, argValue]) => [argKey, String(argValue)]),
          )
        : undefined,
    }));
}

function relationSignature(input: { relation: string; args?: Record<string, string> }): string {
  return `${input.relation}:${JSON.stringify(input.args ?? {})}`;
}

function mergeRelations(
  left: Array<{ relation: string; args?: Record<string, string> }>,
  right: Array<{ relation: string; args?: Record<string, string> }>,
): Array<{ relation: string; args?: Record<string, string> }> {
  const seen = new Set<string>();
  const merged: Array<{ relation: string; args?: Record<string, string> }> = [];
  [...left, ...right].forEach((item) => {
    const signature = relationSignature(item);
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    merged.push(item);
  });
  return merged;
}

function estimateHighSensitivityRuleCount(model: AuthzModelConfig): number {
  return model.policies.rules.filter((rule) =>
    /sensitivity\s*==\s*(['"])?high\1?/i.test(rule.object_selector),
  ).length;
}

function resolveObjectPath(object: Record<string, unknown>, path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }

  let cursor: unknown = segments[0] === 'object' ? object : undefined;
  for (const segment of segments.slice(segments[0] === 'object' ? 1 : 0)) {
    if (typeof cursor !== 'object' || cursor === null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
}

function evaluateOnboardingCondition(condition: string, object: Record<string, unknown>): boolean {
  const parsed = parseSelector(condition, 'object_selector');
  if (!parsed.ok || !parsed.ast) {
    return false;
  }

  for (const clause of parsed.ast.clauses) {
    if (clause.type === 'comparison') {
      const value = resolveObjectPath(object, clause.left);
      if (value === undefined || value === null || String(value) !== clause.right) {
        return false;
      }
      continue;
    }

    const container = resolveObjectPath(object, clause.left);
    if (!Array.isArray(container)) {
      return false;
    }

    const expected = Object.fromEntries(clause.args.map((arg) => [arg.key, arg.value]));
    const matched = container.some((item) => {
      if (typeof item !== 'object' || item === null) {
        return false;
      }
      const asRecord = item as Record<string, unknown>;
      const relationMatched =
        typeof asRecord.relation === 'string' && asRecord.relation === clause.relation;
      if (!relationMatched) {
        return false;
      }
      const args = (asRecord.args ?? {}) as Record<string, unknown>;
      return Object.entries(expected).every(([key, value]) => args[key] === value);
    });

    if (!matched) {
      return false;
    }
  }

  return true;
}

function getModelId(model: unknown): string {
  if (typeof model !== 'object' || model === null) {
    return 'unknown_model';
  }
  const meta = (model as Record<string, unknown>).model_meta;
  if (typeof meta !== 'object' || meta === null) {
    return 'unknown_model';
  }
  const modelId = (meta as Record<string, unknown>).model_id;
  return typeof modelId === 'string' && modelId.length > 0 ? modelId : 'unknown_model';
}

function buildSubjectFromSelector(ruleId: string, selector: string): SimulationScenarioSubject | null {
  const parsed = parseSelector(selector, 'subject_selector');
  if (!parsed.ok || !parsed.ast) {
    return null;
  }

  const candidate: SimulationScenarioSubject = {
    id: `sim_subject_${ruleId}`,
    attributes: {},
    relations: [],
  };

  parsed.ast.clauses.forEach((clause) => {
    if (clause.type === 'comparison') {
      if (!clause.left.startsWith('subject.')) {
        return;
      }
      const path = clause.left.split('.').slice(1);
      if (path.length === 0) {
        return;
      }
      if (path.length === 1 && path[0] === 'id') {
        candidate.id = clause.right;
        return;
      }
      if (path.length === 1 && path[0] === 'type') {
        candidate.type = clause.right;
        return;
      }
      if (path.length === 1 && path[0] === 'state') {
        candidate.state = clause.right;
        return;
      }
      setNestedValue(candidate.attributes as Record<string, unknown>, path, clause.right);
      return;
    }

    if (clause.left !== 'subject.relations') {
      return;
    }
    candidate.relations?.push({
      relation: clause.relation,
      args: Object.fromEntries(clause.args.map((arg) => [arg.key, arg.value])),
    });
  });

  return candidate;
}

function applyObjectComparison(
  candidate: SimulationScenarioObject,
  path: string[],
  value: string,
): void {
  if (path.length === 0) {
    return;
  }
  if (path.length === 1 && path[0] === 'id') {
    candidate.id = value;
    return;
  }
  if (path.length === 1 && path[0] === 'type') {
    candidate.type = value;
    return;
  }
  if (path.length === 1 && path[0] === 'sensitivity') {
    candidate.sensitivity = value;
    return;
  }
  setNestedValue(candidate.attributes as Record<string, unknown>, path, value);
}

function buildObjectFromSelector(
  ruleId: string,
  selector: string,
  suffix: 'selector' | 'conditions',
): SimulationScenarioObject | null {
  const parsed = parseSelector(selector, 'object_selector');
  if (!parsed.ok || !parsed.ast) {
    return null;
  }

  const candidate: SimulationScenarioObject = {
    id: `sim_object_${ruleId}_${suffix}`,
    attributes: {},
    relations: [],
  };

  parsed.ast.clauses.forEach((clause) => {
    if (clause.type === 'comparison') {
      if (!clause.left.startsWith('object.')) {
        return;
      }
      const path = clause.left.split('.').slice(1);
      applyObjectComparison(candidate, path, clause.right);
      return;
    }

    if (clause.left !== 'object.relations') {
      return;
    }
    candidate.relations?.push({
      relation: clause.relation,
      args: Object.fromEntries(clause.args.map((arg) => [arg.key, arg.value])),
    });
  });

  return candidate;
}

function mergeSubjectScenarios(
  items: SimulationScenarioSubject[],
): SimulationScenarioSubject[] {
  const byId = new Map<string, SimulationScenarioSubject>();

  items.forEach((item) => {
    if (!isNonEmptyString(item.id)) {
      return;
    }
    const current = byId.get(item.id);
    if (!current) {
      byId.set(item.id, {
        id: item.id,
        type: item.type,
        state: item.state,
        attributes: isRecord(item.attributes) ? { ...item.attributes } : {},
        relations: normalizeSimulationRelations(item.relations),
      });
      return;
    }

    current.type = current.type ?? item.type;
    current.state = current.state ?? item.state;
    current.attributes = {
      ...(isRecord(current.attributes) ? current.attributes : {}),
      ...(isRecord(item.attributes) ? item.attributes : {}),
    };
    current.relations = mergeRelations(
      normalizeSimulationRelations(current.relations),
      normalizeSimulationRelations(item.relations),
    );
  });

  return Array.from(byId.values());
}

function mergeObjectScenarios(
  items: SimulationScenarioObject[],
): SimulationScenarioObject[] {
  const byId = new Map<string, SimulationScenarioObject>();

  items.forEach((item) => {
    if (!isNonEmptyString(item.id)) {
      return;
    }
    const current = byId.get(item.id);
    if (!current) {
      byId.set(item.id, {
        id: item.id,
        type: item.type,
        sensitivity: item.sensitivity,
        attributes: isRecord(item.attributes) ? { ...item.attributes } : {},
        relations: normalizeSimulationRelations(item.relations),
      });
      return;
    }

    current.type = current.type ?? item.type;
    current.sensitivity = current.sensitivity ?? item.sensitivity;
    current.attributes = {
      ...(isRecord(current.attributes) ? current.attributes : {}),
      ...(isRecord(item.attributes) ? item.attributes : {}),
    };
    current.relations = mergeRelations(
      normalizeSimulationRelations(current.relations),
      normalizeSimulationRelations(item.relations),
    );
  });

  return Array.from(byId.values());
}

function buildSimulationSubjects(input: {
  draftModel: AuthzModelConfig;
  baselineModel?: AuthzModelConfig;
  sampleSubjects?: SimulationScenarioSubject[];
}): DecisionSubject[] {
  const fromRules: SimulationScenarioSubject[] = [];
  const collect = (model: AuthzModelConfig): void => {
    model.policies.rules.forEach((rule) => {
      const subject = buildSubjectFromSelector(rule.id, rule.subject_selector);
      if (subject) {
        fromRules.push(subject);
      }
    });
  };

  collect(input.draftModel);
  if (input.baselineModel) {
    collect(input.baselineModel);
  }

  const merged = mergeSubjectScenarios([...(input.sampleSubjects ?? []), ...fromRules]);
  if (merged.length === 0) {
    merged.push({
      id: 'sim_subject_default',
      type: input.draftModel.catalogs.subject_type_catalog[0] ?? 'user',
      attributes: {},
      relations: [],
    });
  }

  return merged.map((item) =>
    makeSubject({
      id: item.id,
      type: item.type,
      state: item.state,
      attributes: isRecord(item.attributes) ? item.attributes : {},
      relations: normalizeSimulationRelations(item.relations),
    }),
  );
}

function buildSimulationObjects(input: {
  draftModel: AuthzModelConfig;
  baselineModel?: AuthzModelConfig;
  sampleObjects?: SimulationScenarioObject[];
}): DecisionObject[] {
  const fromRules: SimulationScenarioObject[] = [];
  const collect = (model: AuthzModelConfig): void => {
    model.policies.rules.forEach((rule) => {
      const fromSelector = buildObjectFromSelector(rule.id, rule.object_selector, 'selector');
      if (fromSelector) {
        fromRules.push(fromSelector);
      }
      if (isNonEmptyString(rule.conditions)) {
        const fromConditions = buildObjectFromSelector(rule.id, rule.conditions, 'conditions');
        if (fromConditions) {
          fromRules.push(fromConditions);
        }
      }
    });
  };

  collect(input.draftModel);
  if (input.baselineModel) {
    collect(input.baselineModel);
  }

  const merged = mergeObjectScenarios([...(input.sampleObjects ?? []), ...fromRules]);
  if (merged.length === 0) {
    merged.push({
      id: 'sim_object_default',
      type: input.draftModel.catalogs.object_type_catalog[0] ?? 'resource',
      sensitivity: 'normal',
      attributes: {},
      relations: [],
    });
  }

  return merged.map((item) =>
    makeObject({
      id: item.id,
      type: item.type,
      sensitivity: item.sensitivity,
      attributes: isRecord(item.attributes) ? item.attributes : {},
      relations: normalizeSimulationRelations(item.relations),
    }),
  );
}

function resolveSimulationActions(
  draftModel: AuthzModelConfig,
  baselineModel: AuthzModelConfig | undefined,
  requestedActions: string[] | undefined,
): string[] {
  const unionActions = uniqueStrings([
    ...draftModel.catalogs.action_catalog,
    ...(baselineModel?.catalogs.action_catalog ?? []),
  ]);
  if (Array.isArray(requestedActions) && requestedActions.length > 0) {
    const filtered = uniqueStrings(requestedActions).filter((action) => unionActions.includes(action));
    if (filtered.length > 0) {
      return filtered;
    }
  }
  return unionActions.length > 0 ? unionActions : ['read'];
}

async function resolveBaselineModelFromRequest(
  body: PublishSimulateBody,
): Promise<AuthzModelConfig | undefined> {
  if (body.baseline_model !== undefined) {
    return body.baseline_model as AuthzModelConfig;
  }
  if (!isNonEmptyString(body.baseline_publish_id)) {
    return undefined;
  }

  const baselinePublish = await persistence.getPublishRequest(body.baseline_publish_id);
  if (!baselinePublish) {
    return undefined;
  }

  const snapshot = baselinePublish.payload.model_snapshot;
  if (isRecord(snapshot)) {
    return snapshot as unknown as AuthzModelConfig;
  }

  return undefined;
}

async function saveControlAudit(input: {
  event_type: string;
  target: string;
  namespace: string;
  operator: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const createdAt = new Date().toISOString();
  await persistence.saveControlAudit({
    audit_id: nextControlAuditId(),
    event_type: input.event_type,
    target: input.target,
    namespace: input.namespace,
    operator: input.operator,
    created_at: createdAt,
    payload: input.payload,
  });
}

function buildPublishMetricsOverride(
  override: Partial<GateMetrics> | undefined,
  options: PublishGateCheckBody['options'] | undefined,
): Partial<GateMetrics> | undefined {
  const backlog = options?.lifecycle_takeover_backlog_count;
  const pendingHours = options?.lifecycle_takeover_max_pending_hours;

  if (backlog === undefined && pendingHours === undefined) {
    return override;
  }

  const lifecycle = override?.lifecycle;

  return {
    ...(override ?? {}),
    lifecycle: {
      required_handler_missing_count: lifecycle?.required_handler_missing_count ?? 0,
      takeover_queue_backlog_count: backlog ?? lifecycle?.takeover_queue_backlog_count ?? 0,
      takeover_queue_max_pending_hours:
        pendingHours ?? lifecycle?.takeover_queue_max_pending_hours ?? 0,
    },
  };
}

app.get('/healthz', async () => {
  return {
    service: 'acl-api',
    status: 'ok',
    persistence_driver: persistenceDriver,
    timestamp: new Date().toISOString(),
  };
});

app.post<{ Body: SelectorParseBody }>('/selectors:parse', async (request, reply) => {
  const { selector, scope } = request.body ?? {};

  if (typeof selector !== 'string' || (scope !== 'subject_selector' && scope !== 'object_selector')) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'selector must be string and scope must be subject_selector/object_selector',
    });
  }

  const result = parseSelector(selector, scope);
  return reply.code(200).send(result);
});

app.post<{ Body: ModelValidateBody }>('/models:validate', async (request, reply) => {
  const { model, options } = request.body ?? {};
  if (model === undefined) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'model is required in request body',
    });
  }

  const result = validateModelConfig(model, {
    available_obligation_executors: options?.available_obligation_executors,
    cardinality_counts: options?.cardinality_counts,
  });

  const validationId = nextValidationId();
  const createdAt = new Date().toISOString();

  try {
    await persistence.saveValidation({
      validation_id: validationId,
      model_id: getModelId(model),
      created_at: createdAt,
      payload: {
        result,
        options: options ?? {},
      },
    });
  } catch (error) {
    app.log.error({ err: error, validation_id: validationId }, 'persist validation failed');
  }

  return reply.code(200).send({
    validation_id: validationId,
    persisted_at: createdAt,
    persistence_driver: persistenceDriver,
    ...result,
  });
});

app.post<{ Body: ObjectOnboardingCheckBody }>('/objects:onboard-check', async (request, reply) => {
  const { model, object, profile } = request.body ?? {};

  if (model === undefined || typeof object !== 'object' || object === null) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'model and object are required',
    });
  }

  const typedModel = model as AuthzModelConfig;
  const selectedProfile = isNonEmptyString(profile)
    ? profile
    : typedModel.object_onboarding.default_profile;
  const onboardingProfile = typedModel.object_onboarding.profiles[selectedProfile];

  if (!onboardingProfile) {
    return reply.code(400).send({
      code: 'OBJECT_PROFILE_REQUIRED_MISSING',
      message: `profile ${selectedProfile} not found`,
    });
  }

  const hardRequired = ['tenant_id', 'object_id', 'object_type', 'created_by'];
  const profileRequired = onboardingProfile.required_fields;
  const conditionalRequired = typedModel.object_onboarding.conditional_required
    .filter((rule) => evaluateOnboardingCondition(rule.when, object))
    .flatMap((rule) => rule.add_fields);

  const requiredFields = Array.from(new Set([...hardRequired, ...profileRequired, ...conditionalRequired]));
  const missingFields = requiredFields.filter((field) => {
    const value = (object as Record<string, unknown>)[field];
    if (typeof value === 'string') {
      return value.trim().length === 0;
    }
    return value === undefined || value === null;
  });

  const hardMissing = missingFields.filter((field) => hardRequired.includes(field));
  const profileMissing = missingFields.filter(
    (field) => !hardRequired.includes(field) && profileRequired.includes(field),
  );
  const conditionalMissing = missingFields.filter((field) => conditionalRequired.includes(field));

  const mode = typedModel.object_onboarding.compatibility_mode;
  const blockingErrors: string[] = [];
  const warnings: string[] = [];

  if (hardMissing.length > 0) {
    blockingErrors.push('OBJECT_HARD_REQUIRED_MISSING');
  }

  if (mode === 'compat_balanced' && profileMissing.length > 0) {
    blockingErrors.push('OBJECT_PROFILE_REQUIRED_MISSING');
  }

  if (mode === 'compat_strict' && (profileMissing.length > 0 || conditionalMissing.length > 0)) {
    if (profileMissing.length > 0) {
      blockingErrors.push('OBJECT_PROFILE_REQUIRED_MISSING');
    }
    if (conditionalMissing.length > 0) {
      blockingErrors.push('OBJECT_CONDITIONAL_REQUIRED_MISSING');
    }
  }

  if (mode === 'compat_open' && (profileMissing.length > 0 || conditionalMissing.length > 0)) {
    warnings.push('OBJECT_PROFILE_REQUIRED_MISSING');
  }

  if (mode === 'compat_balanced' && conditionalMissing.length > 0) {
    warnings.push('OBJECT_CONDITIONAL_REQUIRED_MISSING');
  }

  const accepted = blockingErrors.length === 0;

  return reply.code(200).send({
    accepted,
    compatibility_mode: mode,
    selected_profile: selectedProfile,
    required_fields: requiredFields,
    missing_fields: missingFields,
    detail: {
      hard_missing: hardMissing,
      profile_missing: profileMissing,
      conditional_missing: conditionalMissing,
    },
    blocking_errors: Array.from(new Set(blockingErrors)),
    warnings: Array.from(new Set(warnings)),
  });
});

app.get<{ Params: IdParams }>('/validations/:id', async (request, reply) => {
  const record = await persistence.getValidation(request.params.id);
  if (!record) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `validation ${request.params.id} not found`,
    });
  }

  return reply.code(200).send(record);
});

app.post<{ Body: PublishGateCheckBody }>('/publish:gate-check', async (request, reply) => {
  const { model, profile, publish_id, metrics_override, options } = request.body ?? {};

  if (model === undefined) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'model is required in request body',
    });
  }

  if (profile !== undefined && !isGateProfile(profile)) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'profile must be baseline or strict_compliance',
    });
  }

  const result = runPublishGate({
    model: model as AuthzModelConfig,
    profile,
    publish_id,
    metrics_override: buildPublishMetricsOverride(metrics_override, options),
    validator_options: {
      available_obligation_executors: options?.available_obligation_executors,
      cardinality_counts: options?.cardinality_counts,
    },
  });

  const createdAt = new Date().toISOString();

  try {
    await persistence.saveGateReport({
      publish_id: result.publish_id,
      profile: result.profile,
      final_result: result.final_result,
      created_at: createdAt,
      payload: result as unknown as Record<string, unknown>,
    });
  } catch (error) {
    app.log.error({ err: error, publish_id: result.publish_id }, 'persist gate report failed');
  }

  return reply.code(200).send({
    persisted_at: createdAt,
    persistence_driver: persistenceDriver,
    ...result,
  });
});

app.get<{ Params: IdParams }>('/gate-reports/:id', async (request, reply) => {
  const record = await persistence.getGateReport(request.params.id);
  if (!record) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `gate report ${request.params.id} not found`,
    });
  }

  return reply.code(200).send(record);
});

app.post<{ Body: ControlCatalogRegisterBody }>('/control/catalogs:register', async (request, reply) => {
  const { system_id, namespace, catalogs } = request.body ?? {};

  if (
    !isNonEmptyString(system_id) ||
    !isNonEmptyString(namespace) ||
    !catalogs ||
    !isNonEmptyStringArray(catalogs.action_catalog) ||
    !isNonEmptyStringArray(catalogs.object_type_catalog) ||
    !isNonEmptyStringArray(catalogs.relation_type_catalog)
  ) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message:
        'system_id, namespace and non-empty catalogs.action_catalog/object_type_catalog/relation_type_catalog are required',
    });
  }

  const key = buildControlCatalogKey(system_id, namespace);
  const now = new Date().toISOString();
  const existed = await persistence.getControlCatalog(key);
  const record = {
    key,
    system_id,
    namespace,
    catalogs: {
      action_catalog: uniqueStrings(catalogs.action_catalog),
      object_type_catalog: uniqueStrings(catalogs.object_type_catalog),
      relation_type_catalog: uniqueStrings(catalogs.relation_type_catalog),
    },
    created_at: existed?.created_at ?? now,
    updated_at: now,
  };

  try {
    await persistence.upsertControlCatalog(record);
    await saveControlAudit({
      event_type: 'control.catalog.registered',
      target: key,
      namespace,
      operator: 'system',
      payload: {
        operation: existed ? 'updated' : 'created',
        catalogs: record.catalogs,
      },
    });
  } catch (error) {
    app.log.error({ err: error, key }, 'persist control catalog failed');
    return reply.code(500).send({
      code: 'PERSISTENCE_FAILED',
      message: 'persist control catalog failed',
    });
  }

  return reply.code(200).send({
    operation: existed ? 'updated' : 'created',
    record,
    persistence_driver: persistenceDriver,
  });
});

app.get<{ Querystring: ControlCatalogListQuery }>('/control/catalogs', async (request, reply) => {
  const systemId = request.query?.system_id?.trim();
  const namespace = request.query?.namespace?.trim();
  const limit = parseListNumber(request.query?.limit, 20);
  const offset = parseListNumber(request.query?.offset, 0);

  if (Number.isNaN(limit) || Number.isNaN(offset) || limit < 1 || limit > 100) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'limit must be integer in [1, 100], offset must be integer >= 0',
    });
  }

  const records = await persistence.listControlCatalogs({
    system_id: systemId && systemId.length > 0 ? systemId : undefined,
    namespace: namespace && namespace.length > 0 ? namespace : undefined,
    limit,
    offset,
  });

  return reply.code(200).send({
    ...records,
    limit,
    offset,
    persistence_driver: persistenceDriver,
  });
});

app.post<{ Body: ControlObjectUpsertBody }>('/control/objects:upsert', async (request, reply) => {
  const { namespace, objects } = request.body ?? {};

  if (!isNonEmptyString(namespace) || !Array.isArray(objects) || objects.length === 0) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'namespace and non-empty objects are required',
    });
  }

  let createdCount = 0;
  let updatedCount = 0;

  try {
    for (const item of objects) {
      if (!isNonEmptyString(item?.object_id) || !isNonEmptyString(item?.object_type)) {
        return reply.code(400).send({
          code: 'INVALID_REQUEST',
          message: 'each object must include object_id and object_type',
        });
      }

      const existed = await persistence.getControlObject(namespace, item.object_id);
      const updatedAt = isNonEmptyString(item.updated_at) ? item.updated_at : new Date().toISOString();
      const key = `${namespace}::${item.object_id}`;

      await persistence.upsertControlObject({
        key,
        namespace,
        object_id: item.object_id,
        object_type: item.object_type,
        sensitivity: isNonEmptyString(item.sensitivity) ? item.sensitivity : 'normal',
        owner_ref: isNonEmptyString(item.owner_ref) ? item.owner_ref : 'unknown',
        labels: Array.isArray(item.labels) ? item.labels.filter(isNonEmptyString) : [],
        updated_at: updatedAt,
      });

      if (existed) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }
    }

    const total = await persistence.listControlObjects({
      namespace,
      limit: 1,
      offset: 0,
    });

    await saveControlAudit({
      event_type: 'control.object.upserted',
      target: namespace,
      namespace,
      operator: 'system',
      payload: {
        batch_size: objects.length,
        created_count: createdCount,
        updated_count: updatedCount,
      },
    });

    return reply.code(200).send({
      namespace,
      created_count: createdCount,
      updated_count: updatedCount,
      total_count: total.total_count,
      persistence_driver: persistenceDriver,
    });
  } catch (error) {
    app.log.error({ err: error, namespace }, 'persist control objects failed');
    return reply.code(500).send({
      code: 'PERSISTENCE_FAILED',
      message: 'persist control objects failed',
    });
  }
});

app.get<{ Querystring: ControlObjectListQuery }>('/control/objects', async (request, reply) => {
  const namespace = request.query?.namespace?.trim();
  if (!namespace) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'namespace query is required',
    });
  }

  const objectType = request.query?.object_type?.trim();
  const sensitivity = request.query?.sensitivity?.trim();
  const limit = parseListNumber(request.query?.limit, 20);
  const offset = parseListNumber(request.query?.offset, 0);

  if (Number.isNaN(limit) || Number.isNaN(offset) || limit < 1 || limit > 100) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'limit must be integer in [1, 100], offset must be integer >= 0',
    });
  }

  const records = await persistence.listControlObjects({
    namespace,
    object_type: objectType && objectType.length > 0 ? objectType : undefined,
    sensitivity: sensitivity && sensitivity.length > 0 ? sensitivity : undefined,
    limit,
    offset,
  });

  return reply.code(200).send({
    namespace,
    ...records,
    limit,
    offset,
    persistence_driver: persistenceDriver,
  });
});

app.post<{ Body: ControlRelationEventBody }>('/control/relations:events', async (request, reply) => {
  const { namespace, events } = request.body ?? {};

  if (!isNonEmptyString(namespace) || !Array.isArray(events) || events.length === 0) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'namespace and non-empty events are required',
    });
  }

  let upsertedCount = 0;
  let deletedCount = 0;

  try {
    for (const event of events) {
      if (
        !isNonEmptyString(event?.from) ||
        !isNonEmptyString(event?.to) ||
        !isNonEmptyString(event?.relation_type)
      ) {
        return reply.code(400).send({
          code: 'INVALID_REQUEST',
          message: 'each event must include from/to/relation_type',
        });
      }

      const operation = event.operation === 'delete' ? 'delete' : 'upsert';
      const relationKey = buildRelationKey(event.from, event.to, event.relation_type, event.scope);
      if (operation === 'delete') {
        const deleted = await persistence.deleteControlRelation(namespace, relationKey);
        if (deleted) {
          deletedCount += 1;
        }
        continue;
      }

      const key = `${namespace}::${relationKey}`;
      await persistence.upsertControlRelation({
        key,
        namespace,
        from: event.from,
        to: event.to,
        relation_type: event.relation_type,
        scope: isNonEmptyString(event.scope) ? event.scope : undefined,
        source: isNonEmptyString(event.source) ? event.source : undefined,
        updated_at: isNonEmptyString(event.occurred_at) ? event.occurred_at : new Date().toISOString(),
      });
      upsertedCount += 1;
    }

    const total = await persistence.listControlRelations({
      namespace,
      limit: 1,
      offset: 0,
    });

    await saveControlAudit({
      event_type: 'control.relation.synced',
      target: namespace,
      namespace,
      operator: 'system',
      payload: {
        batch_size: events.length,
        upserted_count: upsertedCount,
        deleted_count: deletedCount,
      },
    });

    return reply.code(200).send({
      namespace,
      upserted_count: upsertedCount,
      deleted_count: deletedCount,
      total_count: total.total_count,
      persistence_driver: persistenceDriver,
    });
  } catch (error) {
    app.log.error({ err: error, namespace }, 'persist control relation events failed');
    return reply.code(500).send({
      code: 'PERSISTENCE_FAILED',
      message: 'persist control relation events failed',
    });
  }
});

app.get<{ Querystring: ControlRelationListQuery }>('/control/relations', async (request, reply) => {
  const namespace = request.query?.namespace?.trim();
  if (!namespace) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'namespace query is required',
    });
  }

  const relationType = request.query?.relation_type?.trim();
  const from = request.query?.from?.trim();
  const to = request.query?.to?.trim();
  const limit = parseListNumber(request.query?.limit, 20);
  const offset = parseListNumber(request.query?.offset, 0);

  if (Number.isNaN(limit) || Number.isNaN(offset) || limit < 1 || limit > 100) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'limit must be integer in [1, 100], offset must be integer >= 0',
    });
  }

  const records = await persistence.listControlRelations({
    namespace,
    relation_type: relationType && relationType.length > 0 ? relationType : undefined,
    from: from && from.length > 0 ? from : undefined,
    to: to && to.length > 0 ? to : undefined,
    limit,
    offset,
  });

  return reply.code(200).send({
    namespace,
    ...records,
    limit,
    offset,
    persistence_driver: persistenceDriver,
  });
});

app.get<{ Querystring: ControlAuditListQuery }>('/control/audits', async (request, reply) => {
  const namespace = request.query?.namespace?.trim();
  const eventType = request.query?.event_type?.trim();
  const limit = parseListNumber(request.query?.limit, 20);
  const offset = parseListNumber(request.query?.offset, 0);

  if (Number.isNaN(limit) || Number.isNaN(offset) || limit < 1 || limit > 100) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'limit must be integer in [1, 100], offset must be integer >= 0',
    });
  }

  const audits = await persistence.listControlAudits({
    namespace: namespace && namespace.length > 0 ? namespace : undefined,
    event_type: eventType && eventType.length > 0 ? eventType : undefined,
    limit,
    offset,
  });

  return reply.code(200).send({
    ...audits,
    limit,
    offset,
    persistence_driver: persistenceDriver,
  });
});

app.post<{ Body: PublishSimulateBody }>('/publish:simulate', async (request, reply) => {
  const { model, profile, publish_id, metrics_override, options, top_n } = request.body ?? {};

  if (model === undefined) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'model is required in request body',
    });
  }

  if (profile !== undefined && !isGateProfile(profile)) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'profile must be baseline or strict_compliance',
    });
  }

  const draftModel = model as AuthzModelConfig;
  const baselineModel = await resolveBaselineModelFromRequest(request.body);
  if (isNonEmptyString(request.body?.baseline_publish_id) && baselineModel === undefined) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `baseline model snapshot for publish request ${request.body.baseline_publish_id} not found`,
    });
  }

  const subjects = buildSimulationSubjects({
    draftModel,
    baselineModel,
    sampleSubjects: request.body?.sample_subjects,
  });
  const objects = buildSimulationObjects({
    draftModel,
    baselineModel,
    sampleObjects: request.body?.sample_objects,
  });
  const actions = resolveSimulationActions(draftModel, baselineModel, request.body?.actions);

  const maxScenarios = 6000;
  let totalScenarios = 0;
  let truncated = false;
  let draftIndeterminateCount = 0;
  let baselineIndeterminateCount = 0;

  const deltaAllowSubjects = new Set<string>();
  const deltaDenySubjects = new Set<string>();
  const highSensitivityImpactedObjects = new Set<string>();

  const subjectImpacts = new Map<
    string,
    { changed_count: number; allow_gain_count: number; deny_gain_count: number; actions: Set<string> }
  >();
  const objectImpacts = new Map<
    string,
    { changed_count: number; high_sensitivity_changes: number; actions: Set<string> }
  >();
  const actionTransitions = new Map<
    string,
    {
      changed_count: number;
      allow_to_deny: number;
      deny_to_allow: number;
      not_applicable_to_allow: number;
      not_applicable_to_deny: number;
      indeterminate_to_allow: number;
      indeterminate_to_deny: number;
    }
  >();
  const matrixCells: Array<Record<string, unknown>> = [];

  for (const subject of subjects) {
    if (truncated) {
      break;
    }

    for (const object of objects) {
      if (truncated) {
        break;
      }

      for (const action of actions) {
        totalScenarios += 1;
        if (totalScenarios > maxScenarios) {
          truncated = true;
          break;
        }

        const input: DecisionInput = {
          action,
          subject,
          object,
          context: {
            request_time: new Date().toISOString(),
          },
        };

        const draftDecision = evaluateDecision({
          model: draftModel,
          input,
        }).decision;
        const draftEffect = draftDecision.final_effect;
        if (draftEffect === 'indeterminate') {
          draftIndeterminateCount += 1;
        }

        const baselineDecision = baselineModel
          ? evaluateDecision({
              model: baselineModel,
              input,
            }).decision
          : undefined;
        const baselineEffect = baselineDecision?.final_effect ?? 'not_applicable';
        if (baselineEffect === 'indeterminate') {
          baselineIndeterminateCount += 1;
        }

        const changed = baselineEffect !== draftEffect;
        if (!changed) {
          continue;
        }

        if (baselineEffect !== 'allow' && draftEffect === 'allow') {
          deltaAllowSubjects.add(subject.id);
        }
        if (baselineEffect !== 'deny' && draftEffect === 'deny') {
          deltaDenySubjects.add(subject.id);
        }
        if (object.sensitivity === 'high') {
          highSensitivityImpactedObjects.add(object.id);
        }

        const subjectImpact = subjectImpacts.get(subject.id) ?? {
          changed_count: 0,
          allow_gain_count: 0,
          deny_gain_count: 0,
          actions: new Set<string>(),
        };
        subjectImpact.changed_count += 1;
        if (baselineEffect !== 'allow' && draftEffect === 'allow') {
          subjectImpact.allow_gain_count += 1;
        }
        if (baselineEffect !== 'deny' && draftEffect === 'deny') {
          subjectImpact.deny_gain_count += 1;
        }
        subjectImpact.actions.add(action);
        subjectImpacts.set(subject.id, subjectImpact);

        const objectImpact = objectImpacts.get(object.id) ?? {
          changed_count: 0,
          high_sensitivity_changes: 0,
          actions: new Set<string>(),
        };
        objectImpact.changed_count += 1;
        if (object.sensitivity === 'high') {
          objectImpact.high_sensitivity_changes += 1;
        }
        objectImpact.actions.add(action);
        objectImpacts.set(object.id, objectImpact);

        const transition = actionTransitions.get(action) ?? {
          changed_count: 0,
          allow_to_deny: 0,
          deny_to_allow: 0,
          not_applicable_to_allow: 0,
          not_applicable_to_deny: 0,
          indeterminate_to_allow: 0,
          indeterminate_to_deny: 0,
        };
        transition.changed_count += 1;
        if (baselineEffect === 'allow' && draftEffect === 'deny') {
          transition.allow_to_deny += 1;
        }
        if (baselineEffect === 'deny' && draftEffect === 'allow') {
          transition.deny_to_allow += 1;
        }
        if (baselineEffect === 'not_applicable' && draftEffect === 'allow') {
          transition.not_applicable_to_allow += 1;
        }
        if (baselineEffect === 'not_applicable' && draftEffect === 'deny') {
          transition.not_applicable_to_deny += 1;
        }
        if (baselineEffect === 'indeterminate' && draftEffect === 'allow') {
          transition.indeterminate_to_allow += 1;
        }
        if (baselineEffect === 'indeterminate' && draftEffect === 'deny') {
          transition.indeterminate_to_deny += 1;
        }
        actionTransitions.set(action, transition);

        matrixCells.push({
          cell_key: `${subject.id}|${object.id}|${action}`,
          subject_id: subject.id,
          object_id: object.id,
          action,
          baseline_effect: baselineEffect,
          draft_effect: draftEffect,
          baseline_reason: baselineDecision?.reason ?? 'baseline_not_provided',
          draft_reason: draftDecision.reason,
          baseline_matched_rules: baselineDecision?.matched_rules ?? [],
          draft_matched_rules: draftDecision.matched_rules,
          draft_overridden_rules: draftDecision.overridden_rules,
          high_sensitivity: object.sensitivity === 'high',
        });
      }
    }
  }

  const safeScenarioCount = Math.max(1, totalScenarios);
  const draftIndeterminateRate = Number((draftIndeterminateCount / safeScenarioCount).toFixed(6));
  const baselineIndeterminateRate = Number((baselineIndeterminateCount / safeScenarioCount).toFixed(6));
  const metricsOverrideBase = buildPublishMetricsOverride(metrics_override, options);
  const draftMetricsOverride = {
    ...(metricsOverrideBase ?? {}),
    simulation: {
      ...(metricsOverrideBase?.simulation ?? {}),
      indeterminate_rate: draftIndeterminateRate,
    },
  };

  const gateResult = runPublishGate({
    model: draftModel,
    profile,
    publish_id,
    metrics_override: draftMetricsOverride,
    validator_options: {
      available_obligation_executors: options?.available_obligation_executors,
      cardinality_counts: options?.cardinality_counts,
    },
  });

  const baselineGateResult = baselineModel
    ? runPublishGate({
        model: baselineModel,
        profile: gateResult.profile,
        metrics_override: {
          simulation: {
            indeterminate_rate: baselineIndeterminateRate,
          },
        },
        validator_options: {
          available_obligation_executors: options?.available_obligation_executors,
          cardinality_counts: options?.cardinality_counts,
        },
      })
    : undefined;

  const recommendation =
    gateResult.final_result === 'blocked'
      ? '禁止发布'
      : gateResult.final_result === 'review_required'
        ? '需复核'
        : '通过';

  const topN = normalizeTopN(top_n);
  const topImpactedSubjects = Array.from(subjectImpacts.entries())
    .map(([subjectId, value]) => ({
      subject_id: subjectId,
      changed_count: value.changed_count,
      allow_gain_count: value.allow_gain_count,
      deny_gain_count: value.deny_gain_count,
      actions: Array.from(value.actions).sort(),
    }))
    .sort((left, right) => right.changed_count - left.changed_count)
    .slice(0, topN);
  const topImpactedObjects = Array.from(objectImpacts.entries())
    .map(([objectId, value]) => ({
      object_id: objectId,
      changed_count: value.changed_count,
      high_sensitivity_changes: value.high_sensitivity_changes,
      actions: Array.from(value.actions).sort(),
    }))
    .sort((left, right) => right.changed_count - left.changed_count)
    .slice(0, topN);
  const actionChangeMatrix = Array.from(actionTransitions.entries())
    .map(([action, value]) => ({
      action,
      ...value,
    }))
    .sort((left, right) => right.changed_count - left.changed_count);

  const generatedAt = new Date().toISOString();
  const reportId = nextSimulationId();
  const report = {
    report_id: reportId,
    generated_at: generatedAt,
    profile: gateResult.profile,
    publish_id: gateResult.publish_id,
    baseline_model_id: baselineModel ? getModelId(baselineModel) : undefined,
    draft_model_id: getModelId(draftModel),
    summary: {
      delta_allow_subject_count: deltaAllowSubjects.size,
      delta_deny_subject_count: deltaDenySubjects.size,
      delta_high_sensitivity_object_count: highSensitivityImpactedObjects.size,
      new_conflict_rule_count: Math.max(
        0,
        gateResult.metrics.conflict.unresolved_count
          - (baselineGateResult?.metrics.conflict.unresolved_count ?? 0),
      ),
      new_sod_violation_count: Math.max(
        0,
        gateResult.metrics.security.sod_violation_count
          - (baselineGateResult?.metrics.security.sod_violation_count ?? 0),
      ),
      indeterminate_rate_estimation: draftIndeterminateRate,
      mandatory_obligations_pass_rate: gateResult.metrics.execution.mandatory_obligation_pass_rate,
      publish_recommendation: recommendation,
    },
    scenarios: {
      total_subject_count: subjects.length,
      total_object_count: objects.length,
      total_action_count: actions.length,
      evaluated_count: Math.min(totalScenarios, maxScenarios),
      truncated,
    },
    top_impacted_subjects: topImpactedSubjects,
    top_impacted_objects: topImpactedObjects,
    action_change_matrix: actionChangeMatrix,
    matrix_cells: matrixCells.slice(0, 1000),
    risk_details: {
      high_sensitivity_impacted_objects: Array.from(highSensitivityImpactedObjects).slice(0, topN),
      baseline_indeterminate_rate_estimation: baselineIndeterminateRate,
    },
    evidence_samples: matrixCells.slice(0, 20),
    gate_result: gateResult,
    baseline_gate_result: baselineGateResult,
  };

  try {
    await persistence.saveSimulationReport({
      report_id: reportId,
      publish_id: gateResult.publish_id,
      profile: gateResult.profile,
      generated_at: generatedAt,
      baseline_model_id: baselineModel ? getModelId(baselineModel) : undefined,
      draft_model_id: getModelId(draftModel),
      payload: report as unknown as Record<string, unknown>,
    });
  } catch (error) {
    app.log.error({ err: error, report_id: reportId }, 'persist simulation report failed');
    return reply.code(500).send({
      code: 'PERSISTENCE_FAILED',
      message: 'persist simulation report failed',
    });
  }

  return reply.code(200).send({
    ...report,
    persisted_at: generatedAt,
    persistence_driver: persistenceDriver,
  });
});

app.get<{ Querystring: SimulationReportListQuery }>('/publish/simulations', async (request, reply) => {
  const publishId = request.query?.publish_id?.trim();
  const profile = request.query?.profile?.trim();
  const limit = parseListNumber(request.query?.limit, 20);
  const offset = parseListNumber(request.query?.offset, 0);

  if (profile !== undefined && profile.length > 0 && !isGateProfile(profile)) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'profile must be baseline or strict_compliance',
    });
  }
  if (Number.isNaN(limit) || Number.isNaN(offset) || limit < 1 || limit > 100) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'limit must be integer in [1, 100], offset must be integer >= 0',
    });
  }

  const reports = await persistence.listSimulationReports({
    publish_id: publishId && publishId.length > 0 ? publishId : undefined,
    profile: profile && profile.length > 0 ? profile : undefined,
    limit,
    offset,
  });

  return reply.code(200).send({
    ...reports,
    limit,
    offset,
    persistence_driver: persistenceDriver,
  });
});

app.get<{ Params: IdParams }>('/publish/simulations/:id', async (request, reply) => {
  const report = await persistence.getSimulationReport(request.params.id);
  if (!report) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `simulation report ${request.params.id} not found`,
    });
  }

  return reply.code(200).send({
    ...report.payload,
    persisted_at: report.generated_at,
    persistence_driver: persistenceDriver,
  });
});

app.post<{ Body: PublishSubmitBody }>('/publish/submit', async (request, reply) => {
  const { model, profile, publish_id, metrics_override, options, submitted_by } = request.body ?? {};

  if (model === undefined) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'model is required in request body',
    });
  }

  if (profile !== undefined && !isGateProfile(profile)) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'profile must be baseline or strict_compliance',
    });
  }

  const gateResult = runPublishGate({
    model: model as AuthzModelConfig,
    profile,
    publish_id,
    metrics_override: buildPublishMetricsOverride(metrics_override, options),
    validator_options: {
      available_obligation_executors: options?.available_obligation_executors,
      cardinality_counts: options?.cardinality_counts,
    },
  });

  const now = new Date().toISOString();
  const submitter = isNonEmptyString(submitted_by) ? submitted_by : 'system';
  const publishRecord = buildPublishRequestRecord({
    gate_result: gateResult,
    submitted_by: submitter,
    model_snapshot: model as AuthzModelConfig,
    now,
  });

  try {
    await Promise.all([
      persistence.saveGateReport({
        publish_id: gateResult.publish_id,
        profile: gateResult.profile,
        final_result: gateResult.final_result,
        created_at: now,
        payload: gateResult as unknown as Record<string, unknown>,
      }),
      persistence.savePublishRequest(publishRecord),
    ]);
  } catch (error) {
    app.log.error({ err: error, publish_id: gateResult.publish_id }, 'persist publish submit failed');
    return reply.code(500).send({
      code: 'PERSISTENCE_FAILED',
      message: 'persist publish submit failed',
    });
  }

  return reply.code(200).send({
    publish_id: gateResult.publish_id,
    status: publishRecord.status,
    persisted_at: now,
    persistence_driver: persistenceDriver,
    gate_result: gateResult,
  });
});

app.get<{ Querystring: PublishRequestListQuery }>('/publish/requests', async (request, reply) => {
  const status = request.query?.status?.trim();
  const profile = request.query?.profile?.trim();
  const limit = parseListNumber(request.query?.limit, 20);
  const offset = parseListNumber(request.query?.offset, 0);

  if (status !== undefined && status.length > 0 && !isPublishWorkflowStatus(status)) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'status must be one of blocked/review_required/approved/rejected/published',
    });
  }

  if (profile !== undefined && profile.length > 0 && !isGateProfile(profile)) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'profile must be baseline or strict_compliance',
    });
  }

  if (Number.isNaN(limit) || Number.isNaN(offset) || limit < 1 || limit > 100) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'limit must be integer in [1, 100], offset must be integer >= 0',
    });
  }

  const records = await persistence.listPublishRequests({
    status: status && status.length > 0 ? status : undefined,
    profile: profile && profile.length > 0 ? profile : undefined,
    limit,
    offset,
  });

  return reply.code(200).send({
    items: records.items,
    total_count: records.total_count,
    has_more: records.has_more,
    next_offset: records.next_offset,
    limit,
    offset,
  });
});

async function getPublishRequestById(id: string, reply: FastifyReply) {
  const record = await persistence.getPublishRequest(id);
  if (!record) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `publish request ${id} not found`,
    });
  }

  return reply.code(200).send(record);
}

app.get<{ Params: IdParams }>('/publish/requests/:id', async (request, reply) => {
  return getPublishRequestById(request.params.id, reply);
});

app.get<{ Params: IdParams }>('/publish:requests/:id', async (request, reply) => {
  return getPublishRequestById(request.params.id, reply);
});

app.post<{ Body: PublishReviewBody }>('/publish/review', async (request, reply) => {
  const { publish_id, decision, reviewer, reason, expires_at } = request.body ?? {};

  if (
    !isNonEmptyString(publish_id) ||
    (decision !== 'approve' && decision !== 'reject') ||
    !isNonEmptyString(reviewer) ||
    !isNonEmptyString(reason)
  ) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'publish_id, decision, reviewer and reason are required',
    });
  }

  if (isNonEmptyString(expires_at) && Number.isNaN(Date.parse(expires_at))) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'expires_at must be valid ISO datetime',
    });
  }

  const current = await persistence.getPublishRequest(publish_id);
  if (!current) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `publish request ${publish_id} not found`,
    });
  }

  let nextRecord;
  try {
    nextRecord = applyPublishReview({
      record: current,
      review: {
        decision,
        reviewer,
        reason,
        expires_at: isNonEmptyString(expires_at) ? expires_at : undefined,
      },
      now: new Date().toISOString(),
    });
  } catch (error) {
    return reply.code(409).send({
      code: 'INVALID_STATE',
      message: error instanceof Error ? error.message : 'invalid publish review state',
    });
  }

  try {
    await persistence.savePublishRequest(nextRecord);
  } catch (error) {
    app.log.error({ err: error, publish_id }, 'persist publish review failed');
    return reply.code(500).send({
      code: 'PERSISTENCE_FAILED',
      message: 'persist publish review failed',
    });
  }

  return reply.code(200).send(nextRecord);
});

app.post<{ Body: PublishActivateBody }>('/publish/activate', async (request, reply) => {
  const { publish_id, operator } = request.body ?? {};

  if (!isNonEmptyString(publish_id)) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'publish_id is required',
    });
  }

  const current = await persistence.getPublishRequest(publish_id);
  if (!current) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `publish request ${publish_id} not found`,
    });
  }

  let nextRecord;
  try {
    nextRecord = applyPublishActivation({
      record: current,
      operator: isNonEmptyString(operator) ? operator : 'release_bot',
      now: new Date().toISOString(),
    });
  } catch (error) {
    return reply.code(409).send({
      code: 'INVALID_STATE',
      message: error instanceof Error ? error.message : 'invalid publish activation state',
    });
  }

  try {
    await persistence.savePublishRequest(nextRecord);
  } catch (error) {
    app.log.error({ err: error, publish_id }, 'persist publish activation failed');
    return reply.code(500).send({
      code: 'PERSISTENCE_FAILED',
      message: 'persist publish activation failed',
    });
  }

  return reply.code(200).send(nextRecord);
});

app.post<{ Body: LifecycleSubjectRemovedBody }>(
  '/lifecycle:subject-removed',
  async (request, reply) => {
    const { model, event, object_snapshots, options } = request.body ?? {};

    if (model === undefined) {
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'model is required in request body',
      });
    }

    if (!event || !isNonEmptyString(event.target)) {
      return reply.code(400).send({
        code: 'INVALID_REQUEST',
        message: 'event.target is required',
      });
    }

    const occurredAt = isNonEmptyString(event.occurred_at)
      ? event.occurred_at
      : new Date().toISOString();
    const operator = isNonEmptyString(event.operator) ? event.operator : 'system';

    const result = executeSubjectRemovedLifecycle({
      model: model as AuthzModelConfig,
      event: {
        event_type: 'subject_removed',
        target: event.target,
        occurred_at: occurredAt,
        operator,
      },
      object_snapshots,
      options,
    });

    const lifecycleId = nextLifecycleId();
    const createdAt = new Date().toISOString();

    try {
      await persistence.saveLifecycleReport({
        lifecycle_id: lifecycleId,
        event_type: 'subject_removed',
        target: event.target,
        created_at: createdAt,
        payload: result as unknown as Record<string, unknown>,
      });
    } catch (error) {
      app.log.error({ err: error, lifecycle_id: lifecycleId }, 'persist lifecycle report failed');
    }

    return reply.code(200).send({
      lifecycle_id: lifecycleId,
      persisted_at: createdAt,
      persistence_driver: persistenceDriver,
      ...result,
    });
  },
);

app.get<{ Params: IdParams }>('/lifecycle-reports/:id', async (request, reply) => {
  const record = await persistence.getLifecycleReport(request.params.id);
  if (!record) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `lifecycle report ${request.params.id} not found`,
    });
  }

  return reply.code(200).send(record);
});

app.post<{ Body: DecisionEvaluateBody }>('/decisions:evaluate', async (request, reply) => {
  const { model, input, options } = request.body ?? {};

  if (
    !input ||
    !isNonEmptyString(input.action) ||
    !isNonEmptyString(input.subject?.id) ||
    !isNonEmptyString(input.object?.id)
  ) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'input.action, input.subject.id and input.object.id are required',
    });
  }

  if (model === undefined) {
    return reply.code(400).send({
      code: 'INVALID_REQUEST',
      message: 'model is required in request body',
    });
  }

  const validation = validateModelConfig(model, {
    available_obligation_executors: options?.available_obligation_executors,
  });

  const strict = options?.strict_validation ?? true;
  if (strict && !validation.valid) {
    return reply.code(422).send({
      code: 'INVALID_MODEL',
      message: 'model validation failed before decision evaluation',
      validation,
    });
  }

  const constraintEvaluation = evaluateConstraints({
    model: model as AuthzModelConfig,
    cardinality_counts: options?.cardinality_counts,
  });
  if (constraintEvaluation.violations.length > 0) {
    return reply.code(409).send({
      code: 'CONSTRAINT_VIOLATION',
      message: 'constraint evaluation failed before decision evaluation',
      constraint_evaluation: constraintEvaluation,
      model_validation: validation,
    });
  }

  const decisionInput: DecisionInput = {
    action: input.action,
    subject: makeSubject(input.subject),
    object: makeObject(input.object),
    context: input.context,
  };

  const result = evaluateDecision({
    model: model as AuthzModelConfig,
    input: decisionInput,
  });

  const decisionId = nextDecisionId();
  const createdAt = new Date().toISOString();

  try {
    await persistence.saveDecision({
      decision_id: decisionId,
      created_at: createdAt,
      payload: result.decision,
      traces: result.traces as unknown as Array<Record<string, unknown>>,
    });
  } catch (error) {
    app.log.error({ err: error, decision_id: decisionId }, 'persist decision failed');
  }

  return reply.code(200).send({
    decision_id: decisionId,
    persisted_at: createdAt,
    persistence_driver: persistenceDriver,
    decision: result.decision,
    traces: result.traces,
    constraint_evaluation: constraintEvaluation,
    model_validation: validation,
  });
});

app.get<{ Params: IdParams }>('/decisions/:id', async (request, reply) => {
  const record = await persistence.getDecision(request.params.id);
  if (!record) {
    return reply.code(404).send({
      code: 'NOT_FOUND',
      message: `decision ${request.params.id} not found`,
    });
  }

  return reply.code(200).send(record);
});

export async function startServer(port = 3010): Promise<void> {
  await app.listen({ port, host: '0.0.0.0' });
}

function resolvePort(): number {
  const raw = process.env.ACL_API_PORT ?? process.env.PORT;
  const parsed = Number(raw);
  if (raw && Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return 3010;
}

if (require.main === module) {
  startServer(resolvePort()).catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
}
