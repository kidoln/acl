import type { DecisionRecord } from '@acl/shared-types';

export interface PersistedValidationRecord {
  validation_id: string;
  model_id: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface PersistedGateRecord {
  publish_id: string;
  profile: string;
  final_result: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface PersistedDecisionRecord {
  decision_id: string;
  created_at: string;
  payload: DecisionRecord;
  traces: Array<Record<string, unknown>>;
}

export interface DecisionListQuery {
  limit?: number;
  offset?: number;
}

export interface PersistedDecisionListResult {
  items: Array<Pick<PersistedDecisionRecord, 'decision_id' | 'created_at'>>;
  total_count: number;
  has_more: boolean;
  next_offset?: number;
}

export interface PersistedLifecycleReportRecord {
  lifecycle_id: string;
  event_type: string;
  target: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface PersistedPublishRequestRecord {
  publish_id: string;
  profile: string;
  status: string;
  final_result: string;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
}

export interface PublishRequestListQuery {
  status?: string;
  profile?: string;
  limit?: number;
  offset?: number;
}

export interface PersistedPublishRequestListResult {
  items: PersistedPublishRequestRecord[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
}

export interface PersistedControlCatalogRecord {
  key: string;
  system_id: string;
  namespace: string;
  catalogs: {
    action_catalog: string[];
    object_type_catalog: string[];
    relation_type_catalog: string[];
  };
  created_at: string;
  updated_at: string;
}

export interface ControlCatalogListQuery {
  system_id?: string;
  namespace?: string;
  limit?: number;
  offset?: number;
}

export interface PersistedControlCatalogListResult {
  items: PersistedControlCatalogRecord[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
}

export interface PersistedControlObjectRecord {
  key: string;
  namespace: string;
  object_id: string;
  object_type: string;
  sensitivity: string;
  owner_ref: string;
  labels: string[];
  updated_at: string;
}

export interface ControlObjectListQuery {
  namespace: string;
  object_type?: string;
  sensitivity?: string;
  limit?: number;
  offset?: number;
}

export interface PersistedControlObjectListResult {
  items: PersistedControlObjectRecord[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
}

export interface PersistedControlRelationRecord {
  key: string;
  namespace: string;
  from: string;
  to: string;
  relation_type: string;
  scope?: string;
  source?: string;
  updated_at: string;
}

export interface ControlRelationListQuery {
  namespace: string;
  relation_type?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface PersistedControlRelationListResult {
  items: PersistedControlRelationRecord[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
}

export interface PersistedSimulationReportRecord {
  report_id: string;
  publish_id: string;
  profile: string;
  generated_at: string;
  baseline_model_id?: string;
  draft_model_id?: string;
  payload: Record<string, unknown>;
}

export interface SimulationReportListQuery {
  publish_id?: string;
  profile?: string;
  limit?: number;
  offset?: number;
}

export interface PersistedSimulationReportListResult {
  items: PersistedSimulationReportRecord[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
}

export interface PersistedControlAuditRecord {
  audit_id: string;
  event_type: string;
  target: string;
  namespace: string;
  operator: string;
  created_at: string;
  payload: Record<string, unknown>;
}

export interface ControlAuditListQuery {
  namespace?: string;
  event_type?: string;
  limit?: number;
  offset?: number;
}

export interface PersistedControlAuditListResult {
  items: PersistedControlAuditRecord[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
}

export interface PersistedModelRouteRecord {
  key: string;
  namespace: string;
  tenant_id: string;
  environment: string;
  model_id: string;
  model_version?: string;
  publish_id?: string;
  updated_at: string;
  operator: string;
}

export interface ModelRouteListQuery {
  namespace?: string;
  tenant_id?: string;
  environment?: string;
  limit?: number;
  offset?: number;
}

export interface PersistedModelRouteListResult {
  items: PersistedModelRouteRecord[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
}

export interface AclPersistence {
  saveValidation(record: PersistedValidationRecord): Promise<void>;
  getValidation(validationId: string): Promise<PersistedValidationRecord | null>;

  saveGateReport(record: PersistedGateRecord): Promise<void>;
  getGateReport(publishId: string): Promise<PersistedGateRecord | null>;

  saveDecision(record: PersistedDecisionRecord): Promise<void>;
  getDecision(decisionId: string): Promise<PersistedDecisionRecord | null>;
  listDecisions(query?: DecisionListQuery): Promise<PersistedDecisionListResult>;

  saveLifecycleReport(record: PersistedLifecycleReportRecord): Promise<void>;
  getLifecycleReport(lifecycleId: string): Promise<PersistedLifecycleReportRecord | null>;

  savePublishRequest(record: PersistedPublishRequestRecord): Promise<void>;
  getPublishRequest(publishId: string): Promise<PersistedPublishRequestRecord | null>;
  listPublishRequests(
    query?: PublishRequestListQuery,
  ): Promise<PersistedPublishRequestListResult>;

  upsertControlCatalog(record: PersistedControlCatalogRecord): Promise<void>;
  getControlCatalog(key: string): Promise<PersistedControlCatalogRecord | null>;
  listControlCatalogs(query?: ControlCatalogListQuery): Promise<PersistedControlCatalogListResult>;

  upsertControlObject(record: PersistedControlObjectRecord): Promise<void>;
  deleteControlObject(namespace: string, objectId: string): Promise<boolean>;
  getControlObject(
    namespace: string,
    objectId: string,
  ): Promise<PersistedControlObjectRecord | null>;
  listControlObjects(query: ControlObjectListQuery): Promise<PersistedControlObjectListResult>;

  upsertControlRelation(record: PersistedControlRelationRecord): Promise<void>;
  deleteControlRelation(namespace: string, relationKey: string): Promise<boolean>;
  listControlRelations(query: ControlRelationListQuery): Promise<PersistedControlRelationListResult>;

  saveSimulationReport(record: PersistedSimulationReportRecord): Promise<void>;
  getSimulationReport(reportId: string): Promise<PersistedSimulationReportRecord | null>;
  listSimulationReports(query?: SimulationReportListQuery): Promise<PersistedSimulationReportListResult>;

  saveControlAudit(record: PersistedControlAuditRecord): Promise<void>;
  listControlAudits(query?: ControlAuditListQuery): Promise<PersistedControlAuditListResult>;

  upsertModelRoute(record: PersistedModelRouteRecord): Promise<void>;
  getModelRoute(key: string): Promise<PersistedModelRouteRecord | null>;
  listModelRoutes(query?: ModelRouteListQuery): Promise<PersistedModelRouteListResult>;
}
