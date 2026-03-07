import fs from "node:fs";
import path from "node:path";
import {
  listExpectationFixtureOptions,
  listSetupFixtureOptions,
  loadSetupFixtureById,
  type ControlSetupFixture,
} from "./setup-fixtures";
import type {
  ApiResult,
  ConsoleQuery,
  ConsoleTab,
  ConsoleWidget,
  ConsolePageViewModel,
  ControlObjectListResponse,
  DecisionRecordResponse,
  ExpectationRunCaseResult,
  ExpectationRunReport,
  PublishRequestListResponse,
  PublishRequestRecord,
} from "./types";

interface TabMeta {
  id: ConsoleTab;
  label: string;
}

interface WidgetMeta {
  id: ConsoleWidget;
  label: string;
  description: string;
}

const TAB_ITEMS: TabMeta[] = [
  { id: "workflow", label: "发布流程" },
  { id: "simulation", label: "影响模拟" },
  { id: "relations", label: "关系回放" },
  { id: "control", label: "控制面维护" },
  { id: "components", label: "组件索引" },
];

const WIDGET_ITEMS: WidgetMeta[] = [
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

type QueryFieldName = keyof ConsoleQuery;

const QUERY_FIELD_ORDER: QueryFieldName[] = [
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

function readQueryFieldValue(
  query: ConsoleQuery,
  name: QueryFieldName,
): string | undefined {
  const value = query[name];
  if (value === undefined) {
    return undefined;
  }
  return String(value);
}

function renderScopedHiddenContextFields(
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

function buildScopedQueryHref(
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

function getScopedFieldNamesForTab(tab: ConsoleTab): QueryFieldName[] {
  if (tab === "workflow") {
    return ["status", "profile", "detail_mode", "limit", "offset", "publish_id", "namespace"];
  }

  if (tab === "simulation") {
    return ["profile", "detail_mode", "publish_id", "simulation_id", "namespace", "cell_key"];
  }

  if (tab === "relations") {
    return ["detail_mode", "decision_id", "namespace"];
  }

  if (tab === "control") {
    return ["detail_mode", "fixture_id", "expectation_run_id", "namespace"];
  }

  return ["namespace"];
}

function getScopedFieldNamesForWidget(
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
    return ["profile", "detail_mode", "publish_id", "simulation_id", "namespace"];
  }

  if (widget === "matrix") {
    return ["profile", "detail_mode", "publish_id", "simulation_id", "namespace", "cell_key"];
  }

  if (widget === "relation") {
    return ["detail_mode", "decision_id", "namespace"];
  }

  return ["detail_mode", "fixture_id", "expectation_run_id", "namespace"];
}

function renderWidgetRows(viewModel: ConsolePageViewModel): string {
  return WIDGET_ITEMS.map((item) => {
    const embedHref = buildScopedQueryHref(
      viewModel,
      getScopedFieldNamesForWidget(item.id),
      {
        widget: item.id,
        tab: undefined,
      },
    );
    return (
      `<tr>` +
      `<td>${escapeHtml(item.id)}</td>` +
      `<td>${escapeHtml(item.label)}</td>` +
      `<td>${escapeHtml(item.description)}</td>` +
      `<td><a href="${embedHref}" target="_blank" rel="noreferrer">打开嵌入视图</a></td>` +
      `</tr>`
    );
  }).join("");
}

function formatTime(value: string): string {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function renderHiddenContextFields(
  viewModel: ConsolePageViewModel,
  omitNames: string[] = [],
): string {
  const omitSet = new Set<QueryFieldName>(omitNames as QueryFieldName[]);
  const fieldNames = QUERY_FIELD_ORDER.filter((name) => !omitSet.has(name));
  return renderScopedHiddenContextFields(viewModel, fieldNames);
}

function renderFlash(viewModel: ConsolePageViewModel): string {
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

function renderApiResultError<T>(result: ApiResult<T>): string {
  if (result.ok) {
    return "";
  }

  return (
    `<div class=\"card error\">` +
    `<h3>数据加载失败</h3>` +
    `<p>${escapeHtml(result.error)}</p>` +
    `${result.status ? `<p class=\"muted\">HTTP ${result.status}</p>` : ""}` +
    `</div>`
  );
}

function renderPublishRows(
  result: ApiResult<PublishRequestListResponse>,
  viewModel: ConsolePageViewModel,
  selectedId?: string,
): string {
  if (!result.ok) {
    return "";
  }

  if (result.data.items.length === 0) {
    return '<tr><td colspan="6" class="muted">当前筛选条件下无发布请求</td></tr>';
  }

  return result.data.items
    .map((item) => {
      const selectedClass =
        selectedId === item.publish_id ? "row-selected" : "";
      const detailHref = buildScopedQueryHref(
        viewModel,
        ["status", "profile", "detail_mode", "limit", "offset", "namespace"],
        {
          tab: "workflow",
          widget: undefined,
          publish_id: item.publish_id,
          decision_id: undefined,
          simulation_id: undefined,
          cell_key: undefined,
        },
      );
      const statusClass = `status-${item.status}`;

      return (
        `<tr class=\"${selectedClass}\">` +
        `<td><a href=\"${detailHref}\">${escapeHtml(item.publish_id)}</a></td>` +
        `<td>${escapeHtml(item.profile)}</td>` +
        `<td><span class=\"status-tag ${statusClass}\">${escapeHtml(item.status)}</span></td>` +
        `<td>${escapeHtml(item.final_result)}</td>` +
        `<td>${escapeHtml(formatTime(item.updated_at))}</td>` +
        `<td>${escapeHtml(formatTime(item.created_at))}</td>` +
        `</tr>`
      );
    })
    .join("");
}

function renderReviewForm(
  record: PublishRequestRecord,
  viewModel: ConsolePageViewModel,
): string {
  const hiddenFields = renderHiddenContextFields(viewModel);

  return (
    `<form class=\"action-form\" method=\"POST\" action=\"/actions/review\">` +
    `<h4>人工复核</h4>` +
    `<input type=\"hidden\" name=\"publish_id\" value=\"${escapeHtml(record.publish_id)}\" />` +
    hiddenFields +
    `<label>决策 Decision` +
    `<select name=\"decision\">` +
    `<option value=\"approve\">approve</option>` +
    `<option value=\"reject\">reject</option>` +
    `</select></label>` +
    `<label>复核人 Reviewer<input type=\"text\" name=\"reviewer\" value=\"governance_lead\" required /></label>` +
    `<label>原因 Reason<input type=\"text\" name=\"reason\" placeholder=\"临时豁免说明\" required /></label>` +
    `<label>过期时间 Expires At (ISO 可选)<input type=\"text\" name=\"expires_at\" placeholder=\"2026-03-11T00:00:00.000Z\" /></label>` +
    `<button type=\"submit\" class=\"btn btn-primary\">提交复核</button>` +
    `</form>`
  );
}

function renderActivateForm(
  record: PublishRequestRecord,
  viewModel: ConsolePageViewModel,
): string {
  const hiddenFields = renderHiddenContextFields(viewModel);

  return (
    `<form class=\"action-form\" method=\"POST\" action=\"/actions/activate\">` +
    `<h4>激活发布</h4>` +
    `<input type=\"hidden\" name=\"publish_id\" value=\"${escapeHtml(record.publish_id)}\" />` +
    hiddenFields +
    `<label>操作人 Operator<input type=\"text\" name=\"operator\" value=\"release_bot\" required /></label>` +
    `<button type=\"submit\" class=\"btn btn-primary\">执行激活</button>` +
    `</form>`
  );
}

function renderActionPanel(
  result: ApiResult<PublishRequestRecord>,
  viewModel: ConsolePageViewModel,
): string {
  if (!result.ok) {
    return "";
  }

  if (result.data.status === "review_required") {
    return renderReviewForm(result.data, viewModel);
  }

  if (result.data.status === "approved") {
    return renderActivateForm(result.data, viewModel);
  }

  return '<p class="muted">当前状态无需操作，可继续查看回放和审计详情。</p>';
}

function renderPublishJourneyCard(
  record: PublishRequestRecord,
  viewModel: ConsolePageViewModel,
): string {
  const simulationHref = buildScopedQueryHref(
    viewModel,
    ["profile", "detail_mode", "publish_id", "namespace", "tab", "widget"],
    {
      tab: "simulation",
      widget: undefined,
      publish_id: record.publish_id,
      decision_id: undefined,
      simulation_id: undefined,
      cell_key: undefined,
    },
  );
  const workflowHref = buildScopedQueryHref(
    viewModel,
    ["status", "profile", "detail_mode", "limit", "offset", "namespace", "tab"],
    {
      tab: "workflow",
      publish_id: record.publish_id,
      decision_id: undefined,
      simulation_id: undefined,
      cell_key: undefined,
      widget: undefined,
    },
  );

  const nextStepText =
    record.status === "review_required"
      ? "建议先去“影响模拟”确认风险，再回来做人工复核。"
      : record.status === "approved"
        ? "当前已满足激活前置条件，建议先复看一次影响模拟，再执行激活。"
        : record.status === "published"
          ? "当前发布已生效；如需排查线上争议，请切到“关系回放”查看 decision trace。"
          : "先确认这条发布单状态，再决定是否进入模拟、复核或回退模型。";

  return (
    `<section class="story-card story-card-accent story-card-next">` +
    `<h4>下一步建议</h4>` +
    `<p class="muted">${escapeHtml(nextStepText)}</p>` +
    `<div class="toolbar">` +
    `<a class="btn btn-secondary" href="${simulationHref}">去做风险评估</a>` +
    `<a class="btn btn-secondary" href="${workflowHref}">回到这条发布单</a>` +
    `</div>` +
    `</section>`
  );
}

function renderRawJsonPanel(data: unknown): string {
  return `<section class="raw-json-panel"><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></section>`;
}

function renderJsonToggleSwitch(): string {
  return (
    `<div class="json-toggle" data-json-toggle role="tablist" aria-label="卡片详情视图切换">` +
    `<button type="button" class="json-toggle-btn active" data-mode="visual" aria-pressed="true">图</button>` +
    `<button type="button" class="json-toggle-btn" data-mode="raw" aria-pressed="false">JSON</button>` +
    `</div>`
  );
}

function renderModelEditorToggleSwitch(): string {
  return (
    `<div class="json-toggle" data-json-toggle role="tablist" aria-label="模型编辑视图切换">` +
    `<button type="button" class="json-toggle-btn active" data-mode="visual" aria-pressed="true">表单</button>` +
    `<button type="button" class="json-toggle-btn" data-mode="graph" aria-pressed="false">Graph</button>` +
    `<button type="button" class="json-toggle-btn" data-mode="raw" aria-pressed="false">JSON</button>` +
    `</div>`
  );
}

function renderRelationReplayToggleSwitch(): string {
  return (
    `<div class="json-toggle" data-json-toggle role="tablist" aria-label="运行态关系视图切换">` +
    `<button type="button" class="json-toggle-btn active" data-mode="visual" aria-pressed="true">表格</button>` +
    `<button type="button" class="json-toggle-btn" data-mode="graph" aria-pressed="false">Graph</button>` +
    `</div>`
  );
}

function renderSwitchableJsonView(
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

function renderPublishDetailVisual(
  record: PublishRequestRecord,
  viewModel: ConsolePageViewModel,
): string {
  const payload = asRecord(record.payload) ?? {};
  const gateResult = asRecord(payload.gate_result);
  const gateItems = Array.isArray(gateResult?.gates)
    ? gateResult.gates.filter(
        (item): item is Record<string, unknown> => asRecord(item) !== null,
      )
    : [];
  const failedGateItems = gateItems.filter((item) => item.passed !== true);

  const reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
  const exemptions = Array.isArray(payload.exemptions)
    ? payload.exemptions
    : [];
  const activation = asRecord(payload.activation);
  const activationTime =
    typeof activation?.activated_at === "string"
      ? formatTime(activation.activated_at)
      : "-";
  const activationOperator =
    typeof activation?.operator === "string" ? activation.operator : "-";

  const modelSnapshot = asRecord(payload.model_snapshot);
  const modelMeta = asRecord(modelSnapshot?.model_meta);
  const modelPolicies = asRecord(modelSnapshot?.policies);
  const ruleCount = Array.isArray(modelPolicies?.rules)
    ? modelPolicies.rules.length
    : 0;
  const modelId =
    typeof modelMeta?.model_id === "string" ? modelMeta.model_id : "-";
  const modelVersion =
    typeof modelMeta?.version === "string" ? modelMeta.version : "-";

  const gateRows =
    failedGateItems.length === 0
      ? '<tr><td colspan="4" class="muted">无失败门禁项</td></tr>'
      : failedGateItems
          .map(
            (item) =>
              `<tr><td>${escapeHtml(readPathString(item, ["level"], "-"))}</td><td>${escapeHtml(readPathString(item, ["code"], "-"))}</td><td>${escapeHtml(readPathString(item, ["rule_id"], "-"))}</td><td>${escapeHtml(readPathString(item, ["decision"], "-"))}</td></tr>`,
          )
          .join("");

  return (
    `${renderPublishJourneyCard(record, viewModel)}` +
    `<section class="decision-grid">` +
    `<div class="metric"><span>状态</span><strong>${escapeHtml(record.status)}</strong></div>` +
    `<div class="metric"><span>最终结果</span><strong>${escapeHtml(record.final_result)}</strong></div>` +
    `<div class="metric"><span>Profile</span><strong>${escapeHtml(record.profile)}</strong></div>` +
    `<div class="metric"><span>更新时间</span><strong>${escapeHtml(formatTime(record.updated_at))}</strong></div>` +
    `<div class="metric"><span>Reviews</span><strong>${reviews.length}</strong></div>` +
    `<div class="metric"><span>Exemptions</span><strong>${exemptions.length}</strong></div>` +
    `<div class="metric"><span>Gate 失败项</span><strong>${failedGateItems.length}</strong></div>` +
    `<div class="metric"><span>Activation</span><strong>${escapeHtml(activationOperator)}</strong></div>` +
    `</section>` +
    `<section class="kv-grid">` +
    `<div class="kv-item"><span>model_id</span><strong>${escapeHtml(modelId)}</strong></div>` +
    `<div class="kv-item"><span>model_version</span><strong>${escapeHtml(modelVersion)}</strong></div>` +
    `<div class="kv-item"><span>rule_count</span><strong>${ruleCount}</strong></div>` +
    `<div class="kv-item"><span>activated_at</span><strong>${escapeHtml(activationTime)}</strong></div>` +
    `</section>` +
    `<div class="table-container">` +
    `<table class="data-table">` +
    `<thead><tr><th>Level</th><th>Code</th><th>Rule ID</th><th>Decision</th></tr></thead>` +
    `<tbody>${gateRows}</tbody>` +
    `</table>` +
    `</div>`
  );
}

function renderPublishDetail(
  result: ApiResult<PublishRequestRecord> | undefined,
  viewModel: ConsolePageViewModel,
): string {
  if (!result) {
    return '<div class="card card-hover"><h3>发布详情</h3><p class="muted">请选择一条发布请求查看详情</p></div>';
  }

  if (!result.ok) {
    return renderApiResultError(result);
  }

  const actionPanel = renderActionPanel(result, viewModel);
  const visualContent = renderPublishDetailVisual(result.data, viewModel);
  const rawContent = renderRawJsonPanel(result.data);

  return (
    `<div class=\"card card-hover\">` +
    `<div class="card-head"><div class="card-head-main"><h3>发布详情</h3><p class=\"muted\">publish_id: ${escapeHtml(result.data.publish_id)}</p></div>${renderJsonToggleSwitch()}</div>` +
    `<div class=\"action-panel\">${actionPanel}</div>` +
    `${renderSwitchableJsonView(visualContent, rawContent)}` +
    `</div>`
  );
}

function pickStringArray(
  payload: Record<string, unknown>,
  key: string,
): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function renderInlineList(values: string[]): string {
  if (values.length === 0) {
    return '<span class="muted">(empty)</span>';
  }

  return values
    .map((value) => `<span class=\"chip\">${escapeHtml(value)}</span>`)
    .join(" ");
}

function renderDecisionStructured(result: DecisionRecordResponse): string {
  const payload = result.payload;
  const finalEffect =
    typeof payload.final_effect === "string" ? payload.final_effect : "unknown";
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const matchedRules = pickStringArray(payload, "matched_rules");
  const overriddenRules = pickStringArray(payload, "overridden_rules");
  const obligations = pickStringArray(payload, "obligations");
  const advice = pickStringArray(payload, "advice");

  return (
    `<section class=\"decision-grid\">` +
    `<div class=\"metric\"><span>最终效果</span><strong>${escapeHtml(finalEffect)}</strong></div>` +
    `<div class=\"metric\"><span>命中规则</span><strong>${matchedRules.length}</strong></div>` +
    `<div class=\"metric\"><span>覆盖规则</span><strong>${overriddenRules.length}</strong></div>` +
    `<div class=\"metric\"><span>发生时间</span><strong>${escapeHtml(formatTime(result.created_at))}</strong></div>` +
    `</section>` +
    `${reason ? `<p><strong>原因:</strong> ${escapeHtml(reason)}</p>` : ""}` +
    `<p><strong>命中规则:</strong> ${renderInlineList(matchedRules)}</p>` +
    `<p><strong>覆盖规则:</strong> ${renderInlineList(overriddenRules)}</p>` +
    `<p><strong>Obligations:</strong> ${renderInlineList(obligations)}</p>` +
    `<p><strong>Advice:</strong> ${renderInlineList(advice)}</p>`
  );
}

function renderDecisionDetail(
  result: ApiResult<DecisionRecordResponse> | undefined,
): string {
  if (!result) {
    return '<div class="card card-hover"><h3>决策回放</h3><p class="muted">选择 decision_id 后可查看回放证据</p></div>';
  }

  if (!result.ok) {
    return renderApiResultError(result);
  }

  const payload = asRecord(result.data.payload) ?? {};
  const request = asRecord(payload.request);
  const traces = Array.isArray(result.data.traces)
    ? result.data.traces.filter(
        (item): item is Record<string, unknown> => asRecord(item) !== null,
      )
    : [];
  const traceRows =
    traces.length === 0
      ? '<tr><td colspan="4" class="muted">暂无 trace</td></tr>'
      : traces
          .map(
            (trace) =>
              `<tr><td>${escapeHtml(readPathString(trace, ["rule_id"], "-"))}</td><td>${escapeHtml(readPathString(trace, ["status"], "-"))}</td><td>${escapeHtml(readPathString(trace, ["effect"], "-"))}</td><td>${escapeHtml(readPathString(trace, ["reason"], "-"))}</td></tr>`,
          )
          .join("");
  const visualContent =
    `${renderDecisionStructured(result.data)}` +
    `<section class="kv-grid">` +
    `<div class="kv-item"><span>subject_id</span><strong>${escapeHtml(readPathString(request ?? {}, ["subject_id"], "-"))}</strong></div>` +
    `<div class="kv-item"><span>action</span><strong>${escapeHtml(readPathString(request ?? {}, ["action"], "-"))}</strong></div>` +
    `<div class="kv-item"><span>object_id</span><strong>${escapeHtml(readPathString(request ?? {}, ["object_id"], "-"))}</strong></div>` +
    `<div class="kv-item"><span>trace_count</span><strong>${traces.length}</strong></div>` +
    `</section>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Rule</th><th>Status</th><th>Effect</th><th>Reason</th></tr></thead><tbody>${traceRows}</tbody></table></div>`;
  const rawContent = renderRawJsonPanel(result.data);

  return (
    `<div class=\"card card-hover\">` +
    `<div class="card-head"><div class="card-head-main"><h3>决策回放</h3><p class=\"muted\">decision_id: ${escapeHtml(result.data.decision_id)}</p></div>${renderJsonToggleSwitch()}</div>` +
    `${renderSwitchableJsonView(visualContent, rawContent)}` +
    `</div>`
  );
}

function readPathNumber(
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

function readPathString(
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

function buildQueryHref(
  viewModel: ConsolePageViewModel,
  updates: Record<string, string | undefined>,
): string {
  return buildScopedQueryHref(
    viewModel,
    QUERY_FIELD_ORDER,
    updates as Partial<Record<QueryFieldName, string | undefined>>,
  );
}

function readFixtureFileContent(
  fixtureId: string,
  suffix: ".expected.json" | ".setup.json" | ".model.json",
): string {
  if (fixtureId.trim().length === 0 || !/^[a-zA-Z0-9._-]+$/u.test(fixtureId)) {
    return "";
  }

  try {
    return fs.readFileSync(
      path.resolve(__dirname, `../../api/test/fixtures/${fixtureId}${suffix}`),
      "utf-8",
    );
  } catch {
    return "";
  }
}

function renderExpectationRunStatus(status: ExpectationRunCaseResult["status"]): string {
  const statusClass =
    status === "passed"
      ? "status-approved"
      : status === "failed"
        ? "status-rejected"
        : "status-blocked";
  return `<span class="status-tag ${statusClass}">${escapeHtml(status)}</span>`;
}

function renderExpectationRunForm(
  viewModel: ConsolePageViewModel,
  input: {
    namespace: string;
    fixture_id: string;
    fixture_select_options: string;
    fixture_select_attr: string;
    tenant_id: string;
    environment: string;
    default_expectation_json: string;
  },
): string {
  const hiddenWithoutExpectationRun = renderHiddenContextFields(viewModel, [
    "namespace",
    "fixture_id",
    "expectation_run_id",
  ]);

  const hiddenWithoutExpectationFixture = renderHiddenContextFields(viewModel, [
    "namespace",
    "fixture_id",
  ]);

  return (
    `<section class="card card-hover" data-expectation-run-card>` +
    `<h4>Expectation 决策演练 / 回放</h4>` +
    `<p class="muted">先从目录下拉选择 expectation 文件；执行时会按同名 fixture 读取决策输入，并调用真实的 <code>decisions:evaluate</code>。</p>` +
    `<form class="action-form setup-fixture-preview-form" method="GET" action="/" data-control-incremental="true" data-expectation-preview-form="true">` +
    hiddenWithoutExpectationFixture +
    `<div class="setup-fixture-preview-grid">` +
    `<label>命名空间 Namespace<input type="text" name="namespace" value="${escapeHtml(input.namespace)}" required /></label>` +
    `<label>Expectation<select name="fixture_id" id="expectation-fixture-id" ${input.fixture_select_attr}>${input.fixture_select_options}</select></label>` +
    `</div>` +
    `<p class="muted">选择即预载 expectation JSON；执行同名 fixture 的批量 Setup 时，系统会自动发布对应 model 并绑定 route。</p>` +
    `</form>` +
    `<form class="action-form" method="POST" action="/actions/control/expectations/run" data-control-incremental="true">` +
    hiddenWithoutExpectationRun +
    `<input type="hidden" name="namespace" value="${escapeHtml(input.namespace)}" />` +
    `<input type="hidden" name="fixture_id" value="${escapeHtml(input.fixture_id)}" />` +
    `<div class="setup-fixture-preview-grid">` +
    `<label>tenant_id<input type="text" name="tenant_id" value="${escapeHtml(input.tenant_id)}" placeholder="tenant_acme" /></label>` +
    `<label>environment<input type="text" name="environment" value="${escapeHtml(input.environment)}" placeholder="prod" /></label>` +
    `</div>` +
    `<section class="expectation-upload-grid">` +
    `<label class="file-pick">Expectation 文件` +
    `<input type="file" accept=".json,application/json" data-json-file-input data-json-file-target="expectation-json-textarea" data-json-file-name-target="expectation-file-name" data-json-file-fixture-target="expectation-fixture-id" />` +
    `</label>` +
    `<input type="hidden" name="expectation_file_name" value="${escapeHtml(input.fixture_id)}.expected.json" data-json-file-name id="expectation-file-name" />` +
    `<label class="field-wide">Expectation JSON<textarea name="expectation_json" rows="14" required id="expectation-json-textarea" data-json-file-textarea>${escapeHtml(input.default_expectation_json)}</textarea></label>` +
    `</section>` +
    `<p class="muted">建议流程：直接执行同名 fixture 的批量 Setup（会自动绑定 route），再运行 expectation 演练；页面只模拟实际系统调用，不接受 inline_model 覆盖。</p>` +
    `<button type="submit" class="btn btn-primary">执行 Expectation 演练</button>` +
    `</form>` +
    `</section>`
  );
}

function renderExpectationRunReport(
  viewModel: ConsolePageViewModel,
  report: ExpectationRunReport | undefined,
): string {
  if (!report) {
    return (
      `<section class="card card-hover">` +
      `<h4>Expectation 演练结果</h4>` +
      `<p class="muted">尚未执行。执行后会在这里展示每个用例的真实 decision_id、断言结果，以及跳转到“关系回放”的入口。</p>` +
      `</section>`
    );
  }

  const rows =
    report.cases.length === 0
      ? '<tr><td colspan="8" class="muted">无可展示用例</td></tr>'
      : report.cases
          .map((item) => {
            const replayHref = item.decision_id
              ? buildQueryHref(viewModel, {
                  tab: "relations",
                  decision_id: item.decision_id,
                  expectation_run_id: report.run_id,
                })
              : "";
            const errors =
              item.assertion_errors.length === 0
                ? "-"
                : item.assertion_errors.join("；");
            return (
              `<tr>` +
              `<td>${escapeHtml(item.name)}</td>` +
              `<td>${renderExpectationRunStatus(item.status)}</td>` +
              `<td>${escapeHtml(item.mode)}</td>` +
              `<td>${escapeHtml(item.expected_effect)}</td>` +
              `<td>${escapeHtml(item.actual_effect ?? "-")}</td>` +
              `<td>${item.decision_id && replayHref ? `<a href="${replayHref}">${escapeHtml(item.decision_id)}</a>` : "-"}</td>` +
              `<td>${escapeHtml(item.reason ?? "-")}</td>` +
              `<td>${escapeHtml(errors)}</td>` +
              `</tr>`
            );
          })
          .join("");

  return (
    `<section class="card card-hover">` +
    `<div class="section-head">` +
    `<div>` +
    `<h4>Expectation 演练结果</h4>` +
    `<p class="muted">run_id=${escapeHtml(report.run_id)} / namespace=${escapeHtml(report.namespace)} / 生成时间=${escapeHtml(formatTime(report.generated_at))}</p>` +
    `</div>` +
    `<div class="metric-inline-group">` +
    `<span class="badge badge-neutral">setup=${escapeHtml(report.source.setup_source)}</span>` +
    `<span class="badge badge-neutral">model=${escapeHtml(report.source.model_source)}</span>` +
    `${report.source.expectation_file_name ? `<span class="badge badge-neutral">file=${escapeHtml(report.source.expectation_file_name)}</span>` : ""}` +
    `</div>` +
    `</div>` +
    `<section class="decision-grid">` +
    `<div class="metric"><span>total</span><strong>${report.summary.total_count}</strong></div>` +
    `<div class="metric"><span>passed</span><strong>${report.summary.passed_count}</strong></div>` +
    `<div class="metric"><span>failed</span><strong>${report.summary.failed_count}</strong></div>` +
    `<div class="metric"><span>skipped</span><strong>${report.summary.skipped_count}</strong></div>` +
    `</section>` +
    `<div class="table-container">` +
    `<table class="data-table">` +
    `<thead><tr><th>Case</th><th>Status</th><th>Mode</th><th>Expected</th><th>Actual</th><th>Decision ID</th><th>Reason</th><th>Assertions</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</div>` +
    `</section>`
  );
}

function renderAdvancedOpsSection(
  viewModel: ConsolePageViewModel,
  input: {
    namespace: string;
    tenant_id: string;
    environment: string;
    publish_id?: string;
    model_id?: string;
    model_version?: string;
  },
): string {
  const hiddenFields = renderHiddenContextFields(viewModel, ["namespace"]);

  return (
    `<section class="card card-hover advanced-ops-card">` +
    `<h4>高级运维（可选）</h4>` +
    `<p class="muted">用于对运行态 object / relation / model_route 做单条修正，不会反向修改上方策略模型 JSON。</p>` +
    `<section class="management-grid">` +
    `<form class="action-form" method="POST" action="/actions/control/object/upsert">` +
    `<h5>单对象 Upsert</h5>` +
    hiddenFields +
    `<input type="hidden" name="namespace" value="${escapeHtml(input.namespace)}" />` +
    `<label>Object ID<input type="text" name="object_id" placeholder="kb:wiki_core" required /></label>` +
    `<label>Object Type<input type="text" name="object_type" placeholder="kb" required /></label>` +
    `<label>Sensitivity<input type="text" name="sensitivity" placeholder="normal" /></label>` +
    `<label>Owner Ref<input type="text" name="owner_ref" placeholder="user:alice" /></label>` +
    `<label class="field-wide">Labels<textarea name="labels" rows="3" placeholder="finance\npii"></textarea></label>` +
    `<button type="submit" class="btn btn-secondary">写入对象</button>` +
    `</form>` +
    `<form class="action-form" method="POST" action="/actions/control/relation/event">` +
    `<h5>单关系 Event</h5>` +
    hiddenFields +
    `<input type="hidden" name="namespace" value="${escapeHtml(input.namespace)}" />` +
    `<label>From<input type="text" name="from" placeholder="user:alice" required /></label>` +
    `<label>To<input type="text" name="to" placeholder="department:rnd" required /></label>` +
    `<label>Relation Type<input type="text" name="relation_type" placeholder="belongs_to_department" required /></label>` +
    `<label>Operation<select name="operation"><option value="upsert">upsert</option><option value="delete">delete</option></select></label>` +
    `<label>Scope<input type="text" name="scope" placeholder="kb.read" /></label>` +
    `<label>Source<input type="text" name="source" placeholder="console_manual" /></label>` +
    `<button type="submit" class="btn btn-secondary">写入关系</button>` +
    `</form>` +
    `<form class="action-form" method="POST" action="/actions/control/model-route/upsert">` +
    `<h5>Model Route Upsert</h5>` +
    hiddenFields +
    `<input type="hidden" name="namespace" value="${escapeHtml(input.namespace)}" />` +
    `<label>tenant_id<input type="text" name="tenant_id" value="${escapeHtml(input.tenant_id)}" required /></label>` +
    `<label>environment<input type="text" name="environment" value="${escapeHtml(input.environment)}" required /></label>` +
    `<label>model_id<input type="text" name="model_id" value="${escapeHtml(input.model_id ?? "")}" placeholder="tenant_a_authz_v1" required /></label>` +
    `<label>model_version<input type="text" name="model_version" value="${escapeHtml(input.model_version ?? "")}" placeholder="2026.03.06" /></label>` +
    `<label>publish_id<input type="text" name="publish_id" value="${escapeHtml(input.publish_id ?? "")}" placeholder="pub_xxx" /></label>` +
    `<label>operator<input type="text" name="operator" value="console_operator" required /></label>` +
    `<button type="submit" class="btn btn-secondary">写入 Route</button>` +
    `</form>` +
    `</section>` +
    `</section>`
  );
}

function renderMatrixDrawerContent(
  selectedCell: Record<string, unknown>,
): string {
  return (
    `<h4>单元格详情抽屉</h4>` +
    `<p><strong>cell_key:</strong> ${escapeHtml(readPathString(selectedCell, ["cell_key"]))}</p>` +
    `<p><strong>final_decision:</strong> ${escapeHtml(readPathString(selectedCell, ["draft_effect"]))}</p>` +
    `<p><strong>baseline_decision:</strong> ${escapeHtml(readPathString(selectedCell, ["baseline_effect"]))}</p>` +
    `<p><strong>effective_actions:</strong> ${escapeHtml(readPathString(selectedCell, ["action"]))}</p>` +
    `<p><strong>matched_rules:</strong> ${escapeHtml(JSON.stringify((selectedCell.matched_rules ?? selectedCell.draft_matched_rules) as unknown) ?? "[]")}</p>` +
    `<p><strong>overridden_rules:</strong> ${escapeHtml(JSON.stringify((selectedCell.draft_overridden_rules ?? []) as unknown) ?? "[]")}</p>` +
    `<p><strong>relation_path:</strong> ${escapeHtml(readPathString(selectedCell, ["subject_id"]))} -> ${escapeHtml(readPathString(selectedCell, ["object_id"]))}</p>`
  );
}

function renderMatrixView(viewModel: ConsolePageViewModel): string {
  if (!viewModel.simulation_detail?.ok) {
    return '<article class="card card-hover"><h3>权限矩阵视图</h3><p class="muted">选择 publish_id 后自动加载最新模拟报告，再展示矩阵。</p></article>';
  }

  const cells = Array.isArray(viewModel.simulation_detail.data.matrix_cells)
    ? viewModel.simulation_detail.data.matrix_cells
    : [];
  if (cells.length === 0) {
    return '<article class="card card-hover"><h3>权限矩阵视图</h3><p class="muted">当前模拟报告没有差异单元格。</p></article>';
  }

  const subjects = Array.from(
    new Set(cells.map((cell) => readPathString(cell, ["subject_id"], ""))),
  )
    .filter((value) => value.length > 0)
    .slice(0, 8);
  const objects = Array.from(
    new Set(cells.map((cell) => readPathString(cell, ["object_id"], ""))),
  )
    .filter((value) => value.length > 0)
    .slice(0, 8);

  const rows = subjects
    .map((subjectId) => {
      const cols = objects
        .map((objectId) => {
          const scoped = cells.filter(
            (cell) =>
              readPathString(cell, ["subject_id"]) === subjectId &&
              readPathString(cell, ["object_id"]) === objectId,
          );
          if (scoped.length === 0) {
            return '<td class="muted">-</td>';
          }
          const sample = scoped[0];
          const cellKey = readPathString(sample, ["cell_key"]);
          const changedCount = scoped.length;
          const allowGain = scoped.filter(
            (cell) =>
              readPathString(cell, ["baseline_effect"]) !== "allow" &&
              readPathString(cell, ["draft_effect"]) === "allow",
          ).length;
          const denyGain = scoped.filter(
            (cell) =>
              readPathString(cell, ["baseline_effect"]) !== "deny" &&
              readPathString(cell, ["draft_effect"]) === "deny",
          ).length;
          const href = buildScopedQueryHref(
            viewModel,
            [
              "tab",
              "widget",
              "detail_mode",
              "publish_id",
              "simulation_id",
              "namespace",
              "profile",
            ],
            {
              tab: viewModel.query.tab ?? "simulation",
              cell_key: cellKey,
            },
          );
          const matchedRules = JSON.stringify(
            ((sample.matched_rules ?? sample.draft_matched_rules) as unknown) ??
              [],
          );
          const overriddenRules = JSON.stringify(
            ((sample.draft_overridden_rules ?? []) as unknown) ?? [],
          );
          const isActive = viewModel.query.cell_key === cellKey;

          return `<td><a href="${href}" class="matrix-link ${isActive ? "active" : ""}" data-matrix-cell="true" data-cell-key="${escapeHtml(cellKey)}" data-draft-effect="${escapeHtml(readPathString(sample, ["draft_effect"]))}" data-baseline-effect="${escapeHtml(readPathString(sample, ["baseline_effect"]))}" data-action="${escapeHtml(readPathString(sample, ["action"]))}" data-subject-id="${escapeHtml(readPathString(sample, ["subject_id"]))}" data-object-id="${escapeHtml(readPathString(sample, ["object_id"]))}" data-matched-rules="${escapeHtml(matchedRules)}" data-overridden-rules="${escapeHtml(overriddenRules)}">Δ${changedCount} / +A${allowGain} / +D${denyGain}</a></td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(subjectId)}</th>${cols}</tr>`;
    })
    .join("");

  const selectedCell = viewModel.query.cell_key
    ? cells.find(
        (cell) =>
          readPathString(cell, ["cell_key"]) === viewModel.query.cell_key,
      )
    : undefined;

  const drawerContent = selectedCell
    ? renderMatrixDrawerContent(selectedCell)
    : '<p class="muted">点击矩阵单元格可打开详情抽屉。</p>';

  return (
    `<article class="card card-hover">` +
    `<h3>权限矩阵视图</h3>` +
    `<p class="muted">行轴=主体场景，列轴=客体场景，单元格展示变更密度并可钻取。</p>` +
    `<div class="table-container"><table class="data-table matrix-table"><thead><tr><th>Subject \\ Object</th>${objects.map((obj) => `<th>${escapeHtml(obj)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` +
    `<section class="drawer" data-matrix-drawer>${drawerContent}</section>` +
    `</article>`
  );
}

function renderRelationView(viewModel: ConsolePageViewModel): string {
  const relationReplayFocus = buildRelationReplayFocusPayload(viewModel);
  const runtimeRelationGraphPayloadJson = escapeHtml(
    JSON.stringify(buildInstanceGraphPayload(viewModel)),
  );
  const runtimeRelationGraphFocusJson = escapeHtml(
    JSON.stringify(relationReplayFocus),
  );
  const objectRows = viewModel.control_objects?.ok
    ? renderRuntimeObjectRows(
        viewModel.control_objects.data.items,
        relationReplayFocus.object_id,
        relationReplayFocus.object_owner_ref,
      )
    : '<tr><td colspan="6" class="muted">客体台账加载失败</td></tr>';
  const objectCount = viewModel.control_objects?.ok
    ? viewModel.control_objects.data.total_count
    : 0;
  const relationCount = viewModel.control_relations?.ok
    ? viewModel.control_relations.data.total_count
    : 0;
  const relationRows = viewModel.control_relations?.ok
    ? viewModel.control_relations.data.items.length === 0
      ? '<tr><td colspan="5" class="muted">关系事件为空</td></tr>'
      : viewModel.control_relations.data.items
          .map(
            (item) => {
              const edgeKey = buildInstanceGraphEdgeKey({
                from: item.from,
                to: item.to,
                label: buildInstanceGraphEdgeLabel(item.relation_type, item.scope),
                dashed: false,
              });
              const rowClass = relationReplayFocus.highlight_edge_keys.includes(edgeKey)
                ? ' class="runtime-focus-row"'
                : "";
              return `<tr${rowClass}><td>${escapeHtml(item.from)}</td><td>${escapeHtml(item.relation_type)}</td><td>${escapeHtml(item.to)}</td><td>${escapeHtml(item.scope ?? "")}</td><td>${escapeHtml(formatTime(item.updated_at))}</td></tr>`;
            },
          )
          .join("")
    : '<tr><td colspan="5" class="muted">关系数据加载失败</td></tr>';

  const traceRows = viewModel.decision_detail?.ok
    ? viewModel.decision_detail.data.traces.length === 0
      ? '<tr><td colspan="4" class="muted">暂无 trace 记录</td></tr>'
      : viewModel.decision_detail.data.traces
          .map(
            (trace) =>
              `<tr><td>${escapeHtml(readPathString(trace, ["rule_id"], "unknown"))}</td><td>${escapeHtml(readPathString(trace, ["status"], "unknown"))}</td><td>${escapeHtml(readPathString(trace, ["effect"], "unknown"))}</td><td>${escapeHtml(readPathString(trace, ["reason"], ""))}</td></tr>`,
          )
          .join("")
    : '<tr><td colspan="4" class="muted">选择 decision_id 查看命中链路</td></tr>';

  const relationReplaySummary = relationReplayFocus.decision_id
    ? `<section class="decision-grid relation-replay-summary">` +
      `<div class="metric"><span>decision_id</span><strong>${escapeHtml(relationReplayFocus.decision_id)}</strong></div>` +
      `<div class="metric"><span>subject_id</span><strong>${escapeHtml(relationReplayFocus.subject_id ?? "-")}</strong></div>` +
      `<div class="metric"><span>object_id</span><strong>${escapeHtml(relationReplayFocus.object_id ?? "-")}</strong></div>` +
      `<div class="metric"><span>owner_ref</span><strong>${escapeHtml(relationReplayFocus.object_owner_ref ?? "-")}</strong></div>` +
      `<div class="metric"><span>matched_rules</span><strong>${relationReplayFocus.matched_rule_ids.length}</strong></div>` +
      `<div class="metric"><span>path_highlight</span><strong>${relationReplayFocus.path_found ? "已定位" : "仅节点"}</strong></div>` +
      `</section>` +
      `<p class="muted relation-replay-note">当前 Graph 会高亮本次回放的 subject / object / owner_ref，以及从 subject 指向 object（或 owner_ref）的运行态最短链路。</p>`
    : `<p class="muted relation-replay-note">未选择 decision_id 时，上半区展示当前 namespace 的实际运行态 objects / relations；选择 decision 后 Graph 会高亮本次回放焦点。</p>`;

  return (
    `<article class="card card-hover">` +
    `<h3>运行态关系回放</h3>` +
    `<p class="muted">上半区展示当前 namespace 已落库的运行态关系，可切换表格 / Graph；下半区展示决策 trace 链路。</p>` +
    relationReplaySummary +
    `<section class="relation-runtime-card" data-instance-editor data-subject-tree-direction="bottom-up">` +
    `<textarea hidden data-instance-graph-payload>${runtimeRelationGraphPayloadJson}</textarea>` +
    `<textarea hidden data-instance-graph-focus>${runtimeRelationGraphFocusJson}</textarea>` +
    `<div class="model-editor-head">` +
    `<p class="muted">运行态关系边 / Graph</p>` +
    `<div class="model-editor-head-actions">${renderRelationReplayToggleSwitch()}</div>` +
    `</div>` +
    `<section class="json-switchable" data-json-switchable>` +
    `<div class="json-view" data-json-view="visual">` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Object ID</th><th>Type</th><th>Sensitivity</th><th>Owner</th><th>Labels</th><th>Updated</th></tr></thead><tbody>${objectRows}</tbody></table></div>` +
    `<p class="muted relation-runtime-count">当前运行态：objects=${objectCount}，relations=${relationCount}</p>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>From</th><th>Relation</th><th>To</th><th>Scope</th><th>Updated</th></tr></thead><tbody>${relationRows}</tbody></table></div>` +
    `</div>` +
    `<div class="json-view" data-json-view="graph" hidden>` +
    `<section class="model-graph" data-instance-graph data-subject-tree-direction="bottom-up">` +
    `<p class="muted model-graph-placeholder">Graph 视图展示当前运行态 instance 的关系（control_relations + control_objects.owner_ref）；选中 decision 后会高亮回放焦点。</p>` +
    `<div class="instance-graph-layout-bar"><span class="muted">Subject 树方向</span><div class="json-toggle" role="tablist" aria-label="运行态 Subject 树方向"><button type="button" class="json-toggle-btn active" data-instance-subject-direction-btn="bottom-up" aria-pressed="true">自下而上</button><button type="button" class="json-toggle-btn" data-instance-subject-direction-btn="top-down" aria-pressed="false">自上而下</button></div></div>` +
    `<div class="model-graph-chart-wrap"><div class="instance-graph-actions"><button type="button" class="model-graph-node-hide" data-instance-hide-node title="先点击一个节点，再点击隐藏" disabled>隐藏节点</button><button type="button" class="model-graph-zoom-reset" title="重置缩放并恢复全部节点">重置</button></div><div class="model-graph-echart" data-instance-echart role="img" aria-label="运行态 Instance 关系图"></div></div>` +
    `<p class="muted model-graph-legend">说明：Graph 基于当前控制面已存入的 objects / relations 构建；边标签为 relation_type（含 scope）；虚线代表 object.owner_ref 关系；橙色高亮表示当前 decision 回放焦点。</p>` +
    `</section>` +
    `</div>` +
    `</section>` +
    `</section>` +
    `<div class="table-container relation-trace"><table class="data-table"><thead><tr><th>Rule</th><th>Status</th><th>Effect</th><th>Reason</th></tr></thead><tbody>${traceRows}</tbody></table></div>` +
    `</article>`
  );
}

function renderSimulationView(viewModel: ConsolePageViewModel): string {
  if (!viewModel.simulation_detail?.ok) {
    return '<article class="card card-hover"><h3>影响面模拟视图</h3><p class="muted">选择 publish_id 后会自动加载最新模拟报告。</p></article>';
  }

  const report = viewModel.simulation_detail.data;
  const summary = report.summary;
  const recommendation = summary.publish_recommendation;
  const actionRows =
    report.action_change_matrix.length === 0
      ? '<tr><td colspan="7" class="muted">暂无动作变化</td></tr>'
      : report.action_change_matrix
          .map((row) => {
            const action = readPathString(row, ["action"], "unknown");
            return (
              `<tr>` +
              `<td>${escapeHtml(action)}</td>` +
              `<td>${readPathNumber(row, ["changed_count"])}</td>` +
              `<td>${readPathNumber(row, ["allow_to_deny"])}</td>` +
              `<td>${readPathNumber(row, ["deny_to_allow"])}</td>` +
              `<td>${readPathNumber(row, ["not_applicable_to_allow"])}</td>` +
              `<td>${readPathNumber(row, ["not_applicable_to_deny"])}</td>` +
              `<td>${readPathNumber(row, ["indeterminate_to_allow"]) + readPathNumber(row, ["indeterminate_to_deny"])}</td>` +
              `</tr>`
            );
          })
          .join("");
  const impactedSubjects = report.top_impacted_subjects.slice(0, 8);
  const impactedObjects = report.top_impacted_objects.slice(0, 8);
  const subjectRows =
    impactedSubjects.length === 0
      ? '<tr><td colspan="3" class="muted">暂无主体影响排行</td></tr>'
      : impactedSubjects
          .map((item) => {
            const subjectId = readPathString(
              item,
              ["subject_id"],
              readPathString(item, ["id"], "-"),
            );
            const changedCount = readPathNumber(
              item,
              ["changed_count"],
              readPathNumber(item, ["count"], 0),
            );
            const maxRisk = readPathNumber(
              item,
              ["max_risk_score"],
              readPathNumber(item, ["risk_score"], 0),
            );
            return `<tr><td>${escapeHtml(subjectId)}</td><td>${changedCount}</td><td>${maxRisk}</td></tr>`;
          })
          .join("");
  const objectRows =
    impactedObjects.length === 0
      ? '<tr><td colspan="3" class="muted">暂无客体影响排行</td></tr>'
      : impactedObjects
          .map((item) => {
            const objectId = readPathString(
              item,
              ["object_id"],
              readPathString(item, ["id"], "-"),
            );
            const changedCount = readPathNumber(
              item,
              ["changed_count"],
              readPathNumber(item, ["count"], 0),
            );
            const sensitivity = readPathString(item, ["sensitivity"], "-");
            return `<tr><td>${escapeHtml(objectId)}</td><td>${changedCount}</td><td>${escapeHtml(sensitivity)}</td></tr>`;
          })
          .join("");

  const simulationSelector = viewModel.simulation_list?.ok
    ? `<form class="filters toolbar" method="GET" action="/">` +
      `<label>模拟报告 Simulation Report` +
      `<select name="simulation_id">` +
      viewModel.simulation_list.data.items
        .map(
          (item) =>
            `<option value="${escapeHtml(item.report_id)}" ${item.report_id === report.report_id ? "selected" : ""}>${escapeHtml(item.report_id)} | ${escapeHtml(formatTime(item.generated_at))}</option>`,
        )
        .join("") +
      `</select></label>` +
      renderScopedHiddenContextFields(viewModel, [
        "publish_id",
        "profile",
        "detail_mode",
        "namespace",
        "tab",
        "widget",
      ]) +
      `<button type="submit" class="btn btn-primary">切换报告</button>` +
      `</form>`
    : "";
  const visualContent =
    `<section class="decision-grid">` +
    `<div class="metric"><span>delta_allow_subject_count</span><strong>${summary.delta_allow_subject_count}</strong></div>` +
    `<div class="metric"><span>delta_deny_subject_count</span><strong>${summary.delta_deny_subject_count}</strong></div>` +
    `<div class="metric"><span>delta_high_sensitivity_object_count</span><strong>${summary.delta_high_sensitivity_object_count}</strong></div>` +
    `<div class="metric"><span>new_conflict_rule_count</span><strong>${summary.new_conflict_rule_count}</strong></div>` +
    `<div class="metric"><span>new_sod_violation_count</span><strong>${summary.new_sod_violation_count}</strong></div>` +
    `<div class="metric"><span>indeterminate_rate_estimation</span><strong>${summary.indeterminate_rate_estimation}</strong></div>` +
    `<div class="metric"><span>mandatory_obligations_pass_rate</span><strong>${summary.mandatory_obligations_pass_rate}</strong></div>` +
    `<div class="metric"><span>publish_recommendation</span><strong>${escapeHtml(recommendation)}</strong></div>` +
    `</section>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Action</th><th>Changed</th><th>Allow→Deny</th><th>Deny→Allow</th><th>NA→Allow</th><th>NA→Deny</th><th>Indeterminate Δ</th></tr></thead><tbody>${actionRows}</tbody></table></div>` +
    `<section class="split-grid">` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Top Impacted Subjects</th><th>Changed</th><th>Max Risk</th></tr></thead><tbody>${subjectRows}</tbody></table></div>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Top Impacted Objects</th><th>Changed</th><th>Sensitivity</th></tr></thead><tbody>${objectRows}</tbody></table></div>` +
    `</section>`;
  const rawContent = renderRawJsonPanel(report);

  return (
    `<article class="card card-hover">` +
    `<div class="card-head"><div class="card-head-main"><h3>影响面模拟视图</h3><p class="muted">模拟报告: ${escapeHtml(report.report_id)} / ${escapeHtml(formatTime(report.generated_at))}</p></div>${renderJsonToggleSwitch()}</div>` +
    simulationSelector +
    `${renderSwitchableJsonView(visualContent, rawContent)}` +
    `</article>`
  );
}

interface ModelTemplate {
  model_meta: {
    model_id: string;
    tenant_id: string;
    version: string;
    status: string;
    combining_algorithm: string;
  };
  catalogs: {
    action_catalog: string[];
    subject_type_catalog: string[];
    object_type_catalog: string[];
    subject_relation_type_catalog: string[];
    object_relation_type_catalog: string[];
    subject_object_relation_type_catalog?: string[];
  };
  object_onboarding: Record<string, unknown>;
  relations: Record<string, unknown>;
  policies: {
    rules: Array<Record<string, unknown>>;
  };
  constraints: Record<string, unknown>;
  lifecycle: Record<string, unknown>;
  consistency: Record<string, unknown>;
  quality_guardrails: {
    attribute_quality: Record<string, unknown>;
    mandatory_obligations: string[];
  };
  relation_signature?: Record<string, unknown>;
  action_signature?: Record<string, unknown>;
  context_inference?: Record<string, unknown>;
  decision_search?: Record<string, unknown>;
}

interface ModelTemplateOption {
  id: string;
  label: string;
  description: string;
  model: ModelTemplate;
}

const MODEL_TEMPLATE_DISPLAY_OVERRIDES: Record<
  string,
  {
    order: number;
    label: string;
    description: string;
  }
> = {
  "03-mixed-model-instance-hybrid.model.json": {
    order: 3,
    label: "样例3：Model/Instance 混合判权",
    description:
      "覆盖动态属性判权、控制面索引推导、model 内 instance 高优先级规则。",
  },
  "01-same-company-derived.model.json": {
    order: 1,
    label: "样例1：同公司派生可见（当前）",
    description: "当前默认样例：同公司主体可访问 owner 资源及派生资源。",
  },
  "02-virtual-team-department-scope.model.json": {
    order: 2,
    label: "样例2：虚拟团队 + 部门可见",
    description: "新增虚拟团队关系建模，并将可见性收敛到同部门范围。",
  },
};

function readModelTemplateFixture(
  fixtureFileName: string,
): ModelTemplate | null {
  const fixturePath = path.resolve(
    __dirname,
    `../../api/test/fixtures/${fixtureFileName}`,
  );
  try {
    const raw = fs.readFileSync(fixturePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ModelTemplate;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown parse error";
    console.warn(
      `[console] skip invalid model template fixture: ${fixturePath} (${message})`,
    );
    return null;
  }
}

function buildModelTemplateOptions(namespace: string): ModelTemplateOption[] {
  void namespace;
  const fixtureDir = path.resolve(__dirname, "../../api/test/fixtures");
  const fixtureFiles = fs
    .readdirSync(fixtureDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".model.json"))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const leftOrder =
        MODEL_TEMPLATE_DISPLAY_OVERRIDES[left]?.order ??
        Number.MAX_SAFE_INTEGER;
      const rightOrder =
        MODEL_TEMPLATE_DISPLAY_OVERRIDES[right]?.order ??
        Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      return left.localeCompare(right);
    });

  const templateOptions: ModelTemplateOption[] = [];
  fixtureFiles.forEach((fixtureFileName) => {
    const model = readModelTemplateFixture(fixtureFileName);
    if (!model) {
      return;
    }

    const templateId = fixtureFileName.replace(/\.model\.json$/u, "");
    const override = MODEL_TEMPLATE_DISPLAY_OVERRIDES[fixtureFileName];
    const fallbackIndex = templateOptions.length + 1;
    const modelMeta = asRecord(model.model_meta);
    const fallbackModelId =
      typeof modelMeta?.model_id === "string" && modelMeta.model_id.length > 0
        ? modelMeta.model_id
        : templateId;
    const fallbackTenant =
      typeof modelMeta?.tenant_id === "string" && modelMeta.tenant_id.length > 0
        ? modelMeta.tenant_id
        : "-";
    const fallbackVersion =
      typeof modelMeta?.version === "string" && modelMeta.version.length > 0
        ? modelMeta.version
        : "-";

    templateOptions.push({
      id: templateId,
      label: override?.label ?? `样例${fallbackIndex}：${fallbackModelId}`,
      description:
        override?.description ??
        `来源 fixtures/${fixtureFileName}；tenant=${fallbackTenant}；version=${fallbackVersion}`,
      model,
    });
  });

  return templateOptions;
}

function buildDefaultModelTemplate(namespace: string): ModelTemplate {
  const [firstTemplate] = buildModelTemplateOptions(namespace);
  if (!firstTemplate) {
    throw new Error("model template list is empty");
  }
  return firstTemplate.model;
}

interface PublishedModelOverviewMetrics {
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

interface RuntimeRouteOverview {
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

function normalizeStringArray(input: unknown): string[] {
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

function getModelSnapshotFromPublish(
  record: PublishRequestRecord,
): Record<string, unknown> | null {
  const payload = asRecord(record.payload);
  return asRecord(payload?.model_snapshot);
}

function getModelMetaFromSnapshot(snapshot: unknown): {
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
    typeof modelMeta.tenant_id === "string"
      ? modelMeta.tenant_id.trim()
      : "";
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

function pickPublishRecordForOverview(
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

function collectPublishedModelOverviewMetrics(
  viewModel: ConsolePageViewModel,
): PublishedModelOverviewMetrics | null {
  const sourceRecord = pickPublishRecordForOverview(viewModel);
  if (!sourceRecord) {
    return null;
  }

  const modelSnapshot = getModelSnapshotFromPublish(sourceRecord);
  if (!modelSnapshot) {
    return null;
  }

  const modelMeta = getModelMetaFromSnapshot(modelSnapshot);
  const catalogs = asRecord(modelSnapshot.catalogs);
  const policies = asRecord(modelSnapshot.policies);

  const actionCatalog = normalizeStringArray(catalogs?.action_catalog);
  const subjectTypeCatalog = normalizeStringArray(
    catalogs?.subject_type_catalog,
  );
  const objectTypeCatalog = normalizeStringArray(catalogs?.object_type_catalog);
  const relationTypeCatalog = Array.from(
    new Set([
      ...normalizeStringArray(catalogs?.subject_relation_type_catalog),
      ...normalizeStringArray(catalogs?.object_relation_type_catalog),
      ...normalizeStringArray(catalogs?.subject_object_relation_type_catalog),
    ]),
  );
  const rules = Array.isArray(policies?.rules) ? policies.rules.length : 0;

  return {
    publish_id: sourceRecord.publish_id,
    model_id: modelMeta?.model_id ?? "-",
    tenant_id: modelMeta?.tenant_id ?? "-",
    model_version: modelMeta?.version ?? "-",
    subject_types: subjectTypeCatalog.length,
    categories: actionCatalog.length,
    object_types: objectTypeCatalog.length,
    relation_types: relationTypeCatalog.length,
    rules,
  };
}

function collectRuntimeRouteOverview(
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
    new Set(routeItems.map((item) => item.tenant_id).filter((item) => item.length > 0)),
  );
  const environments = Array.from(
    new Set(
      routeItems.map((item) => item.environment).filter((item) => item.length > 0),
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

function buildRouteMismatchMessage(
  publishedModelMetrics: PublishedModelOverviewMetrics | null,
  runtimeRouteOverview: RuntimeRouteOverview,
): string | null {
  if (!publishedModelMetrics || runtimeRouteOverview.route_items.length === 0) {
    return null;
  }

  const matchedRoute = runtimeRouteOverview.route_items.find(
    (item) =>
      item.tenant_id === publishedModelMetrics.tenant_id &&
      item.model_id === publishedModelMetrics.model_id &&
      (item.publish_id === publishedModelMetrics.publish_id ||
        item.model_version === publishedModelMetrics.model_version),
  );

  if (matchedRoute) {
    return null;
  }

  const routeSummary = runtimeRouteOverview.route_items
    .map(
      (item) =>
        `${item.environment}: ${item.tenant_id} / ${item.model_id} / ${item.publish_id}`,
    )
    .join("；");

  return `提醒：当前查看发布 ${publishedModelMetrics.publish_id}（${publishedModelMetrics.tenant_id} / ${publishedModelMetrics.model_id} / ${publishedModelMetrics.model_version}）与当前 namespace 的运行路由不一致；现有路由为 ${routeSummary}。`;
}

function collectControlOverviewMetrics(viewModel: ConsolePageViewModel): {
  subjects: number;
  objects: number;
  relations: number;
} {
  const objects = viewModel.control_objects?.ok
    ? viewModel.control_objects.data.total_count
    : 0;
  const relations = viewModel.control_relations?.ok
    ? viewModel.control_relations.data.total_count
    : 0;

  const objectIdSet = new Set<string>();
  const subjectIdSet = new Set<string>();

  if (viewModel.control_objects?.ok) {
    viewModel.control_objects.data.items.forEach((item) => {
      const objectId = item.object_id.trim();
      if (objectId.length > 0) {
        objectIdSet.add(objectId);
      }

      const ownerRef = item.owner_ref.trim();
      if (ownerRef.length > 0) {
        subjectIdSet.add(ownerRef);
      }
    });
  }

  const isObjectStyleRef = (value: string): boolean => {
    if (objectIdSet.has(value)) {
      return true;
    }
    const lower = value.toLowerCase();
    return (
      lower.startsWith("obj:") ||
      lower.startsWith("object:") ||
      lower.startsWith("asset:")
    );
  };

  const addSubjectCandidate = (value: string): void => {
    const candidate = value.trim();
    if (candidate.length === 0 || isObjectStyleRef(candidate)) {
      return;
    }
    subjectIdSet.add(candidate);
  };

  if (viewModel.control_relations?.ok) {
    viewModel.control_relations.data.items.forEach((item) => {
      addSubjectCandidate(item.from);
      addSubjectCandidate(item.to);
    });
  }

  return {
    subjects: subjectIdSet.size,
    objects,
    relations,
  };
}

interface InstanceGraphPayload {
  nodes: Array<{
    id: string;
    label: string;
    category: "subject" | "object" | "mixed";
    subject_type?: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label: string;
    dashed: boolean;
    color: string;
  }>;
  subject_layout?: {
    type_catalog: string[];
    type_edges: Array<{
      from_type: string;
      to_type: string;
    }>;
  };
}

interface RelationReplayFocusPayload {
  decision_id?: string;
  subject_id?: string;
  object_id?: string;
  object_owner_ref?: string;
  matched_rule_ids: string[];
  trace_rule_ids: string[];
  highlight_node_ids: string[];
  highlight_edge_keys: string[];
  path_found: boolean;
}

interface SubjectLayoutModelMeta {
  typeCatalog: string[];
  typeEdges: Array<{
    fromType: string;
    toType: string;
  }>;
}

interface InstanceGraphSource {
  objects: Array<{
    object_id: string;
    object_type?: string;
    owner_ref?: string;
  }>;
  relations: Array<{
    from: string;
    to: string;
    relation_type: string;
    scope?: string;
  }>;
}

interface InstanceSnapshotPayload {
  namespace: string;
  model_routes: Array<{
    namespace?: string;
    tenant_id: string;
    environment: string;
    model_id: string;
    model_version?: string;
    publish_id?: string;
    operator?: string;
  }>;
  objects: Array<{
    object_id: string;
    object_type: string;
    sensitivity?: string;
    owner_ref?: string;
    labels?: string[];
    updated_at?: string;
  }>;
  relation_events: Array<{
    from: string;
    to: string;
    relation_type: string;
    operation: "upsert" | "delete";
    scope?: string;
    source?: string;
    updated_at?: string;
  }>;
}

function inferEntityTypeFromId(entityId: string): string | null {
  const separatorIndex = entityId.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }
  const candidate = entityId.slice(0, separatorIndex).trim();
  return candidate.length > 0 ? candidate : null;
}

function collectSubjectLayoutModelMeta(
  viewModel: ConsolePageViewModel,
): SubjectLayoutModelMeta {
  const sourceRecord = pickPublishRecordForOverview(viewModel);
  const modelSnapshot = sourceRecord
    ? getModelSnapshotFromPublish(sourceRecord)
    : null;
  if (!modelSnapshot) {
    return {
      typeCatalog: [],
      typeEdges: [],
    };
  }

  const catalogs = asRecord(modelSnapshot.catalogs);
  const relationSignature = asRecord(modelSnapshot.relation_signature);
  const subjectRelationItems = Array.isArray(relationSignature?.subject_relations)
    ? relationSignature.subject_relations
    : [];
  const typeCatalog = normalizeStringArray(catalogs?.subject_type_catalog);

  const dedupTypeEdgeKeys = new Set<string>();
  const typeEdges: SubjectLayoutModelMeta["typeEdges"] = [];
  subjectRelationItems.forEach((item) => {
    const relation = asRecord(item);
    if (!relation) {
      return;
    }
    const fromTypes = normalizeStringArray(relation.from_types);
    const toTypes = normalizeStringArray(relation.to_types);
    fromTypes.forEach((fromType) => {
      toTypes.forEach((toType) => {
        const edgeKey = `${fromType}->${toType}`;
        if (dedupTypeEdgeKeys.has(edgeKey)) {
          return;
        }
        dedupTypeEdgeKeys.add(edgeKey);
        typeEdges.push({
          fromType,
          toType,
        });
      });
    });
  });

  return {
    typeCatalog,
    typeEdges,
  };
}

function buildInstanceGraphEdgeLabel(
  relationType: string,
  scope?: string,
): string {
  const normalizedRelationType = relationType.trim();
  const normalizedScope = (scope ?? "").trim();
  if (normalizedRelationType.length === 0) {
    return "related_to";
  }
  return normalizedScope.length > 0
    ? `${normalizedRelationType} [${normalizedScope}]`
    : normalizedRelationType;
}

function buildInstanceGraphEdgeKey(input: {
  from: string;
  to: string;
  label: string;
  dashed: boolean;
}): string {
  return `${input.from.trim()}::${input.to.trim()}::${input.label.trim()}::${input.dashed ? "d" : "s"}`;
}

function collectRuntimeInstanceGraphEdges(
  viewModel: ConsolePageViewModel,
): Array<{
  from: string;
  to: string;
  label: string;
  dashed: boolean;
}> {
  const edges: Array<{
    from: string;
    to: string;
    label: string;
    dashed: boolean;
  }> = [];

  if (viewModel.control_relations?.ok) {
    viewModel.control_relations.data.items.forEach((item) => {
      const from = item.from.trim();
      const to = item.to.trim();
      if (from.length === 0 || to.length === 0) {
        return;
      }
      edges.push({
        from,
        to,
        label: buildInstanceGraphEdgeLabel(item.relation_type, item.scope),
        dashed: false,
      });
    });
  }

  if (viewModel.control_objects?.ok) {
    viewModel.control_objects.data.items.forEach((item) => {
      const objectId = item.object_id.trim();
      const ownerRef = item.owner_ref.trim();
      if (objectId.length === 0 || ownerRef.length === 0) {
        return;
      }
      edges.push({
        from: ownerRef,
        to: objectId,
        label: "owner_ref",
        dashed: true,
      });
    });
  }

  return edges;
}

function findShortestDirectedEdgePath(
  edges: Array<{
    from: string;
    to: string;
    label: string;
    dashed: boolean;
  }>,
  startId: string,
  targetId: string,
): Array<{
  from: string;
  to: string;
  label: string;
  dashed: boolean;
}> {
  const normalizedStartId = startId.trim();
  const normalizedTargetId = targetId.trim();
  if (
    normalizedStartId.length === 0 ||
    normalizedTargetId.length === 0 ||
    normalizedStartId === normalizedTargetId
  ) {
    return [];
  }

  const outgoingMap = new Map<
    string,
    Array<{
      from: string;
      to: string;
      label: string;
      dashed: boolean;
    }>
  >();
  edges.forEach((edge) => {
    const from = edge.from.trim();
    const to = edge.to.trim();
    if (from.length === 0 || to.length === 0) {
      return;
    }
    const scoped = outgoingMap.get(from) ?? [];
    scoped.push(edge);
    outgoingMap.set(from, scoped);
  });

  const visited = new Set<string>([normalizedStartId]);
  const queue: string[] = [normalizedStartId];
  const previousEdgeByNode = new Map<
    string,
    {
      from: string;
      to: string;
      label: string;
      dashed: boolean;
    }
  >();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const outgoingEdges = outgoingMap.get(current) ?? [];
    for (const edge of outgoingEdges) {
      const next = edge.to.trim();
      if (next.length === 0 || visited.has(next)) {
        continue;
      }
      visited.add(next);
      previousEdgeByNode.set(next, edge);
      if (next === normalizedTargetId) {
        const path: Array<{
          from: string;
          to: string;
          label: string;
          dashed: boolean;
        }> = [];
        let cursor = normalizedTargetId;
        while (cursor !== normalizedStartId) {
          const previousEdge = previousEdgeByNode.get(cursor);
          if (!previousEdge) {
            return [];
          }
          path.unshift(previousEdge);
          cursor = previousEdge.from;
        }
        return path;
      }
      queue.push(next);
    }
  }

  return [];
}

function buildRelationReplayFocusPayload(
  viewModel: ConsolePageViewModel,
): RelationReplayFocusPayload {
  const empty: RelationReplayFocusPayload = {
    matched_rule_ids: [],
    trace_rule_ids: [],
    highlight_node_ids: [],
    highlight_edge_keys: [],
    path_found: false,
  };

  if (!viewModel.decision_detail?.ok) {
    return empty;
  }

  const payload = asRecord(viewModel.decision_detail.data.payload) ?? {};
  const request = asRecord(payload.request) ?? {};
  const subjectId = readPathString(request, ["subject_id"], "").trim();
  const objectId = readPathString(request, ["object_id"], "").trim();
  const matchedRuleIds = Array.isArray(payload.matched_rules)
    ? payload.matched_rules.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const traceRuleIds = Array.isArray(viewModel.decision_detail.data.traces)
    ? viewModel.decision_detail.data.traces
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .map((item) => readPathString(item, ["rule_id"], "").trim())
        .filter((item) => item.length > 0)
    : [];

  const objectRecord = viewModel.control_objects?.ok
    ? viewModel.control_objects.data.items.find(
        (item) => item.object_id.trim() === objectId,
      )
    : undefined;
  const ownerRef = objectRecord?.owner_ref.trim() ?? "";
  const graphEdges = collectRuntimeInstanceGraphEdges(viewModel);

  const highlightNodeIds = new Set<string>();
  if (subjectId.length > 0) {
    highlightNodeIds.add(subjectId);
  }
  if (objectId.length > 0) {
    highlightNodeIds.add(objectId);
  }
  if (ownerRef.length > 0) {
    highlightNodeIds.add(ownerRef);
  }

  const highlightEdgeKeys = new Set<string>();
  const pathToObject = findShortestDirectedEdgePath(graphEdges, subjectId, objectId);
  let pathFound = false;
  if (pathToObject.length > 0) {
    pathFound = true;
    pathToObject.forEach((edge) => {
      highlightEdgeKeys.add(buildInstanceGraphEdgeKey(edge));
      highlightNodeIds.add(edge.from);
      highlightNodeIds.add(edge.to);
    });
  } else if (ownerRef.length > 0) {
    const pathToOwner = findShortestDirectedEdgePath(graphEdges, subjectId, ownerRef);
    if (pathToOwner.length > 0) {
      pathFound = true;
      pathToOwner.forEach((edge) => {
        highlightEdgeKeys.add(buildInstanceGraphEdgeKey(edge));
        highlightNodeIds.add(edge.from);
        highlightNodeIds.add(edge.to);
      });
    }

    const ownerEdgeKey = buildInstanceGraphEdgeKey({
      from: ownerRef,
      to: objectId,
      label: "owner_ref",
      dashed: true,
    });
    if (
      graphEdges.some(
        (edge) =>
          buildInstanceGraphEdgeKey(edge) === ownerEdgeKey,
      )
    ) {
      highlightEdgeKeys.add(ownerEdgeKey);
      pathFound = true;
    }
  }

  return {
    decision_id: viewModel.decision_detail.data.decision_id,
    subject_id: subjectId || undefined,
    object_id: objectId || undefined,
    object_owner_ref: ownerRef || undefined,
    matched_rule_ids: Array.from(new Set(matchedRuleIds)),
    trace_rule_ids: Array.from(new Set(traceRuleIds)),
    highlight_node_ids: Array.from(highlightNodeIds),
    highlight_edge_keys: Array.from(highlightEdgeKeys),
    path_found: pathFound,
  };
}

function renderRuntimeObjectRows(
  objects: ControlObjectListResponse["items"],
  focusObjectId?: string,
  focusOwnerRef?: string,
): string {
  if (objects.length === 0) {
    return '<tr><td colspan="6" class="muted">当前命名空间暂无客体数据</td></tr>';
  }

  return objects
    .map((item) => {
      const isFocusObject =
        focusObjectId && item.object_id.trim() === focusObjectId.trim();
      const isFocusOwner =
        focusOwnerRef && item.owner_ref.trim() === focusOwnerRef.trim();
      const rowClass = isFocusObject || isFocusOwner ? ' class="runtime-focus-row"' : "";
      return (
        `<tr${rowClass}>` +
        `<td>${escapeHtml(item.object_id)}</td>` +
        `<td>${escapeHtml(item.object_type)}</td>` +
        `<td>${escapeHtml(item.sensitivity ?? "")}</td>` +
        `<td>${escapeHtml(item.owner_ref ?? "")}</td>` +
        `<td>${escapeHtml((item.labels ?? []).join(", "))}</td>` +
        `<td>${escapeHtml(formatTime(item.updated_at))}</td>` +
        `</tr>`
      );
    })
    .join("");
}

function buildInstanceGraphPayload(
  viewModel: ConsolePageViewModel,
  source?: InstanceGraphSource,
): InstanceGraphPayload {
  const objectItems =
    source?.objects ??
    (viewModel.control_objects?.ok ? viewModel.control_objects.data.items : []);
  const relationItems =
    source?.relations ??
    (viewModel.control_relations?.ok
      ? viewModel.control_relations.data.items
      : []);
  const subjectLayoutModelMeta = collectSubjectLayoutModelMeta(viewModel);
  const subjectTypeCatalogSet = new Set(subjectLayoutModelMeta.typeCatalog);

  const nodeMeta = new Map<
    string,
    {
      id: string;
      label: string;
      isObject: boolean;
      isSubject: boolean;
      subjectType?: string;
    }
  >();
  const edgeMap = new Map<string, InstanceGraphPayload["edges"][number]>();

  const inferSubjectType = (nodeId: string): string | undefined => {
    const inferredType = inferEntityTypeFromId(nodeId);
    if (!inferredType) {
      return undefined;
    }
    if (
      subjectTypeCatalogSet.size > 0 &&
      !subjectTypeCatalogSet.has(inferredType)
    ) {
      return undefined;
    }
    return inferredType;
  };

  const ensureNode = (
    id: string,
    label: string,
    options?: { asObject?: boolean; asSubject?: boolean; subjectType?: string },
  ): void => {
    const trimmedId = id.trim();
    if (trimmedId.length === 0) {
      return;
    }
    const normalizedSubjectType = options?.subjectType?.trim();
    const existing = nodeMeta.get(trimmedId);
    if (existing) {
      existing.isObject = existing.isObject || options?.asObject === true;
      existing.isSubject = existing.isSubject || options?.asSubject === true;
      if (
        normalizedSubjectType &&
        normalizedSubjectType.length > 0 &&
        !existing.subjectType
      ) {
        existing.subjectType = normalizedSubjectType;
      }
      if (
        label.trim().length > 0 &&
        existing.label === trimmedId &&
        label.trim() !== trimmedId
      ) {
        existing.label = label.trim();
      }
      return;
    }
    nodeMeta.set(trimmedId, {
      id: trimmedId,
      label: label.trim().length > 0 ? label.trim() : trimmedId,
      isObject: options?.asObject === true,
      isSubject: options?.asSubject === true,
      subjectType:
        normalizedSubjectType && normalizedSubjectType.length > 0
          ? normalizedSubjectType
          : undefined,
    });
  };

  const appendEdge = (edge: InstanceGraphPayload["edges"][number]): void => {
    const from = edge.from.trim();
    const to = edge.to.trim();
    if (from.length === 0 || to.length === 0) {
      return;
    }
    const key = `${from}::${to}::${edge.label}::${edge.dashed ? "d" : "s"}`;
    if (edgeMap.has(key)) {
      return;
    }
    edgeMap.set(key, {
      ...edge,
      from,
      to,
    });
  };

  objectItems.forEach((item) => {
    const objectId = item.object_id.trim();
    if (objectId.length === 0) {
      return;
    }
    const objectType = (item.object_type ?? "").trim();
    const objectLabel =
      objectType.length > 0
        ? `${objectId} (${objectType})`
        : objectId;
    ensureNode(objectId, objectLabel, { asObject: true });

    const ownerRef = (item.owner_ref ?? "").trim();
    if (ownerRef.length === 0) {
      return;
    }
    ensureNode(ownerRef, ownerRef, {
      asSubject: true,
      subjectType: inferSubjectType(ownerRef),
    });
    appendEdge({
      from: ownerRef,
      to: objectId,
      label: "owner_ref",
      dashed: true,
      color: "#8b5cf6",
    });
  });

  relationItems.forEach((item) => {
    const from = item.from.trim();
    const to = item.to.trim();
    if (from.length === 0 || to.length === 0) {
      return;
    }
    ensureNode(from, from, {
      asSubject: true,
      subjectType: inferSubjectType(from),
    });
    ensureNode(to, to, {
      asSubject: true,
      subjectType: inferSubjectType(to),
    });

    const relationType = item.relation_type.trim();
    const scope = (item.scope ?? "").trim();
    const label =
      relationType.length > 0
        ? scope.length > 0
          ? `${relationType} [${scope}]`
          : relationType
        : "related_to";

    appendEdge({
      from,
      to,
      label,
      dashed: false,
      color: "#2563eb",
    });
  });

  const nodes = [...nodeMeta.values()]
    .map((item) => {
      const category: InstanceGraphPayload["nodes"][number]["category"] =
        item.isObject && item.isSubject
          ? "mixed"
          : item.isObject
            ? "object"
            : "subject";
      return {
        id: item.id,
        label: item.label,
        category,
        ...(item.subjectType
          ? {
              subject_type: item.subjectType,
            }
          : {}),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    nodes,
    edges: [...edgeMap.values()],
    subject_layout: {
      type_catalog: subjectLayoutModelMeta.typeCatalog,
      type_edges: subjectLayoutModelMeta.typeEdges.map((item) => ({
        from_type: item.fromType,
        to_type: item.toType,
      })),
    },
  };
}

function buildCurrentInstanceSnapshot(
  viewModel: ConsolePageViewModel,
  namespace: string,
): InstanceSnapshotPayload {
  const modelRoutes = viewModel.model_routes?.ok
    ? viewModel.model_routes.data.items.map((item) => ({
        namespace: item.namespace,
        tenant_id: item.tenant_id,
        environment: item.environment,
        model_id: item.model_id,
        model_version: item.model_version,
        publish_id: item.publish_id,
        operator: item.operator,
      }))
    : [];
  const objects = viewModel.control_objects?.ok
    ? viewModel.control_objects.data.items.map((item) => ({
        object_id: item.object_id,
        object_type: item.object_type,
        sensitivity: item.sensitivity,
        owner_ref: item.owner_ref,
        labels: item.labels,
        updated_at: item.updated_at,
      }))
    : [];
  const relationEvents = viewModel.control_relations?.ok
    ? viewModel.control_relations.data.items.map((item) => ({
        from: item.from,
        to: item.to,
        relation_type: item.relation_type,
        operation: "upsert" as const,
        scope: item.scope,
        source: item.source,
        updated_at: item.updated_at,
      }))
    : [];

  return {
    namespace,
    model_routes: modelRoutes,
    objects,
    relation_events: relationEvents,
  };
}

function buildFixtureInstanceSnapshot(
  namespace: string,
  fixture: ControlSetupFixture,
): InstanceSnapshotPayload {
  return {
    namespace,
    model_routes: [],
    objects: fixture.objects.map((item) => ({
      object_id: item.object_id,
      object_type: item.object_type,
      sensitivity: item.sensitivity,
      owner_ref: item.owner_ref,
      labels: item.labels,
    })),
    relation_events: fixture.relation_events.map((item) => ({
      from: item.from,
      to: item.to,
      relation_type: item.relation_type,
      operation: item.operation,
      scope: item.scope,
      source: item.source,
    })),
  };
}

function buildInstanceSnapshotJson(snapshot: InstanceSnapshotPayload): string {
  return JSON.stringify(snapshot, null, 2);
}

function renderInstanceObjectRows(
  objects: InstanceSnapshotPayload["objects"],
): string {
  return objects
    .slice(0, 6)
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.object_id)}</td><td>${escapeHtml(item.object_type)}</td><td>${escapeHtml(item.sensitivity ?? "")}</td><td>${escapeHtml(item.owner_ref ?? "")}</td><td>${escapeHtml((item.labels ?? []).join(", "))}</td><td>${escapeHtml(item.updated_at ? formatTime(item.updated_at) : "待导入")}</td></tr>`,
    )
    .join("");
}

function renderInstanceRelationRows(
  relationEvents: InstanceSnapshotPayload["relation_events"],
): string {
  return relationEvents
    .slice(0, 6)
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.from)}</td><td>${escapeHtml(item.relation_type)}</td><td>${escapeHtml(item.to)}</td><td>${escapeHtml(item.scope ?? "")}</td><td>${escapeHtml(item.updated_at ? formatTime(item.updated_at) : "待导入")}</td></tr>`,
    )
    .join("");
}

function renderControlPlaneOverview(viewModel: ConsolePageViewModel): string {
  const namespace = viewModel.query.namespace ?? "tenant_a.crm";
  const overviewMetrics = collectControlOverviewMetrics(viewModel);
  const publishedModelMetrics = collectPublishedModelOverviewMetrics(viewModel);
  const runtimeRouteOverview = collectRuntimeRouteOverview(viewModel);
  const routeMismatchMessage = buildRouteMismatchMessage(
    publishedModelMetrics,
    runtimeRouteOverview,
  );
  const modelRouteCount = viewModel.model_routes?.ok
    ? viewModel.model_routes.data.total_count
    : 0;
  const hiddenContext = renderHiddenContextFields(viewModel);
  const hiddenWithoutNamespace = renderHiddenContextFields(viewModel, [
    "namespace",
    "fixture_id",
  ]);
  const setupFixtureOptions = listSetupFixtureOptions();
  const expectationFixtureOptions = listExpectationFixtureOptions();
  const hasSetupFixtureOptions = setupFixtureOptions.length > 0;
  const hasExpectationFixtureOptions = expectationFixtureOptions.length > 0;
  const activeSetupFixtureId =
    viewModel.query.fixture_id ??
    setupFixtureOptions[0]?.id ??
    expectationFixtureOptions[0]?.id ??
    "";
  const activeSetupFixtureOption = setupFixtureOptions.find(
    (option) => option.id === activeSetupFixtureId,
  );
  const activeSetupFixture = activeSetupFixtureId
    ? loadSetupFixtureById(activeSetupFixtureId)
    : null;
  const currentRoute = viewModel.model_routes?.ok
    ? viewModel.model_routes.data.items[0]
    : undefined;
  const expectationTenantId =
    activeSetupFixture?.fixture.route?.tenant_id ?? currentRoute?.tenant_id ?? "";
  const expectationEnvironment =
    activeSetupFixture?.fixture.route?.environment ??
    currentRoute?.environment ??
    "";
  const defaultExpectationJson = activeSetupFixtureId
    ? readFixtureFileContent(activeSetupFixtureId, ".expected.json")
    : "";
  const setupFixtureSelectOptions = hasSetupFixtureOptions
    ? setupFixtureOptions
        .map(
          (option) =>
            `<option value="${escapeHtml(option.id)}" ${option.id === activeSetupFixtureId ? "selected" : ""} title="${escapeHtml(option.description)}">${escapeHtml(option.label)}</option>`,
        )
        .join("")
    : '<option value="">暂无可用 setup fixture</option>';
  const expectationFixtureSelectOptions = hasExpectationFixtureOptions
    ? expectationFixtureOptions
        .map(
          (option) =>
            `<option value="${escapeHtml(option.id)}" ${option.id === activeSetupFixtureId ? "selected" : ""} title="${escapeHtml(option.description)}">${escapeHtml(option.label)}</option>`,
        )
        .join("")
    : '<option value="">暂无可用 expectation fixture</option>';
  const setupFixtureSelectAttr = hasSetupFixtureOptions
    ? "required"
    : "disabled";
  const expectationFixtureSelectAttr = hasExpectationFixtureOptions
    ? "required"
    : "disabled";
  const previewSetupSubmitAttr = hasSetupFixtureOptions ? "" : "disabled";
  const currentInstanceSnapshot = buildCurrentInstanceSnapshot(
    viewModel,
    namespace,
  );
  const stagedInstanceSnapshot = activeSetupFixture
    ? buildFixtureInstanceSnapshot(namespace, activeSetupFixture.fixture)
    : currentInstanceSnapshot;
  const stagedInstanceGraphPayload = buildInstanceGraphPayload(viewModel, {
    objects: stagedInstanceSnapshot.objects,
    relations: stagedInstanceSnapshot.relation_events,
  });
  const instanceGraphPayloadJson = escapeHtml(
    JSON.stringify(stagedInstanceGraphPayload),
  );
  const instanceSnapshotJson = escapeHtml(
    buildInstanceSnapshotJson(stagedInstanceSnapshot),
  );
  const stagedPreviewTitle = activeSetupFixtureOption
    ? `当前预览：${activeSetupFixtureOption.label}`
    : "当前预览：当前命名空间数据";
  const stagedPreviewDescription = activeSetupFixtureOption
    ? `${activeSetupFixtureOption.description}；已加载到下方视图，可先修改 JSON 再执行 setup。`
    : "未选择 setup fixture，当前展示的是该 namespace 已存在的 instance 数据。";
  const modelTemplateOptions = buildModelTemplateOptions(namespace);
  const [defaultTemplateOption] = modelTemplateOptions;
  if (!defaultTemplateOption) {
    throw new Error("model template options are empty");
  }
  const defaultModel = defaultTemplateOption.model;
  const defaultTemplateMeta = getModelMetaFromSnapshot(defaultModel);
  const defaultRule = defaultModel.policies.rules[0] ?? {};
  const defaultModelJson = escapeHtml(JSON.stringify(defaultModel, null, 2));
  const modelTemplateMap = Object.fromEntries(
    modelTemplateOptions.map((option) => [option.id, option.model]),
  );
  const modelTemplateMapJson = escapeHtml(JSON.stringify(modelTemplateMap));
  const modelTemplateSelectOptions = modelTemplateOptions
    .map(
      (option, index) =>
        `<option value="${escapeHtml(option.id)}" ${index === 0 ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
  const defaultTemplateDescription = escapeHtml(
    defaultTemplateOption.description,
  );
  const actionCatalog = escapeHtml(
    defaultModel.catalogs.action_catalog.join("\n"),
  );
  const subjectTypeCatalog = escapeHtml(
    defaultModel.catalogs.subject_type_catalog.join("\n"),
  );
  const objectTypeCatalog = escapeHtml(
    defaultModel.catalogs.object_type_catalog.join("\n"),
  );
  const subjectRelationTypeCatalog = escapeHtml(
    (defaultModel.catalogs.subject_relation_type_catalog ?? []).join("\n"),
  );
  const objectRelationTypeCatalog = escapeHtml(
    (defaultModel.catalogs.object_relation_type_catalog ?? []).join("\n"),
  );
  const subjectObjectRelationTypeCatalog = escapeHtml(
    (defaultModel.catalogs.subject_object_relation_type_catalog ?? []).join(
      "\n",
    ),
  );
  const mandatoryObligations = escapeHtml(
    defaultModel.quality_guardrails.mandatory_obligations.join("\n"),
  );
  const ruleActionSet = escapeHtml(
    Array.isArray(defaultRule.action_set)
      ? defaultRule.action_set
          .filter((item): item is string => typeof item === "string")
          .join("\n")
      : "",
  );
  const ruleId = escapeHtml(
    typeof defaultRule.id === "string" ? defaultRule.id : "",
  );
  const ruleSubjectSelector = escapeHtml(
    typeof defaultRule.subject_selector === "string"
      ? defaultRule.subject_selector
      : "",
  );
  const ruleObjectSelector = escapeHtml(
    typeof defaultRule.object_selector === "string"
      ? defaultRule.object_selector
      : "",
  );
  const ruleEffect = escapeHtml(
    typeof defaultRule.effect === "string" ? defaultRule.effect : "allow",
  );
  const rulePriority =
    typeof defaultRule.priority === "number"
      ? String(defaultRule.priority)
      : "100";

  // 生成 policy rules 列表
  const policyRulesRows = defaultModel.policies.rules
    .map((rule, index) => {
      const ruleId = typeof rule.id === "string" ? rule.id : `rule_${index}`;
      const ruleEffect =
        typeof rule.effect === "string" ? rule.effect : "allow";
      const rulePriority =
        typeof rule.priority === "number" ? String(rule.priority) : "-";
      const ruleActions = Array.isArray(rule.action_set)
        ? rule.action_set
            .filter((item): item is string => typeof item === "string")
            .join(", ")
        : "-";
      const ruleSubjectSelector =
        typeof rule.subject_selector === "string" ? rule.subject_selector : "-";
      const ruleObjectSelector =
        typeof rule.object_selector === "string" ? rule.object_selector : "-";
      return (
        `<tr>` +
        `<td>${escapeHtml(ruleId)}</td>` +
        `<td><span class="badge ${ruleEffect === "allow" ? "badge-success" : "badge-danger"}">${escapeHtml(ruleEffect)}</span></td>` +
        `<td>${escapeHtml(rulePriority)}</td>` +
        `<td>${escapeHtml(ruleActions)}</td>` +
        `<td><code class="selector-code">${escapeHtml(ruleSubjectSelector)}</code></td>` +
        `<td><code class="selector-code">${escapeHtml(ruleObjectSelector)}</code></td>` +
        `</tr>`
      );
    })
    .join("");

  const auditRows = viewModel.control_audits?.ok
    ? viewModel.control_audits.data.items
        .slice(0, 6)
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.event_type)}</td><td>${escapeHtml(item.target)}</td><td>${escapeHtml(item.operator)}</td><td>${escapeHtml(formatTime(item.created_at))}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="muted">审计数据加载失败</td></tr>';

  const objectRows = renderInstanceObjectRows(stagedInstanceSnapshot.objects);

  const relationRows = renderInstanceRelationRows(
    stagedInstanceSnapshot.relation_events,
  );

  const modelRouteRows = viewModel.model_routes?.ok
    ? viewModel.model_routes.data.items
        .slice(0, 8)
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.tenant_id)}</td><td>${escapeHtml(item.environment)}</td><td>${escapeHtml(item.model_id)}</td><td>${escapeHtml(item.model_version ?? "-")}</td><td>${escapeHtml(item.publish_id ?? "-")}</td><td>${escapeHtml(item.namespace)}</td><td>${escapeHtml(item.operator)}</td><td>${escapeHtml(formatTime(item.updated_at))}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="8" class="muted">model route 加载失败</td></tr>';
  const publishedMetricsSection = publishedModelMetrics
    ? `<section>` +
      `<p class="muted metric-caption">发布快照统计（无需先维护 Catalog/Object）</p>` +
      `<p class="muted">统计来源：publish_id=${escapeHtml(publishedModelMetrics.publish_id)} / tenant_id=${escapeHtml(publishedModelMetrics.tenant_id)} / model_id=${escapeHtml(publishedModelMetrics.model_id)} / version=${escapeHtml(publishedModelMetrics.model_version)}</p>` +
      `<section class="decision-grid">` +
      `<div class="metric"><span>subject types</span><strong>${publishedModelMetrics.subject_types}</strong></div>` +
      `<div class="metric"><span>categories(action)</span><strong>${publishedModelMetrics.categories}</strong></div>` +
      `<div class="metric"><span>object types</span><strong>${publishedModelMetrics.object_types}</strong></div>` +
      `<div class="metric"><span>relation types</span><strong>${publishedModelMetrics.relation_types}</strong></div>` +
      `<div class="metric"><span>policy rules</span><strong>${publishedModelMetrics.rules}</strong></div>` +
      `</section>` +
      `</section>`
    : `<section>` +
      `<p class="muted metric-caption">发布快照统计（无需先维护 Catalog/Object）</p>` +
      `<p class="muted">当前未找到可用的 model_snapshot。请先在“发布流程”选择一条包含模型快照的记录，或提交一次发布。</p>` +
      `</section>`;

  const publishContextSection = publishedModelMetrics
    ? `<section>` +
      `<p class="muted metric-caption">当前查看发布（用于理解你刚提交/选中的发布快照）</p>` +
      `<section class="kv-grid">` +
      `<div class="kv-item"><span>publish_id</span><strong>${escapeHtml(publishedModelMetrics.publish_id)}</strong></div>` +
      `<div class="kv-item"><span>tenant</span><strong>${escapeHtml(publishedModelMetrics.tenant_id)}</strong></div>` +
      `<div class="kv-item"><span>model_id</span><strong>${escapeHtml(publishedModelMetrics.model_id)}</strong></div>` +
      `<div class="kv-item"><span>version</span><strong>${escapeHtml(publishedModelMetrics.model_version)}</strong></div>` +
      `</section>` +
      `</section>`
    : `<section>` +
      `<p class="muted metric-caption">当前查看发布（用于理解你刚提交/选中的发布快照）</p>` +
      `<p class="muted">当前没有选中可解析的发布快照；总览无法展示 tenant/model/version。</p>` +
      `</section>`;

  const runtimeRouteSection =
    `<section>` +
    `<p class="muted metric-caption">当前运行态路由（决定这个 namespace 现在会命中哪个已发布模型）</p>` +
    `<section class="kv-grid">` +
    `<div class="kv-item"><span>namespace</span><strong>${escapeHtml(namespace)}</strong></div>` +
    `<div class="kv-item"><span>tenant</span><strong>${escapeHtml(runtimeRouteOverview.tenant_label)}</strong></div>` +
    `<div class="kv-item"><span>environments</span><strong>${escapeHtml(runtimeRouteOverview.environment_label)}</strong></div>` +
    `<div class="kv-item"><span>route count</span><strong>${runtimeRouteOverview.route_count}</strong></div>` +
    `</section>` +
    (runtimeRouteOverview.route_items.length > 0
      ? `<p class="muted">${escapeHtml(
          runtimeRouteOverview.route_items
            .map(
              (item) =>
                `${item.environment}: ${item.model_id} / version=${item.model_version} / publish=${item.publish_id}`,
            )
            .join("；"),
        )}</p>`
      : `<p class="muted">当前 namespace 尚未配置 model_route，运行态不会自动切到你刚发布的模型。</p>`) +
    (routeMismatchMessage
      ? `<p class="overview-alert overview-alert-danger">${escapeHtml(routeMismatchMessage)}</p>`
      : "") +
    `</section>`;

  const defaultTemplateSection =
    `<section>` +
    `<p class="muted metric-caption">默认提交模板（仅影响“策略模型提交”表单初始值，不代表当前生效模型）</p>` +
    `<section class="kv-grid">` +
    `<div class="kv-item"><span>template</span><strong>${escapeHtml(defaultTemplateOption.label)}</strong></div>` +
    `<div class="kv-item"><span>tenant</span><strong>${escapeHtml(defaultTemplateMeta?.tenant_id ?? "-")}</strong></div>` +
    `<div class="kv-item"><span>model_id</span><strong>${escapeHtml(defaultTemplateMeta?.model_id ?? "-")}</strong></div>` +
    `<div class="kv-item"><span>version</span><strong>${escapeHtml(defaultTemplateMeta?.version ?? "-")}</strong></div>` +
    `</section>` +
    `</section>`;

  const controlRuntimeHint =
    overviewMetrics.subjects +
      overviewMetrics.objects +
      overviewMetrics.relations +
      modelRouteCount ===
    0
      ? '<p class="muted">当前运行态控制面为空（这不影响上方发布快照统计）。</p>'
      : "";

  const hasObjectItems = Boolean(
    stagedInstanceSnapshot.objects.length > 0,
  );
  const hasRelationItems = Boolean(
    stagedInstanceSnapshot.relation_events.length > 0,
  );
  const hasModelRouteItems = Boolean(
    viewModel.model_routes?.ok && viewModel.model_routes.data.items.length > 0,
  );
  const hasAuditItems = Boolean(
    viewModel.control_audits?.ok &&
    viewModel.control_audits.data.items.length > 0,
  );
  const modelRouteTableSection =
    viewModel.model_routes?.ok && !hasModelRouteItems
      ? ""
      : `<section class="runtime-table-card"><h4>模型路由 Model Routes</h4><div class="table-container management-table"><table class="data-table"><thead><tr><th>Tenant</th><th>Env</th><th>Model ID</th><th>Version</th><th>Publish ID</th><th>Namespace</th><th>Operator</th><th>Updated</th></tr></thead><tbody>${modelRouteRows}</tbody></table></div></section>`;
  const auditTableSection =
    viewModel.control_audits?.ok && !hasAuditItems
      ? ""
      : `<section class="runtime-table-card"><h4>审计事件 Audits</h4><div class="table-container"><table class="data-table"><thead><tr><th>Event</th><th>Target</th><th>Operator</th><th>Created At</th></tr></thead><tbody>${auditRows}</tbody></table></div></section>`;
  const objectTableSection =
    !hasObjectItems
      ? ""
      : `<section class="runtime-table-card"><h4>客体台账 Objects</h4><div class="table-container management-table"><table class="data-table"><thead><tr><th>Object ID</th><th>Type</th><th>Sensitivity</th><th>Owner</th><th>Labels</th><th>Updated</th></tr></thead><tbody>${objectRows}</tbody></table></div></section>`;
  const relationTableSection =
    !hasRelationItems
      ? ""
      : `<section class="runtime-table-card"><h4>关系边 Relations</h4><div class="table-container management-table"><table class="data-table"><thead><tr><th>From</th><th>Relation</th><th>To</th><th>Scope</th><th>Updated</th></tr></thead><tbody>${relationRows}</tbody></table></div></section>`;

  const fixedRuntimeSection = modelRouteTableSection + auditTableSection;
  const objectRelationTableSection = objectTableSection + relationTableSection;
  const fixedRuntimeSectionWithFallback =
    fixedRuntimeSection.length > 0
      ? fixedRuntimeSection
      : `<section class="runtime-empty-hint">` +
        `<p class="muted">当前命名空间暂无模型路由与审计事件数据。</p>` +
        `</section>`;
  const objectRelationSectionWithFallback =
    objectRelationTableSection.length > 0
      ? objectRelationTableSection
      : `<section class="runtime-empty-hint">` +
        `<p class="muted">当前预览暂无客体台账与关系边数据。</p>` +
        `<p class="muted">可切换其他预置 instance，或直接在 JSON 视图补充后再执行 setup。</p>` +
        `</section>`;
  const namespaceSwitchForm =
    `<form class="filters toolbar" method="GET" action="/" data-control-incremental="true" data-control-namespace-form="true">` +
    `<label>命名空间 Namespace` +
    `<input type="text" name="namespace" value="${escapeHtml(namespace)}" placeholder="tenant_a.crm" />` +
    `</label>` +
    renderScopedHiddenContextFields(viewModel, ["tab", "widget", "detail_mode"]) +
    `<input type="hidden" name="fixture_id" value="${escapeHtml(activeSetupFixtureId)}" />` +
    `<button type="submit" class="btn btn-primary">切换命名空间</button>` +
    `</form>`;
  const runtimeSummarySection =
    `<section data-control-runtime-summary>` +
    `<p class="muted metric-caption">运行态控制面统计（subject 来自 relation 端点与 object.owner_ref 推断）</p>` +
    controlRuntimeHint +
    `<section class="decision-grid">` +
    `<div class="metric"><span>subjects</span><strong>${overviewMetrics.subjects}</strong></div>` +
    `<div class="metric"><span>objects</span><strong>${overviewMetrics.objects}</strong></div>` +
    `<div class="metric"><span>relations</span><strong>${overviewMetrics.relations}</strong></div>` +
    `<div class="metric"><span>model routes</span><strong>${modelRouteCount}</strong></div>` +
    `</section>` +
    `</section>`;
  const expectationRunSection =
    `<section data-expectation-run-section>` +
    renderExpectationRunForm(viewModel, {
      namespace,
      fixture_id: activeSetupFixtureId,
      fixture_select_options: expectationFixtureSelectOptions,
      fixture_select_attr: expectationFixtureSelectAttr,
      tenant_id: expectationTenantId,
      environment: expectationEnvironment,
      default_expectation_json: defaultExpectationJson,
    }) +
    renderExpectationRunReport(viewModel, viewModel.expectation_run) +
    `</section>`;
  const advancedOpsSection = renderAdvancedOpsSection(viewModel, {
    namespace,
    tenant_id: expectationTenantId,
    environment: expectationEnvironment,
    publish_id: currentRoute?.publish_id,
    model_id:
      currentRoute?.model_id ??
      defaultTemplateMeta?.model_id ??
      defaultModel.model_meta.model_id,
    model_version:
      currentRoute?.model_version ??
      defaultTemplateMeta?.version ??
      defaultModel.model_meta.version,
  });
  return (
    `<article class="card card-hover">` +
    `<h3>控制面总览</h3>` +
    publishedMetricsSection +
    publishContextSection +
    runtimeRouteSection +
    defaultTemplateSection +
    `${renderControlJourneyCard(namespace)}` +
    `<p class="muted metric-caption">上半区聚焦模型发布与发布快照；运行态工作区选择与 instance 维护放在下方单独卡片。</p>` +
    `<p class="muted metric-caption">说明：下方维护操作只写入控制面运行态数据，不会回写“策略模型提交”卡片中的 JSON。</p>` +
    `<section class="control-lane">` +
    `<div class="section-head section-head-lane"><h4>1. 提交模型并发起发布</h4><span class="muted">编辑模型草稿，生成 publish 请求，进入后续治理流程</span></div>` +
    `<section class="management-grid model-submit-grid">` +
    `<form class="action-form model-submit-form" method="POST" action="/actions/publish/submit" data-model-jsoneditor-form="true">` +
    `<h4>策略模型提交</h4>` +
    hiddenContext +
    `<label>发布ID Publish ID (可选)<input type="text" name="publish_id" placeholder="pub_20260304_001" /></label>` +
    `<label>档位 Profile<select name="profile"><option value="">auto</option><option value="baseline">baseline</option><option value="strict_compliance">strict_compliance</option></select></label>` +
    `<label>提交人 Submitted By<input type="text" name="submitted_by" value="console_operator" /></label>` +
    `<section class="model-editor" data-model-editor data-json-scope>` +
    `<div class="model-editor-head">` +
    `<p class="muted">模型编辑模式</p>` +
    `<div class="model-editor-head-actions">` +
    `<label class="model-template-picker">策略样例 Template` +
    `<select data-model-template-select>${modelTemplateSelectOptions}</select>` +
    `</label>` +
    `${renderModelEditorToggleSwitch()}` +
    `</div>` +
    `</div>` +
    `<textarea hidden data-model-template-map>${modelTemplateMapJson}</textarea>` +
    `<section class="json-switchable" data-json-switchable>` +
    `<div class="json-view" data-json-view="visual">` +
    `<div class="model-editor-grid">` +
    `<label>模型ID Model ID<input type="text" value="${escapeHtml(defaultModel.model_meta.model_id)}" data-model-field="model_id" /></label>` +
    `<label>租户ID Tenant ID<input type="text" value="${escapeHtml(defaultModel.model_meta.tenant_id)}" data-model-field="tenant_id" /></label>` +
    `<label>版本 Version<input type="text" value="${escapeHtml(defaultModel.model_meta.version)}" data-model-field="version" /></label>` +
    `<label>合并算法 Combining Algorithm<select data-model-field="combining_algorithm"><option value="deny-overrides" ${defaultModel.model_meta.combining_algorithm === "deny-overrides" ? "selected" : ""}>deny-overrides</option><option value="permit-overrides" ${defaultModel.model_meta.combining_algorithm === "permit-overrides" ? "selected" : ""}>permit-overrides</option><option value="first-applicable" ${defaultModel.model_meta.combining_algorithm === "first-applicable" ? "selected" : ""}>first-applicable</option></select></label>` +
    `<label>动作目录 Action Catalog<textarea rows="3" data-model-field="action_catalog">${actionCatalog}</textarea></label>` +
    `<label>主体类型目录 Subject Type Catalog<textarea rows="3" data-model-field="subject_type_catalog">${subjectTypeCatalog}</textarea></label>` +
    `<label>客体类型目录 Object Type Catalog<textarea rows="3" data-model-field="object_type_catalog">${objectTypeCatalog}</textarea></label>` +
    `<label>主体关系目录 Subject Relation Catalog<textarea rows="3" data-model-field="subject_relation_type_catalog">${subjectRelationTypeCatalog}</textarea></label>` +
    `<label>客体关系目录 Object Relation Catalog<textarea rows="3" data-model-field="object_relation_type_catalog">${objectRelationTypeCatalog}</textarea></label>` +
    `<label>主体-客体关系目录 Subject-Object Relation Catalog<textarea rows="3" data-model-field="subject_object_relation_type_catalog">${subjectObjectRelationTypeCatalog}</textarea></label>` +
    `<label>强制义务 Mandatory Obligations<textarea rows="3" data-model-field="mandatory_obligations">${mandatoryObligations}</textarea></label>` +
    `</div>` +
    `<div class="policy-rules-section">` +
    `<h5>Policy Rules 列表 <span class="muted">(${defaultModel.policies.rules.length} 条)</span></h5>` +
    `<div class="table-container"><table class="data-table policy-rules-table"><thead><tr><th>Rule ID</th><th>效果</th><th>优先级</th><th>动作</th><th>主体选择器</th><th>客体选择器</th></tr></thead><tbody>${policyRulesRows}</tbody></table></div>` +
    `</div>` +
    `<details class="policy-rule-editor">` +
    `<summary><strong>规则编辑器</strong>（编辑后同步到 JSON）</summary>` +
    `<div class="model-editor-grid rule-editor-grid">` +
    `<label>规则ID Rule ID<input type="text" value="${ruleId}" data-model-field="rule_id" /></label>` +
    `<label>规则效果 Rule Effect<select data-model-field="rule_effect"><option value="allow" ${ruleEffect === "allow" ? "selected" : ""}>allow</option><option value="deny" ${ruleEffect === "deny" ? "selected" : ""}>deny</option></select></label>` +
    `<label>规则优先级 Rule Priority<input type="number" min="1" value="${escapeHtml(rulePriority)}" data-model-field="rule_priority" /></label>` +
    `<label>规则动作 Rule Actions<textarea rows="3" data-model-field="rule_action_set">${ruleActionSet}</textarea></label>` +
    `<label>主体选择器 Subject Selector<textarea rows="3" data-model-field="rule_subject_selector">${ruleSubjectSelector}</textarea></label>` +
    `<label>客体选择器 Object Selector<textarea rows="3" data-model-field="rule_object_selector">${ruleObjectSelector}</textarea></label>` +
    `</div>` +
    `</details>` +
    `<p class="muted model-editor-note">字段变更会自动同步到 JSON，可直接提交。</p>` +
    `</div>` +
    `<div class="json-view" data-json-view="raw" hidden>` +
    `<div class="raw-json-toolbar"><button type="button" class="btn btn-secondary" data-apply-model-json>从 JSON 刷新字段</button></div>` +
    `<section class="instance-json-rich-editor" data-instance-json-rich-editor hidden>` +
    `<div class="raw-json-toolbar"><button type="button" class="btn btn-secondary" data-instance-jsoneditor-reset>从文本重新加载</button></div>` +
    `<div class="instance-json-rich-editor-target" data-instance-jsoneditor-target></div>` +
    `<p class="muted instance-json-rich-editor-hint" data-instance-jsoneditor-status>结构化编辑器已启用：支持层级折叠、节点级值编辑与搜索。</p>` +
    `</section>` +
    `<label data-instance-json-textarea-field>模型JSON Model JSON<textarea name="model_json" rows="12" required data-model-json data-instance-json-textarea>${defaultModelJson}</textarea></label>` +
    `<p class="muted model-editor-note">修改 JSON 后可点“从 JSON 刷新字段”，再回到图形化继续编辑。</p>` +
    `</div>` +
    `<div class="json-view" data-json-view="graph" hidden>` +
    `<section class="model-graph" data-model-graph>` +
    `<p class="muted model-graph-placeholder">Graph 视图会根据 catalogs、relation_signature 与 context_inference 展示模型定义层的关系结构与推理过程。</p>` +
    `</section>` +
    `</div>` +
    `</section>` +
    `</section>` +
    `<button type="submit" class="btn btn-primary">提交发布请求</button>` +
    `</form>` +
    `</section>` +
    `</section>` +
    `<section class="control-lane">` +
    `<div class="section-head section-head-lane"><h4>2. 维护运行态对象与关系</h4><span class="muted">切换 namespace、预览 fixture、执行 setup，并维护 route/object/relation</span></div>` +
    `<section class="card card-hover instance-editor-card">` +
    `<h4>Instance 导入 / 维护 / 展示</h4>` +
    `<p class="muted">预置场景批量导入：可基于内置 fixture 或手工 JSON 一次性写入当前 namespace 的运行态数据；fixture 模式会自动发布同名 model 并绑定 route。</p>` +
    `<p class="muted">此卡片只维护运行态 instance 数据（model_route / object / relation），不会修改上方“策略模型提交”的 JSON。</p>` +
    namespaceSwitchForm +
    runtimeSummarySection +
    `<section data-control-fixed-runtime>${fixedRuntimeSectionWithFallback}</section>` +
    `<form class="action-form setup-fixture-preview-form" method="GET" action="/" data-control-incremental="true" data-control-setup-form="true" data-control-setup-preview-form="true">` +
    `<h4>预置场景选择</h4>` +
    hiddenWithoutNamespace +
    `<div class="setup-fixture-preview-grid">` +
    `<label>命名空间 Namespace<input type="text" name="namespace" value="${escapeHtml(namespace)}" required /></label>` +
    `<label>预置 Instance<select name="fixture_id" ${setupFixtureSelectAttr}>${setupFixtureSelectOptions}</select></label>` +
    `</div>` +
    `<p class="muted">选择即预览，下方“客体台账 / 关系边视图”和 JSON 会立即切换；可先修改，再执行 setup。</p>` +
    `</form>` +
    `<section class="model-editor" data-instance-editor>` +
    `<section class="instance-object-relation-block" data-json-scope>` +
    `<form class="action-form setup-fixture-form" method="POST" action="/actions/control/setup/apply" data-control-incremental="true" data-control-instance-json-form="true">` +
    hiddenWithoutNamespace +
    `<input type="hidden" name="fixture_id" value="${escapeHtml(activeSetupFixtureId)}" />` +
    `<input type="hidden" name="namespace" value="${escapeHtml(namespace)}" />` +
    `<div class="model-editor-head">` +
    `<p class="muted">客体台账 / 关系边视图</p>` +
    `<div class="model-editor-head-actions">${renderModelEditorToggleSwitch()}</div>` +
    `</div>` +
    `<p class="muted">${escapeHtml(stagedPreviewTitle)}</p>` +
    `<p class="muted">${escapeHtml(stagedPreviewDescription)}</p>` +
    `<section class="json-switchable" data-json-switchable>` +
    `<div class="json-view" data-json-view="visual">` +
    `<section data-control-object-relation-visual>${objectRelationSectionWithFallback}</section>` +
    `</div>` +
    `<div class="json-view" data-json-view="graph" hidden>` +
    `<section class="model-graph" data-instance-graph data-subject-tree-direction="bottom-up">` +
    `<textarea hidden data-instance-graph-payload>${instanceGraphPayloadJson}</textarea>` +
    `<p class="muted model-graph-placeholder">Graph 视图展示当前预览 instance 的关系（relation_events + object.owner_ref）。</p>` +
    `<div class="instance-graph-layout-bar"><span class="muted">Subject 树方向</span><div class="json-toggle" role="tablist" aria-label="Subject 树方向"><button type="button" class="json-toggle-btn active" data-instance-subject-direction-btn="bottom-up" aria-pressed="true">自下而上</button><button type="button" class="json-toggle-btn" data-instance-subject-direction-btn="top-down" aria-pressed="false">自上而下</button></div></div>` +
    `<div class="model-graph-chart-wrap"><div class="instance-graph-actions"><button type="button" class="model-graph-node-hide" data-instance-hide-node title="先点击一个节点，再点击隐藏" disabled>隐藏节点</button><button type="button" class="model-graph-zoom-reset" title="重置缩放并恢复全部节点">重置</button></div><div class="model-graph-echart" data-instance-echart role="img" aria-label="Instance 关系图"></div></div>` +
    `<p class="muted model-graph-legend">说明：左侧 subject 节点按模型定义的 type 分层树状布局（同 type 同层，可切换自下而上/自上而下）；边标签为 relation_type（含 scope）；虚线代表 owner_ref 关系。点击节点后可用“隐藏节点”临时隐藏该节点及关联边，点击“重置”恢复全部节点。</p>` +
    `</section>` +
    `</div>` +
    `<div class="json-view" data-json-view="raw" hidden>` +
    `<section class="instance-json-rich-editor" data-instance-json-rich-editor hidden>` +
    `<div class="raw-json-toolbar"><button type="button" class="btn btn-secondary" data-instance-jsoneditor-reset>从文本重新加载</button></div>` +
    `<div class="instance-json-rich-editor-target" data-instance-jsoneditor-target></div>` +
    `<p class="muted instance-json-rich-editor-hint" data-instance-jsoneditor-status>结构化编辑器已启用：支持层级折叠、节点级值编辑与搜索。</p>` +
    `</section>` +
    `<label data-instance-json-textarea-field>Instance JSON<textarea name="instance_json" rows="16" required data-instance-json-textarea>${instanceSnapshotJson}</textarea></label>` +
    `<p class="muted model-editor-note">支持字段：namespace、objects、relation_events（可选 model_routes）。可基于当前预览微调后，再执行 setup。</p>` +
    `</div>` +
    `</section>` +
    `<button type="submit" class="btn btn-primary" ${previewSetupSubmitAttr}>执行批量 Setup（自动绑定 Route）</button>` +
    `</form>` +
    `</section>` +
    expectationRunSection +
    advancedOpsSection +
    `</section>` +
    `</section>` +
    `</section>` +
    `</article>`
  );
}

function renderComponentsIndexView(viewModel: ConsolePageViewModel): string {
  const widgetRows = renderWidgetRows(viewModel);
  const hiddenContext = renderHiddenContextFields(viewModel, ["tab"]);

  return (
    `<article class="card card-hover story-entry-card">` +
    `<h3>组件索引</h3>` +
    `<p class="muted">该页面用于查看可嵌入组件与对应链接，不属于控制面运行态数据。</p>` +
    `<form class="filters toolbar" method="GET" action="/">` +
    hiddenContext +
    `<input type="hidden" name="tab" value="components" />` +
    `<button type="submit" class="btn btn-secondary">刷新组件索引</button>` +
    `</form>` +
    `<div class="table-container management-table"><table class="data-table"><thead><tr><th>Widget ID</th><th>组件</th><th>用途</th><th>Embed</th></tr></thead><tbody>${widgetRows}</tbody></table></div>` +
    `</article>`
  );
}

function renderPublishSummary(viewModel: ConsolePageViewModel): string {
  if (!viewModel.publish_list.ok) {
    return '<div class="badge-row"><span class="badge badge-danger">列表加载失败</span></div>';
  }

  const current = viewModel.publish_list.data.items.length;
  const total = viewModel.publish_list.data.total_count;
  const status = viewModel.query.status ?? "all";
  const profile = viewModel.query.profile ?? "all";

  return (
    `<div class=\"badge-row\">` +
    `<span class=\"badge badge-info\">status: ${escapeHtml(status)}</span>` +
    `<span class=\"badge badge-neutral\">profile: ${escapeHtml(profile)}</span>` +
    `<span class=\"badge badge-primary\">当前 ${current} 条 / 总计 ${total} 条</span>` +
    `</div>`
  );
}

function renderPagination(
  viewModel: ConsolePageViewModel,
  prevQuery: URLSearchParams,
  nextQuery: URLSearchParams,
  hasPrev: boolean,
  hasNext: boolean,
): string {
  if (!viewModel.publish_list.ok) {
    return "";
  }

  const {
    items,
    offset,
    total_count: totalCount,
  } = viewModel.publish_list.data;
  const start = items.length === 0 ? 0 : offset + 1;
  const end = items.length === 0 ? 0 : offset + items.length;
  const info =
    totalCount === 0
      ? "当前无记录"
      : `第 ${start}-${end} 条，共 ${totalCount} 条`;

  const currentPage = Math.floor(offset / viewModel.query.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / viewModel.query.limit));
  const nextPage = Math.min(currentPage + 1, totalPages);
  const prevPage = Math.max(currentPage - 1, 1);

  return (
    `<div class=\"pagination-wrapper\">` +
    `<span class=\"pagination-info\">${info}</span>` +
    `<div class=\"pagination\">` +
    `${
      hasPrev
        ? `<a class=\"pagination-arrow\" href=\"/?${prevQuery.toString()}\" aria-label=\"上一页\">&lsaquo;</a>`
        : '<span class="pagination-arrow disabled" aria-hidden="true">&lsaquo;</span>'
    }` +
    `${
      hasPrev
        ? `<a class=\"pagination-item\" href=\"/?${prevQuery.toString()}\">${prevPage}</a>`
        : ""
    }` +
    `<span class=\"pagination-item active\">${currentPage}</span>` +
    `${
      hasNext
        ? `<a class=\"pagination-item\" href=\"/?${nextQuery.toString()}\">${nextPage}</a>`
        : ""
    }` +
    `${
      hasNext
        ? `<a class=\"pagination-arrow\" href=\"/?${nextQuery.toString()}\" aria-label=\"下一页\">&rsaquo;</a>`
        : '<span class="pagination-arrow disabled" aria-hidden="true">&rsaquo;</span>'
    }` +
    `</div>` +
    `</div>`
  );
}

function resolveActiveTab(viewModel: ConsolePageViewModel): ConsoleTab {
  return viewModel.query.tab ?? "workflow";
}

function renderTabNav(
  viewModel: ConsolePageViewModel,
  activeTab: ConsoleTab,
): string {
  const links = TAB_ITEMS.map((item) => {
    const panelId = `tab-panel-${item.id}`;
    const href = buildScopedQueryHref(
      viewModel,
      getScopedFieldNamesForTab(item.id),
      {
        tab: item.id,
        widget: undefined,
      },
    );
    const activeClass = item.id === activeTab ? "active" : "";
    return `<a class="tab-link ${activeClass}" href="${href}" data-tab="${escapeHtml(item.id)}" role="tab" aria-selected="${item.id === activeTab ? "true" : "false"}" aria-controls="${panelId}">${escapeHtml(item.label)}</a>`;
  }).join("");

  return `<nav class="tab-nav animate-enter delay-100" role="tablist" aria-label="ACL 控制台一级标签">${links}</nav>`;
}

function renderPublishListPanel(
  viewModel: ConsolePageViewModel,
  prevQuery: URLSearchParams,
  nextQuery: URLSearchParams,
  hasPrev: boolean,
  hasNext: boolean,
): string {
  const { query } = viewModel;

  return (
    `<article class="card card-hover animate-enter delay-100 publish-panel">` +
    `<div class="section-head">` +
    `<h3>发布请求</h3>` +
    `${renderPublishSummary(viewModel)}` +
    `</div>` +
    `<form class="filters toolbar" method="GET" action="/">` +
    `<label>状态 Status` +
    `<select name="status">` +
    `<option value="">全部</option>` +
    `<option value="blocked" ${query.status === "blocked" ? "selected" : ""}>blocked</option>` +
    `<option value="review_required" ${query.status === "review_required" ? "selected" : ""}>review_required</option>` +
    `<option value="approved" ${query.status === "approved" ? "selected" : ""}>approved</option>` +
    `<option value="rejected" ${query.status === "rejected" ? "selected" : ""}>rejected</option>` +
    `<option value="published" ${query.status === "published" ? "selected" : ""}>published</option>` +
    `</select>` +
    `</label>` +
    `<label>档位 Profile` +
    `<select name="profile">` +
    `<option value="">全部</option>` +
    `<option value="baseline" ${query.profile === "baseline" ? "selected" : ""}>baseline</option>` +
    `<option value="strict_compliance" ${query.profile === "strict_compliance" ? "selected" : ""}>strict_compliance</option>` +
    `</select>` +
    `</label>` +
    `<label>每页条数 Limit` +
    `<input type="number" min="1" max="100" name="limit" value="${query.limit}" />` +
    `</label>` +
    `<label>偏移 Offset` +
    `<input type="number" min="0" name="offset" value="${query.offset}" />` +
    `</label>` +
    renderScopedHiddenContextFields(viewModel, [
      "namespace",
      "fixture_id",
      "expectation_run_id",
      "tab",
      "widget",
      "detail_mode",
    ]) +
    `<button type="submit" class="btn btn-primary">应用筛选</button>` +
    `</form>` +
    `${renderApiResultError(viewModel.publish_list)}` +
    `<div class="table-container">` +
    `<table class="data-table publish-table">` +
    `<thead><tr><th>Publish ID</th><th>Profile</th><th>Status</th><th>Final Result</th><th>Updated At</th><th>Created At</th></tr></thead>` +
    `<tbody>${renderPublishRows(viewModel.publish_list, viewModel, query.publish_id)}</tbody>` +
    `</table>` +
    `</div>` +
    `${renderPagination(viewModel, prevQuery, nextQuery, hasPrev, hasNext)}` +
    `</article>`
  );
}

interface SelectOptionItem {
  value: string;
  label: string;
}

function buildPublishedPublishOptions(
  viewModel: ConsolePageViewModel,
): SelectOptionItem[] {
  const options = new Map<string, string>();
  const selectedPublishId = viewModel.query.publish_id?.trim();

  if (selectedPublishId) {
    options.set(selectedPublishId, `${selectedPublishId} | 当前上下文`);
  }

  if (viewModel.published_publish_list?.ok) {
    viewModel.published_publish_list.data.items.forEach((item) => {
      options.set(
        item.publish_id,
        `${item.publish_id} | ${item.profile} | ${formatTime(item.updated_at)}`,
      );
    });
  }

  return Array.from(options.entries()).map(([value, label]) => ({
    value,
    label,
  }));
}

function buildDecisionOptions(viewModel: ConsolePageViewModel): SelectOptionItem[] {
  const options = new Map<string, string>();
  const selectedDecisionId = viewModel.query.decision_id?.trim();

  if (selectedDecisionId) {
    options.set(selectedDecisionId, `${selectedDecisionId} | 当前上下文`);
  }

  if (viewModel.decision_list?.ok) {
    viewModel.decision_list.data.items.forEach((item) => {
      options.set(
        item.decision_id,
        `${item.decision_id} | ${formatTime(item.created_at)}`,
      );
    });
  }

  return Array.from(options.entries()).map(([value, label]) => ({
    value,
    label,
  }));
}

function renderSelectOptions(input: {
  items: SelectOptionItem[];
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

function renderDecisionQueryCard(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  const decisionOptions = buildDecisionOptions(viewModel);
  const hasDecisionOptions = decisionOptions.length > 0;
  const decisionHint = viewModel.decision_list
    ? viewModel.decision_list.ok
      ? hasDecisionOptions
        ? "从列表选择 decision_id 后查看关系回放。"
        : "暂无决策记录可供回放。"
      : `决策列表加载失败：${viewModel.decision_list.error}`
    : "正在加载决策列表。";
  const hiddenFields = renderScopedHiddenContextFields(viewModel, [
    "tab",
    "widget",
    "detail_mode",
  ]);
  return (
    `<article class="card card-hover story-entry-card">` +
    `<h3>从决策列表查看回放</h3>` +
    `<p class="muted">本页只围绕 decision trace 排查，不再混入发布/模拟筛选。</p>` +
    `<form class="filters toolbar" method="GET" action="/">` +
    `<label class="field-wide">决策ID Decision ID` +
    `<select name="decision_id" class="input-id-wide" ${hasDecisionOptions ? "" : "disabled"}>` +
    renderSelectOptions({
      items: decisionOptions,
      selectedValue: query.decision_id,
      placeholder: "请选择决策 ID",
    }) +
    `</select>` +
    `</label>` +
    `<label>命名空间 Namespace` +
    `<input type="text" name="namespace" value="${escapeHtml(query.namespace ?? "tenant_a.crm")}" placeholder="tenant_a.crm" />` +
    `</label>` +
    `<span class="muted">${escapeHtml(decisionHint)}</span>` +
    hiddenFields +
    `<button type="submit" class="btn btn-primary" ${hasDecisionOptions ? "" : "disabled"}>查看决策回放</button>` +
    `</form>` +
    `</article>`
  );
}

function renderSimulationContextCard(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  const publishedPublishOptions = buildPublishedPublishOptions(viewModel);
  const hasPublishedPublishOptions = publishedPublishOptions.length > 0;
  const publishHint = viewModel.published_publish_list
    ? viewModel.published_publish_list.ok
      ? hasPublishedPublishOptions
        ? "从已发布列表选择 publish_id 后查看影响评估。"
        : "暂无已发布记录可供模拟。"
      : `已发布列表加载失败：${viewModel.published_publish_list.error}`
    : "正在加载已发布列表。";
  const hiddenFields = renderScopedHiddenContextFields(viewModel, [
    "tab",
    "widget",
    "detail_mode",
    "profile",
  ]);
  const generationHiddenFields = renderScopedHiddenContextFields(viewModel, [
    "status",
    "widget",
    "detail_mode",
    "profile",
    "namespace",
    "limit",
    "offset",
  ]);
  const workflowHref = query.publish_id
    ? buildScopedQueryHref(
        viewModel,
        ["status", "profile", "detail_mode", "limit", "offset", "namespace"],
        {
          tab: "workflow",
          widget: undefined,
          publish_id: query.publish_id,
          decision_id: undefined,
          simulation_id: undefined,
          cell_key: undefined,
        },
      )
    : undefined;
  const generationForm = query.publish_id
    ? `<form class="filters toolbar" method="POST" action="/actions/simulation/generate">` +
      generationHiddenFields +
      `<input type="hidden" name="publish_id" value="${escapeHtml(query.publish_id)}" />` +
      `<button type="submit" class="btn btn-secondary">生成模拟报告</button>` +
      `<span class="muted">默认优先对比同模型上一条已发布版本；没有历史版本时按空基线生成。</span>` +
      `</form>`
    : `<p class="muted">选定 publish_id 后，才可以生成或刷新模拟报告。</p>`;
  return (
    `<article class="card card-hover story-card story-card-accent story-card-workflow">` +
    `<h3>从已发布列表选择发布单</h3>` +
    `<p class="muted">先锁定一条 publish，再看摘要、排行和矩阵；不要把 decision 查询混在这里。</p>` +
    `<form class="filters toolbar" method="GET" action="/">` +
    `<label>发布ID Publish ID` +
    `<select name="publish_id" ${hasPublishedPublishOptions ? "" : "disabled"}>` +
    renderSelectOptions({
      items: publishedPublishOptions,
      selectedValue: query.publish_id,
      placeholder: "请选择已发布的 Publish ID",
    }) +
    `</select>` +
    `</label>` +
    `<label>命名空间 Namespace` +
    `<input type="text" name="namespace" value="${escapeHtml(query.namespace ?? "tenant_a.crm")}" placeholder="tenant_a.crm" />` +
    `</label>` +
    `<span class="muted">${escapeHtml(publishHint)}</span>` +
    hiddenFields +
    `<button type="submit" class="btn btn-primary" ${hasPublishedPublishOptions ? "" : "disabled"}>查看影响评估</button>` +
    `${workflowHref ? `<a class="btn btn-secondary" href="${workflowHref}">返回发布流程</a>` : ""}` +
    `</form>` +
    generationForm +
    `</article>`
  );
}

function renderWorkflowGuideCard(viewModel: ConsolePageViewModel): string {
  const selectedPublish = viewModel.query.publish_id;

  return (
    `<article class="card card-hover">` +
    `<h3>你现在该怎么走</h3>` +
    `<ol class="story-list">` +
    `<li>左侧选择一条 publish 请求，右侧只看这条发布详情。</li>` +
    `<li>确认门禁结果、模型快照和当前状态。</li>` +
    `<li>需要风险判断时，显式进入“影响模拟”。</li>` +
    `<li>确认无误后回到本页做复核或激活。</li>` +
    `</ol>` +
    `<p class="muted">${selectedPublish ? `当前已选中：${escapeHtml(selectedPublish)}` : "当前尚未选择 publish_id。"}</p>` +
    `</article>`
  );
}

function renderControlJourneyCard(namespace: string): string {
  return (
    `<section class="story-card story-card-accent story-card-control">` +
    `<h4>控制面怎么用</h4>` +
    `<ol class="story-list">` +
    `<li>先锁定 namespace，确认当前运行态路由、对象和关系范围。</li>` +
    `<li>上半区只处理模型草稿与发布请求提交。</li>` +
    `<li>下半区只处理运行态 instance、route、object、relation 维护。</li>` +
    `<li>需要验证效果时，回到“发布流程”或“影响模拟”继续治理闭环。</li>` +
    `</ol>` +
    `<p class="muted">当前控制面命名空间：${escapeHtml(namespace)}</p>` +
    `</section>`
  );
}

function renderEmbedWidget(
  viewModel: ConsolePageViewModel,
  widget: ConsoleWidget,
  publishListPanel: string,
): string {
  if (widget === "publish_list") {
    return publishListPanel;
  }

  if (widget === "publish_detail") {
    return renderPublishDetail(viewModel.publish_detail, viewModel);
  }

  if (widget === "decision_detail") {
    return `${renderDecisionQueryCard(viewModel)}${renderDecisionDetail(viewModel.decision_detail)}`;
  }

  if (widget === "simulation") {
    return `${renderSimulationContextCard(viewModel)}${renderSimulationView(viewModel)}`;
  }

  if (widget === "matrix") {
    return `${renderSimulationContextCard(viewModel)}${renderMatrixView(viewModel)}`;
  }

  if (widget === "relation") {
    return `${renderDecisionQueryCard(viewModel)}${renderDecisionDetail(viewModel.decision_detail)}${renderRelationView(viewModel)}`;
  }

  return renderControlPlaneOverview(viewModel);
}

function renderHeroMeta(viewModel: ConsolePageViewModel, activeTab: ConsoleTab): string {
  const { query } = viewModel;
  const tabLabel =
    TAB_ITEMS.find((item) => item.id === activeTab)?.label ?? "发布流程";
  const badges = [
    `<span class="badge badge-info" data-tab-label="true">tab: ${escapeHtml(tabLabel)}</span>`,
  ];

  if (activeTab === "workflow") {
    badges.push(
      `<span class="badge badge-info">status: ${escapeHtml(query.status ?? "all")}</span>`,
      `<span class="badge badge-neutral">profile: ${escapeHtml(query.profile ?? "all")}</span>`,
      `<span class="badge badge-primary">publish: ${escapeHtml(query.publish_id ?? "未选中")}</span>`,
      `<span class="badge badge-info">namespace: ${escapeHtml(query.namespace ?? "tenant_a.crm")}</span>`,
    );
  } else if (activeTab === "simulation") {
    badges.push(
      `<span class="badge badge-primary">publish: ${escapeHtml(query.publish_id ?? "未选择")}</span>`,
      `<span class="badge badge-neutral">simulation: ${escapeHtml(query.simulation_id ?? "latest")}</span>`,
      `<span class="badge badge-info">profile: ${escapeHtml(query.profile ?? "all")}</span>`,
      `<span class="badge badge-info">namespace: ${escapeHtml(query.namespace ?? "tenant_a.crm")}</span>`,
    );
  } else if (activeTab === "relations") {
    badges.push(
      `<span class="badge badge-primary">decision: ${escapeHtml(query.decision_id ?? "未选择")}</span>`,
      `<span class="badge badge-info">namespace: ${escapeHtml(query.namespace ?? "tenant_a.crm")}</span>`,
    );
  } else if (activeTab === "control") {
    badges.push(
      `<span class="badge badge-primary">namespace: ${escapeHtml(query.namespace ?? "tenant_a.crm")}</span>`,
      `<span class="badge badge-neutral">fixture: ${escapeHtml(query.fixture_id ?? "未选择")}</span>`,
      `<span class="badge badge-info">expectation: ${escapeHtml(query.expectation_run_id ?? "未运行")}</span>`,
    );
  } else {
    badges.push(
      `<span class="badge badge-primary">namespace: ${escapeHtml(query.namespace ?? "tenant_a.crm")}</span>`,
    );
  }

  return `<div class="hero-meta">${badges.join("")}</div>`;
}

export function renderConsolePage(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  const activeTab = resolveActiveTab(viewModel);
  const prevOffset = Math.max(query.offset - query.limit, 0);
  const hasPrev = query.offset > 0;
  const nextOffset =
    viewModel.publish_list.ok && viewModel.publish_list.data.has_more
      ? (viewModel.publish_list.data.next_offset ?? query.offset + query.limit)
      : query.offset;
  const hasNext =
    viewModel.publish_list.ok && viewModel.publish_list.data.has_more;

  const queryBase = new URLSearchParams();
  queryBase.set("limit", String(query.limit));
  queryBase.set("offset", String(query.offset));
  if (query.status) {
    queryBase.set("status", query.status);
  }
  if (query.profile) {
    queryBase.set("profile", query.profile);
  }
  if (query.tab) {
    queryBase.set("tab", query.tab);
  }
  if (query.widget) {
    queryBase.set("widget", query.widget);
  }
  if (query.detail_mode) {
    queryBase.set("detail_mode", query.detail_mode);
  }
  if (query.fixture_id) {
    queryBase.set("fixture_id", query.fixture_id);
  }
  if (query.expectation_run_id) {
    queryBase.set("expectation_run_id", query.expectation_run_id);
  }
  if (query.publish_id) {
    queryBase.set("publish_id", query.publish_id);
  }
  if (query.decision_id) {
    queryBase.set("decision_id", query.decision_id);
  }
  if (query.simulation_id) {
    queryBase.set("simulation_id", query.simulation_id);
  }
  if (query.namespace) {
    queryBase.set("namespace", query.namespace);
  }
  if (query.cell_key) {
    queryBase.set("cell_key", query.cell_key);
  }

  const prevQuery = new URLSearchParams(queryBase);
  prevQuery.set("offset", String(prevOffset));
  const nextQuery = new URLSearchParams(queryBase);
  nextQuery.set("offset", String(nextOffset));

  const publishListPanel = renderPublishListPanel(
    viewModel,
    prevQuery,
    nextQuery,
    hasPrev,
    hasNext,
  );
  const decisionQueryCard = renderDecisionQueryCard(viewModel);
  const workflowStack = `${renderPublishDetail(viewModel.publish_detail, viewModel)}${renderWorkflowGuideCard(viewModel)}`;
  const simulationStack = `${renderSimulationContextCard(viewModel)}${renderSimulationView(viewModel)}${renderMatrixView(viewModel)}`;
  const relationsStack = `${decisionQueryCard}${renderDecisionDetail(viewModel.decision_detail)}${renderRelationView(viewModel)}`;
  const controlStack = `${renderControlPlaneOverview(viewModel)}`;
  const componentsStack = `${renderComponentsIndexView(viewModel)}`;

  const pageTitle = query.widget
    ? `ACL 嵌入视图 - ${WIDGET_ITEMS.find((item) => item.id === query.widget)?.label ?? "Widget"}`
    : "ACL 控制台";

  const dashboardPanels =
    `<section class="tab-panels">` +
    `<section class="tab-panel ${activeTab === "workflow" ? "active" : ""}" data-tab-panel="workflow" id="tab-panel-workflow" role="tabpanel" aria-hidden="${activeTab === "workflow" ? "false" : "true"}">` +
    `<section class="grid">${publishListPanel}<section class="stack animate-enter delay-200">${workflowStack}</section></section>` +
    `</section>` +
    `<section class="tab-panel ${activeTab === "simulation" ? "active" : ""}" data-tab-panel="simulation" id="tab-panel-simulation" role="tabpanel" aria-hidden="${activeTab === "simulation" ? "false" : "true"}">` +
    `<section class="stack stack-main animate-enter delay-200">${simulationStack}</section>` +
    `</section>` +
    `<section class="tab-panel ${activeTab === "relations" ? "active" : ""}" data-tab-panel="relations" id="tab-panel-relations" role="tabpanel" aria-hidden="${activeTab === "relations" ? "false" : "true"}">` +
    `<section class="stack stack-main animate-enter delay-200">${relationsStack}</section>` +
    `</section>` +
    `<section class="tab-panel ${activeTab === "control" ? "active" : ""}" data-tab-panel="control" id="tab-panel-control" role="tabpanel" aria-hidden="${activeTab === "control" ? "false" : "true"}">` +
    `<section class="stack stack-main animate-enter delay-200">${controlStack}</section>` +
    `</section>` +
    `<section class="tab-panel ${activeTab === "components" ? "active" : ""}" data-tab-panel="components" id="tab-panel-components" role="tabpanel" aria-hidden="${activeTab === "components" ? "false" : "true"}">` +
    `<section class="stack stack-main animate-enter delay-200">${componentsStack}</section>` +
    `</section>` +
    `</section>`;

  const echartsScriptTag =
    '<script src="/assets/echarts.min.js" defer></script>';
  const tabScriptTag =
    '<script src="/assets/dashboard-tabs.js" defer></script>';
  const systemNotice = renderFlash(viewModel);

  const body = query.widget
    ? `<section class="embed-head card animate-enter">` +
      `<div class="hero-top"><h1>${escapeHtml(pageTitle)}</h1><span class="hero-pill">Embeddable Widget</span></div>` +
      `<p>widget=${escapeHtml(query.widget)} / API: ${escapeHtml(viewModel.api_base_url)} / 时间: ${escapeHtml(formatTime(viewModel.generated_at))}</p>` +
      `</section>` +
      `<section class="stack stack-main animate-enter delay-100">${renderEmbedWidget(viewModel, query.widget, publishListPanel)}</section>`
    : `<section class="hero animate-enter">` +
      `<div class="hero-top"><h1>ACL 控制台</h1><span class="hero-pill">Governance Console</span></div>` +
      `<p>发布流程治理 + 决策回放 + 控制面同步。API: ${escapeHtml(viewModel.api_base_url)}，生成时间: ${escapeHtml(formatTime(viewModel.generated_at))}</p>` +
      renderHeroMeta(viewModel, activeTab) +
      `</section>` +
      renderTabNav(viewModel, activeTab) +
      dashboardPanels;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="stylesheet" href="/assets/global.css" />
</head>
<body>
  <main class="shell ${query.widget ? "embed-shell" : ""}">
    ${body}
  </main>
  ${systemNotice}
  ${echartsScriptTag}
  ${tabScriptTag}
</body>
</html>`;
}
