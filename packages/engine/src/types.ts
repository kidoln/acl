import type { AuthzModelConfig, DecisionEffect, DecisionRecord } from '@acl/shared-types';

export interface EngineRelationFact {
  relation: string;
  args?: Record<string, string>;
}

export interface DecisionSubject {
  id: string;
  type?: string;
  state?: string;
  relations?: EngineRelationFact[];
  attributes?: Record<string, unknown>;
}

export interface DecisionObject {
  id: string;
  type?: string;
  sensitivity?: string;
  relations?: EngineRelationFact[];
  attributes?: Record<string, unknown>;
}

export interface DecisionInput {
  action: string;
  subject: DecisionSubject;
  object: DecisionObject;
  context?: Record<string, unknown>;
}

export interface EvaluateDecisionRequest {
  model: AuthzModelConfig;
  input: DecisionInput;
}

export type RuleMatchStatus = 'matched' | 'not_matched' | 'indeterminate';

export interface RuleTrace {
  rule_id: string;
  priority: number;
  effect: DecisionEffect | 'unknown';
  status: RuleMatchStatus;
  reason: string;
}

export interface DecisionEvaluationResult {
  decision: DecisionRecord;
  traces: RuleTrace[];
}
