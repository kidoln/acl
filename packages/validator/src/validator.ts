import { evaluateConstraints } from '@acl/constraints';
import { parseSelector } from '@acl/policy-dsl';
import { validateAuthzModel } from '@acl/schema';
import type {
  AuthzModelConfig,
  ContextInferenceRule,
  PolicyRule,
  RelationSignatureTuple,
} from '@acl/shared-types';

import type {
  ModelValidationResult,
  ValidationCode,
  ValidationIssue,
  ValidationLayer,
  ValidatorOptions,
} from './types';

const HARD_REQUIRED_FIELDS = ['tenant_id', 'object_id', 'object_type', 'created_by'];

const BUILTIN_OBLIGATION_EXECUTORS = new Set([
  'audit_write',
  'step_up_mfa',
  'pii_masking',
  'dual_approval',
  'review_ticket',
]);

const VALID_MODEL_STATUSES = new Set(['draft', 'published', 'archived']);
const VALID_COMBINING_ALGORITHMS = new Set([
  'deny-overrides',
  'permit-overrides',
  'first-applicable',
  'ordered-deny-overrides',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAuthzModelConfigLike(value: unknown): value is AuthzModelConfig {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRecord(value.model_meta) &&
    isRecord(value.catalogs) &&
    isRecord(value.object_onboarding) &&
    isRecord(value.policies) &&
    isRecord(value.constraints) &&
    isRecord(value.lifecycle) &&
    isRecord(value.consistency) &&
    isRecord(value.quality_guardrails)
  );
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function firstSegment(path: string): string {
  const [segment] = path.split('.');
  return segment ?? '';
}

function addIssue(
  issues: ValidationIssue[],
  code: ValidationCode,
  layer: ValidationLayer,
  message: string,
  path: string,
  blocking = true,
): void {
  issues.push({
    code,
    layer,
    severity: blocking ? 'error' : 'warning',
    message,
    path,
    blocking,
  });
}

function validateModelMeta(config: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(config) || !isRecord(config.model_meta)) {
    addIssue(
      issues,
      'MODEL_META_INVALID',
      'structure',
      'model_meta is required and must be an object',
      '/model_meta',
    );
    return;
  }

  const modelMeta = config.model_meta;
  const modelId = modelMeta.model_id;
  const tenantId = modelMeta.tenant_id;
  const version = modelMeta.version;
  const status = modelMeta.status;
  const algorithm = modelMeta.combining_algorithm;

  if (typeof modelId !== 'string' || modelId.trim().length === 0) {
    addIssue(
      issues,
      'MODEL_META_INVALID',
      'structure',
      'model_meta.model_id must be non-empty string',
      '/model_meta/model_id',
    );
  }

  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    addIssue(
      issues,
      'MODEL_META_INVALID',
      'structure',
      'model_meta.tenant_id must be non-empty string',
      '/model_meta/tenant_id',
    );
  }

  if (typeof version !== 'string' || version.trim().length === 0) {
    addIssue(
      issues,
      'MODEL_META_INVALID',
      'structure',
      'model_meta.version must be non-empty string',
      '/model_meta/version',
    );
  }

  if (typeof status !== 'string' || !VALID_MODEL_STATUSES.has(status)) {
    addIssue(
      issues,
      'MODEL_META_INVALID',
      'structure',
      'model_meta.status must be one of draft/published/archived',
      '/model_meta/status',
    );
  }

  if (typeof algorithm !== 'string' || !VALID_COMBINING_ALGORITHMS.has(algorithm)) {
    addIssue(
      issues,
      'MODEL_META_INVALID',
      'structure',
      'model_meta.combining_algorithm is invalid',
      '/model_meta/combining_algorithm',
    );
  }
}

function collectTopLevelStructureIssues(config: unknown, issues: ValidationIssue[]): void {
  if (!isRecord(config)) {
    addIssue(
      issues,
      'SCHEMA_VALIDATION_FAILED',
      'structure',
      'model config must be an object',
      '/',
    );
    return;
  }

  const requiredBlocks = [
    'model_meta',
    'catalogs',
    'relation_signature',
    'object_onboarding',
    'policies',
    'constraints',
    'lifecycle',
    'consistency',
    'quality_guardrails',
  ];

  for (const block of requiredBlocks) {
    if (!(block in config)) {
      addIssue(
        issues,
        'SCHEMA_VALIDATION_FAILED',
        'structure',
        `missing required top-level block: ${block}`,
        `/${block}`,
      );
    }
  }
}

function isHighSensitivityRule(rule: PolicyRule): boolean {
  return /sensitivity\s*==\s*(['"])?high\1?/i.test(rule.object_selector);
}

function validateRuleSelectors(rules: PolicyRule[], issues: ValidationIssue[]): void {
  rules.forEach((rule, index) => {
    const subjectResult = parseSelector(rule.subject_selector, 'subject_selector');
    if (!subjectResult.ok) {
      subjectResult.errors.forEach((error) => {
        addIssue(
          issues,
          'SELECTOR_PARSE_ERROR',
          'semantic',
          `${error.message}; clause=${error.clause}; offset=${error.offset}`,
          `/policies/rules/${index}/subject_selector`,
        );
      });
    }

    const objectResult = parseSelector(rule.object_selector, 'object_selector');
    if (!objectResult.ok) {
      objectResult.errors.forEach((error) => {
        addIssue(
          issues,
          'SELECTOR_PARSE_ERROR',
          'semantic',
          `${error.message}; clause=${error.clause}; offset=${error.offset}`,
          `/policies/rules/${index}/object_selector`,
        );
      });
    }
  });
}

function validateUniqueRuleIds(rules: PolicyRule[], issues: ValidationIssue[]): void {
  const seen = new Map<string, number>();

  rules.forEach((rule, index) => {
    const firstIndex = seen.get(rule.id);
    if (firstIndex === undefined) {
      seen.set(rule.id, index);
      return;
    }

    addIssue(
      issues,
      'DUPLICATE_RULE_ID',
      'schema',
      `rule id ${rule.id} is duplicated with rules[${firstIndex}]`,
      `/policies/rules/${index}/id`,
    );
  });
}

function validateSelectorTypeMismatch(rules: PolicyRule[], issues: ValidationIssue[]): void {
  rules.forEach((rule, index) => {
    const checkScope = (
      selector: string,
      scope: 'subject_selector' | 'object_selector',
      path: string,
      allowedRoots: string[],
    ): void => {
      const parsed = parseSelector(selector, scope);
      if (!parsed.ok || !parsed.ast) {
        return;
      }

      parsed.ast.clauses.forEach((clause) => {
        const root = firstSegment(clause.left);
        if (allowedRoots.includes(root)) {
          return;
        }

        addIssue(
          issues,
          'SELECTOR_TYPE_MISMATCH',
          'semantic',
          `${scope} contains unsupported root "${root}" in path "${clause.left}"`,
          path,
        );
      });
    };

    checkScope(
      rule.subject_selector,
      'subject_selector',
      `/policies/rules/${index}/subject_selector`,
      ['subject', 'context'],
    );
    checkScope(
      rule.object_selector,
      'object_selector',
      `/policies/rules/${index}/object_selector`,
      ['object', 'context'],
    );

    if (typeof rule.conditions === 'string' && rule.conditions.trim().length > 0) {
      checkScope(
        rule.conditions,
        'object_selector',
        `/policies/rules/${index}/conditions`,
        ['object', 'context'],
      );
    }
  });
}

function validateRegisteredActions(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const registeredActions = new Set(model.catalogs.action_catalog);

  model.policies.rules.forEach((rule, index) => {
    rule.action_set.forEach((action) => {
      if (!registeredActions.has(action)) {
        addIssue(
          issues,
          'ACTION_NOT_REGISTERED',
          'semantic',
          `action ${action} is not registered in catalogs.action_catalog`,
          `/policies/rules/${index}/action_set`,
        );
      }
    });
  });
}

function extractSelectorExactTypeValues(
  selector: string,
  scope: 'subject_selector' | 'object_selector',
  typePath: string,
): string[] | undefined {
  const parsed = parseSelector(selector, scope);
  if (!parsed.ok || !parsed.ast) {
    return undefined;
  }

  const values = new Set<string>();
  parsed.ast.clauses.forEach((clause) => {
    if (clause.type !== 'comparison') {
      return;
    }
    if (clause.left !== typePath) {
      return;
    }
    values.add(clause.right);
  });

  if (values.size === 0) {
    return undefined;
  }
  return Array.from(values);
}

function encodeActionSignatureTriple(subjectType: string, objectType: string, action: string): string {
  return `${subjectType}::${objectType}::${action}`;
}

function validateActionSignature(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  if (!model.action_signature || !Array.isArray(model.action_signature.tuples)) {
    return;
  }

  const subjectCatalog = new Set(model.catalogs.subject_type_catalog);
  const objectCatalog = new Set(model.catalogs.object_type_catalog);
  const actionCatalog = new Set(model.catalogs.action_catalog);
  const allowedTriples = new Set<string>();

  model.action_signature.tuples.forEach((tuple, tupleIndex) => {
    tuple.subject_types.forEach((subjectType) => {
      if (!subjectCatalog.has(subjectType)) {
        addIssue(
          issues,
          'ACTION_SIGNATURE_MISMATCH',
          'semantic',
          `action signature subject type ${subjectType} is not in catalogs.subject_type_catalog`,
          `/action_signature/tuples/${tupleIndex}/subject_types`,
        );
      }
    });

    tuple.object_types.forEach((objectType) => {
      if (!objectCatalog.has(objectType)) {
        addIssue(
          issues,
          'ACTION_SIGNATURE_MISMATCH',
          'semantic',
          `action signature object type ${objectType} is not in catalogs.object_type_catalog`,
          `/action_signature/tuples/${tupleIndex}/object_types`,
        );
      }
    });

    tuple.actions.forEach((action) => {
      if (!actionCatalog.has(action)) {
        addIssue(
          issues,
          'ACTION_SIGNATURE_MISMATCH',
          'semantic',
          `action signature action ${action} is not in catalogs.action_catalog`,
          `/action_signature/tuples/${tupleIndex}/actions`,
        );
      }
    });

    if (tuple.enabled === false) {
      return;
    }

    tuple.subject_types.forEach((subjectType) => {
      tuple.object_types.forEach((objectType) => {
        tuple.actions.forEach((action) => {
          allowedTriples.add(encodeActionSignatureTriple(subjectType, objectType, action));
        });
      });
    });
  });

  model.policies.rules.forEach((rule, ruleIndex) => {
    const subjectTypes =
      extractSelectorExactTypeValues(rule.subject_selector, 'subject_selector', 'subject.type')
      ?? model.catalogs.subject_type_catalog;
    const objectTypes =
      extractSelectorExactTypeValues(rule.object_selector, 'object_selector', 'object.type')
      ?? model.catalogs.object_type_catalog;

    for (const action of rule.action_set) {
      let covered = true;

      for (const subjectType of subjectTypes) {
        for (const objectType of objectTypes) {
          const triple = encodeActionSignatureTriple(subjectType, objectType, action);
          if (allowedTriples.has(triple)) {
            continue;
          }
          covered = false;
          break;
        }
        if (!covered) {
          break;
        }
      }

      if (!covered) {
        addIssue(
          issues,
          'ACTION_SIGNATURE_MISMATCH',
          'semantic',
          `rule ${rule.id} action ${action} exceeds action_signature allowed subject/object/action tuples`,
          `/policies/rules/${ruleIndex}/action_set`,
        );
        break;
      }
    }
  });
}

interface RelationTypeCatalogSets {
  subject: Set<string>;
  object: Set<string>;
  subjectObject: Set<string>;
  contextSubject: Set<string>;
  contextObject: Set<string>;
}

function toStringSet(values: string[] | undefined): Set<string> {
  return new Set(values ?? []);
}

function unionSets(...sets: Set<string>[]): Set<string> {
  const merged = new Set<string>();
  sets.forEach((set) => {
    set.forEach((item) => merged.add(item));
  });
  return merged;
}

function buildRelationTypeCatalogSets(model: AuthzModelConfig): RelationTypeCatalogSets {
  const subjectCatalog = toStringSet(model.catalogs.subject_relation_type_catalog);
  const objectCatalog = toStringSet(model.catalogs.object_relation_type_catalog);
  const subjectObjectCatalog = toStringSet(model.catalogs.subject_object_relation_type_catalog);

  return {
    subject: unionSets(subjectCatalog),
    object: unionSets(objectCatalog),
    subjectObject: unionSets(subjectObjectCatalog),
    contextSubject: unionSets(subjectCatalog, subjectObjectCatalog),
    contextObject: unionSets(objectCatalog, subjectObjectCatalog),
  };
}

function validateRelationSignature(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const relationSignature = model.relation_signature;
  if (!relationSignature) {
    addIssue(
      issues,
      'RELATION_SIGNATURE_MISMATCH',
      'semantic',
      'relation_signature is required',
      '/relation_signature',
    );
    return;
  }
  const subjectSignatureTuples = Array.isArray(relationSignature.subject_relations)
    ? relationSignature.subject_relations
    : [];
  const objectSignatureTuples = Array.isArray(relationSignature.object_relations)
    ? relationSignature.object_relations
    : [];
  const subjectObjectSignatureTuples = Array.isArray(relationSignature.subject_object_relations)
    ? relationSignature.subject_object_relations
    : [];

  const subjectTypeCatalog = new Set(model.catalogs.subject_type_catalog);
  const objectTypeCatalog = new Set(model.catalogs.object_type_catalog);
  const relationCatalogs = buildRelationTypeCatalogSets(model);

  const validateTupleCatalogs = (
    tuples: RelationSignatureTuple[],
    tuplePathPrefix: string,
    fromTypeCatalog: Set<string>,
    toTypeCatalog: Set<string>,
    relationTypeCatalog: Set<string>,
    relationCatalogHint: string,
  ): void => {
    tuples.forEach((tuple, tupleIndex) => {
      if (!relationTypeCatalog.has(tuple.relation_type)) {
        addIssue(
          issues,
          'RELATION_SIGNATURE_MISMATCH',
          'semantic',
          `relation signature relation_type ${tuple.relation_type} is not in ${relationCatalogHint}`,
          `${tuplePathPrefix}/${tupleIndex}/relation_type`,
        );
      }

      tuple.from_types.forEach((fromType, fromTypeIndex) => {
        if (!fromTypeCatalog.has(fromType)) {
          addIssue(
            issues,
            'RELATION_SIGNATURE_MISMATCH',
            'semantic',
            `relation signature from_type ${fromType} is not in domain type catalog`,
            `${tuplePathPrefix}/${tupleIndex}/from_types/${fromTypeIndex}`,
          );
        }
      });

      tuple.to_types.forEach((toType, toTypeIndex) => {
        if (!toTypeCatalog.has(toType)) {
          addIssue(
            issues,
            'RELATION_SIGNATURE_MISMATCH',
            'semantic',
            `relation signature to_type ${toType} is not in domain type catalog`,
            `${tuplePathPrefix}/${tupleIndex}/to_types/${toTypeIndex}`,
          );
        }
      });
    });
  };

  validateTupleCatalogs(
    subjectSignatureTuples,
    '/relation_signature/subject_relations',
    subjectTypeCatalog,
    subjectTypeCatalog,
    relationCatalogs.subject,
    'catalogs.subject_relation_type_catalog',
  );
  validateTupleCatalogs(
    objectSignatureTuples,
    '/relation_signature/object_relations',
    objectTypeCatalog,
    objectTypeCatalog,
    relationCatalogs.object,
    'catalogs.object_relation_type_catalog',
  );
  validateTupleCatalogs(
    subjectObjectSignatureTuples,
    '/relation_signature/subject_object_relations',
    subjectTypeCatalog,
    objectTypeCatalog,
    relationCatalogs.subjectObject,
    'catalogs.subject_object_relation_type_catalog',
  );

  const validateCoverage = (
    relationTypes: Set<string>,
    tuples: RelationSignatureTuple[],
    tuplePath: string,
    catalogHint: string,
  ): void => {
    const coveredRelationTypes = new Set<string>();
    tuples.forEach((tuple) => {
      if (tuple.enabled === false) {
        return;
      }
      coveredRelationTypes.add(tuple.relation_type);
    });

    relationTypes.forEach((relationType) => {
      if (coveredRelationTypes.has(relationType)) {
        return;
      }
      addIssue(
        issues,
        'RELATION_SIGNATURE_MISMATCH',
        'semantic',
        `relation type ${relationType} in ${catalogHint} must declare at least one enabled signature tuple`,
        tuplePath,
      );
    });
  };

  validateCoverage(
    relationCatalogs.subject,
    subjectSignatureTuples,
    '/relation_signature/subject_relations',
    'catalogs.subject_relation_type_catalog',
  );
  validateCoverage(
    relationCatalogs.object,
    objectSignatureTuples,
    '/relation_signature/object_relations',
    'catalogs.object_relation_type_catalog',
  );
  validateCoverage(
    relationCatalogs.subjectObject,
    subjectObjectSignatureTuples,
    '/relation_signature/subject_object_relations',
    'catalogs.subject_object_relation_type_catalog',
  );
}

function validateContextInferenceRules(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  if (!model.context_inference || !Array.isArray(model.context_inference.rules)) {
    return;
  }
  if (model.context_inference.enabled === false) {
    return;
  }

  const ruleIdSet = new Set<string>();
  const outputFieldSet = new Set<string>();
  const relationCatalogs = buildRelationTypeCatalogSets(model);

  const checkEdge = (
    rule: ContextInferenceRule,
    edgePath: string,
    edge: { relation_type: string },
    allowedRelationTypes: Set<string>,
    catalogHint: string,
  ): void => {
    if (allowedRelationTypes.has(edge.relation_type)) {
      return;
    }
    addIssue(
      issues,
      'RELATION_TYPE_UNKNOWN',
      'semantic',
      `context inference rule ${rule.id} uses relation type ${edge.relation_type} not registered in ${catalogHint}`,
      edgePath,
    );
  };

  model.context_inference.rules.forEach((rule, index) => {
    if (ruleIdSet.has(rule.id)) {
      addIssue(
        issues,
        'DUPLICATE_RULE_ID',
        'semantic',
        `context inference rule id ${rule.id} is duplicated`,
        `/context_inference/rules/${index}/id`,
      );
    }
    ruleIdSet.add(rule.id);

    if (outputFieldSet.has(rule.output_field)) {
      addIssue(
        issues,
        'RULE_CONFLICT_UNRESOLVED',
        'semantic',
        `context inference output_field ${rule.output_field} is duplicated`,
        `/context_inference/rules/${index}/output_field`,
      );
    }
    outputFieldSet.add(rule.output_field);

    const subjectPath = rule.subject_edges;
    const objectPath = rule.object_edges;

    if (
      rule.owner_fallback_include_input !== undefined &&
      rule.object_owner_fallback !== true
    ) {
      addIssue(
        issues,
        'INFERENCE_RULE_UNSAFE',
        'semantic',
        `context inference rule ${rule.id} sets owner_fallback_include_input but object_owner_fallback is not true`,
        `/context_inference/rules/${index}/owner_fallback_include_input`,
      );
    }

    if (subjectPath.length === 0 || objectPath.length === 0) {
      addIssue(
        issues,
        'INFERENCE_RULE_UNSAFE',
        'semantic',
        `context inference rule ${rule.id} must define non-empty subject_edges and object_edges`,
        `/context_inference/rules/${index}`,
      );
    }

    subjectPath.forEach((edge, edgeIndex) => {
      checkEdge(
        rule,
        `/context_inference/rules/${index}/subject_edges/${edgeIndex}/relation_type`,
        edge,
        relationCatalogs.contextSubject,
        'catalogs.subject_relation_type_catalog / catalogs.subject_object_relation_type_catalog',
      );
    });

    objectPath.forEach((edge, edgeIndex) => {
      checkEdge(
        rule,
        `/context_inference/rules/${index}/object_edges/${edgeIndex}/relation_type`,
        edge,
        relationCatalogs.contextObject,
        'catalogs.object_relation_type_catalog / catalogs.subject_object_relation_type_catalog',
      );
    });
  });

  const inferenceConstraints = model.context_inference.constraints;
  if (!inferenceConstraints) {
    addIssue(
      issues,
      'INFERENCE_RULE_UNSAFE',
      'semantic',
      'context_inference.constraints must be declared to bound inference decidability',
      '/context_inference/constraints',
    );
    return;
  }

  const monotonicOnly = inferenceConstraints.monotonic_only;
  const stratifiedNegation = inferenceConstraints.stratified_negation;
  if (monotonicOnly === true && stratifiedNegation === true) {
    addIssue(
      issues,
      'INFERENCE_RULE_UNSAFE',
      'semantic',
      'monotonic_only=true cannot be combined with stratified_negation=true',
      '/context_inference/constraints',
    );
  }

  if (monotonicOnly !== true && stratifiedNegation !== true) {
    addIssue(
      issues,
      'INFERENCE_RULE_UNSAFE',
      'semantic',
      'inference constraints must enable monotonic_only=true or stratified_negation=true',
      '/context_inference/constraints',
    );
  }
}

function validateDecisionSearchConfig(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const search = model.decision_search;
  if (!search || search.enabled !== true) {
    return;
  }

  const pushdown = search.pushdown;
  if (!pushdown) {
    addIssue(
      issues,
      'SEARCH_PUSHDOWN_UNSAFE',
      'security',
      'decision_search.enabled=true requires decision_search.pushdown configuration',
      '/decision_search/pushdown',
    );
    return;
  }

  if (pushdown.require_semantic_equivalence !== true && pushdown.allow_conservative_superset !== true) {
    addIssue(
      issues,
      'SEARCH_PUSHDOWN_UNSAFE',
      'security',
      'pushdown must enforce semantic equivalence or allow conservative superset + residual evaluation',
      '/decision_search/pushdown',
    );
  }

  if (pushdown.mode === 'aggressive' && pushdown.require_semantic_equivalence !== true) {
    addIssue(
      issues,
      'SEARCH_SEMANTIC_DRIFT',
      'executability',
      'aggressive pushdown without strict semantic equivalence may introduce search drift',
      '/decision_search/pushdown/mode',
      false,
    );
  }
}

function validateObjectOnboarding(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const profileNames = Object.keys(model.object_onboarding.profiles);
  if (!profileNames.includes(model.object_onboarding.default_profile)) {
    addIssue(
      issues,
      'OBJECT_PROFILE_REQUIRED_MISSING',
      'semantic',
      `default_profile ${model.object_onboarding.default_profile} does not exist in profiles`,
      '/object_onboarding/default_profile',
    );
  }

  profileNames.forEach((profileName) => {
    const profile = model.object_onboarding.profiles[profileName];
    const missing = HARD_REQUIRED_FIELDS.filter(
      (field) => !profile.required_fields.includes(field),
    );
    if (missing.length > 0) {
      addIssue(
        issues,
        'OBJECT_HARD_REQUIRED_MISSING',
        'semantic',
        `profile ${profileName} is missing hard required fields: ${missing.join(', ')}`,
        `/object_onboarding/profiles/${profileName}/required_fields`,
      );
    }
  });

  if (
    model.object_onboarding.compatibility_mode === 'compat_strict' &&
    model.object_onboarding.conditional_required.length === 0
  ) {
    addIssue(
      issues,
      'OBJECT_CONDITIONAL_REQUIRED_MISSING',
      'semantic',
      'compat_strict requires at least one conditional_required rule',
      '/object_onboarding/conditional_required',
      false,
    );
  }
}

function validateLifecycleHandlers(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const subjectRemovedRule = model.lifecycle.event_rules.find(
    (rule) => rule.event_type === 'subject_removed',
  );

  if (!subjectRemovedRule || subjectRemovedRule.required !== true || !subjectRemovedRule.handler) {
    addIssue(
      issues,
      'LIFECYCLE_HANDLER_MISSING',
      'semantic',
      'subject_removed lifecycle handler must exist and set required=true',
      '/lifecycle/event_rules',
    );
  }
}

function intersectActions(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((action) => rightSet.has(action));
}

function validateConflicts(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const canDisambiguate =
    model.model_meta.combining_algorithm !== 'first-applicable';

  for (let i = 0; i < model.policies.rules.length; i += 1) {
    const current = model.policies.rules[i];
    for (let j = i + 1; j < model.policies.rules.length; j += 1) {
      const target = model.policies.rules[j];
      if (current.effect === target.effect) {
        continue;
      }
      if (current.priority !== target.priority) {
        continue;
      }
      if (current.subject_selector !== target.subject_selector) {
        continue;
      }
      if (current.object_selector !== target.object_selector) {
        continue;
      }

      const sharedActions = intersectActions(current.action_set, target.action_set);
      if (sharedActions.length === 0) {
        continue;
      }

      if (canDisambiguate) {
        addIssue(
          issues,
          'PRIORITY_COLLISION',
          'semantic',
          `rule ${current.id} and ${target.id} share same priority with opposite effect: ${sharedActions.join(', ')}`,
          `/policies/rules/${j}`,
          false,
        );
      } else {
        addIssue(
          issues,
          'RULE_CONFLICT_UNRESOLVED',
          'semantic',
          `rule ${current.id} conflicts with ${target.id} on actions: ${sharedActions.join(', ')}`,
          `/policies/rules/${j}`,
        );
      }
    }
  }
}

function hasActionSuperset(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  return right.every((action) => leftSet.has(action));
}

function validateRuleReachability(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const rules = model.policies.rules;

  for (let i = 0; i < rules.length; i += 1) {
    const current = rules[i];

    for (let j = 0; j < rules.length; j += 1) {
      if (i === j) {
        continue;
      }

      const higher = rules[j];
      if (higher.effect !== current.effect) {
        continue;
      }
      if (higher.subject_selector !== current.subject_selector) {
        continue;
      }
      if (higher.object_selector !== current.object_selector) {
        continue;
      }
      if (higher.priority <= current.priority) {
        continue;
      }
      if (!hasActionSuperset(higher.action_set, current.action_set)) {
        continue;
      }

      if (higher.validity || current.validity) {
        continue;
      }

      addIssue(
        issues,
        'RULE_UNREACHABLE',
        'semantic',
        `rule ${current.id} is shadowed by higher-priority rule ${higher.id}`,
        `/policies/rules/${i}`,
        false,
      );
      break;
    }
  }
}

function validateHighSensitivityRules(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const highSensitivityRules = model.policies.rules.filter(isHighSensitivityRule);

  if (highSensitivityRules.length === 0) {
    return;
  }

  if (model.consistency.default_level === 'eventual') {
    addIssue(
      issues,
      'HIGH_SENSITIVITY_DOWNGRADED',
      'security',
      'high sensitivity rules cannot use eventual default consistency',
      '/consistency/default_level',
    );
  }

  if (model.consistency.high_risk_level !== 'strong') {
    addIssue(
      issues,
      'HIGH_SENSITIVITY_DOWNGRADED',
      'security',
      'high sensitivity rules require consistency.high_risk_level=strong',
      '/consistency/high_risk_level',
    );
  }

  if (model.model_meta.combining_algorithm === 'permit-overrides') {
    addIssue(
      issues,
      'HIGH_SENSITIVITY_DOWNGRADED',
      'security',
      'high sensitivity rules cannot use permit-overrides combining algorithm',
      '/model_meta/combining_algorithm',
    );
  }

  const mandatoryObligations = new Set(model.quality_guardrails.mandatory_obligations);
  highSensitivityRules.forEach((rule, index) => {
    if (rule.effect !== 'allow') {
      return;
    }
    const obligations = new Set(rule.obligations ?? []);
    const missing: string[] = [];

    mandatoryObligations.forEach((obligation) => {
      if (!obligations.has(obligation)) {
        missing.push(obligation);
      }
    });

    if (missing.length > 0) {
      addIssue(
        issues,
        'MANDATORY_OBLIGATION_MISSING',
        'security',
        `high sensitivity allow rule ${rule.id} is missing mandatory obligations: ${missing.join(', ')}`,
        `/policies/rules/${index}/obligations`,
      );
    }
  });
}

function validateAttributeQuality(model: AuthzModelConfig, issues: ValidationIssue[]): void {
  const attributeQuality = model.quality_guardrails.attribute_quality;
  const authority = attributeQuality.authority_whitelist ?? [];

  if (attributeQuality.reject_unknown_source === true && authority.length === 0) {
    addIssue(
      issues,
      'ATTRIBUTE_SOURCE_UNTRUSTED',
      'security',
      'reject_unknown_source=true requires non-empty authority_whitelist',
      '/quality_guardrails/attribute_quality/authority_whitelist',
    );
  }

  const ttlMap = attributeQuality.freshness_ttl_sec ?? {};
  Object.entries(ttlMap).forEach(([key, value]) => {
    if (value > 3600) {
      addIssue(
        issues,
        'ATTRIBUTE_STALE',
        'security',
        `attribute ${key} freshness_ttl_sec=${value} is higher than recommended 3600`,
        `/quality_guardrails/attribute_quality/freshness_ttl_sec/${key}`,
        false,
      );
    }
  });
}

function validateObligationExecutability(
  model: AuthzModelConfig,
  issues: ValidationIssue[],
  options: ValidatorOptions,
): void {
  const available =
    options.available_obligation_executors && options.available_obligation_executors.length > 0
      ? new Set(options.available_obligation_executors)
      : BUILTIN_OBLIGATION_EXECUTORS;

  const obligations = new Set<string>();
  model.quality_guardrails.mandatory_obligations.forEach((item) => obligations.add(item));
  model.policies.rules.forEach((rule) => {
    asStringArray(rule.obligations).forEach((item) => obligations.add(item));
  });

  obligations.forEach((obligation) => {
    if (!available.has(obligation)) {
      addIssue(
        issues,
        'OBLIGATION_NOT_EXECUTABLE',
        'executability',
        `obligation executor ${obligation} is not available`,
        '/quality_guardrails/mandatory_obligations',
      );
    }
  });
}

function validateConstraints(
  model: AuthzModelConfig,
  issues: ValidationIssue[],
  options: ValidatorOptions,
): void {
  const result = evaluateConstraints({
    model,
    cardinality_counts: options.cardinality_counts,
  });

  result.violations.forEach((violation) => {
    addIssue(issues, violation.code, 'security', violation.message, violation.path);
  });
}

function summarize(issues: ValidationIssue[]): ModelValidationResult['summary'] {
  const byLayer: Record<ValidationLayer, number> = {
    structure: 0,
    schema: 0,
    semantic: 0,
    security: 0,
    executability: 0,
  };

  issues.forEach((issue) => {
    byLayer[issue.layer] += 1;
  });

  return {
    total_issues: issues.length,
    blocking_issues: issues.filter((issue) => issue.blocking).length,
    by_layer: byLayer,
  };
}

export function validateModelConfig(
  config: unknown,
  options: ValidatorOptions = {},
): ModelValidationResult {
  const issues: ValidationIssue[] = [];

  collectTopLevelStructureIssues(config, issues);
  validateModelMeta(config, issues);

  const schemaResult = validateAuthzModel(config);
  if (!schemaResult.valid) {
    schemaResult.errors.forEach((error) => {
      addIssue(
        issues,
        'SCHEMA_VALIDATION_FAILED',
        'schema',
        error.message ?? 'schema validation failed',
        error.instancePath || '/',
      );
    });
  }

  if (isRecord(config) && isAuthzModelConfigLike(config)) {
    const model = config;

    if (Array.isArray(model.policies?.rules)) {
      validateUniqueRuleIds(model.policies.rules, issues);
      validateRuleSelectors(model.policies.rules, issues);
      validateSelectorTypeMismatch(model.policies.rules, issues);
      validateConflicts(model, issues);
      validateRuleReachability(model, issues);
    }

    if (model.catalogs && model.policies && Array.isArray(model.policies.rules)) {
      validateRegisteredActions(model, issues);
      validateActionSignature(model, issues);
    }

    if (model.catalogs) {
      validateRelationSignature(model, issues);
      validateContextInferenceRules(model, issues);
    }

    if (model.object_onboarding) {
      validateObjectOnboarding(model, issues);
    }

    if (model.lifecycle) {
      validateLifecycleHandlers(model, issues);
    }

    if (model.model_meta && model.consistency && model.quality_guardrails && model.policies) {
      validateConstraints(model, issues, options);
      validateHighSensitivityRules(model, issues);
      validateAttributeQuality(model, issues);
      validateObligationExecutability(model, issues, options);
      validateDecisionSearchConfig(model, issues);
    }
  }

  const summary = summarize(issues);
  return {
    valid: summary.blocking_issues === 0,
    issues,
    summary,
  };
}
