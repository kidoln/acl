import type {
  AclPersistence,
  ControlPlaneResetResult,
  ControlAuditListQuery,
  ControlCatalogListQuery,
  ControlObjectListQuery,
  ControlRelationListQuery,
  DecisionListQuery,
  ModelRouteListQuery,
  PersistedControlAuditListResult,
  PersistedControlAuditRecord,
  PersistedControlCatalogListResult,
  PersistedControlCatalogRecord,
  PersistedControlNamespaceListResult,
  PersistedDecisionListResult,
  PersistedControlObjectListResult,
  PersistedControlObjectRecord,
  PersistedControlRelationListResult,
  PersistedControlRelationRecord,
  PersistedDecisionRecord,
  PersistedGateRecord,
  PersistedLifecycleReportRecord,
  PersistedModelRouteListResult,
  PersistedModelRouteRecord,
  PersistedPublishRequestListResult,
  PersistedPublishRequestRecord,
  PersistedSimulationReportListResult,
  PersistedSimulationReportRecord,
  PersistedValidationRecord,
  PublishRequestListQuery,
  SimulationReportListQuery,
} from './types';

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIST_LIMIT;
  }
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIST_LIMIT), 1), MAX_LIST_LIMIT);
}

function normalizeOffset(offset: number | undefined): number {
  if (!Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(Math.trunc(offset ?? 0), 0);
}

function buildPagedResult<T extends object>(
  list: T[],
  limit: number,
  offset: number,
): {
  items: T[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
} {
  const items = list.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < list.length;

  return {
    items,
    total_count: list.length,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : undefined,
  };
}

export class InMemoryPersistence implements AclPersistence {
  private readonly validations = new Map<string, PersistedValidationRecord>();

  private readonly gateReports = new Map<string, PersistedGateRecord>();

  private readonly decisions = new Map<string, PersistedDecisionRecord>();

  private readonly lifecycleReports = new Map<string, PersistedLifecycleReportRecord>();

  private readonly publishRequests = new Map<string, PersistedPublishRequestRecord>();

  private readonly controlCatalogs = new Map<string, PersistedControlCatalogRecord>();

  private readonly controlObjects = new Map<string, PersistedControlObjectRecord>();

  private readonly controlRelations = new Map<string, PersistedControlRelationRecord>();

  private readonly simulationReports = new Map<string, PersistedSimulationReportRecord>();

  private readonly controlAudits = new Map<string, PersistedControlAuditRecord>();

  private readonly modelRoutes = new Map<string, PersistedModelRouteRecord>();

  async saveValidation(record: PersistedValidationRecord): Promise<void> {
    this.validations.set(record.validation_id, record);
  }

  async getValidation(validationId: string): Promise<PersistedValidationRecord | null> {
    return this.validations.get(validationId) ?? null;
  }

  async saveGateReport(record: PersistedGateRecord): Promise<void> {
    this.gateReports.set(record.publish_id, record);
  }

  async getGateReport(publishId: string): Promise<PersistedGateRecord | null> {
    return this.gateReports.get(publishId) ?? null;
  }

  async saveDecision(record: PersistedDecisionRecord): Promise<void> {
    this.decisions.set(record.decision_id, record);
  }

  async getDecision(decisionId: string): Promise<PersistedDecisionRecord | null> {
    return this.decisions.get(decisionId) ?? null;
  }

  async listDecisions(query?: DecisionListQuery): Promise<PersistedDecisionListResult> {
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const filtered = Array.from(this.decisions.values())
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((record) => ({
        decision_id: record.decision_id,
        created_at: record.created_at,
      }));

    return buildPagedResult(filtered, limit, offset);
  }

  async saveLifecycleReport(record: PersistedLifecycleReportRecord): Promise<void> {
    this.lifecycleReports.set(record.lifecycle_id, record);
  }

  async getLifecycleReport(lifecycleId: string): Promise<PersistedLifecycleReportRecord | null> {
    return this.lifecycleReports.get(lifecycleId) ?? null;
  }

  async savePublishRequest(record: PersistedPublishRequestRecord): Promise<void> {
    this.publishRequests.set(record.publish_id, record);
  }

  async getPublishRequest(publishId: string): Promise<PersistedPublishRequestRecord | null> {
    return this.publishRequests.get(publishId) ?? null;
  }

  async listPublishRequests(
    query?: PublishRequestListQuery,
  ): Promise<PersistedPublishRequestListResult> {
    const status = query?.status?.trim();
    const profile = query?.profile?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const filtered = Array.from(this.publishRequests.values())
      .filter((record) => {
        if (status && record.status !== status) {
          return false;
        }
        if (profile && record.profile !== profile) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

    return buildPagedResult(filtered, limit, offset);
  }

  async upsertControlCatalog(record: PersistedControlCatalogRecord): Promise<void> {
    this.controlCatalogs.set(record.key, record);
  }

  async getControlCatalog(key: string): Promise<PersistedControlCatalogRecord | null> {
    return this.controlCatalogs.get(key) ?? null;
  }

  async listControlCatalogs(query?: ControlCatalogListQuery): Promise<PersistedControlCatalogListResult> {
    const systemId = query?.system_id?.trim();
    const namespace = query?.namespace?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const filtered = Array.from(this.controlCatalogs.values())
      .filter((record) => {
        if (systemId && record.system_id !== systemId) {
          return false;
        }
        if (namespace && record.namespace !== namespace) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

    return buildPagedResult(filtered, limit, offset);
  }

  async upsertControlObject(record: PersistedControlObjectRecord): Promise<void> {
    this.controlObjects.set(record.key, record);
  }

  async deleteControlObject(namespace: string, objectId: string): Promise<boolean> {
    return this.controlObjects.delete(`${namespace}::${objectId}`);
  }

  async getControlObject(
    namespace: string,
    objectId: string,
  ): Promise<PersistedControlObjectRecord | null> {
    return this.controlObjects.get(`${namespace}::${objectId}`) ?? null;
  }

  async listControlObjects(query: ControlObjectListQuery): Promise<PersistedControlObjectListResult> {
    const objectType = query.object_type?.trim();
    const sensitivity = query.sensitivity?.trim();
    const limit = normalizeLimit(query.limit);
    const offset = normalizeOffset(query.offset);

    const filtered = Array.from(this.controlObjects.values())
      .filter((record) => {
        if (record.namespace !== query.namespace) {
          return false;
        }
        if (objectType && record.object_type !== objectType) {
          return false;
        }
        if (sensitivity && record.sensitivity !== sensitivity) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

    return buildPagedResult(filtered, limit, offset);
  }

  async upsertControlRelation(record: PersistedControlRelationRecord): Promise<void> {
    this.controlRelations.set(record.key, record);
  }

  async deleteControlRelation(namespace: string, relationKey: string): Promise<boolean> {
    return this.controlRelations.delete(`${namespace}::${relationKey}`);
  }

  async listControlRelations(query: ControlRelationListQuery): Promise<PersistedControlRelationListResult> {
    const relationType = query.relation_type?.trim();
    const from = query.from?.trim();
    const to = query.to?.trim();
    const limit = normalizeLimit(query.limit);
    const offset = normalizeOffset(query.offset);

    const filtered = Array.from(this.controlRelations.values())
      .filter((record) => {
        if (record.namespace !== query.namespace) {
          return false;
        }
        if (relationType && record.relation_type !== relationType) {
          return false;
        }
        if (from && record.from !== from) {
          return false;
        }
        if (to && record.to !== to) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

    return buildPagedResult(filtered, limit, offset);
  }

  async saveSimulationReport(record: PersistedSimulationReportRecord): Promise<void> {
    this.simulationReports.set(record.report_id, record);
  }

  async getSimulationReport(reportId: string): Promise<PersistedSimulationReportRecord | null> {
    return this.simulationReports.get(reportId) ?? null;
  }

  async listSimulationReports(
    query?: SimulationReportListQuery,
  ): Promise<PersistedSimulationReportListResult> {
    const publishId = query?.publish_id?.trim();
    const profile = query?.profile?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const filtered = Array.from(this.simulationReports.values())
      .filter((record) => {
        if (publishId && record.publish_id !== publishId) {
          return false;
        }
        if (profile && record.profile !== profile) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.generated_at.localeCompare(left.generated_at));

    return buildPagedResult(filtered, limit, offset);
  }

  async saveControlAudit(record: PersistedControlAuditRecord): Promise<void> {
    this.controlAudits.set(record.audit_id, record);
  }

  async listControlAudits(query?: ControlAuditListQuery): Promise<PersistedControlAuditListResult> {
    const namespace = query?.namespace?.trim();
    const eventType = query?.event_type?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const filtered = Array.from(this.controlAudits.values())
      .filter((record) => {
        if (namespace && record.namespace !== namespace) {
          return false;
        }
        if (eventType && record.event_type !== eventType) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.created_at.localeCompare(left.created_at));

    return buildPagedResult(filtered, limit, offset);
  }

  async upsertModelRoute(record: PersistedModelRouteRecord): Promise<void> {
    this.modelRoutes.set(record.key, record);
  }

  async getModelRoute(key: string): Promise<PersistedModelRouteRecord | null> {
    return this.modelRoutes.get(key) ?? null;
  }

  async listModelRoutes(query?: ModelRouteListQuery): Promise<PersistedModelRouteListResult> {
    const namespace = query?.namespace?.trim();
    const tenantId = query?.tenant_id?.trim();
    const environment = query?.environment?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const filtered = Array.from(this.modelRoutes.values())
      .filter((record) => {
        if (namespace && record.namespace !== namespace) {
          return false;
        }
        if (tenantId && record.tenant_id !== tenantId) {
          return false;
        }
        if (environment && record.environment !== environment) {
          return false;
        }
        return true;
      })
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

    return buildPagedResult(filtered, limit, offset);
  }

  async listControlNamespaces(): Promise<PersistedControlNamespaceListResult> {
    const namespaces = new Set<string>();

    this.controlObjects.forEach((record) => {
      if (record.namespace) {
        namespaces.add(record.namespace);
      }
    });
    this.controlRelations.forEach((record) => {
      if (record.namespace) {
        namespaces.add(record.namespace);
      }
    });
    this.modelRoutes.forEach((record) => {
      if (record.namespace) {
        namespaces.add(record.namespace);
      }
    });

    const items = Array.from(namespaces).sort((left, right) =>
      left.localeCompare(right),
    );

    return {
      items,
      total_count: items.length,
    };
  }

  async resetControlPlane(): Promise<ControlPlaneResetResult> {
    const result: ControlPlaneResetResult = {
      control_object_count: this.controlObjects.size,
      control_relation_count: this.controlRelations.size,
      model_route_count: this.modelRoutes.size,
      publish_request_count: this.publishRequests.size,
      gate_report_count: this.gateReports.size,
      simulation_report_count: this.simulationReports.size,
      control_audit_count: this.controlAudits.size,
    };

    this.controlObjects.clear();
    this.controlRelations.clear();
    this.modelRoutes.clear();
    this.publishRequests.clear();
    this.gateReports.clear();
    this.simulationReports.clear();
    this.controlAudits.clear();

    return result;
  }
}
