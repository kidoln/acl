import type { RelationEdge, ValidityWindow } from './domain';

export type ModelStatus = 'draft' | 'published' | 'archived';

export type CombiningAlgorithm =
  | 'deny-overrides'
  | 'permit-overrides'
  | 'first-applicable'
  | 'ordered-deny-overrides';

export type RuleEffect = 'allow' | 'deny';

export type DecisionEffect = 'allow' | 'deny' | 'not_applicable' | 'indeterminate';

export type CompatibilityMode = 'compat_open' | 'compat_balanced' | 'compat_strict';

export type ConsistencyLevel = 'strong' | 'bounded_staleness' | 'eventual';

export interface ModelMeta {
  model_id: string;
  tenant_id: string;
  version: string;
  status: ModelStatus;
  combining_algorithm: CombiningAlgorithm;
}

export interface OnboardingProfile {
  required_fields: string[];
  autofill?: Record<string, string>;
}

export interface ConditionalRequiredRule {
  when: string;
  add_fields: string[];
}

export interface ActionSignatureTuple {
  subject_types: string[];
  object_types: string[];
  actions: string[];
  enabled?: boolean;
}

export interface ActionSignatureConfig {
  tuples: ActionSignatureTuple[];
}

export interface ObjectOnboardingConfig {
  compatibility_mode: CompatibilityMode;
  default_profile: string;
  profiles: Record<string, OnboardingProfile>;
  conditional_required: ConditionalRequiredRule[];
}

export interface PolicyRule {
  id: string;
  subject_selector: string;
  object_selector: string;
  action_set: string[];
  effect: RuleEffect;
  priority: number;
  conditions?: string;
  validity?: ValidityWindow;
  obligations?: string[];
  advice?: string[];
}

export interface SodRule {
  id: string;
  forbidden_combination: string[];
}

export interface CardinalityRule {
  target: string;
  max_count: number;
}

export interface LifecycleRule {
  event_type: string;
  handler: string;
  required?: boolean;
}

export interface ConsistencyConfig {
  default_level: ConsistencyLevel;
  high_risk_level: Extract<ConsistencyLevel, 'strong' | 'bounded_staleness'>;
  bounded_staleness_ms?: number;
}

export interface AttributeQualityConfig {
  authority_whitelist?: string[];
  freshness_ttl_sec?: Record<string, number>;
  reject_unknown_source?: boolean;
}

export interface QualityGuardrails {
  attribute_quality: AttributeQualityConfig;
  mandatory_obligations: string[];
}

export type ContextInferenceEntitySide = 'from' | 'to';

export interface ContextInferenceEdgeSelector {
  relation_type: string;
  entity_side: ContextInferenceEntitySide;
  max_depth?: number;
}

export interface ContextInferenceRule {
  id: string;
  output_field: string;
  subject_edges: ContextInferenceEdgeSelector[];
  object_edges: ContextInferenceEdgeSelector[];
  object_owner_fallback?: boolean;
  owner_fallback_include_input?: boolean;
}

export interface ContextInferenceConstraints {
  monotonic_only?: boolean;
  stratified_negation?: boolean;
}

export interface ContextInferenceConfig {
  enabled?: boolean;
  rules: ContextInferenceRule[];
  constraints?: ContextInferenceConstraints;
}

export type DecisionSearchPushdownMode = 'safe' | 'aggressive';

export interface DecisionSearchPushdownConfig {
  mode?: DecisionSearchPushdownMode;
  require_semantic_equivalence?: boolean;
  allow_conservative_superset?: boolean;
  max_candidates_scan?: number;
}

export interface DecisionSearchConfig {
  enabled?: boolean;
  pushdown?: DecisionSearchPushdownConfig;
}

export interface AuthzModelConfig {
  model_meta: ModelMeta;
  catalogs: {
    action_catalog: string[];
    subject_type_catalog: string[];
    object_type_catalog: string[];
    relation_type_catalog?: string[];
    subject_relation_type_catalog?: string[];
    object_relation_type_catalog?: string[];
    subject_object_relation_type_catalog?: string[];
  };
  action_signature?: ActionSignatureConfig;
  object_onboarding: ObjectOnboardingConfig;
  relations?: {
    subject_relations: RelationEdge[];
    object_relations: RelationEdge[];
    subject_object_relations: RelationEdge[];
  };
  policies: {
    rules: PolicyRule[];
  };
  constraints: {
    sod_rules: SodRule[];
    cardinality_rules: CardinalityRule[];
  };
  lifecycle: {
    event_rules: LifecycleRule[];
  };
  consistency: ConsistencyConfig;
  quality_guardrails: QualityGuardrails;
  context_inference?: ContextInferenceConfig;
  decision_search?: DecisionSearchConfig;
}

export interface DecisionRequest {
  subject_id: string;
  action: string;
  object_id: string;
  context?: Record<string, unknown>;
}

export interface DecisionRecord {
  request: DecisionRequest;
  matched_rules: string[];
  overridden_rules: string[];
  final_effect: DecisionEffect;
  reason: string;
  obligations?: string[];
  advice?: string[];
  occurred_at: string;
}
