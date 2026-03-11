import type {
  ApiResult,
  ConsoleQuery,
  ConsoleTab,
  ConsoleWidget,
  ConsolePageViewModel,
  PublishRequestRecord,
} from "../types";

interface TabMeta {
  id: ConsoleTab;
  label: string;
}

interface WidgetMeta {
  id: ConsoleWidget;
  label: string;
  description: string;
}

export const TAB_ITEMS: TabMeta[] = [
  { id: "workflow", label: "发布流程" },
  { id: "simulation", label: "影响模拟" },
  { id: "relations", label: "关系回放" },
  { id: "control", label: "控制面维护" },
  { id: "components", label: "组件索引" },
];

export const WIDGET_ITEMS: WidgetMeta[] = [
  { id: "publish_list", label: "发布请求", description: "发布筛选与请求列表" },
  {
    id: "publish_detail",
    label: "发布详情",
    description: "发布详情与复核/激活",
  },
  {
    id: "decision_detail",
    label: "决策回放",
    description: "决策证据结构化回放",
  },
  { id: "simulation", label: "影响面模拟", description: "模拟摘要与变化矩阵" },
  { id: "matrix", label: "权限矩阵", description: "主体-客体变更矩阵与钻取" },
  { id: "relation", label: "关系图视图", description: "关系边与 trace 链路" },
  {
    id: "control",
    label: "控制面总览",
    description: "目录/对象/关系维护与审计",
  },
];

export type QueryFieldName = keyof ConsoleQuery;

export const QUERY_FIELD_ORDER: QueryFieldName[] = [
  "status",
  "profile",
  "tab",
  "widget",
  "detail_mode",
  "fixture_id",
  "expectation_run_id",
  "limit",
  "offset",
  "publish_id",
  "decision_id",
  "simulation_id",
  "namespace",
  "cell_key",
];

export function readQueryFieldValue(
  query: ConsoleQuery,
  name: QueryFieldName,
): string | undefined {
  const value = query[name];
  if (value === undefined) {
    return undefined;
  }
  return String(value);
}

export function renderScopedHiddenContextFields(
  viewModel: ConsolePageViewModel,
  fieldNames: QueryFieldName[],
): string {
  return fieldNames
    .map((name) => [name, readQueryFieldValue(viewModel.query, name)] as const)
    .flatMap(([name, value]) => {
      if (!value || value.length === 0) {
        return [];
      }

      return [
        `<input type="hidden" name="${name}" value="${escapeHtml(value)}" />`,
      ];
    })
    .join("");
}

export function buildScopedQueryHref(
  viewModel: ConsolePageViewModel,
  fieldNames: QueryFieldName[],
  updates: Partial<Record<QueryFieldName, string | undefined>>,
): string {
  const params = new URLSearchParams();

  fieldNames.forEach((name) => {
    const value = readQueryFieldValue(viewModel.query, name);
    if (value && value.length > 0) {
      params.set(name, value);
    }
  });

  Object.entries(updates).forEach(([name, value]) => {
    if (!value || value.length === 0) {
      params.delete(name);
      return;
    }
    params.set(name, value);
  });

  const queryString = params.toString();
  return queryString.length > 0 ? `/?${queryString}` : "/";
}

export function getScopedFieldNamesForTab(tab: ConsoleTab): QueryFieldName[] {
  if (tab === "workflow") {
    return [
      "status",
      "profile",
      "detail_mode",
      "limit",
      "offset",
      "publish_id",
      "namespace",
    ];
  }

  if (tab === "simulation") {
    return [
      "profile",
      "detail_mode",
      "publish_id",
      "simulation_id",
      "namespace",
      "cell_key",
    ];
  }

  if (tab === "relations") {
    return ["detail_mode", "decision_id", "namespace"];
  }

  if (tab === "control") {
    return ["detail_mode", "fixture_id", "expectation_run_id", "namespace"];
  }

  return ["namespace"];
}

export function getScopedFieldNamesForWidget(
  widget: ConsoleWidget,
): QueryFieldName[] {
  if (widget === "publish_list") {
    return ["status", "profile", "detail_mode", "limit", "offset", "namespace"];
  }

  if (widget === "publish_detail") {
    return ["detail_mode", "publish_id", "namespace"];
  }

  if (widget === "decision_detail") {
    return ["detail_mode", "decision_id", "namespace"];
  }

  if (widget === "simulation") {
    return [
      "profile",
      "detail_mode",
      "publish_id",
      "simulation_id",
      "namespace",
    ];
  }

  if (widget === "matrix") {
    return [
      "profile",
      "detail_mode",
      "publish_id",
      "simulation_id",
      "namespace",
      "cell_key",
    ];
  }

  if (widget === "relation") {
    return ["detail_mode", "decision_id", "namespace"];
  }

  return ["detail_mode", "fixture_id", "expectation_run_id", "namespace"];
}

export function formatTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function renderHiddenContextFields(
  viewModel: ConsolePageViewModel,
  omitNames: string[] = [],
): string {
  const omitSet = new Set<QueryFieldName>(omitNames as QueryFieldName[]);
  const fieldNames = QUERY_FIELD_ORDER.filter((name) => !omitSet.has(name));
  return renderScopedHiddenContextFields(viewModel, fieldNames);
}

export function renderFlash(viewModel: ConsolePageViewModel): string {
  if (!viewModel.action_flash) {
    return "";
  }

  const isSuccess = viewModel.action_flash.type === "success";
  const title = isSuccess ? "系统通知 · 操作成功" : "系统通知 · 操作失败";
  const role = isSuccess ? "status" : "alert";
  const live = isSuccess ? "polite" : "assertive";
  const icon = isSuccess ? "✓" : "!";

  return (
    `<section class="system-notice-layer" aria-live="${live}" aria-atomic="true">` +
    `<div class="system-notice system-notice-${viewModel.action_flash.type}" role="${role}">` +
    `<div class="system-notice-icon" aria-hidden="true">${icon}</div>` +
    `<div class="system-notice-body">` +
    `<p class="system-notice-title">${title}</p>` +
    `<p class="system-notice-message">${escapeHtml(viewModel.action_flash.message)}</p>` +
    `</div>` +
    `<button type="button" class="system-notice-close" aria-label="关闭通知" data-system-notice-close="true">×</button>` +
    `</div>` +
    `</section>`
  );
}

export function renderApiResultError<T>(result: ApiResult<T>): string {
  if (result.ok) {
    return "";
  }

  return (
    `<div class="card error">` +
    `<h3>数据加载失败</h3>` +
    `<p>${escapeHtml(result.error)}</p>` +
    `${result.status ? `<p class="muted">HTTP ${result.status}</p>` : ""}` +
    `</div>`
  );
}

export function renderRawJsonPanel(data: unknown): string {
  return `<section class="raw-json-panel"><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></section>`;
}

export function renderJsonToggleSwitch(): string {
  return (
    `<div class="json-toggle" data-json-toggle role="tablist" aria-label="卡片详情视图切换">` +
    `<button type="button" class="json-toggle-btn active" data-mode="visual" aria-pressed="true">图</button>` +
    `<button type="button" class="json-toggle-btn" data-mode="raw" aria-pressed="false">JSON</button>` +
    `</div>`
  );
}

export function renderModelEditorToggleSwitch(): string {
  return (
    `<div class="json-toggle" data-json-toggle role="tablist" aria-label="模型编辑视图切换">` +
    `<button type="button" class="json-toggle-btn active" data-mode="visual" aria-pressed="true">表单</button>` +
    `<button type="button" class="json-toggle-btn" data-mode="graph" aria-pressed="false">Graph</button>` +
    `<button type="button" class="json-toggle-btn" data-mode="raw" aria-pressed="false">JSON</button>` +
    `</div>`
  );
}

export function renderRelationReplayToggleSwitch(): string {
  return (
    `<div class="json-toggle" data-json-toggle role="tablist" aria-label="运行态关系视图切换">` +
    `<button type="button" class="json-toggle-btn active" data-mode="visual" aria-pressed="true">表格</button>` +
    `<button type="button" class="json-toggle-btn" data-mode="graph" aria-pressed="false">Graph</button>` +
    `</div>`
  );
}

export function renderSwitchableJsonView(
  visualContent: string,
  rawContent: string,
): string {
  return (
    `<section class="json-switchable" data-json-switchable>` +
    `<div class="json-view" data-json-view="visual">${visualContent}</div>` +
    `<div class="json-view" data-json-view="raw" hidden>${rawContent}</div>` +
    `</section>`
  );
}

export function pickStringArray(
  payload: Record<string, unknown>,
  key: string,
): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function renderInlineList(values: string[]): string {
  if (values.length === 0) {
    return '<span class="muted">(empty)</span>';
  }

  return values
    .map((value) => `<span class="chip">${escapeHtml(value)}</span>`)
    .join(" ");
}

export function readPathNumber(
  source: Record<string, unknown>,
  path: string[],
  fallback = 0,
): number {
  let cursor: unknown = source;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) {
      return fallback;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "number" ? cursor : fallback;
}

export function readPathString(
  source: Record<string, unknown>,
  path: string[],
  fallback = "",
): string {
  let cursor: unknown = source;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) {
      return fallback;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" ? cursor : fallback;
}

export function buildQueryHref(
  viewModel: ConsolePageViewModel,
  updates: Record<string, string | undefined>,
): string {
  return buildScopedQueryHref(
    viewModel,
    QUERY_FIELD_ORDER,
    updates as Partial<Record<QueryFieldName, string | undefined>>,
  );
}

export function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return Array.from(
    new Set(
      input
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

export function getModelSnapshotFromPublish(
  record: PublishRequestRecord,
): Record<string, unknown> | null {
  const payload = asRecord(record.payload);
  return asRecord(payload?.model_snapshot);
}

export function getModelMetaFromSnapshot(snapshot: unknown): {
  model_id: string;
  tenant_id: string;
  version: string;
} | null {
  const snapshotRecord = asRecord(snapshot);
  if (!snapshotRecord) {
    return null;
  }

  const modelMeta = asRecord(snapshotRecord.model_meta);
  if (!modelMeta) {
    return null;
  }

  const modelId =
    typeof modelMeta.model_id === "string" ? modelMeta.model_id.trim() : "";
  const tenantId =
    typeof modelMeta.tenant_id === "string" ? modelMeta.tenant_id.trim() : "";
  const version =
    typeof modelMeta.version === "string" ? modelMeta.version.trim() : "";

  if (modelId.length === 0 || tenantId.length === 0 || version.length === 0) {
    return null;
  }

  return {
    model_id: modelId,
    tenant_id: tenantId,
    version,
  };
}

export function pickPublishRecordForOverview(
  viewModel: ConsolePageViewModel,
): PublishRequestRecord | null {
  if (viewModel.publish_detail?.ok) {
    const snapshot = getModelSnapshotFromPublish(viewModel.publish_detail.data);
    if (snapshot) {
      return viewModel.publish_detail.data;
    }
  }

  if (!viewModel.publish_list.ok) {
    return null;
  }

  const withSnapshot = viewModel.publish_list.data.items.filter(
    (item) => getModelSnapshotFromPublish(item) !== null,
  );
  if (withSnapshot.length === 0) {
    return null;
  }

  const published = withSnapshot.find((item) => item.status === "published");
  return published ?? withSnapshot[0] ?? null;
}

export interface PublishedModelOverviewMetrics {
  publish_id: string;
  model_id: string;
  tenant_id: string;
  model_version: string;
  subject_types: number;
  categories: number;
  object_types: number;
  relation_types: number;
  rules: number;
}

export interface RuntimeRouteOverview {
  tenant_label: string;
  environment_label: string;
  route_count: number;
  route_items: Array<{
    tenant_id: string;
    environment: string;
    model_id: string;
    model_version: string;
    publish_id: string;
  }>;
}

export function collectRuntimeRouteOverview(
  viewModel: ConsolePageViewModel,
): RuntimeRouteOverview {
  if (!viewModel.model_routes?.ok) {
    return {
      tenant_label: "-",
      environment_label: "-",
      route_count: 0,
      route_items: [],
    };
  }

  const routeItems = viewModel.model_routes.data.items.map((item) => ({
    tenant_id: item.tenant_id.trim(),
    environment: item.environment.trim(),
    model_id: item.model_id.trim(),
    model_version: item.model_version?.trim() || "latest published",
    publish_id: item.publish_id?.trim() || "latest published",
  }));

  const tenantIds = Array.from(
    new Set(
      routeItems
        .map((item) => item.tenant_id)
        .filter((item) => item.length > 0),
    ),
  );
  const environments = Array.from(
    new Set(
      routeItems
        .map((item) => item.environment)
        .filter((item) => item.length > 0),
    ),
  );

  return {
    tenant_label:
      tenantIds.length === 0
        ? "-"
        : tenantIds.length === 1
          ? tenantIds[0]
          : `${tenantIds.length} tenants`,
    environment_label:
      environments.length === 0
        ? "-"
        : environments.length === 1
          ? environments[0]
          : environments.join(", "),
    route_count: routeItems.length,
    route_items: routeItems,
  };
}

export function buildNamespaceOptions(
  viewModel: ConsolePageViewModel,
  selectedNamespace?: string,
): { value: string; label: string }[] {
  const options = new Map<string, string>();
  const activeNamespace =
    selectedNamespace?.trim() ?? viewModel.query.namespace?.trim();

  if (activeNamespace) {
    options.set(activeNamespace, `${activeNamespace} | 当前上下文`);
  }

  if (viewModel.control_namespaces?.ok) {
    viewModel.control_namespaces.data.items.forEach((namespace) => {
      if (namespace && !options.has(namespace)) {
        options.set(namespace, namespace);
      }
    });
  }

  return Array.from(options.entries()).map(([value, label]) => ({
    value,
    label,
  }));
}

export function buildNamespaceValues(
  viewModel: ConsolePageViewModel,
  selectedNamespace?: string,
): string[] {
  const values = new Set<string>();
  const activeNamespace =
    selectedNamespace?.trim() ?? viewModel.query.namespace?.trim();

  if (activeNamespace) {
    values.add(activeNamespace);
  }

  if (viewModel.control_namespaces?.ok) {
    viewModel.control_namespaces.data.items.forEach((namespace) => {
      if (namespace) {
        values.add(namespace);
      }
    });
  }

  return Array.from(values);
}

export function hasRuntimeNamespaceOptions(viewModel: ConsolePageViewModel): boolean {
  return Boolean(
    viewModel.control_namespaces?.ok &&
      viewModel.control_namespaces.data.items.length > 0,
  );
}

export function renderNamespaceInputWithDatalist(input: {
  viewModel: ConsolePageViewModel;
  selectedValue?: string;
  placeholder: string;
  required?: boolean;
  datalistId: string;
}): string {
  const values = buildNamespaceValues(input.viewModel, input.selectedValue);
  const requiredAttr = input.required ? "required" : "";

  if (values.length === 0) {
    return `<input type="text" name="namespace" value="${escapeHtml(input.selectedValue ?? "tenant_a.crm")}" placeholder="${escapeHtml(input.placeholder)}" ${requiredAttr} />`;
  }

  return (
    `<input type="text" name="namespace" value="${escapeHtml(input.selectedValue ?? "")}" list="${escapeHtml(input.datalistId)}" placeholder="${escapeHtml(input.placeholder)}" ${requiredAttr} />` +
    `<datalist id="${escapeHtml(input.datalistId)}">` +
    values
      .map((value) => `<option value="${escapeHtml(value)}"></option>`)
      .join("") +
    `</datalist>`
  );
}

export function renderNamespaceSelectOrInput(input: {
  viewModel: ConsolePageViewModel;
  selectedValue?: string;
  placeholder: string;
  required?: boolean;
}): string {
  const useSelect = hasRuntimeNamespaceOptions(input.viewModel);
  const requiredAttr = input.required ? "required" : "";

  if (useSelect) {
    const namespaceOptions = buildNamespaceOptions(
      input.viewModel,
      input.selectedValue,
    );
    return (
      `<select name="namespace" ${requiredAttr}>` +
      renderSelectOptions({
        items: namespaceOptions,
        selectedValue: input.selectedValue,
        placeholder: "请选择命名空间",
      }) +
      `</select>`
    );
  }

  return `<input type="text" name="namespace" value="${escapeHtml(input.selectedValue ?? "tenant_a.crm")}" placeholder="${escapeHtml(input.placeholder)}" ${requiredAttr} />`;
}

export function renderSelectOptions(input: {
  items: { value: string; label: string }[];
  selectedValue?: string;
  placeholder: string;
}): string {
  return (
    `<option value="">${escapeHtml(input.placeholder)}</option>` +
    input.items
      .map(
        (item) =>
          `<option value="${escapeHtml(item.value)}" ${item.value === input.selectedValue ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
      )
      .join("")
  );
}

export function renderNamespaceStaticField(namespace: string, hint?: string): string {
  const hintText = hint
    ? `<span class="field-static-hint">${escapeHtml(hint)}</span>`
    : "";
  return (
    `<div class="field-static">` +
    `<span class="field-static-label">命名空间 Namespace</span>` +
    `<span class="field-static-value">${escapeHtml(namespace)}</span>` +
    hintText +
    `</div>`
  );
}
