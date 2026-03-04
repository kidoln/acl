import type { AuthzModelConfig } from '@acl/shared-types';
import type { ValidatorOptions } from '@acl/validator';

export type GateProfile = 'baseline' | 'strict_compliance';

export type GateLevel = 'P0' | 'P1' | 'P2' | 'P3';

export type GateDecision =
  | 'block'
  | 'review_data_governance'
  | 'review_ops'
  | 'review_business_owner'
  | 'open_governance_ticket';

export type GateFinalResult = 'blocked' | 'review_required' | 'passed' | 'passed_with_ticket';

export interface PublishGateRuleResult {
  level: GateLevel;
  rule_id: string;
  code: string;
  passed: boolean;
  decision: GateDecision;
  detail: string;
}

export interface GateMetrics {
  schema: {
    valid: boolean;
  };
  semantic: {
    selector_parse_error_count: number;
    selector_type_mismatch_count: number;
    unregistered_action_count: number;
    unknown_relation_type_count: number;
    duplicate_rule_id_count: number;
  };
  conflict: {
    unresolved_count: number;
  };
  security: {
    sod_violation_count: number;
    cardinality_exceeded_count: number;
    high_sensitivity_eventual_count: number;
    high_sensitivity_weak_staleness_count: number;
    mandatory_obligation_missing_count: number;
  };
  lifecycle: {
    required_handler_missing_count: number;
    takeover_queue_backlog_count: number;
    takeover_queue_max_pending_hours: number;
  };
  onboarding: {
    default_profile_exists: boolean;
    profile_include_hard_required: boolean;
    strict_mode_violation_count: number;
  };
  execution: {
    mandatory_obligation_static_unexecutable_count: number;
    mandatory_obligation_pass_rate: number;
  };
  attribute: {
    untrusted_source_count: number;
    stale_count: number;
  };
  simulation: {
    indeterminate_rate: number;
  };
  quality: {
    unreachable_rule_ratio: number;
    priority_collision_ratio: number;
  };
}

export interface PublishGateInput {
  model: AuthzModelConfig;
  profile?: GateProfile;
  publish_id?: string;
  metrics_override?: Partial<GateMetrics>;
  validator_options?: ValidatorOptions;
}

export interface PublishGateResult {
  publish_id: string;
  profile: GateProfile;
  final_result: GateFinalResult;
  gates: PublishGateRuleResult[];
  review_required: boolean;
  tickets: string[];
  metrics: GateMetrics;
}
