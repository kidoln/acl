import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { AclApiClient } from "./acl-api-client";
import { renderConsolePage } from "./html";
import { loadSetupFixtureById } from "./setup-fixtures";
import type {
  ConsoleQuery,
  ConsoleTab,
  ConsoleWidget,
  DetailMode,
  GateProfile,
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

  return {
    status,
    profile,
    tab,
    widget,
    detail_mode: detailMode,
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

async function handleIndex(
  req: IncomingMessage,
  res: ServerResponse,
  client: AclApiClient,
): Promise<void> {
  const inputUrl = new URL(req.url ?? "/", "http://127.0.0.1");
  const query = parseQuery(inputUrl);
  const namespace = query.namespace ?? "tenant_a.crm";

  const publishListPromise = client.listPublishRequests(query);
  const publishDetailPromise = query.publish_id
    ? client.getPublishRequest(query.publish_id)
    : undefined;
  const decisionDetailPromise = query.decision_id
    ? client.getDecision(query.decision_id)
    : undefined;
  const simulationListPromise = client.listSimulationReports({
    publish_id: query.publish_id,
    profile: query.profile,
    limit: 20,
    offset: 0,
  });
  const controlObjectsPromise = client.listControlObjects({
    namespace,
    limit: 20,
    offset: 0,
  });
  const controlRelationsPromise = client.listControlRelations({
    namespace,
    limit: 20,
    offset: 0,
  });
  const controlAuditsPromise = client.listControlAudits({
    namespace,
    limit: 20,
    offset: 0,
  });
  const modelRoutesPromise = client.listModelRoutes({
    namespace,
    limit: 20,
    offset: 0,
  });

  const [
    publishList,
    publishDetail,
    decisionDetail,
    simulationList,
    controlObjects,
    controlRelations,
    controlAudits,
    modelRoutes,
  ] = await Promise.all([
    publishListPromise,
    publishDetailPromise,
    decisionDetailPromise,
    simulationListPromise,
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
    publish_detail: publishDetail,
    decision_detail: decisionDetail,
    simulation_list: simulationList,
    simulation_detail: simulationDetail,
    control_objects: controlObjects,
    control_relations: controlRelations,
    control_audits: controlAudits,
    model_routes: modelRoutes,
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

  if (!namespace || !fixtureId) {
    redirectTo(
      res,
      buildRedirectUrl({
        query: context,
        flashType: "error",
        flashMessage: "fixture setup 参数缺失：namespace/fixture_id 必填",
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

  const {
    id,
    fixture: {
      objects,
      relation_events: relationEvents,
    },
  } = loadedFixture;

  if (objects.length > 0) {
    const objectResult = await client.upsertControlObjects({
      namespace,
      objects: objects.map((item) => ({
        object_id: item.object_id,
        object_type: item.object_type,
        sensitivity: item.sensitivity,
        owner_ref: item.owner_ref,
        labels: item.labels,
      })),
    });

    if (!objectResult.ok) {
      redirectTo(
        res,
        buildRedirectUrl({
          query: context,
          flashType: "error",
          flashMessage: `fixture setup 失败（objects）: ${objectResult.error}`,
        }),
      );
      return;
    }
  }

  if (relationEvents.length > 0) {
    const relationResult = await client.syncControlRelations({
      namespace,
      events: relationEvents.map((item) => ({
        from: item.from,
        to: item.to,
        relation_type: item.relation_type,
        operation: item.operation,
        scope: item.scope,
        source: item.source,
      })),
    });

    if (!relationResult.ok) {
      redirectTo(
        res,
        buildRedirectUrl({
          query: context,
          flashType: "error",
          flashMessage: `fixture setup 失败（relations）: ${relationResult.error}`,
        }),
      );
      return;
    }
  }

  context.namespace = namespace;
  redirectTo(
    res,
    buildRedirectUrl({
      query: context,
      flashType: "success",
      flashMessage:
        `fixture setup 执行成功: ${id}` +
        `（objects=${objects.length}, relations=${relationEvents.length}）`,
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

        if (inputUrl.pathname === "/actions/control/object/upsert") {
          await handleControlObjectUpsertAction(req, res, client);
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
