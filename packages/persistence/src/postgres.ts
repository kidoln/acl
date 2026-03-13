import { Pool } from 'pg';

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
  PersistedControlObjectListResult,
  PersistedControlObjectRecord,
  PersistedControlRelationListResult,
  PersistedControlRelationRecord,
  PersistedDecisionListResult,
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

interface PgPersistenceOptions {
  connectionString: string;
}

interface PgRow {
  id: string;
  model_id?: string;
  profile?: string;
  final_result?: string;
  status?: string;
  event_type?: string;
  target?: string;
  namespace?: string | null;
  created_at: Date | string;
  updated_at?: Date | string;
  payload: string | object;
  traces?: string | object;
  total_count?: string | number;
}

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

const CONTROL_CATALOG_ID_PREFIX = 'control_catalog::';
const CONTROL_CATALOG_MODEL_PREFIX = 'control.catalog::';
const CONTROL_OBJECT_ID_PREFIX = 'control_object::';
const CONTROL_OBJECT_MODEL_PREFIX = 'control.object::';
const CONTROL_RELATION_ID_PREFIX = 'control_relation::';
const CONTROL_RELATION_MODEL_PREFIX = 'control.relation::';
const SIMULATION_MODEL_PREFIX = 'simulation.report::';
const CONTROL_AUDIT_EVENT_PREFIX = 'control.';
const MODEL_ROUTE_ID_PREFIX = 'model_route::';
const MODEL_ROUTE_MODEL_PREFIX = 'model.route::';

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

function parseJson(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    return JSON.parse(input) as Record<string, unknown>;
  }
  if (typeof input === 'object' && input !== null) {
    return input as Record<string, unknown>;
  }
  return {};
}

function asStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((item): item is string => typeof item === 'string');
}

function toPublishRequestRecord(row: PgRow): PersistedPublishRequestRecord {
  return {
    publish_id: row.id,
    profile: row.profile ?? 'baseline',
    status: row.status ?? 'submitted',
    final_result: row.final_result ?? 'passed',
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at ?? row.created_at).toISOString(),
    payload: parseJson(row.payload),
  };
}

function withPrefix(prefix: string, value: string): string {
  return `${prefix}${value}`;
}

function stripPrefix(prefix: string, value: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function toPagedResult<T extends object>(
  items: T[],
  totalCount: number,
  offset: number,
): {
  items: T[];
  total_count: number;
  has_more: boolean;
  next_offset?: number;
} {
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < totalCount;
  return {
    items,
    total_count: totalCount,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : undefined,
  };
}

export class PostgresPersistence implements AclPersistence {
  private readonly pool: Pool;

  constructor(options: PgPersistenceOptions) {
    this.pool = new Pool({ connectionString: options.connectionString });
  }

  async saveValidation(record: PersistedValidationRecord): Promise<void> {
    await this.pool.query(
      `insert into acl_validation_records (id, model_id, created_at, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set model_id = excluded.model_id, created_at = excluded.created_at, payload = excluded.payload`,
      [record.validation_id, record.model_id, record.created_at, JSON.stringify(record.payload)],
    );
  }

  async getValidation(validationId: string): Promise<PersistedValidationRecord | null> {
    const result = await this.pool.query<PgRow>(
      `select id, model_id, created_at, payload
       from acl_validation_records
       where id = $1`,
      [validationId],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    return {
      validation_id: row.id,
      model_id: row.model_id ?? '',
      created_at: new Date(row.created_at).toISOString(),
      payload: parseJson(row.payload),
    };
  }

  async saveGateReport(record: PersistedGateRecord): Promise<void> {
    await this.pool.query(
      `insert into acl_gate_reports (id, profile, final_result, created_at, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (id) do update set profile = excluded.profile, final_result = excluded.final_result, created_at = excluded.created_at, payload = excluded.payload`,
      [record.publish_id, record.profile, record.final_result, record.created_at, JSON.stringify(record.payload)],
    );
  }

  async getGateReport(publishId: string): Promise<PersistedGateRecord | null> {
    const result = await this.pool.query<PgRow>(
      `select id, profile, final_result, created_at, payload
       from acl_gate_reports
       where id = $1`,
      [publishId],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    return {
      publish_id: row.id,
      profile: row.profile ?? 'baseline',
      final_result: row.final_result ?? 'passed',
      created_at: new Date(row.created_at).toISOString(),
      payload: parseJson(row.payload),
    };
  }

  async saveDecision(record: PersistedDecisionRecord): Promise<void> {
    await this.pool.query(
      `insert into acl_decision_records (id, created_at, payload, traces)
       values ($1, $2, $3::jsonb, $4::jsonb)
       on conflict (id) do update set created_at = excluded.created_at, payload = excluded.payload, traces = excluded.traces`,
      [
        record.decision_id,
        record.created_at,
        JSON.stringify(record.payload),
        JSON.stringify(record.traces),
      ],
    );
  }

  async getDecision(decisionId: string): Promise<PersistedDecisionRecord | null> {
    const result = await this.pool.query<PgRow>(
      `select id, created_at, payload, traces
       from acl_decision_records
       where id = $1`,
      [decisionId],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    const traces = parseJson(row.traces);
    const payload = parseJson(row.payload);

    return {
      decision_id: row.id,
      created_at: new Date(row.created_at).toISOString(),
      payload: payload as unknown as PersistedDecisionRecord['payload'],
      traces: Array.isArray(traces) ? traces : [],
    };
  }

  async listDecisions(query?: DecisionListQuery): Promise<PersistedDecisionListResult> {
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const [listResult, countResult] = await Promise.all([
      this.pool.query<PgRow>(
        `select id, created_at
         from acl_decision_records
         order by created_at desc, id desc
         limit $1
         offset $2`,
        [limit, offset],
      ),
      this.pool.query<PgRow>(
        `select count(1)::int as total_count
         from acl_decision_records`,
      ),
    ]);

    const items = listResult.rows.map((row) => ({
      decision_id: row.id,
      created_at: new Date(row.created_at).toISOString(),
    }));
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);

    return toPagedResult(items, totalCount, offset);
  }

  async saveLifecycleReport(record: PersistedLifecycleReportRecord): Promise<void> {
    await this.pool.query(
      `insert into acl_lifecycle_reports (id, event_type, target, created_at, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (id) do update set event_type = excluded.event_type, target = excluded.target, created_at = excluded.created_at, payload = excluded.payload`,
      [
        record.lifecycle_id,
        record.event_type,
        record.target,
        record.created_at,
        JSON.stringify(record.payload),
      ],
    );
  }

  async getLifecycleReport(lifecycleId: string): Promise<PersistedLifecycleReportRecord | null> {
    const result = await this.pool.query<PgRow>(
      `select id, event_type, target, created_at, payload
       from acl_lifecycle_reports
       where id = $1`,
      [lifecycleId],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    return {
      lifecycle_id: row.id,
      event_type: row.event_type ?? 'subject_removed',
      target: row.target ?? '',
      created_at: new Date(row.created_at).toISOString(),
      payload: parseJson(row.payload),
    };
  }

  async savePublishRequest(record: PersistedPublishRequestRecord): Promise<void> {
    await this.pool.query(
      `insert into acl_publish_requests (id, profile, status, final_result, created_at, updated_at, payload)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb)
       on conflict (id) do update set profile = excluded.profile, status = excluded.status, final_result = excluded.final_result, created_at = excluded.created_at, updated_at = excluded.updated_at, payload = excluded.payload`,
      [
        record.publish_id,
        record.profile,
        record.status,
        record.final_result,
        record.created_at,
        record.updated_at,
        JSON.stringify(record.payload),
      ],
    );
  }

  async getPublishRequest(publishId: string): Promise<PersistedPublishRequestRecord | null> {
    const result = await this.pool.query<PgRow>(
      `select id, profile, status, final_result, created_at, updated_at, payload
       from acl_publish_requests
       where id = $1`,
      [publishId],
    );

    if (!result.rowCount) {
      return null;
    }

    return toPublishRequestRecord(result.rows[0]);
  }

  async listPublishRequests(
    query?: PublishRequestListQuery,
  ): Promise<PersistedPublishRequestListResult> {
    const status = query?.status?.trim();
    const profile = query?.profile?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const conditions: string[] = [];
    const whereParams: unknown[] = [];

    if (status) {
      conditions.push(`status = $${whereParams.length + 1}`);
      whereParams.push(status);
    }
    if (profile) {
      conditions.push(`profile = $${whereParams.length + 1}`);
      whereParams.push(profile);
    }

    const whereClause = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
    const listParams = [...whereParams, limit, offset];
    const limitIdx = whereParams.length + 1;
    const offsetIdx = whereParams.length + 2;

    const [listResult, countResult] = await Promise.all([
      this.pool.query<PgRow>(
        `select id, profile, status, final_result, created_at, updated_at, payload
         from acl_publish_requests
         ${whereClause}
         order by updated_at desc, id desc
         limit $${limitIdx}
         offset $${offsetIdx}`,
        listParams,
      ),
      this.pool.query<PgRow>(
        `select count(1)::int as total_count
         from acl_publish_requests
         ${whereClause}`,
        whereParams,
      ),
    ]);

    const items = listResult.rows.map(toPublishRequestRecord);
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    return toPagedResult(items, totalCount, offset);
  }

  async upsertControlCatalog(record: PersistedControlCatalogRecord): Promise<void> {
    const id = withPrefix(CONTROL_CATALOG_ID_PREFIX, record.key);
    const modelId = withPrefix(CONTROL_CATALOG_MODEL_PREFIX, record.namespace);

    await this.pool.query(
      `insert into acl_validation_records (id, model_id, created_at, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set model_id = excluded.model_id, created_at = excluded.created_at, payload = excluded.payload`,
      [id, modelId, record.created_at, JSON.stringify(record)],
    );
  }

  async getControlCatalog(key: string): Promise<PersistedControlCatalogRecord | null> {
    const id = withPrefix(CONTROL_CATALOG_ID_PREFIX, key);
    const result = await this.pool.query<PgRow>(
      `select id, created_at, payload
       from acl_validation_records
       where id = $1`,
      [id],
    );

    if (!result.rowCount) {
      return null;
    }

    const payload = parseJson(result.rows[0]?.payload);
    return {
      key: typeof payload.key === 'string' ? payload.key : key,
      system_id: typeof payload.system_id === 'string' ? payload.system_id : '',
      namespace: typeof payload.namespace === 'string' ? payload.namespace : '',
      catalogs: {
        action_catalog: asStringArray(payload.catalogs && (payload.catalogs as Record<string, unknown>).action_catalog),
        object_type_catalog: asStringArray(
          payload.catalogs && (payload.catalogs as Record<string, unknown>).object_type_catalog,
        ),
        relation_type_catalog: asStringArray(
          payload.catalogs && (payload.catalogs as Record<string, unknown>).relation_type_catalog,
        ),
      },
      created_at:
        typeof payload.created_at === 'string'
          ? payload.created_at
          : new Date(result.rows[0]?.created_at).toISOString(),
      updated_at:
        typeof payload.updated_at === 'string'
          ? payload.updated_at
          : new Date(result.rows[0]?.created_at).toISOString(),
    };
  }

  async listControlCatalogs(query?: ControlCatalogListQuery): Promise<PersistedControlCatalogListResult> {
    const systemId = query?.system_id?.trim();
    const namespace = query?.namespace?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const conditions: string[] = ['id like $1'];
    const listParams: unknown[] = [`${CONTROL_CATALOG_ID_PREFIX}%`];
    const countParams: unknown[] = [`${CONTROL_CATALOG_ID_PREFIX}%`];

    if (systemId) {
      conditions.push(`payload ->> 'system_id' = $${listParams.length + 1}`);
      listParams.push(systemId);
      countParams.push(systemId);
    }
    if (namespace) {
      conditions.push(`payload ->> 'namespace' = $${listParams.length + 1}`);
      listParams.push(namespace);
      countParams.push(namespace);
    }

    listParams.push(limit, offset);
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;
    const whereClause = `where ${conditions.join(' and ')}`;

    const [listResult, countResult] = await Promise.all([
      this.pool.query<PgRow>(
        `select id, created_at, payload
         from acl_validation_records
         ${whereClause}
         order by coalesce(payload ->> 'updated_at', created_at::text) desc, id desc
         limit $${limitIdx}
         offset $${offsetIdx}`,
        listParams,
      ),
      this.pool.query<PgRow>(
        `select count(1)::int as total_count
         from acl_validation_records
         ${whereClause}`,
        countParams,
      ),
    ]);

    const items = listResult.rows.map((row) => {
      const payload = parseJson(row.payload);
      const catalogs = payload.catalogs as Record<string, unknown> | undefined;
      return {
        key:
          typeof payload.key === 'string'
            ? payload.key
            : stripPrefix(CONTROL_CATALOG_ID_PREFIX, row.id),
        system_id: typeof payload.system_id === 'string' ? payload.system_id : '',
        namespace: typeof payload.namespace === 'string' ? payload.namespace : '',
        catalogs: {
          action_catalog: asStringArray(catalogs?.action_catalog),
          object_type_catalog: asStringArray(catalogs?.object_type_catalog),
          relation_type_catalog: asStringArray(catalogs?.relation_type_catalog),
        },
        created_at:
          typeof payload.created_at === 'string'
            ? payload.created_at
            : new Date(row.created_at).toISOString(),
        updated_at:
          typeof payload.updated_at === 'string'
            ? payload.updated_at
            : new Date(row.created_at).toISOString(),
      };
    });
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    return toPagedResult(items, totalCount, offset);
  }

  async upsertControlObject(record: PersistedControlObjectRecord): Promise<void> {
    const id = withPrefix(CONTROL_OBJECT_ID_PREFIX, record.key);
    const modelId = withPrefix(CONTROL_OBJECT_MODEL_PREFIX, record.namespace);
    await this.pool.query(
      `insert into acl_validation_records (id, model_id, created_at, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set model_id = excluded.model_id, created_at = excluded.created_at, payload = excluded.payload`,
      [id, modelId, record.updated_at, JSON.stringify(record)],
    );
  }

  async deleteControlObject(namespace: string, objectId: string): Promise<boolean> {
    const key = `${namespace}::${objectId}`;
    const id = withPrefix(CONTROL_OBJECT_ID_PREFIX, key);
    const result = await this.pool.query(
      `delete from acl_validation_records where id = $1`,
      [id],
    );
    return Number(result.rowCount ?? 0) > 0;
  }

  async getControlObject(
    namespace: string,
    objectId: string,
  ): Promise<PersistedControlObjectRecord | null> {
    const key = `${namespace}::${objectId}`;
    const id = withPrefix(CONTROL_OBJECT_ID_PREFIX, key);
    const result = await this.pool.query<PgRow>(
      `select id, created_at, payload
       from acl_validation_records
       where id = $1`,
      [id],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    const payload = parseJson(row.payload);
    return {
      key: typeof payload.key === 'string' ? payload.key : key,
      namespace: typeof payload.namespace === 'string' ? payload.namespace : namespace,
      object_id: typeof payload.object_id === 'string' ? payload.object_id : objectId,
      object_type: typeof payload.object_type === 'string' ? payload.object_type : '',
      sensitivity: typeof payload.sensitivity === 'string' ? payload.sensitivity : 'normal',
      owner_ref: typeof payload.owner_ref === 'string' ? payload.owner_ref : 'unknown',
      labels: asStringArray(payload.labels),
      updated_at:
        typeof payload.updated_at === 'string'
          ? payload.updated_at
          : new Date(row.created_at).toISOString(),
    };
  }

  async listControlObjects(query: ControlObjectListQuery): Promise<PersistedControlObjectListResult> {
    const objectType = query.object_type?.trim();
    const sensitivity = query.sensitivity?.trim();
    const limit = normalizeLimit(query.limit);
    const offset = normalizeOffset(query.offset);

    const modelId = withPrefix(CONTROL_OBJECT_MODEL_PREFIX, query.namespace);
    const conditions: string[] = ['model_id = $1'];
    const listParams: unknown[] = [modelId];
    const countParams: unknown[] = [modelId];

    if (objectType) {
      conditions.push(`payload ->> 'object_type' = $${listParams.length + 1}`);
      listParams.push(objectType);
      countParams.push(objectType);
    }
    if (sensitivity) {
      conditions.push(`payload ->> 'sensitivity' = $${listParams.length + 1}`);
      listParams.push(sensitivity);
      countParams.push(sensitivity);
    }

    listParams.push(limit, offset);
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;
    const whereClause = `where ${conditions.join(' and ')}`;

    const [listResult, countResult] = await Promise.all([
      this.pool.query<PgRow>(
        `select id, created_at, payload
         from acl_validation_records
         ${whereClause}
         order by coalesce(payload ->> 'updated_at', created_at::text) desc, id desc
         limit $${limitIdx}
         offset $${offsetIdx}`,
        listParams,
      ),
      this.pool.query<PgRow>(
        `select count(1)::int as total_count
         from acl_validation_records
         ${whereClause}`,
        countParams,
      ),
    ]);

    const items = listResult.rows.map((row) => {
      const payload = parseJson(row.payload);
      return {
        key:
          typeof payload.key === 'string'
            ? payload.key
            : stripPrefix(CONTROL_OBJECT_ID_PREFIX, row.id),
        namespace: typeof payload.namespace === 'string' ? payload.namespace : query.namespace,
        object_id: typeof payload.object_id === 'string' ? payload.object_id : '',
        object_type: typeof payload.object_type === 'string' ? payload.object_type : '',
        sensitivity: typeof payload.sensitivity === 'string' ? payload.sensitivity : 'normal',
        owner_ref: typeof payload.owner_ref === 'string' ? payload.owner_ref : 'unknown',
        labels: asStringArray(payload.labels),
        updated_at:
          typeof payload.updated_at === 'string'
            ? payload.updated_at
            : new Date(row.created_at).toISOString(),
      };
    });
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    return toPagedResult(items, totalCount, offset);
  }

  async upsertControlRelation(record: PersistedControlRelationRecord): Promise<void> {
    const id = withPrefix(CONTROL_RELATION_ID_PREFIX, record.key);
    const modelId = withPrefix(CONTROL_RELATION_MODEL_PREFIX, record.namespace);
    await this.pool.query(
      `insert into acl_validation_records (id, model_id, created_at, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set model_id = excluded.model_id, created_at = excluded.created_at, payload = excluded.payload`,
      [id, modelId, record.updated_at, JSON.stringify(record)],
    );
  }

  async deleteControlRelation(namespace: string, relationKey: string): Promise<boolean> {
    const key = `${namespace}::${relationKey}`;
    const id = withPrefix(CONTROL_RELATION_ID_PREFIX, key);
    const result = await this.pool.query(
      `delete from acl_validation_records
       where id = $1`,
      [id],
    );
    return Number(result.rowCount ?? 0) > 0;
  }

  async listControlRelations(query: ControlRelationListQuery): Promise<PersistedControlRelationListResult> {
    const relationType = query.relation_type?.trim();
    const from = query.from?.trim();
    const to = query.to?.trim();
    const limit = normalizeLimit(query.limit);
    const offset = normalizeOffset(query.offset);

    const modelId = withPrefix(CONTROL_RELATION_MODEL_PREFIX, query.namespace);
    const conditions: string[] = ['model_id = $1'];
    const listParams: unknown[] = [modelId];
    const countParams: unknown[] = [modelId];

    if (relationType) {
      conditions.push(`payload ->> 'relation_type' = $${listParams.length + 1}`);
      listParams.push(relationType);
      countParams.push(relationType);
    }
    if (from) {
      conditions.push(`payload ->> 'from' = $${listParams.length + 1}`);
      listParams.push(from);
      countParams.push(from);
    }
    if (to) {
      conditions.push(`payload ->> 'to' = $${listParams.length + 1}`);
      listParams.push(to);
      countParams.push(to);
    }

    listParams.push(limit, offset);
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;
    const whereClause = `where ${conditions.join(' and ')}`;

    const [listResult, countResult] = await Promise.all([
      this.pool.query<PgRow>(
        `select id, created_at, payload
         from acl_validation_records
         ${whereClause}
         order by coalesce(payload ->> 'updated_at', created_at::text) desc, id desc
         limit $${limitIdx}
         offset $${offsetIdx}`,
        listParams,
      ),
      this.pool.query<PgRow>(
        `select count(1)::int as total_count
         from acl_validation_records
         ${whereClause}`,
        countParams,
      ),
    ]);

    const items = listResult.rows.map((row) => {
      const payload = parseJson(row.payload);
      return {
        key:
          typeof payload.key === 'string'
            ? payload.key
            : stripPrefix(CONTROL_RELATION_ID_PREFIX, row.id),
        namespace: typeof payload.namespace === 'string' ? payload.namespace : query.namespace,
        from: typeof payload.from === 'string' ? payload.from : '',
        to: typeof payload.to === 'string' ? payload.to : '',
        relation_type: typeof payload.relation_type === 'string' ? payload.relation_type : '',
        scope: typeof payload.scope === 'string' ? payload.scope : undefined,
        source: typeof payload.source === 'string' ? payload.source : undefined,
        updated_at:
          typeof payload.updated_at === 'string'
            ? payload.updated_at
            : new Date(row.created_at).toISOString(),
      };
    });
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    return toPagedResult(items, totalCount, offset);
  }

  async saveSimulationReport(record: PersistedSimulationReportRecord): Promise<void> {
    const modelId = withPrefix(SIMULATION_MODEL_PREFIX, record.publish_id);
    await this.pool.query(
      `insert into acl_validation_records (id, model_id, created_at, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set model_id = excluded.model_id, created_at = excluded.created_at, payload = excluded.payload`,
      [record.report_id, modelId, record.generated_at, JSON.stringify(record)],
    );
  }

  async getSimulationReport(reportId: string): Promise<PersistedSimulationReportRecord | null> {
    const result = await this.pool.query<PgRow>(
      `select id, model_id, created_at, payload
       from acl_validation_records
       where id = $1 and model_id like $2`,
      [reportId, `${SIMULATION_MODEL_PREFIX}%`],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    const payload = parseJson(row.payload);
    return {
      report_id: row.id,
      publish_id: typeof payload.publish_id === 'string' ? payload.publish_id : stripPrefix(SIMULATION_MODEL_PREFIX, row.model_id ?? ''),
      profile: typeof payload.profile === 'string' ? payload.profile : 'baseline',
      generated_at:
        typeof payload.generated_at === 'string'
          ? payload.generated_at
          : new Date(row.created_at).toISOString(),
      baseline_model_id:
        typeof payload.baseline_model_id === 'string' ? payload.baseline_model_id : undefined,
      draft_model_id: typeof payload.draft_model_id === 'string' ? payload.draft_model_id : undefined,
      payload,
    };
  }

  async listSimulationReports(
    query?: SimulationReportListQuery,
  ): Promise<PersistedSimulationReportListResult> {
    const publishId = query?.publish_id?.trim();
    const profile = query?.profile?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const conditions: string[] = ['model_id like $1'];
    const listParams: unknown[] = [`${SIMULATION_MODEL_PREFIX}%`];
    const countParams: unknown[] = [`${SIMULATION_MODEL_PREFIX}%`];

    if (publishId) {
      conditions.push(`payload ->> 'publish_id' = $${listParams.length + 1}`);
      listParams.push(publishId);
      countParams.push(publishId);
    }
    if (profile) {
      conditions.push(`payload ->> 'profile' = $${listParams.length + 1}`);
      listParams.push(profile);
      countParams.push(profile);
    }

    listParams.push(limit, offset);
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;
    const whereClause = `where ${conditions.join(' and ')}`;

    const [listResult, countResult] = await Promise.all([
      this.pool.query<PgRow>(
        `select id, model_id, created_at, payload
         from acl_validation_records
         ${whereClause}
         order by coalesce(payload ->> 'generated_at', created_at::text) desc, id desc
         limit $${limitIdx}
         offset $${offsetIdx}`,
        listParams,
      ),
      this.pool.query<PgRow>(
        `select count(1)::int as total_count
         from acl_validation_records
         ${whereClause}`,
        countParams,
      ),
    ]);

    const items = listResult.rows.map((row) => {
      const payload = parseJson(row.payload);
      return {
        report_id: row.id,
        publish_id:
          typeof payload.publish_id === 'string'
            ? payload.publish_id
            : stripPrefix(SIMULATION_MODEL_PREFIX, row.model_id ?? ''),
        profile: typeof payload.profile === 'string' ? payload.profile : 'baseline',
        generated_at:
          typeof payload.generated_at === 'string'
            ? payload.generated_at
            : new Date(row.created_at).toISOString(),
        baseline_model_id:
          typeof payload.baseline_model_id === 'string' ? payload.baseline_model_id : undefined,
        draft_model_id:
          typeof payload.draft_model_id === 'string' ? payload.draft_model_id : undefined,
        payload,
      };
    });
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    return toPagedResult(items, totalCount, offset);
  }

  async saveControlAudit(record: PersistedControlAuditRecord): Promise<void> {
    await this.pool.query(
      `insert into acl_lifecycle_reports (id, event_type, target, created_at, payload)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (id) do update set event_type = excluded.event_type, target = excluded.target, created_at = excluded.created_at, payload = excluded.payload`,
      [
        record.audit_id,
        record.event_type,
        record.target,
        record.created_at,
        JSON.stringify(record),
      ],
    );
  }

  async listControlAudits(query?: ControlAuditListQuery): Promise<PersistedControlAuditListResult> {
    const namespace = query?.namespace?.trim();
    const eventType = query?.event_type?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const conditions: string[] = ['event_type like $1'];
    const listParams: unknown[] = [`${CONTROL_AUDIT_EVENT_PREFIX}%`];
    const countParams: unknown[] = [`${CONTROL_AUDIT_EVENT_PREFIX}%`];

    if (namespace) {
      conditions.push(`payload ->> 'namespace' = $${listParams.length + 1}`);
      listParams.push(namespace);
      countParams.push(namespace);
    }
    if (eventType) {
      conditions.push(`event_type = $${listParams.length + 1}`);
      listParams.push(eventType);
      countParams.push(eventType);
    }

    listParams.push(limit, offset);
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;
    const whereClause = `where ${conditions.join(' and ')}`;

    const [listResult, countResult] = await Promise.all([
      this.pool.query<PgRow>(
        `select id, event_type, target, created_at, payload
         from acl_lifecycle_reports
         ${whereClause}
         order by created_at desc, id desc
         limit $${limitIdx}
         offset $${offsetIdx}`,
        listParams,
      ),
      this.pool.query<PgRow>(
        `select count(1)::int as total_count
         from acl_lifecycle_reports
         ${whereClause}`,
        countParams,
      ),
    ]);

    const items = listResult.rows.map((row) => {
      const payload = parseJson(row.payload);
      return {
        audit_id: row.id,
        event_type: row.event_type ?? 'control.unknown',
        target: row.target ?? '',
        namespace: typeof payload.namespace === 'string' ? payload.namespace : '',
        operator: typeof payload.operator === 'string' ? payload.operator : 'system',
        created_at:
          typeof payload.created_at === 'string'
            ? payload.created_at
            : new Date(row.created_at).toISOString(),
        payload,
      };
    });
    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    return toPagedResult(items, totalCount, offset);
  }

  async upsertModelRoute(record: PersistedModelRouteRecord): Promise<void> {
    const id = withPrefix(MODEL_ROUTE_ID_PREFIX, record.key);
    const modelId = withPrefix(MODEL_ROUTE_MODEL_PREFIX, record.namespace);
    await this.pool.query(
      `insert into acl_validation_records (id, model_id, created_at, payload)
       values ($1, $2, $3, $4::jsonb)
       on conflict (id) do update set model_id = excluded.model_id, created_at = excluded.created_at, payload = excluded.payload`,
      [id, modelId, record.updated_at, JSON.stringify(record)],
    );
  }

  async getModelRoute(key: string): Promise<PersistedModelRouteRecord | null> {
    const id = withPrefix(MODEL_ROUTE_ID_PREFIX, key);
    const result = await this.pool.query<PgRow>(
      `select id, created_at, payload
       from acl_validation_records
       where id = $1`,
      [id],
    );

    if (!result.rowCount) {
      return null;
    }

    const row = result.rows[0];
    const payload = parseJson(row.payload);
    return {
      key: typeof payload.key === 'string' ? payload.key : key,
      namespace: typeof payload.namespace === 'string' ? payload.namespace : '',
      tenant_id: typeof payload.tenant_id === 'string' ? payload.tenant_id : '',
      environment: typeof payload.environment === 'string' ? payload.environment : '',
      model_id: typeof payload.model_id === 'string' ? payload.model_id : '',
      model_version:
        typeof payload.model_version === 'string' ? payload.model_version : undefined,
      publish_id: typeof payload.publish_id === 'string' ? payload.publish_id : undefined,
      updated_at:
        typeof payload.updated_at === 'string'
          ? payload.updated_at
          : new Date(row.created_at).toISOString(),
      operator: typeof payload.operator === 'string' ? payload.operator : 'system',
    };
  }

  async listModelRoutes(query?: ModelRouteListQuery): Promise<PersistedModelRouteListResult> {
    const namespace = query?.namespace?.trim();
    const tenantId = query?.tenant_id?.trim();
    const environment = query?.environment?.trim();
    const limit = normalizeLimit(query?.limit);
    const offset = normalizeOffset(query?.offset);

    const conditions: string[] = ['model_id like $1'];
    const listParams: unknown[] = [`${MODEL_ROUTE_MODEL_PREFIX}%`];
    const countParams: unknown[] = [`${MODEL_ROUTE_MODEL_PREFIX}%`];

    if (namespace) {
      conditions.push(`payload ->> 'namespace' = $${listParams.length + 1}`);
      listParams.push(namespace);
      countParams.push(namespace);
    }
    if (tenantId) {
      conditions.push(`payload ->> 'tenant_id' = $${listParams.length + 1}`);
      listParams.push(tenantId);
      countParams.push(tenantId);
    }
    if (environment) {
      conditions.push(`payload ->> 'environment' = $${listParams.length + 1}`);
      listParams.push(environment);
      countParams.push(environment);
    }

    listParams.push(limit, offset);
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;
    const whereClause = `where ${conditions.join(' and ')}`;

    const [listResult, countResult] = await Promise.all([
      this.pool.query<PgRow>(
        `select id, created_at, payload
         from acl_validation_records
         ${whereClause}
         order by coalesce(payload ->> 'updated_at', created_at::text) desc, id desc
         limit $${limitIdx}
         offset $${offsetIdx}`,
        listParams,
      ),
      this.pool.query<PgRow>(
        `select count(1)::int as total_count
         from acl_validation_records
         ${whereClause}`,
        countParams,
      ),
    ]);

    const items = listResult.rows.map((row) => {
      const payload = parseJson(row.payload);
      return {
        key:
          typeof payload.key === 'string'
            ? payload.key
            : stripPrefix(MODEL_ROUTE_ID_PREFIX, row.id),
        namespace: typeof payload.namespace === 'string' ? payload.namespace : '',
        tenant_id: typeof payload.tenant_id === 'string' ? payload.tenant_id : '',
        environment: typeof payload.environment === 'string' ? payload.environment : '',
        model_id: typeof payload.model_id === 'string' ? payload.model_id : '',
        model_version:
          typeof payload.model_version === 'string' ? payload.model_version : undefined,
        publish_id: typeof payload.publish_id === 'string' ? payload.publish_id : undefined,
        updated_at:
          typeof payload.updated_at === 'string'
            ? payload.updated_at
            : new Date(row.created_at).toISOString(),
        operator: typeof payload.operator === 'string' ? payload.operator : 'system',
      };
    });

    const totalCount = Number(countResult.rows[0]?.total_count ?? 0);
    return toPagedResult(items, totalCount, offset);
  }

  async listControlNamespaces(): Promise<PersistedControlNamespaceListResult> {
    const result = await this.pool.query<PgRow>(
      `select distinct payload ->> 'namespace' as namespace
       from acl_validation_records
       where model_id like $1
          or model_id like $2
          or model_id like $3
       order by namespace asc`,
      [
        `${CONTROL_OBJECT_MODEL_PREFIX}%`,
        `${CONTROL_RELATION_MODEL_PREFIX}%`,
        `${MODEL_ROUTE_MODEL_PREFIX}%`,
      ],
    );

    const items = result.rows
      .map((row) => row.namespace)
      .filter((namespace): namespace is string => typeof namespace === 'string' && namespace.length > 0);

    return {
      items,
      total_count: items.length,
    };
  }

  async resetControlPlane(): Promise<ControlPlaneResetResult> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');

      const controlObjects = await client.query(
        `delete from acl_validation_records where model_id like $1`,
        [`${CONTROL_OBJECT_MODEL_PREFIX}%`],
      );
      const controlRelations = await client.query(
        `delete from acl_validation_records where model_id like $1`,
        [`${CONTROL_RELATION_MODEL_PREFIX}%`],
      );
      const modelRoutes = await client.query(
        `delete from acl_validation_records where model_id like $1`,
        [`${MODEL_ROUTE_MODEL_PREFIX}%`],
      );
      const simulationReports = await client.query(
        `delete from acl_validation_records where model_id like $1`,
        [`${SIMULATION_MODEL_PREFIX}%`],
      );
      const publishRequests = await client.query(`delete from acl_publish_requests`);
      const gateReports = await client.query(`delete from acl_gate_reports`);
      const controlAudits = await client.query(
        `delete from acl_lifecycle_reports where event_type like $1`,
        [`${CONTROL_AUDIT_EVENT_PREFIX}%`],
      );

      await client.query('commit');

      return {
        control_object_count: Number(controlObjects.rowCount ?? 0),
        control_relation_count: Number(controlRelations.rowCount ?? 0),
        model_route_count: Number(modelRoutes.rowCount ?? 0),
        publish_request_count: Number(publishRequests.rowCount ?? 0),
        gate_report_count: Number(gateReports.rowCount ?? 0),
        simulation_report_count: Number(simulationReports.rowCount ?? 0),
        control_audit_count: Number(controlAudits.rowCount ?? 0),
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
}
