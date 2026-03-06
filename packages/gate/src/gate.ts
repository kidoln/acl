import type { AuthzModelConfig } from '@acl/shared-types';
import { validateModelConfig, type ModelValidationResult } from '@acl/validator';

import type {
  GateDecision,
  GateLevel,
  GateMetrics,
  GateProfile,
  PublishGateInput,
  PublishGateResult,
  PublishGateRuleResult,
} from './types';

const HARD_REQUIRED_FIELDS = ['tenant_id', 'object_id', 'object_type', 'created_by'];

type GateCheckFn = (metrics: GateMetrics) => boolean;

interface GateRule {
  level: GateLevel;
  rule_id: string;
  code: string;
  decision: GateDecision;
  check: GateCheckFn;
  detail: string;
}

function deepMergeMetrics(base: GateMetrics, override?: Partial<GateMetrics>): GateMetrics {
  if (!override) {
    return base;
  }

  return {
    schema: { ...base.schema, ...(override.schema ?? {}) },
    semantic: { ...base.semantic, ...(override.semantic ?? {}) },
    conflict: { ...base.conflict, ...(override.conflict ?? {}) },
    security: { ...base.security, ...(override.security ?? {}) },
    lifecycle: { ...base.lifecycle, ...(override.lifecycle ?? {}) },
    onboarding: { ...base.onboarding, ...(override.onboarding ?? {}) },
    execution: { ...base.execution, ...(override.execution ?? {}) },
    attribute: { ...base.attribute, ...(override.attribute ?? {}) },
    simulation: { ...base.simulation, ...(override.simulation ?? {}) },
    quality: { ...base.quality, ...(override.quality ?? {}) },
    search: { ...base.search, ...(override.search ?? {}) },
  };
}

function countIssue(validation: ModelValidationResult, code: string): number {
  return validation.issues.filter((issue) => issue.code === code).length;
}

function hasHighSensitivityRule(model: AuthzModelConfig): boolean {
  return model.policies.rules.some((rule) =>
    /sensitivity\s*==\s*(['"])?high\1?/i.test(rule.object_selector),
  );
}

function buildHighSensitivityConsistencyMetrics(model: AuthzModelConfig): {
  eventual_count: number;
  weak_staleness_count: number;
} {
  if (!hasHighSensitivityRule(model)) {
    return {
      eventual_count: 0,
      weak_staleness_count: 0,
    };
  }

  const eventualCount = model.consistency.default_level === 'eventual' ? 1 : 0;
  const weakStalenessCount =
    model.consistency.high_risk_level !== 'strong' ||
    (model.consistency.default_level === 'bounded_staleness' &&
      (model.consistency.bounded_staleness_ms ?? 0) > 1000)
      ? 1
      : 0;

  return {
    eventual_count: eventualCount,
    weak_staleness_count: weakStalenessCount,
  };
}

function toRatio(count: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Number((count / total).toFixed(6));
}

function hasHardRequiredInAllProfiles(model: AuthzModelConfig): boolean {
  return Object.values(model.object_onboarding.profiles).every((profile) =>
    HARD_REQUIRED_FIELDS.every((field) => profile.required_fields.includes(field)),
  );
}

function buildMetrics(model: AuthzModelConfig, validation: ModelValidationResult): GateMetrics {
  const defaultProfileExists = Object.prototype.hasOwnProperty.call(
    model.object_onboarding.profiles,
    model.object_onboarding.default_profile,
  );

  const highSensitivityMetrics = buildHighSensitivityConsistencyMetrics(model);
  const totalRules = model.policies.rules.length;
  const unreachableRuleCount = countIssue(validation, 'RULE_UNREACHABLE');
  const priorityCollisionCount = countIssue(validation, 'PRIORITY_COLLISION');

  return {
    schema: {
      valid: validation.issues.every(
        (issue) =>
          issue.code !== 'SCHEMA_VALIDATION_FAILED' && issue.code !== 'MODEL_META_INVALID',
      ),
    },
    semantic: {
      selector_parse_error_count: countIssue(validation, 'SELECTOR_PARSE_ERROR'),
      selector_type_mismatch_count: countIssue(validation, 'SELECTOR_TYPE_MISMATCH'),
      unregistered_action_count: countIssue(validation, 'ACTION_NOT_REGISTERED'),
      action_signature_mismatch_count: countIssue(validation, 'ACTION_SIGNATURE_MISMATCH'),
      relation_signature_mismatch_count: countIssue(validation, 'RELATION_SIGNATURE_MISMATCH'),
      unknown_relation_type_count: countIssue(validation, 'RELATION_TYPE_UNKNOWN'),
      inference_rule_unsafe_count: countIssue(validation, 'INFERENCE_RULE_UNSAFE'),
      duplicate_rule_id_count: countIssue(validation, 'DUPLICATE_RULE_ID'),
    },
    conflict: {
      unresolved_count: countIssue(validation, 'RULE_CONFLICT_UNRESOLVED'),
    },
    security: {
      sod_violation_count: countIssue(validation, 'SOD_VIOLATION'),
      cardinality_exceeded_count: countIssue(validation, 'CARDINALITY_EXCEEDED'),
      high_sensitivity_eventual_count: highSensitivityMetrics.eventual_count,
      high_sensitivity_weak_staleness_count: highSensitivityMetrics.weak_staleness_count,
      mandatory_obligation_missing_count: countIssue(validation, 'MANDATORY_OBLIGATION_MISSING'),
    },
    lifecycle: {
      required_handler_missing_count: countIssue(validation, 'LIFECYCLE_HANDLER_MISSING'),
      takeover_queue_backlog_count: 0,
      takeover_queue_max_pending_hours: 0,
    },
    onboarding: {
      default_profile_exists: defaultProfileExists,
      profile_include_hard_required: hasHardRequiredInAllProfiles(model),
      strict_mode_violation_count: countIssue(validation, 'OBJECT_CONDITIONAL_REQUIRED_MISSING'),
    },
    execution: {
      mandatory_obligation_static_unexecutable_count: countIssue(validation, 'OBLIGATION_NOT_EXECUTABLE'),
      mandatory_obligation_pass_rate: 1,
    },
    attribute: {
      untrusted_source_count: countIssue(validation, 'ATTRIBUTE_SOURCE_UNTRUSTED'),
      stale_count: countIssue(validation, 'ATTRIBUTE_STALE'),
    },
    simulation: {
      indeterminate_rate: 0,
    },
    quality: {
      unreachable_rule_ratio: toRatio(unreachableRuleCount, totalRules),
      priority_collision_ratio: toRatio(priorityCollisionCount, totalRules),
    },
    search: {
      enabled: model.decision_search?.enabled === true,
      pushdown_unsafe_count: countIssue(validation, 'SEARCH_PUSHDOWN_UNSAFE'),
      semantic_drift_count: countIssue(validation, 'SEARCH_SEMANTIC_DRIFT'),
    },
  };
}

const BASELINE_RULES: GateRule[] = [
  {
    level: 'P0',
    rule_id: 'p0_schema_valid',
    code: 'SCHEMA_VALIDATION_FAILED',
    decision: 'block',
    check: (m) => m.schema.valid,
    detail: 'schema validation must pass',
  },
  {
    level: 'P0',
    rule_id: 'p0_selector_parse',
    code: 'SELECTOR_PARSE_ERROR',
    decision: 'block',
    check: (m) => m.semantic.selector_parse_error_count === 0,
    detail: 'selector parse error count must be 0',
  },
  {
    level: 'P0',
    rule_id: 'p0_selector_type_mismatch',
    code: 'SELECTOR_TYPE_MISMATCH',
    decision: 'block',
    check: (m) => m.semantic.selector_type_mismatch_count === 0,
    detail: 'selector field scope must match subject/object domain',
  },
  {
    level: 'P0',
    rule_id: 'p0_action_registered',
    code: 'ACTION_NOT_REGISTERED',
    decision: 'block',
    check: (m) => m.semantic.unregistered_action_count === 0,
    detail: 'all action must be registered in catalog',
  },
  {
    level: 'P0',
    rule_id: 'p0_action_signature',
    code: 'ACTION_SIGNATURE_MISMATCH',
    decision: 'block',
    check: (m) => m.semantic.action_signature_mismatch_count === 0,
    detail: 'policy subject/object/action tuples must stay inside action_signature whitelist',
  },
  {
    level: 'P0',
    rule_id: 'p0_relation_registered',
    code: 'RELATION_TYPE_UNKNOWN',
    decision: 'block',
    check: (m) => m.semantic.unknown_relation_type_count === 0,
    detail: 'all relation type must be registered in catalog',
  },
  {
    level: 'P0',
    rule_id: 'p0_relation_signature',
    code: 'RELATION_SIGNATURE_MISMATCH',
    decision: 'block',
    check: (m) => m.semantic.relation_signature_mismatch_count === 0,
    detail: 'each relation type must be covered by relation_signature endpoint tuples',
  },
  {
    level: 'P0',
    rule_id: 'p0_inference_safe',
    code: 'INFERENCE_RULE_UNSAFE',
    decision: 'block',
    check: (m) => m.semantic.inference_rule_unsafe_count === 0,
    detail: 'context inference must stay within decidable safe subset',
  },
  {
    level: 'P0',
    rule_id: 'p0_rule_id_unique',
    code: 'DUPLICATE_RULE_ID',
    decision: 'block',
    check: (m) => m.semantic.duplicate_rule_id_count === 0,
    detail: 'rule id must be unique in model version',
  },
  {
    level: 'P0',
    rule_id: 'p0_unresolved_conflict',
    code: 'RULE_CONFLICT_UNRESOLVED',
    decision: 'block',
    check: (m) => m.conflict.unresolved_count === 0,
    detail: 'rule conflicts must be resolvable',
  },
  {
    level: 'P0',
    rule_id: 'p0_sod',
    code: 'SOD_VIOLATION',
    decision: 'block',
    check: (m) => m.security.sod_violation_count === 0,
    detail: 'sod violation count must be 0',
  },
  {
    level: 'P0',
    rule_id: 'p0_high_sensitivity_consistency',
    code: 'HIGH_SENSITIVITY_DOWNGRADED',
    decision: 'block',
    check: (m) => m.security.high_sensitivity_eventual_count === 0,
    detail: 'high sensitivity consistency cannot be downgraded',
  },
  {
    level: 'P0',
    rule_id: 'p0_lifecycle_handler',
    code: 'LIFECYCLE_HANDLER_MISSING',
    decision: 'block',
    check: (m) => m.lifecycle.required_handler_missing_count === 0,
    detail: 'required lifecycle handlers must exist',
  },
  {
    level: 'P0',
    rule_id: 'p0_onboarding_contract',
    code: 'OBJECT_PROFILE_REQUIRED_MISSING',
    decision: 'block',
    check: (m) => m.onboarding.default_profile_exists && m.onboarding.profile_include_hard_required,
    detail: 'default profile and hard required onboarding fields must be complete',
  },
  {
    level: 'P0',
    rule_id: 'p0_obligation_executable_static',
    code: 'OBLIGATION_NOT_EXECUTABLE',
    decision: 'block',
    check: (m) => m.execution.mandatory_obligation_static_unexecutable_count === 0,
    detail: 'mandatory obligations must be statically executable',
  },
  {
    level: 'P0',
    rule_id: 'p0_search_pushdown_safe',
    code: 'SEARCH_PUSHDOWN_UNSAFE',
    decision: 'block',
    check: (m) => !m.search.enabled || m.search.pushdown_unsafe_count === 0,
    detail: 'decision_search pushdown must satisfy semantic safety preconditions',
  },
  {
    level: 'P1',
    rule_id: 'p1_attribute_source',
    code: 'ATTRIBUTE_SOURCE_UNTRUSTED',
    decision: 'review_data_governance',
    check: (m) => m.attribute.untrusted_source_count === 0,
    detail: 'attribute source must be trusted',
  },
  {
    level: 'P2',
    rule_id: 'p2_lifecycle_takeover_backlog',
    code: 'LIFECYCLE_TAKEOVER_BACKLOG',
    decision: 'review_ops',
    check: (m) => m.lifecycle.takeover_queue_backlog_count <= 10,
    detail: 'takeover queue backlog should be <= 10 in baseline profile',
  },
  {
    level: 'P2',
    rule_id: 'p2_lifecycle_takeover_stale',
    code: 'LIFECYCLE_TAKEOVER_STALE',
    decision: 'review_ops',
    check: (m) => m.lifecycle.takeover_queue_max_pending_hours <= 24,
    detail: 'takeover queue max pending hours should be <= 24 in baseline profile',
  },
  {
    level: 'P2',
    rule_id: 'p2_obligation_exec',
    code: 'OBLIGATION_EXECUTION_DEGRADED',
    decision: 'review_ops',
    check: (m) => m.execution.mandatory_obligation_pass_rate >= 0.99,
    detail: 'mandatory obligation pass rate must be >= 0.99',
  },
  {
    level: 'P2',
    rule_id: 'p2_indeterminate_rate',
    code: 'INDETERMINATE_RATE_TOO_HIGH',
    decision: 'review_business_owner',
    check: (m) => m.simulation.indeterminate_rate <= 0.02,
    detail: 'indeterminate rate must be <= 0.02',
  },
  {
    level: 'P3',
    rule_id: 'p3_unreachable_ratio',
    code: 'RULE_UNREACHABLE',
    decision: 'open_governance_ticket',
    check: (m) => m.quality.unreachable_rule_ratio <= 0.15,
    detail: 'unreachable rule ratio should be <= 0.15',
  },
  {
    level: 'P3',
    rule_id: 'p3_priority_style',
    code: 'PRIORITY_COLLISION',
    decision: 'open_governance_ticket',
    check: (m) => m.quality.priority_collision_ratio <= 0.1,
    detail: 'priority collision ratio should be <= 0.10',
  },
];

const STRICT_RULES: GateRule[] = [
  ...BASELINE_RULES.filter(
    (rule) =>
      ![
        'p0_sod',
        'p0_high_sensitivity_consistency',
        'p0_onboarding_contract',
        'p2_lifecycle_takeover_backlog',
        'p2_lifecycle_takeover_stale',
        'p2_obligation_exec',
        'p2_indeterminate_rate',
        'p3_unreachable_ratio',
        'p3_priority_style',
      ].includes(rule.rule_id),
  ),
  {
    level: 'P0',
    rule_id: 'p0_sod',
    code: 'SOD_VIOLATION',
    decision: 'block',
    check: (m) => m.security.sod_violation_count === 0,
    detail: 'sod violation count must be 0',
  },
  {
    level: 'P0',
    rule_id: 'p0_cardinality',
    code: 'CARDINALITY_EXCEEDED',
    decision: 'block',
    check: (m) => m.security.cardinality_exceeded_count === 0,
    detail: 'cardinality exceeded count must be 0',
  },
  {
    level: 'P0',
    rule_id: 'p0_high_sensitivity_consistency',
    code: 'HIGH_SENSITIVITY_DOWNGRADED',
    decision: 'block',
    check: (m) =>
      m.security.high_sensitivity_eventual_count === 0 &&
      m.security.high_sensitivity_weak_staleness_count === 0,
    detail: 'high sensitivity consistency cannot be downgraded',
  },
  {
    level: 'P0',
    rule_id: 'p0_mandatory_obligation',
    code: 'MANDATORY_OBLIGATION_MISSING',
    decision: 'block',
    check: (m) => m.security.mandatory_obligation_missing_count === 0,
    detail: 'high sensitivity allow rules must include mandatory obligations',
  },
  {
    level: 'P0',
    rule_id: 'p0_onboarding_contract',
    code: 'OBJECT_PROFILE_REQUIRED_MISSING',
    decision: 'block',
    check: (m) =>
      m.onboarding.default_profile_exists &&
      m.onboarding.profile_include_hard_required &&
      m.onboarding.strict_mode_violation_count === 0,
    detail: 'strict profile onboarding contract must be complete',
  },
  {
    level: 'P1',
    rule_id: 'p1_lifecycle_takeover_backlog',
    code: 'LIFECYCLE_TAKEOVER_BACKLOG',
    decision: 'review_ops',
    check: (m) => m.lifecycle.takeover_queue_backlog_count === 0,
    detail: 'strict profile requires takeover queue backlog to be 0',
  },
  {
    level: 'P1',
    rule_id: 'p1_lifecycle_takeover_stale',
    code: 'LIFECYCLE_TAKEOVER_STALE',
    decision: 'review_ops',
    check: (m) => m.lifecycle.takeover_queue_max_pending_hours <= 4,
    detail: 'strict profile requires takeover queue max pending hours <= 4',
  },
  {
    level: 'P1',
    rule_id: 'p1_attribute_stale',
    code: 'ATTRIBUTE_STALE',
    decision: 'review_data_governance',
    check: (m) => m.attribute.stale_count === 0,
    detail: 'attribute staleness count should be 0',
  },
  {
    level: 'P2',
    rule_id: 'p2_obligation_exec',
    code: 'OBLIGATION_EXECUTION_DEGRADED',
    decision: 'review_ops',
    check: (m) => m.execution.mandatory_obligation_pass_rate >= 0.999,
    detail: 'mandatory obligation pass rate must be >= 0.999',
  },
  {
    level: 'P2',
    rule_id: 'p2_indeterminate_rate',
    code: 'INDETERMINATE_RATE_TOO_HIGH',
    decision: 'review_business_owner',
    check: (m) => m.simulation.indeterminate_rate <= 0.005,
    detail: 'indeterminate rate must be <= 0.005',
  },
  {
    level: 'P3',
    rule_id: 'p3_unreachable_ratio',
    code: 'RULE_UNREACHABLE',
    decision: 'open_governance_ticket',
    check: (m) => m.quality.unreachable_rule_ratio <= 0.05,
    detail: 'unreachable rule ratio should be <= 0.05',
  },
  {
    level: 'P3',
    rule_id: 'p3_priority_style',
    code: 'PRIORITY_COLLISION',
    decision: 'open_governance_ticket',
    check: (m) => m.quality.priority_collision_ratio <= 0.03,
    detail: 'priority collision ratio should be <= 0.03',
  },
];

function getRules(profile: GateProfile): GateRule[] {
  return profile === 'strict_compliance' ? STRICT_RULES : BASELINE_RULES;
}

function toGateResult(rule: GateRule, passed: boolean): PublishGateRuleResult {
  return {
    level: rule.level,
    rule_id: rule.rule_id,
    code: rule.code,
    passed,
    decision: rule.decision,
    detail: rule.detail,
  };
}

function nextPublishId(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `pub_${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
}

export function runPublishGate(input: PublishGateInput): PublishGateResult {
  const profile = input.profile ?? 'baseline';
  const validation = validateModelConfig(input.model, input.validator_options);
  const baseMetrics = buildMetrics(input.model, validation);
  const metrics = deepMergeMetrics(baseMetrics, input.metrics_override);

  const rules = getRules(profile);
  const gates: PublishGateRuleResult[] = [];
  const tickets: string[] = [];

  let blocked = false;
  let reviewRequired = false;

  const levels: GateLevel[] = ['P0', 'P1', 'P2', 'P3'];
  for (const level of levels) {
    const levelRules = rules.filter((rule) => rule.level === level);
    let levelFailed = false;

    for (const rule of levelRules) {
      const passed = rule.check(metrics);
      if (passed) {
        continue;
      }

      levelFailed = true;
      const item = toGateResult(rule, false);
      gates.push(item);

      if (rule.decision === 'open_governance_ticket') {
        tickets.push(`${rule.code}:${rule.rule_id}`);
      }

      if (level === 'P0') {
        blocked = true;
      }

      if (level === 'P1' || level === 'P2') {
        reviewRequired = true;
      }
    }

    if (blocked && levelFailed) {
      break;
    }
  }

  let finalResult: PublishGateResult['final_result'] = 'passed';
  if (blocked) {
    finalResult = 'blocked';
  } else if (reviewRequired) {
    finalResult = 'review_required';
  } else if (tickets.length > 0) {
    finalResult = 'passed_with_ticket';
  }

  return {
    publish_id: input.publish_id ?? nextPublishId(),
    profile,
    final_result: finalResult,
    gates,
    review_required: reviewRequired,
    tickets,
    metrics,
  };
}
