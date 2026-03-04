import type { AuthzModelConfig } from '@acl/shared-types';

export type ConstraintViolationCode = 'SOD_VIOLATION' | 'CARDINALITY_EXCEEDED';

export interface ConstraintViolation {
  code: ConstraintViolationCode;
  message: string;
  path: string;
  detail: Record<string, unknown>;
}

export interface ConstraintEvaluationInput {
  model: AuthzModelConfig;
  cardinality_counts?: Record<string, number>;
}

export interface ConstraintEvaluationResult {
  violations: ConstraintViolation[];
  summary: {
    sod_violation_count: number;
    cardinality_exceeded_count: number;
  };
}
