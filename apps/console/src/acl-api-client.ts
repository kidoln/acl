import type {
  ApiResult,
  ConsoleQuery,
  ControlAuditListResponse,
  ControlCatalogListResponse,
  ControlObjectListResponse,
  ControlRelationListResponse,
  DecisionRecordResponse,
  ModelRouteListResponse,
  PublishRequestListResponse,
  PublishRequestRecord,
  SimulationReportListResponse,
  SimulationReportResponse,
} from './types';

const DEFAULT_TIMEOUT_MS = 5000;

function ensureTrailingSlashRemoved(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

async function safeReadJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export class AclApiClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = ensureTrailingSlashRemoved(baseUrl);
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const data = await safeReadJson(response);

      if (!response.ok) {
        const message =
          typeof data.message === 'string'
            ? data.message
            : `request failed with status ${response.status}`;
        return {
          ok: false,
          status: response.status,
          error: message,
        };
      }

      return {
        ok: true,
        status: response.status,
        data: data as unknown as T,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request failed';
      return {
        ok: false,
        error: message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async get<T>(path: string): Promise<ApiResult<T>> {
    return this.request<T>(path, {
      method: 'GET',
    });
  }

  private async post<T>(path: string, payload: Record<string, unknown>): Promise<ApiResult<T>> {
    return this.request<T>(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  async listPublishRequests(query: ConsoleQuery): Promise<ApiResult<PublishRequestListResponse>> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit));
    params.set('offset', String(query.offset));

    if (query.status) {
      params.set('status', query.status);
    }
    if (query.profile) {
      params.set('profile', query.profile);
    }

    return this.get<PublishRequestListResponse>(`/publish/requests?${params.toString()}`);
  }

  async getPublishRequest(id: string): Promise<ApiResult<PublishRequestRecord>> {
    return this.get<PublishRequestRecord>(`/publish/requests/${encodeURIComponent(id)}`);
  }

  async reviewPublishRequest(payload: {
    publish_id: string;
    decision: 'approve' | 'reject';
    reviewer: string;
    reason: string;
    expires_at?: string;
  }): Promise<ApiResult<PublishRequestRecord>> {
    return this.post<PublishRequestRecord>('/publish/review', payload);
  }

  async activatePublishRequest(payload: {
    publish_id: string;
    operator: string;
  }): Promise<ApiResult<PublishRequestRecord>> {
    return this.post<PublishRequestRecord>('/publish/activate', payload);
  }

  async submitPublishRequest(payload: {
    model: Record<string, unknown>;
    publish_id?: string;
    profile?: 'baseline' | 'strict_compliance';
    submitted_by?: string;
  }): Promise<ApiResult<Record<string, unknown>>> {
    return this.post<Record<string, unknown>>('/publish/submit', payload);
  }

  async getDecision(id: string): Promise<ApiResult<DecisionRecordResponse>> {
    return this.get<DecisionRecordResponse>(`/decisions/${encodeURIComponent(id)}`);
  }

  async listSimulationReports(query: {
    publish_id?: string;
    profile?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResult<SimulationReportListResponse>> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    if (query.publish_id) {
      params.set('publish_id', query.publish_id);
    }
    if (query.profile) {
      params.set('profile', query.profile);
    }
    return this.get<SimulationReportListResponse>(`/publish/simulations?${params.toString()}`);
  }

  async getSimulationReport(id: string): Promise<ApiResult<SimulationReportResponse>> {
    return this.get<SimulationReportResponse>(`/publish/simulations/${encodeURIComponent(id)}`);
  }

  async listControlCatalogs(query: {
    namespace?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResult<ControlCatalogListResponse>> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    if (query.namespace) {
      params.set('namespace', query.namespace);
    }
    return this.get<ControlCatalogListResponse>(`/control/catalogs?${params.toString()}`);
  }

  async listControlObjects(query: {
    namespace: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResult<ControlObjectListResponse>> {
    const params = new URLSearchParams();
    params.set('namespace', query.namespace);
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    return this.get<ControlObjectListResponse>(`/control/objects?${params.toString()}`);
  }

  async listControlRelations(query: {
    namespace: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResult<ControlRelationListResponse>> {
    const params = new URLSearchParams();
    params.set('namespace', query.namespace);
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    return this.get<ControlRelationListResponse>(`/control/relations?${params.toString()}`);
  }

  async listControlAudits(query: {
    namespace?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResult<ControlAuditListResponse>> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    if (query.namespace) {
      params.set('namespace', query.namespace);
    }
    return this.get<ControlAuditListResponse>(`/control/audits?${params.toString()}`);
  }

  async listModelRoutes(query: {
    namespace?: string;
    tenant_id?: string;
    environment?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiResult<ModelRouteListResponse>> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 20));
    params.set('offset', String(query.offset ?? 0));
    if (query.namespace) {
      params.set('namespace', query.namespace);
    }
    if (query.tenant_id) {
      params.set('tenant_id', query.tenant_id);
    }
    if (query.environment) {
      params.set('environment', query.environment);
    }
    return this.get<ModelRouteListResponse>(`/control/model-routes?${params.toString()}`);
  }

  async registerControlCatalog(payload: {
    system_id: string;
    namespace: string;
    catalogs: {
      action_catalog: string[];
      object_type_catalog: string[];
      relation_type_catalog: string[];
    };
  }): Promise<ApiResult<Record<string, unknown>>> {
    return this.post<Record<string, unknown>>('/control/catalogs:register', payload);
  }

  async upsertControlObjects(payload: {
    namespace: string;
    objects: Array<{
      object_id: string;
      object_type: string;
      sensitivity?: string;
      owner_ref?: string;
      labels?: string[];
      updated_at?: string;
    }>;
  }): Promise<ApiResult<Record<string, unknown>>> {
    return this.post<Record<string, unknown>>('/control/objects:upsert', payload);
  }

  async syncControlRelations(payload: {
    namespace: string;
    events: Array<{
      from: string;
      to: string;
      relation_type: string;
      operation?: 'upsert' | 'delete';
      scope?: string;
      source?: string;
      occurred_at?: string;
    }>;
  }): Promise<ApiResult<Record<string, unknown>>> {
    return this.post<Record<string, unknown>>('/control/relations:events', payload);
  }

  async upsertModelRoutes(payload: {
    namespace: string;
    routes: Array<{
      tenant_id: string;
      environment: string;
      model_id: string;
      model_version?: string;
      publish_id?: string;
      operator?: string;
      updated_at?: string;
    }>;
  }): Promise<ApiResult<Record<string, unknown>>> {
    return this.post<Record<string, unknown>>('/control/model-routes:upsert', payload);
  }
}
