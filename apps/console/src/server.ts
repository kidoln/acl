import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AclApiClient } from "./acl-api-client";
import {
  loadExecutionPlanFromFixtureId,
  runExpectationSimulation,
  type AppliedExpectationExecutionPlan,
} from "./expectation-runner";
import { bootstrapFixtureRoute } from "./fixture-bootstrap";
import { renderConsolePage } from "./html";
import { loadSetupFixtureById } from "./setup-fixtures";
import type {
  ApiResult,
  ConsoleQuery,
  ConsoleTab,
  ConsoleWidget,
  ControlObjectListResponse,
  ControlRelationListResponse,
  DetailMode,
  ExpectationRunReport,
  GateProfile,
  ModelRouteListResponse,
  PublishRequestRecord,
  PublishWorkflowStatus,
} from "./types";

const VALID_STATUSES = new Set<PublishWorkflowStatus>([
  "blocked",
  "review_required",
  "approved",
  "rejected",
  "published",
]);

const VALID_PROFILES = new Set<GateProfile>(["baseline", "strict_compliance"]);
const VALID_TABS = new Set<ConsoleTab>([
  "workflow",
  "simulation",
  "relations",
  "control",
  "components",
]);
const VALID_DETAIL_MODES = new Set<DetailMode>(["visual", "raw"]);
const VALID_WIDGETS = new Set<ConsoleWidget>([
  "publish_list",
  "publish_detail",
  "decision_detail",
  "simulation",
  "matrix",
  "relation",
  "control",
]);

const MAX_FORM_BODY_BYTES = 64 * 1024;
const CONTROL_PAGE_SIZE = 100;
const CONTROL_MAX_PAGES = 200;
const expectationRunStore = new Map<string, ExpectationRunReport>();
const namespaceExecutionPlanStore = new Map<string, AppliedExpectationExecutionPlan>();

function splitCsvValues(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(/[\n,，]/g)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function parseInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === null || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function parseQuery(inputUrl: URL): ConsoleQuery {
  const statusRaw = inputUrl.searchParams.get("status");
  const profileRaw = inputUrl.searchParams.get("profile");
  const tabRaw = inputUrl.searchParams.get("tab");
  const widgetRaw = inputUrl.searchParams.get("widget");
  const detailModeRaw = inputUrl.searchParams.get("detail_mode");
  const fixtureIdRaw = inputUrl.searchParams.get("fixture_id");
  const expectationRunIdRaw = inputUrl.searchParams.get("expectation_run_id");
  const flashTypeRaw = inputUrl.searchParams.get("flash_type");
  const flashMessage = inputUrl.searchParams.get("flash_message")?.trim();

  const status =
    statusRaw && VALID_STATUSES.has(statusRaw as PublishWorkflowStatus)
      ? (statusRaw as PublishWorkflowStatus)
      : undefined;
  const profile =
    profileRaw && VALID_PROFILES.has(profileRaw as GateProfile)
      ? (profileRaw as GateProfile)
      : undefined;
  const tab =
    tabRaw && VALID_TABS.has(tabRaw as ConsoleTab)
      ? (tabRaw as ConsoleTab)
      : undefined;
  const widget =
    widgetRaw && VALID_WIDGETS.has(widgetRaw as ConsoleWidget)
      ? (widgetRaw as ConsoleWidget)
      : undefined;
  const detailMode =
    detailModeRaw && VALID_DETAIL_MODES.has(detailModeRaw as DetailMode)
      ? (detailModeRaw as DetailMode)
      : undefined;

  const publishId = inputUrl.searchParams.get("publish_id")?.trim();
  const decisionId = inputUrl.searchParams.get("decision_id")?.trim();
  const simulationId = inputUrl.searchParams.get("simulation_id")?.trim();
  const namespace = inputUrl.searchParams.get("namespace")?.trim();
  const cellKey = inputUrl.searchParams.get("cell_key")?.trim();
  const fixtureId = fixtureIdRaw?.trim();

  return {
    status,
    profile,
    tab,
    widget,
    detail_mode: detailMode,
    fixture_id: fixtureId && fixtureId.length > 0 ? fixtureId : undefined,
    expectation_run_id:
      expectationRunIdRaw && expectationRunIdRaw.trim().length > 0
        ? expectationRunIdRaw.trim()
        : undefined,
    limit: parseInteger(inputUrl.searchParams.get("limit"), 20, 1, 100),
    offset: parseInteger(
      inputUrl.searchParams.get("offset"),
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    publish_id: publishId && publishId.length > 0 ? publishId : undefined,
    decision_id: decisionId && decisionId.length > 0 ? decisionId : undefined,
    simulation_id:
      simulationId && simulationId.length > 0 ? simulationId : undefined,
    namespace: namespace && namespace.length > 0 ? namespace : "tenant_a.crm",
    cell_key: cellKey && cellKey.length > 0 ? cellKey : undefined,
    flash_type:
      flashTypeRaw === "success" || flashTypeRaw === "error"
        ? flashTypeRaw
        : undefined,
    flash_message:
      flashMessage && flashMessage.length > 0 ? flashMessage : undefined,
  };
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: Record<string, unknown>,
): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(html);
}

function sendCss(res: ServerResponse, css: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", "text/css; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(css);
}

function sendJs(res: ServerResponse, script: string): void {
  res.statusCode = 200;
  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(script);
}

function redirectTo(res: ServerResponse, location: string): void {
  res.statusCode = 303;
  res.setHeader("location", location);
  res.end();
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, {
    code: "METHOD_NOT_ALLOWED",
    message: "only GET/POST is supported",
  });
}

function notFound(res: ServerResponse): void {
  sendJson(res, 404, {
    code: "NOT_FOUND",
    message: "route not found",
  });
}

function buildRedirectUrl(input: {
  query?: Partial<ConsoleQuery>;
  flashType?: "success" | "error";
  flashMessage?: string;
}): string {
  const params = new URLSearchParams();
  const query = input.query;

  if (query?.status) {
    params.set("status", query.status);
  }
  if (query?.profile) {
    params.set("profile", query.profile);
  }
  if (query?.tab) {
    params.set("tab", query.tab);
  }
  if (query?.widget) {
    params.set("widget", query.widget);
  }
  if (query?.detail_mode) {
    params.set("detail_mode", query.detail_mode);
  }
  if (query?.fixture_id) {
    params.set("fixture_id", query.fixture_id);
  }
  if (query?.expectation_run_id) {
    params.set("expectation_run_id", query.expectation_run_id);
  }
  if (query?.limit && Number.isInteger(query.limit)) {
    params.set("limit", String(query.limit));
  }
  if (query?.offset !== undefined && Number.isInteger(query.offset)) {
    params.set("offset", String(query.offset));
  }
  if (query?.publish_id) {
    params.set("publish_id", query.publish_id);
  }
  if (query?.decision_id) {
    params.set("decision_id", query.decision_id);
  }
  if (query?.simulation_id) {
    params.set("simulation_id", query.simulation_id);
  }
  if (query?.namespace) {
    params.set("namespace", query.namespace);
  }
  if (query?.cell_key) {
    params.set("cell_key", query.cell_key);
  }

  if (input.flashType && input.flashMessage) {
    params.set("flash_type", input.flashType);
    params.set("flash_message", input.flashMessage);
  }

  const queryString = params.toString();
  return queryString.length > 0 ? `/?${queryString}` : "/";
}

async function loadGlobalCss(): Promise<string> {
  const fileCandidates = [
    resolve(__dirname, "styles/global.css"),
    resolve(__dirname, "../src/styles/global.css"),
  ];

  for (const filePath of fileCandidates) {
    try {
      return await readFile(filePath, "utf-8");
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(
    `global css not found, checked: ${fileCandidates.join(", ")}`,
  );
}

async function loadDashboardTabsScript(): Promise<string> {
  const fileCandidates = [
    resolve(__dirname, "scripts/dashboard-tabs.js"),
    resolve(__dirname, "../src/scripts/dashboard-tabs.js"),
  ];

  for (const filePath of fileCandidates) {
    try {
      return await readFile(filePath, "utf-8");
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(
    `dashboard tabs script not found, checked: ${fileCandidates.join(", ")}`,
  );
}

async function loadEchartsScript(): Promise<string> {
  const fileCandidates = [
    resolve(__dirname, "../node_modules/echarts/dist/echarts.min.js"),
    resolve(process.cwd(), "node_modules/echarts/dist/echarts.min.js"),
    resolve(__dirname, "vendor/echarts.min.js"),
    resolve(__dirname, "../src/vendor/echarts.min.js"),
  ];

  for (const filePath of fileCandidates) {
    try {
      return await readFile(filePath, "utf-8");
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(
    `echarts script not found, checked: ${fileCandidates.join(", ")}`,
  );
}

async function loadVanillaJsonEditorScript(): Promise<string> {
  const fileCandidates = [
    resolve(__dirname, "../node_modules/vanilla-jsoneditor/standalone.js"),
    resolve(process.cwd(), "node_modules/vanilla-jsoneditor/standalone.js"),
    resolve(__dirname, "vendor/vanilla-jsoneditor.js"),
    resolve(__dirname, "../src/vendor/vanilla-jsoneditor.js"),
  ];

  for (const filePath of fileCandidates) {
    try {
      return await readFile(filePath, "utf-8");
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(
    `vanilla jsoneditor script not found, checked: ${fileCandidates.join(", ")}`,
  );
}

async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let receivedBytes = 0;

  for await (const chunk of req) {
    const chunkBuffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    receivedBytes += chunkBuffer.byteLength;

    if (receivedBytes > MAX_FORM_BODY_BYTES) {
      throw new Error("form body too large");
    }

    chunks.push(chunkBuffer);
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  return new URLSearchParams(raw);
}

function parseContextFromForm(form: URLSearchParams): Partial<ConsoleQuery> {
  const statusRaw = form.get("status");
  const profileRaw = form.get("profile");
  const tabRaw = form.get("tab");
  const widgetRaw = form.get("widget");
  const detailModeRaw = form.get("detail_mode");
  const fixtureId = form.get("fixture_id")?.trim();
  const expectationRunId = form.get("expectation_run_id")?.trim();

  const status =
    statusRaw && VALID_STATUSES.has(statusRaw as PublishWorkflowStatus)
      ? (statusRaw as PublishWorkflowStatus)
      : undefined;
  const profile =
    profileRaw && VALID_PROFILES.has(profileRaw as GateProfile)
      ? (profileRaw as GateProfile)
      : undefined;
  const tab =
    tabRaw && VALID_TABS.has(tabRaw as ConsoleTab)
      ? (tabRaw as ConsoleTab)
      : undefined;
  const widget =
    widgetRaw && VALID_WIDGETS.has(widgetRaw as ConsoleWidget)
      ? (widgetRaw as ConsoleWidget)
      : undefined;
  const detailMode =
    detailModeRaw && VALID_DETAIL_MODES.has(detailModeRaw as DetailMode)
      ? (detailModeRaw as DetailMode)
      : undefined;

  const publishId = form.get("publish_id")?.trim();
  const decisionId = form.get("decision_id")?.trim();
  const simulationId = form.get("simulation_id")?.trim();
  const namespace = form.get("namespace")?.trim();
  const cellKey = form.get("cell_key")?.trim();

  return {
    status,
    profile,
    tab,
    widget,
    detail_mode: detailMode,
    fixture_id: fixtureId && fixtureId.length > 0 ? fixtureId : undefined,
    expectation_run_id:
      expectationRunId && expectationRunId.length > 0
        ? expectationRunId
        : undefined,
    limit: parseInteger(form.get("limit"), 20, 1, 100),
    offset: parseInteger(form.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER),
    publish_id: publishId && publishId.length > 0 ? publishId : undefined,
    decision_id: decisionId && decisionId.length > 0 ? decisionId : undefined,
    simulation_id:
      simulationId && simulationId.length > 0 ? simulationId : undefined,
    namespace: namespace && namespace.length > 0 ? namespace : "tenant_a.crm",
    cell_key: cellKey && cellKey.length > 0 ? cellKey : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getModelSnapshotFromPublishRecord(
  record: PublishRequestRecord,
): Record<string, unknown> | null {
  const payload = asRecord(record.payload);
  if (!payload) {
    return null;
  }

  const snapshot = asRecord(payload.model_snapshot);
  return snapshot;
}

function getModelIdentity(model: Record<string, unknown>): {
  model_id: string;
  tenant_id: string;
} | null {
  const meta = asRecord(model.model_meta);
  if (!meta) {
    return null;
  }

  const modelId = typeof meta.model_id === "string" ? meta.model_id.trim() : "";
  const tenantId = typeof meta.tenant_id === "string" ? meta.tenant_id.trim() : "";
  if (!modelId || !tenantId) {
    return null;
  }

  return {
    model_id: modelId,
    tenant_id: tenantId,
  };
}

async function findBaselinePublishIdForSimulation(
  client: AclApiClient,
  currentRecord: PublishRequestRecord,
): Promise<string | undefined> {
  const currentSnapshot = getModelSnapshotFromPublishRecord(currentRecord);
  if (!currentSnapshot) {
    return undefined;
  }

  const currentIdentity = getModelIdentity(currentSnapshot);
  if (!currentIdentity) {
    return undefined;
  }

  const publishedList = await client.listPublishRequests({
    status: "published",
    limit: 100,
    offset: 0,
  });
  if (!publishedList.ok) {
    return undefined;
  }

  for (const item of publishedList.data.items) {
    if (item.publish_id === currentRecord.publish_id) {
      continue;
    }

    const snapshot = getModelSnapshotFromPublishRecord(item);
    if (!snapshot) {
      continue;
    }

    const identity = getModelIdentity(snapshot);
    if (!identity) {
      continue;
    }

    if (
      identity.model_id === currentIdentity.model_id &&
      identity.tenant_id === currentIdentity.tenant_id
    ) {
      return item.publish_id;
    }
  }

  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function resolveNextOffset(input: {
  offset: number;
  limit: number;
  next_offset?: number;
  current_length: number;
}): number {
  if (
    typeof input.next_offset === "number" &&
    Number.isInteger(input.next_offset) &&
    input.next_offset >= 0
  ) {
    return input.next_offset;
  }
  const normalizedLimit =
    input.limit > 0 ? input.limit : Math.max(input.current_length, 1);
  return input.offset + normalizedLimit;
}

async function listAllControlObjects(
  client: AclApiClient,
  namespace: string,
): Promise<ApiResult<ControlObjectListResponse>> {
  const first = await client.listControlObjects({
    namespace,
    limit: CONTROL_PAGE_SIZE,
    offset: 0,
  });
  if (!first.ok) {
    return first;
  }

  const items = [...first.data.items];
  let hasMore = first.data.has_more;
  let nextOffset = resolveNextOffset({
    offset: first.data.offset,
    limit: first.data.limit,
    next_offset: first.data.next_offset,
    current_length: first.data.items.length,
  });

  for (
    let page = 1;
    hasMore && page < CONTROL_MAX_PAGES;
    page += 1
  ) {
    const pageResult = await client.listControlObjects({
      namespace,
      limit: CONTROL_PAGE_SIZE,
      offset: nextOffset,
    });
    if (!pageResult.ok) {
      return pageResult;
    }
    items.push(...pageResult.data.items);
    hasMore = pageResult.data.has_more;
    nextOffset = resolveNextOffset({
      offset: pageResult.data.offset,
      limit: pageResult.data.limit,
      next_offset: pageResult.data.next_offset,
      current_length: pageResult.data.items.length,
    });
  }

  return {
    ok: true,
    status: first.status,
    data: {
      ...first.data,
      items,
      total_count: hasMore
        ? Math.max(first.data.total_count, items.length)
        : items.length,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : undefined,
      limit: CONTROL_PAGE_SIZE,
      offset: 0,
    },
  };
}

async function listAllControlRelations(
  client: AclApiClient,
  namespace: string,
): Promise<ApiResult<ControlRelationListResponse>> {
  const first = await client.listControlRelations({
    namespace,
    limit: CONTROL_PAGE_SIZE,
    offset: 0,
  });
  if (!first.ok) {
    return first;
  }

  const items = [...first.data.items];
  let hasMore = first.data.has_more;
  let nextOffset = resolveNextOffset({
    offset: first.data.offset,
    limit: first.data.limit,
    next_offset: first.data.next_offset,
    current_length: first.data.items.length,
  });

  for (
    let page = 1;
    hasMore && page < CONTROL_MAX_PAGES;
    page += 1
  ) {
    const pageResult = await client.listControlRelations({
      namespace,
      limit: CONTROL_PAGE_SIZE,
      offset: nextOffset,
    });
    if (!pageResult.ok) {
      return pageResult;
    }
    items.push(...pageResult.data.items);
    hasMore = pageResult.data.has_more;
    nextOffset = resolveNextOffset({
      offset: pageResult.data.offset,
      limit: pageResult.data.limit,
      next_offset: pageResult.data.next_offset,
      current_length: pageResult.data.items.length,
    });
  }

  return {
    ok: true,
    status: first.status,
    data: {
      ...first.data,
      items,
      total_count: hasMore
        ? Math.max(first.data.total_count, items.length)
        : items.length,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : undefined,
      limit: CONTROL_PAGE_SIZE,
      offset: 0,
    },
  };
}

async function listAllModelRoutes(
  client: AclApiClient,
  namespace: string,
): Promise<ApiResult<ModelRouteListResponse>> {
  const first = await client.listModelRoutes({
    namespace,
    limit: CONTROL_PAGE_SIZE,
    offset: 0,
  });
  if (!first.ok) {
    return first;
  }

  const items = [...first.data.items];
  let hasMore = first.data.has_more;
  let nextOffset = resolveNextOffset({
    offset: first.data.offset,
    limit: first.data.limit,
    next_offset: first.data.next_offset,
    current_length: first.data.items.length,
  });

  for (
    let page = 1;
    hasMore && page < CONTROL_MAX_PAGES;
    page += 1
  ) {
    const pageResult = await client.listModelRoutes({
      namespace,
      limit: CONTROL_PAGE_SIZE,
      offset: nextOffset,
    });
    if (!pageResult.ok) {
      return pageResult;
    }
    items.push(...pageResult.data.items);
    hasMore = pageResult.data.has_more;
    nextOffset = resolveNextOffset({
      offset: pageResult.data.offset,
      limit: pageResult.data.limit,
      next_offset: pageResult.data.next_offset,
      current_length: pageResult.data.items.length,
    });
  }

  return {
    ok: true,
    status: first.status,
    data: {
      ...first.data,
      items,
      total_count: hasMore
        ? Math.max(first.data.total_count, items.length)
        : items.length,
      has_more: hasMore,
      next_offset: hasMore ? nextOffset : undefined,
      limit: CONTROL_PAGE_SIZE,
      offset: 0,
    },
  };
}

interface ParsedInstanceJsonPayload {
  namespace?: string;
  objects: Array<{
    object_id: string;
    object_type: string;
    sensitivity?: string;
    owner_ref?: string;
    labels?: string[];
  }>;
  relation_events: Array<{
    from: string;
    to: string;
    relation_type: string;
    operation: "upsert" | "delete";
    scope?: string;
    source?: string;
  }>;
  model_routes: Array<{
    namespace?: string;
    tenant_id: string;
    environment: string;
    model_id: string;
    model_version?: string;
    publish_id?: string;
    operator?: string;
  }>;
}

function parseInstanceJsonPayload(
  rawJson: string,
):
  | { ok: true; data: ParsedInstanceJsonPayload }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? `instance_json 不是合法 JSON：${error.message}`
          : "instance_json 不是合法 JSON",
    };
  }

  const record = asRecord(parsed);
  if (!record) {
    return {
      ok: false,
      error: "instance_json 必须是 JSON Object",
    };
  }

  const namespace = normalizeString(record.namespace);
  const rawObjects = Array.isArray(record.objects) ? record.objects : [];
  const rawRelations = Array.isArray(record.relation_events)
    ? record.relation_events
    : [];
  const rawModelRoutes = Array.isArray(record.model_routes)
    ? record.model_routes
    : [];

  const objects: ParsedInstanceJsonPayload["objects"] = [];
  for (let index = 0; index < rawObjects.length; index += 1) {
    const item = asRecord(rawObjects[index]);
    if (!item) {
      return {
        ok: false,
        error: `objects[${index}] 必须是 Object`,
      };
    }
    const objectId = normalizeString(item.object_id);
    const objectType = normalizeString(item.object_type);
    if (!objectId || !objectType) {
      return {
        ok: false,
        error: `objects[${index}] 缺少 object_id/object_type`,
      };
    }
    objects.push({
      object_id: objectId,
      object_type: objectType,
      sensitivity: normalizeString(item.sensitivity),
      owner_ref: normalizeString(item.owner_ref),
      labels: normalizeStringArray(item.labels),
    });
  }

  const relationEvents: ParsedInstanceJsonPayload["relation_events"] = [];
  for (let index = 0; index < rawRelations.length; index += 1) {
    const item = asRecord(rawRelations[index]);
    if (!item) {
      return {
        ok: false,
        error: `relation_events[${index}] 必须是 Object`,
      };
    }
    const from = normalizeString(item.from);
    const to = normalizeString(item.to);
    const relationType = normalizeString(item.relation_type);
    if (!from || !to || !relationType) {
      return {
        ok: false,
        error: `relation_events[${index}] 缺少 from/to/relation_type`,
      };
    }
    relationEvents.push({
      from,
      to,
      relation_type: relationType,
      operation: item.operation === "delete" ? "delete" : "upsert",
      scope: normalizeString(item.scope),
      source: normalizeString(item.source),
    });
  }

  const modelRoutes: ParsedInstanceJsonPayload["model_routes"] = [];
  for (let index = 0; index < rawModelRoutes.length; index += 1) {
    const item = asRecord(rawModelRoutes[index]);
    if (!item) {
      return {
        ok: false,
        error: `model_routes[${index}] 必须是 Object`,
      };
    }
    const tenantId = normalizeString(item.tenant_id);
    const environment = normalizeString(item.environment);
    const modelId = normalizeString(item.model_id);
    if (!tenantId || !environment || !modelId) {
      return {
        ok: false,
        error: `model_routes[${index}] 缺少 tenant_id/environment/model_id`,
      };
    }
    modelRoutes.push({
      namespace: normalizeString(item.namespace),
      tenant_id: tenantId,
      environment,
      model_id: modelId,
      model_version: normalizeString(item.model_version),
      publish_id: normalizeString(item.publish_id),
      operator: normalizeString(item.operator),
    });
  }

  return {
    ok: true,
    data: {
      namespace,
      objects,
      relation_events: relationEvents,
      model_routes: modelRoutes,
    },
  };
}

async function applyParsedInstancePayload(input: {
  client: AclApiClient;
  namespaceInput: string;
  parsed: ParsedInstanceJsonPayload;
}): Promise<
  | {
      ok: true;
      targetNamespace: string;
      modelRouteCount: number;
      objectCount: number;
      relationCount: number;
    }
  | {
      ok: false;
      step: "model_routes" | "objects" | "relation_events";
      error: string;
    }
> {
  const targetNamespace = input.parsed.namespace ?? input.namespaceInput;

  if (input.parsed.model_routes.length > 0) {
    const groupedModelRoutes = new Map<
      string,
      Array<{
        tenant_id: string;
        environment: string;
        model_id: string;
        model_version?: string;
        publish_id?: string;
        operator?: string;
      }>
    >();

    input.parsed.model_routes.forEach((item) => {
      const namespace = item.namespace ?? targetNamespace;
      const current = groupedModelRoutes.get(namespace) ?? [];
      current.push({
        tenant_id: item.tenant_id,
        environment: item.environment,
        model_id: item.model_id,
        model_version: item.model_version,
        publish_id: item.publish_id,
        operator: item.operator,
      });
      groupedModelRoutes.set(namespace, current);
    });

    for (const [namespace, routes] of groupedModelRoutes.entries()) {
      const routeResult = await input.client.upsertModelRoutes({
        namespace,
        routes,
      });
      if (!routeResult.ok) {
        return {
          ok: false,
          step: "model_routes",
          error: routeResult.error,
        };
      }
    }
  }

  if (input.parsed.objects.length > 0) {
    const objectResult = await input.client.upsertControlObjects({
      namespace: targetNamespace,
      objects: input.parsed.objects,
    });
    if (!objectResult.ok) {
      return {
        ok: false,
        step: "objects",
        error: objectResult.error,
      };
    }
  }

  if (input.parsed.relation_events.length > 0) {
    const relationResult = await input.client.syncControlRelations({
      namespace: targetNamespace,
      events: input.parsed.relation_events,
    });
    if (!relationResult.ok) {
      return {
        ok: false,
        step: "relation_events",
        error: relationResult.error,
      };
    }
  }

  return {
    ok: true,
    targetNamespace,
    modelRouteCount: input.parsed.model_routes.length,
    objectCount: input.parsed.objects.length,
    relationCount: input.parsed.relation_events.length,
  };
}

export async function maybeAutoAttachFixtureRoute(input: {
  client: AclApiClient;
  namespaceInput: string;
  fixtureId?: string;
  parsed: ParsedInstanceJsonPayload;
}): Promise<
  | {
      ok: true;
      parsed: ParsedInstanceJsonPayload;
      summary?: {
        publish_id: string;
        model_id: string;
        model_version?: string;
        tenant_id: string;
        environment: string;
      };
    }
  | {
      ok: false;
      step:
        | "load_model_fixture"
        | "publish_submit"
        | "publish_review"
        | "publish_activate"
        | "model_meta";
      error: string;
    }
> {
  if (!input.fixtureId || input.parsed.model_routes.length > 0) {
    return {
      ok: true,
      parsed: input.parsed,
    };
  }

  const loadedFixture = loadSetupFixtureById(input.fixtureId);
  const route = loadedFixture?.fixture.route;
  if (!route) {
    return {
      ok: true,
      parsed: input.parsed,
    };
  }

  const targetNamespace = input.parsed.namespace ?? input.namespaceInput;
  const bootstrapResult = await bootstrapFixtureRoute({
    client: input.client,
    fixtureId: input.fixtureId,
    namespace: targetNamespace,
    route,
  });

  if (!bootstrapResult.ok) {
    return bootstrapResult;
  }

  return {
    ok: true,
    parsed: {
      ...input.parsed,
      model_routes: [bootstrapResult.route],
    },
    summary: {
      publish_id: bootstrapResult.summary.publish_id,
      model_id: bootstrapResult.summary.model_id,
      model_version: bootstrapResult.summary.model_version,
      tenant_id: bootstrapResult.summary.tenant_id,
      environment: bootstrapResult.summary.environment,
    },
  };
}

async function handleIndex(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const inputUrl = new URL(req.url ?? "/", "http://127.0.0.1");
  const query = parseQuery(inputUrl);
  const namespace = query.namespace ?? "tenant_a.crm";

  const publishListPromise = client.listPublishRequests(query);
  const publishedPublishListPromise = client.listPublishRequests({
    ...query,
    status: "published",
    limit: 100,
    offset: 0,
  });
  const publishDetailPromise = query.publish_id
    ? client.getPublishRequest(query.publish_id)
    : undefined;
  const decisionListPromise = client.listDecisions({
    limit: 100,
    offset: 0,
  });
  const decisionDetailPromise = query.decision_id
    ? client.getDecision(query.decision_id)
    : undefined;
  const simulationListPromise = client.listSimulationReports({
    publish_id: query.publish_id,
    profile: query.profile,
    limit: 20,
    offset: 0,
  });
  const controlNamespacesPromise = client.listControlNamespaces();
  const controlObjectsPromise = listAllControlObjects(client, namespace);
  const controlRelationsPromise = listAllControlRelations(client, namespace);
  const controlAuditsPromise = client.listControlAudits({
    namespace,
    limit: 20,
    offset: 0,
  });
  const modelRoutesPromise = listAllModelRoutes(client, namespace);

  const [
    publishList,
    publishedPublishList,
    publishDetail,
    decisionList,
    decisionDetail,
    simulationList,
    controlNamespaces,
    controlObjects,
    controlRelations,
    controlAudits,
    modelRoutes,
  ] = await Promise.all([
    publishListPromise,
    publishedPublishListPromise,
    publishDetailPromise,
    decisionListPromise,
    decisionDetailPromise,
    simulationListPromise,
    controlNamespacesPromise,
    controlObjectsPromise,
    controlRelationsPromise,
    controlAuditsPromise,
    modelRoutesPromise,
  ]);

  const pickedSimulationId =
    query.simulation_id ??
    (simulationList.ok && simulationList.data.items[0]
      ? simulationList.data.items[0].report_id
      : undefined);
  const simulationDetail = pickedSimulationId
    ? await client.getSimulationReport(pickedSimulationId)
    : undefined;

  const html = renderConsolePage({
    query,
    publish_list: publishList,
    published_publish_list: publishedPublishList,
    publish_detail: publishDetail,
    decision_list: decisionList,
    decision_detail: decisionDetail,
    simulation_list: simulationList,
    simulation_detail: simulationDetail,
    control_namespaces: controlNamespaces,
    control_objects: controlObjects,
    control_relations: controlRelations,
    control_audits: controlAudits,
    model_routes: modelRoutes,
    expectation_run: query.expectation_run_id
      ? expectationRunStore.get(query.expectation_run_id)
      : undefined,
    action_flash:
      query.flash_type && query.flash_message
        ? {
            type: query.flash_type,
            message: query.flash_message,
          }
        : undefined,
    api_base_url: client.getBaseUrl(),
    generated_at: new Date().toISOString(),
  });

  sendHtml(res, html);
}

async function handleReviewAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const publishId = form.get("publish_id")?.trim();
  const decision = form.get("decision")?.trim();
  const reviewer = form.get("reviewer")?.trim();
  const reason = form.get("reason")?.trim();
  const expiresAt = form.get("expires_at")?.trim();

  if (
    !publishId ||
    (decision !== "approve" && decision !== "reject") ||
    !reviewer ||
    !reason
  ) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage:
          "review 参数缺失：publish_id/decision/reviewer/reason 必填",
      }),
    );
    return;
  }

  const result = await client.reviewPublishRequest({
    publish_id: publishId,
    decision,
    reviewer,
    reason,
    expires_at: expiresAt && expiresAt.length > 0 ? expiresAt : undefined,
  });

  context.publish_id = publishId;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `review 失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage: `review 成功，状态: ${result.data.status}`,
    }),
  );
}

async function handleActivateAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const publishId = form.get("publish_id")?.trim();
  const operator = form.get("operator")?.trim() || "release_bot";

  if (!publishId) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "activate 参数缺失：publish_id 必填",
      }),
    );
    return;
  }

  const result = await client.activatePublishRequest({
    publish_id: publishId,
    operator,
  });

  context.publish_id = publishId;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `activate 失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage: `activate 成功，状态: ${result.data.status}`,
    }),
  );
}

async function handlePublishSubmitAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const modelJson = form.get("model_json")?.trim();
  const publishId = form.get("publish_id")?.trim();
  const profile = form.get("profile")?.trim();
  const submittedBy = form.get("submitted_by")?.trim();

  if (!modelJson) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "submit 参数缺失：model_json 必填",
      }),
    );
    return;
  }

  let parsedModel: unknown;
  try {
    parsedModel = JSON.parse(modelJson) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid json";
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `model_json 解析失败: ${message}`,
      }),
    );
    return;
  }

  if (
    typeof parsedModel !== "object" ||
    parsedModel === null ||
    Array.isArray(parsedModel)
  ) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "model_json 必须是 JSON Object",
      }),
    );
    return;
  }

  if (profile && !VALID_PROFILES.has(profile as GateProfile)) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "profile 仅支持 baseline/strict_compliance",
      }),
    );
    return;
  }

  const result = await client.submitPublishRequest({
    model: parsedModel as Record<string, unknown>,
    publish_id: publishId && publishId.length > 0 ? publishId : undefined,
    profile:
      profile && profile.length > 0 ? (profile as GateProfile) : undefined,
    submitted_by:
      submittedBy && submittedBy.length > 0 ? submittedBy : undefined,
  });

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `submit 失败: ${result.error}`,
      }),
    );
    return;
  }

  const responsePublishId =
    typeof result.data.publish_id === "string"
      ? result.data.publish_id
      : publishId;
  const responseStatus =
    typeof result.data.status === "string" ? result.data.status : "unknown";
  context.publish_id = responsePublishId;

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage: `submit 成功: ${responsePublishId ?? "unknown"} (${responseStatus})`,
    }),
  );
}

async function handleSimulationGenerateAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const publishId = form.get("publish_id")?.trim();
  if (!publishId) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "生成模拟参数缺失：publish_id 必填",
      }),
    );
    return;
  }

  const publishRecord = await client.getPublishRequest(publishId);
  if (!publishRecord.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: {
          ...context,
          publish_id: publishId,
          tab: "simulation",
        },
        flashType: "error",
        flashMessage: `加载发布单失败: ${publishRecord.error}`,
      }),
    );
    return;
  }

  const modelSnapshot = getModelSnapshotFromPublishRecord(publishRecord.data);
  if (!modelSnapshot) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: {
          ...context,
          publish_id: publishId,
          tab: "simulation",
        },
        flashType: "error",
        flashMessage: "生成模拟失败：发布单缺少 model_snapshot",
      }),
    );
    return;
  }

  const baselinePublishId = await findBaselinePublishIdForSimulation(
    client,
    publishRecord.data,
  );
  const result = await client.simulatePublish({
    model: modelSnapshot,
    publish_id: publishId,
    profile: publishRecord.data.profile,
    baseline_publish_id: baselinePublishId,
  });

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: {
          ...context,
          publish_id: publishId,
          tab: "simulation",
        },
        flashType: "error",
        flashMessage: `生成模拟失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: {
        ...context,
        publish_id: publishId,
        profile: result.data.profile,
        tab: "simulation",
        simulation_id: result.data.report_id,
        cell_key: undefined,
      },
      flashType: "success",
      flashMessage: `模拟报告已生成: ${result.data.report_id}${baselinePublishId ? `（基线 ${baselinePublishId}）` : "（无历史基线）"}`,
    }),
  );
}

async function handleControlObjectUpsertAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const namespace = form.get("namespace")?.trim();
  const objectId = form.get("object_id")?.trim();
  const objectType = form.get("object_type")?.trim();
  const sensitivity = form.get("sensitivity")?.trim();
  const ownerRef = form.get("owner_ref")?.trim();
  const labels = splitCsvValues(form.get("labels"));

  if (!namespace || !objectId || !objectType) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "object 参数缺失：namespace/object_id/object_type 必填",
      }),
    );
    return;
  }

  const result = await client.upsertControlObjects({
    namespace,
    objects: [
      {
        object_id: objectId,
        object_type: objectType,
        sensitivity:
          sensitivity && sensitivity.length > 0 ? sensitivity : undefined,
        owner_ref: ownerRef && ownerRef.length > 0 ? ownerRef : undefined,
        labels,
      },
    ],
  });

  context.namespace = namespace;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `object 写入失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage: `object 写入成功: ${objectId}`,
    }),
  );
}

async function handleControlObjectDeleteAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const namespace = form.get("namespace")?.trim();
  const objectId = form.get("object_id")?.trim();

  if (!namespace || !objectId) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "object delete 参数缺失：namespace/object_id 必填",
      }),
    );
    return;
  }

  const result = await client.deleteControlObjects({
    namespace,
    object_ids: [objectId],
  });

  context.namespace = namespace;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `object 删除失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage: `object 删除成功: ${objectId}`,
    }),
  );
}

async function handleControlRelationEventAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const namespace = form.get("namespace")?.trim();
  const from = form.get("from")?.trim();
  const to = form.get("to")?.trim();
  const relationType = form.get("relation_type")?.trim();
  const operationRaw = form.get("operation")?.trim();
  const scope = form.get("scope")?.trim();
  const source = form.get("source")?.trim();

  const operation = operationRaw === "delete" ? "delete" : "upsert";

  if (!namespace || !from || !to || !relationType) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "relation 参数缺失：namespace/from/to/relation_type 必填",
      }),
    );
    return;
  }

  const result = await client.syncControlRelations({
    namespace,
    events: [
      {
        from,
        to,
        relation_type: relationType,
        operation,
        scope: scope && scope.length > 0 ? scope : undefined,
        source: source && source.length > 0 ? source : undefined,
      },
    ],
  });

  context.namespace = namespace;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `relation ${operation} 失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage: `relation ${operation} 成功: ${from} -> ${to}`,
    }),
  );
}

async function handleModelRouteUpsertAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const namespace = form.get("namespace")?.trim();
  const tenantId = form.get("tenant_id")?.trim();
  const environment = form.get("environment")?.trim();
  const modelId = form.get("model_id")?.trim();
  const modelVersion = form.get("model_version")?.trim();
  const publishId = form.get("publish_id")?.trim();
  const operator = form.get("operator")?.trim();

  if (!namespace || !tenantId || !environment || !modelId) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage:
          "model route 参数缺失：namespace/tenant_id/environment/model_id 必填",
      }),
    );
    return;
  }

  const result = await client.upsertModelRoutes({
    namespace,
    routes: [
      {
        tenant_id: tenantId,
        environment,
        model_id: modelId,
        model_version:
          modelVersion && modelVersion.length > 0 ? modelVersion : undefined,
        publish_id: publishId && publishId.length > 0 ? publishId : undefined,
        operator: operator && operator.length > 0 ? operator : undefined,
      },
    ],
  });

  context.namespace = namespace;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `model route 写入失败: ${result.error}`,
      }),
    );
    return;
  }

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage: `model route 写入成功: ${tenantId}/${environment}`,
    }),
  );
}

async function handleControlSetupFixtureApplyAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const namespace = form.get("namespace")?.trim();
  const fixtureId = form.get("fixture_id")?.trim();
  const instanceJson = form.get("instance_json")?.trim();

  if (!namespace) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "fixture setup 参数缺失：namespace 必填",
      }),
    );
    return;
  }

  let parsedPayload: ParsedInstanceJsonPayload;
  let autoRouteSummary:
    | {
        publish_id: string;
        model_id: string;
        model_version?: string;
        tenant_id: string;
        environment: string;
      }
    | undefined;
  if (instanceJson && instanceJson.length > 0) {
    const parsed = parseInstanceJsonPayload(instanceJson);
    if (!parsed.ok) {
      redirectTo(
        res,
        buildRedirectUrl({
          query: context,
          flashType: "error",
          flashMessage: parsed.error,
        }),
      );
      return;
    }

    const routeAttachResult = await maybeAutoAttachFixtureRoute({
      client,
      namespaceInput: namespace,
      fixtureId: fixtureId && fixtureId.length > 0 ? fixtureId : undefined,
      parsed: parsed.data,
    });
    if (!routeAttachResult.ok) {
      redirectTo(
        res,
        buildRedirectUrl({
          query: context,
          flashType: "error",
          flashMessage:
            `fixture setup 自动发布失败（${routeAttachResult.step}）: ${routeAttachResult.error}`,
        }),
      );
      return;
    }

    parsedPayload = routeAttachResult.parsed;
    autoRouteSummary = routeAttachResult.summary;
  } else {
    if (!fixtureId) {
      redirectTo(
        res,
        buildRedirectUrl({
          query: context,
          flashType: "error",
          flashMessage: "fixture setup 参数缺失：fixture_id/instance_json 至少提供一个",
        }),
      );
      return;
    }

    const loadedFixture = loadSetupFixtureById(fixtureId);
    if (!loadedFixture) {
      redirectTo(
        res,
        buildRedirectUrl({
          query: context,
          flashType: "error",
          flashMessage: `fixture setup 不存在或格式非法: ${fixtureId}`,
        }),
      );
      return;
    }

    const route = loadedFixture.fixture.route;
    if (!route) {
      redirectTo(
        res,
        buildRedirectUrl({
          query: context,
          flashType: "error",
          flashMessage: `fixture setup 缺少 route 定义，无法自动绑定: ${fixtureId}`,
        }),
      );
      return;
    }

    const bootstrapResult = await bootstrapFixtureRoute({
      client,
      fixtureId,
      namespace,
      route,
    });
    if (!bootstrapResult.ok) {
      redirectTo(
        res,
        buildRedirectUrl({
          query: context,
          flashType: "error",
          flashMessage:
            `fixture setup 自动发布失败（${bootstrapResult.step}）: ${bootstrapResult.error}`,
        }),
      );
      return;
    }

    autoRouteSummary = {
      publish_id: bootstrapResult.summary.publish_id,
      model_id: bootstrapResult.summary.model_id,
      model_version: bootstrapResult.summary.model_version,
      tenant_id: bootstrapResult.summary.tenant_id,
      environment: bootstrapResult.summary.environment,
    };

    parsedPayload = {
      namespace,
      model_routes: [bootstrapResult.route],
      objects: loadedFixture.fixture.objects.map((item) => ({
        object_id: item.object_id,
        object_type: item.object_type,
        sensitivity: item.sensitivity,
        owner_ref: item.owner_ref,
        labels: item.labels,
      })),
      relation_events: loadedFixture.fixture.relation_events.map((item) => ({
        from: item.from,
        to: item.to,
        relation_type: item.relation_type,
        operation: item.operation,
        scope: item.scope,
        source: item.source,
      })),
    };
  }

  const applyResult = await applyParsedInstancePayload({
    client,
    namespaceInput: namespace,
    parsed: parsedPayload,
  });
  if (!applyResult.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `fixture setup 失败（${applyResult.step}）: ${applyResult.error}`,
      }),
    );
    return;
  }

  context.namespace = applyResult.targetNamespace;
  const autoRouteMessage = autoRouteSummary
    ? `；publish=${autoRouteSummary.publish_id}；route=${autoRouteSummary.tenant_id}/${autoRouteSummary.environment} -> ${autoRouteSummary.model_id}${autoRouteSummary.model_version ? `@${autoRouteSummary.model_version}` : ""}`
    : "";
  if (fixtureId && fixtureId.length > 0) {
    const executionPlan = loadExecutionPlanFromFixtureId(fixtureId);
    if (executionPlan) {
      namespaceExecutionPlanStore.set(applyResult.targetNamespace, executionPlan);
    }
  } else {
    namespaceExecutionPlanStore.delete(applyResult.targetNamespace);
  }
  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage:
        `fixture setup 执行成功: ${fixtureId ?? "custom"}` +
        `（routes=${applyResult.modelRouteCount}, objects=${applyResult.objectCount}, relations=${applyResult.relationCount}${autoRouteMessage}）`,
    }),
  );
}

async function handleControlInstanceJsonApplyAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const namespaceInput = form.get("namespace")?.trim();
  const instanceJson = form.get("instance_json")?.trim();

  if (!namespaceInput || !instanceJson) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage:
          "instance_json 参数缺失：namespace/instance_json 必填",
      }),
    );
    return;
  }

  const parsed = parseInstanceJsonPayload(instanceJson);
  if (!parsed.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: parsed.error,
      }),
    );
    return;
  }

  const applyResult = await applyParsedInstancePayload({
    client,
    namespaceInput,
    parsed: parsed.data,
  });
  if (!applyResult.ok) {
    const stepLabel =
      applyResult.step === "relation_events"
        ? "relation_events"
        : applyResult.step;
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `instance_json 写入失败（${stepLabel}）: ${applyResult.error}`,
      }),
    );
    return;
  }

  context.namespace = applyResult.targetNamespace;
  namespaceExecutionPlanStore.delete(applyResult.targetNamespace);

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage:
        "instance_json 更新成功" +
        `（routes=${applyResult.modelRouteCount}, objects=${applyResult.objectCount}, relations=${applyResult.relationCount}）`,
    }),
  );
}

async function handleExpectationRunAction(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const form = await readFormBody(req);
  const context = parseContextFromForm(form);

  const namespace = form.get("namespace")?.trim();
  const tenantId = form.get("tenant_id")?.trim();
  const environment = form.get("environment")?.trim();
  const fixtureId = form.get("fixture_id")?.trim();
  const expectationJson = form.get("expectation_json")?.trim();
  const expectationFileName = form.get("expectation_file_name")?.trim();

  if (!namespace || !expectationJson) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage:
          "expectation 演练参数缺失：namespace/expectation_json 必填",
      }),
    );
    return;
  }

  const result = await runExpectationSimulation({
    client,
    namespace,
    tenant_id: tenantId && tenantId.length > 0 ? tenantId : undefined,
    environment: environment && environment.length > 0 ? environment : undefined,
    fixture_id: fixtureId && fixtureId.length > 0 ? fixtureId : undefined,
    execution_plan: namespaceExecutionPlanStore.get(namespace),
    expectation_json: expectationJson,
    expectation_file_name:
      expectationFileName && expectationFileName.length > 0
        ? expectationFileName
        : undefined,
  });

  context.namespace = namespace;
  context.fixture_id = fixtureId && fixtureId.length > 0 ? fixtureId : context.fixture_id;

  if (!result.ok) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: `expectation 演练失败: ${result.error}`,
      }),
    );
    return;
  }

  expectationRunStore.set(result.report.run_id, result.report);
  context.expectation_run_id = result.report.run_id;

  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: result.report.summary.failed_count > 0 ? "error" : "success",
      flashMessage:
        `expectation 演练完成: run=${result.report.run_id}` +
        `，passed=${result.report.summary.passed_count}` +
        `，failed=${result.report.summary.failed_count}` +
        `，skipped=${result.report.summary.skipped_count}`,
    }),
  );
}

export interface StartConsoleServerOptions {
  port?: number;
  apiBaseUrl?: string;
}

export async function startConsoleServer(
  options: StartConsoleServerOptions = {},
): Promise<void> {
  const port = options.port ?? 3020;
  const apiBaseUrl =
    options.apiBaseUrl ??
    process.env.ACL_API_BASE_URL ??
    "http://127.0.0.1:3010";
  const client = new AclApiClient(apiBaseUrl);

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const inputUrl = new URL(req.url ?? "/", "http://127.0.0.1");

    if (method === "GET") {
      if (inputUrl.pathname === "/assets/global.css") {
        try {
          const css = await loadGlobalCss();
          sendCss(res, css);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "load css failed";
          sendJson(res, 500, {
            code: "INTERNAL_ERROR",
            message,
          });
        }
        return;
      }

      if (inputUrl.pathname === "/assets/dashboard-tabs.js") {
        try {
          const script = await loadDashboardTabsScript();
          sendJs(res, script);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "load script failed";
          sendJson(res, 500, {
            code: "INTERNAL_ERROR",
            message,
          });
        }
        return;
      }

      if (inputUrl.pathname === "/assets/echarts.min.js") {
        try {
          const script = await loadEchartsScript();
          sendJs(res, script);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "load echarts failed";
          sendJson(res, 500, {
            code: "INTERNAL_ERROR",
            message,
          });
        }
        return;
      }

      if (inputUrl.pathname === "/assets/vanilla-jsoneditor.js") {
        try {
          const script = await loadVanillaJsonEditorScript();
          sendJs(res, script);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "load vanilla jsoneditor failed";
          sendJson(res, 500, {
            code: "INTERNAL_ERROR",
            message,
          });
        }
        return;
      }

      if (inputUrl.pathname === "/healthz") {
        sendJson(res, 200, {
          service: "acl-console",
          status: "ok",
          api_base_url: client.getBaseUrl(),
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (inputUrl.pathname === "/") {
        try {
          await handleIndex(req, res, client);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "render failed";
          sendJson(res, 500, {
            code: "INTERNAL_ERROR",
            message,
          });
        }
        return;
      }

      notFound(res);
      return;
    }

    if (method === "POST") {
      try {
        if (inputUrl.pathname === "/actions/publish/submit") {
          await handlePublishSubmitAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/simulation/generate") {
          await handleSimulationGenerateAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/control/object/upsert") {
          await handleControlObjectUpsertAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/control/object/delete") {
          await handleControlObjectDeleteAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/control/relation/event") {
          await handleControlRelationEventAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/control/model-route/upsert") {
          await handleModelRouteUpsertAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/control/setup/apply") {
          await handleControlSetupFixtureApplyAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/control/instance/json/apply") {
          await handleControlInstanceJsonApplyAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/control/expectations/run") {
          await handleExpectationRunAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/review") {
          await handleReviewAction(req, res, client);
          return;
        }

        if (inputUrl.pathname === "/actions/activate") {
          await handleActivateAction(req, res, client);
          return;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "action failed";
        sendJson(res, 500, {
          code: "INTERNAL_ERROR",
          message,
        });
        return;
      }

      notFound(res);
      return;
    }

    methodNotAllowed(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve());
  });
}
