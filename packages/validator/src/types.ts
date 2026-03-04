export type ValidationLayer = 'structure' | 'schema' | 'semantic' | 'security' | 'executability';

export type ValidationSeverity = 'error' | 'warning';

export type ValidationCode =
  | 'MODEL_META_INVALID'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'DUPLICATE_RULE_ID'
  | 'SELECTOR_PARSE_ERROR'
  | 'SELECTOR_TYPE_MISMATCH'
  | 'ACTION_NOT_REGISTERED'
  | 'RELATION_TYPE_UNKNOWN'
  | 'PRIORITY_COLLISION'
  | 'RULE_CONFLICT_UNRESOLVED'
  | 'RULE_UNREACHABLE'
  | 'SOD_VIOLATION'
  | 'CARDINALITY_EXCEEDED'
  | 'HIGH_SENSITIVITY_DOWNGRADED'
  | 'MANDATORY_OBLIGATION_MISSING'
  | 'ATTRIBUTE_SOURCE_UNTRUSTED'
  | 'ATTRIBUTE_STALE'
  | 'LIFECYCLE_HANDLER_MISSING'
  | 'OBJECT_HARD_REQUIRED_MISSING'
  | 'OBJECT_PROFILE_REQUIRED_MISSING'
  | 'OBJECT_CONDITIONAL_REQUIRED_MISSING'
  | 'OBLIGATION_NOT_EXECUTABLE';

export interface ValidationIssue {
  code: ValidationCode;
  layer: ValidationLayer;
  severity: ValidationSeverity;
  message: string;
  path: string;
  blocking: boolean;
}

export interface ModelValidationSummary {
  total_issues: number;
  blocking_issues: number;
  by_layer: Record<ValidationLayer, number>;
}

export interface ModelValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  summary: ModelValidationSummary;
}

export interface ValidatorOptions {
  available_obligation_executors?: string[];
  cardinality_counts?: Record<string, number>;
}
