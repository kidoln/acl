export type GateProfile = 'baseline' | 'strict_compliance';

export type PublishWorkflowStatus =
  | 'blocked'
  | 'review_required'
  | 'approved'
  | 'rejected'
  | 'published';

export type ConsoleTab = 'workflow' | 'simulation' | 'relations' | 'control' | 'components';

export type ConsoleWidget =
  | 'publish_list'
  | 'publish_detail'
  | 'decision_detail'
  | 'simulation'
  | 'matrix'
  | 'relation'
  | 'control';

export type DetailMode = 'visual' | 'raw';

export interface PublishRequestRecord {
  publish_id: string;
  profile: GateProfile;
  status: PublishWorkflowStatus;
  final_result: string;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
}

export interface PublishRequestListResponse {
  items: PublishRequestRecord[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
  limit: number;
  offset: number;
}

export interface DecisionRecordResponse {
  decision_id: string;
  created_at: string;
  payload: Record<string, unknown>;
  traces: Array<Record<string, unknown>>;
}

export interface DecisionListResponse {
  items: Array<{
    decision_id: string;
    created_at: string;
  }>;
  total_count: number;
  has_more: boolean;
  next_offset?: number;
  limit: number;
  offset: number;
}

export interface DecisionEvaluateResponse {
  decision_id: string;
  persisted_at: string;
  persistence_driver?: string;
  resolved_model?: Record<string, unknown>;
  resolved_route?: {
    key: string;
    namespace: string;
    tenant_id: string;
    environment: string;
    model_id: string;
    model_version?: string;
    publish_id?: string;
  };
  decision: {
    final_effect: string;
    reason: string;
    matched_rules: string[];
    overridden_rules: string[];
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
    namespace?: string;
    rules?: Array<{
      id: string;
      matched: boolean;
      subject_values?: string[];
      object_values?: string[];
      object_owner_ref?: string;
    }>;
  };
}

export interface SimulationReportResponse {
  report_id: string;
  generated_at: string;
  publish_id: string;
  profile: GateProfile;
  summary: {
    delta_allow_subject_count: number;
    delta_deny_subject_count: number;
    delta_high_sensitivity_object_count: number;
    new_conflict_rule_count: number;
    new_sod_violation_count: number;
    indeterminate_rate_estimation: number;
    mandatory_obligations_pass_rate: number;
    publish_recommendation: string;
  };
  top_impacted_subjects: Array<Record<string, unknown>>;
  top_impacted_objects: Array<Record<string, unknown>>;
  action_change_matrix: Array<Record<string, unknown>>;
  matrix_cells: Array<Record<string, unknown>>;
  scenarios?: Record<string, unknown>;
  risk_details?: Record<string, unknown>;
  gate_result?: Record<string, unknown>;
  baseline_gate_result?: Record<string, unknown>;
}

export interface SimulationReportListResponse {
  items: Array<{
    report_id: string;
    publish_id: string;
    profile: GateProfile;
    generated_at: string;
  }>;
  total_count: number;
  has_more: boolean;
  next_offset?: number;
  limit: number;
  offset: number;
}

export interface ControlObjectListResponse {
  namespace: string;
  items: Array<{
    key: string;
    object_id: string;
    object_type: string;
    sensitivity: string;
    owner_ref: string;
    labels: string[];
    updated_at: string;
  }>;
  total_count: number;
  has_more: boolean;
  next_offset?: number;
  limit: number;
  offset: number;
}

export interface ControlRelationListResponse {
  namespace: string;
  items: Array<{
    key: string;
    from: string;
    to: string;
    relation_type: string;
    scope?: string;
    source?: string;
    updated_at: string;
  }>;
  total_count: number;
  has_more: boolean;
  next_offset?: number;
  limit: number;
  offset: number;
}

export interface ControlAuditListResponse {
  items: Array<{
    audit_id: string;
    event_type: string;
    target: string;
    namespace: string;
    operator: string;
    created_at: string;
  }>;
  total_count: number;
  has_more: boolean;
  next_offset?: number;
  limit: number;
  offset: number;
}

export interface ModelRouteListResponse {
  items: Array<{
    key: string;
    namespace: string;
    tenant_id: string;
    environment: string;
    model_id: string;
    model_version?: string;
    publish_id?: string;
    updated_at: string;
    operator: string;
  }>;
  total_count: number;
  has_more: boolean;
  next_offset?: number;
  limit: number;
  offset: number;
}

export type ApiResult<T> =
  | {
      ok: true;
      data: T;
      status: number;
    }
  | {
      ok: false;
      error: string;
      status?: number;
    };

export interface ConsoleQuery {
  status?: PublishWorkflowStatus;
  profile?: GateProfile;
  tab?: ConsoleTab;
  widget?: ConsoleWidget;
  detail_mode?: DetailMode;
  fixture_id?: string;
  expectation_run_id?: string;
  limit: number;
  offset: number;
  publish_id?: string;
  decision_id?: string;
  simulation_id?: string;
  namespace?: string;
  cell_key?: string;
  flash_type?: 'success' | 'error';
  flash_message?: string;
}

export interface ConsoleActionFlash {
  type: 'success' | 'error';
  message: string;
}

export interface ConsolePageViewModel {
  query: ConsoleQuery;
  publish_list: ApiResult<PublishRequestListResponse>;
  published_publish_list?: ApiResult<PublishRequestListResponse>;
  publish_detail?: ApiResult<PublishRequestRecord>;
  decision_list?: ApiResult<DecisionListResponse>;
  decision_detail?: ApiResult<DecisionRecordResponse>;
  simulation_list?: ApiResult<SimulationReportListResponse>;
  simulation_detail?: ApiResult<SimulationReportResponse>;
  control_objects?: ApiResult<ControlObjectListResponse>;
  control_relations?: ApiResult<ControlRelationListResponse>;
  control_audits?: ApiResult<ControlAuditListResponse>;
  model_routes?: ApiResult<ModelRouteListResponse>;
  expectation_run?: ExpectationRunReport;
  action_flash?: ConsoleActionFlash;
  api_base_url: string;
  generated_at: string;
}

export type ExpectationRunMode = 'inline_model' | 'model_route';

export interface ExpectationRunCaseResult {
  name: string;
  mode: ExpectationRunMode;
  status: 'passed' | 'failed' | 'skipped';
  expected_effect: string;
  actual_effect?: string;
  decision_id?: string;
  reason?: string;
  matched_rules?: string[];
  trace_matched_rules?: string[];
  relation_inference?: {
    enabled?: boolean;
    applied?: boolean;
    reason?: string;
  };
  assertion_errors: string[];
}

export interface ExpectationRunReport {
  run_id: string;
  fixture_id?: string;
  namespace: string;
  tenant_id?: string;
  environment?: string;
  generated_at: string;
  summary: {
    total_count: number;
    passed_count: number;
    failed_count: number;
    skipped_count: number;
  };
  source: {
    expectation_file_name?: string;
    setup_source: 'fixture' | 'uploaded';
    model_source: 'route' | 'uploaded' | 'missing';
  };
  cases: ExpectationRunCaseResult[];
}
