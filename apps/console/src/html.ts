import fs from "node:fs";
import path from "node:path";
import type {
  ApiResult,
  ConsoleTab,
  ConsoleWidget,
  ConsolePageViewModel,
  DecisionRecordResponse,
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

function renderWidgetRows(viewModel: ConsolePageViewModel): string {
  return WIDGET_ITEMS.map((item) => {
    const embedHref = buildQueryHref(viewModel, {
      widget: item.id,
      tab: undefined,
    });
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
  const omitSet = new Set(omitNames);
  const fields: Array<[string, string | number | undefined]> = [
    ["status", viewModel.query.status],
    ["profile", viewModel.query.profile],
    ["tab", viewModel.query.tab],
    ["widget", viewModel.query.widget],
    ["detail_mode", viewModel.query.detail_mode],
    ["limit", viewModel.query.limit],
    ["offset", viewModel.query.offset],
    ["decision_id", viewModel.query.decision_id],
    ["simulation_id", viewModel.query.simulation_id],
    ["namespace", viewModel.query.namespace],
    ["cell_key", viewModel.query.cell_key],
  ];

  return fields
    .filter(
      ([name, value]) =>
        !omitSet.has(name) && value !== undefined && String(value).length > 0,
    )
    .map(
      ([name, value]) =>
        `<input type=\"hidden\" name=\"${name}\" value=\"${escapeHtml(String(value))}\" />`,
    )
    .join("");
}

function renderFlash(viewModel: ConsolePageViewModel): string {
  if (!viewModel.action_flash) {
    return "";
  }

  return (
    `<section class=\"flash flash-${viewModel.action_flash.type}\">` +
    `<p>${escapeHtml(viewModel.action_flash.message)}</p>` +
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
      const detailHref = buildQueryHref(viewModel, {
        publish_id: item.publish_id,
      });
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

function renderPublishDetailVisual(record: PublishRequestRecord): string {
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
  const visualContent = renderPublishDetailVisual(result.data);
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
    return '<div class="card card-hover"><h3>决策回放</h3><p class="muted">输入 decision_id 后可查看回放证据</p></div>';
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
  const params = new URLSearchParams();
  const baseEntries: Array<[string, string | undefined]> = [
    ["status", viewModel.query.status],
    ["profile", viewModel.query.profile],
    ["tab", viewModel.query.tab],
    ["widget", viewModel.query.widget],
    ["detail_mode", viewModel.query.detail_mode],
    ["limit", String(viewModel.query.limit)],
    ["offset", String(viewModel.query.offset)],
    ["publish_id", viewModel.query.publish_id],
    ["decision_id", viewModel.query.decision_id],
    ["simulation_id", viewModel.query.simulation_id],
    ["namespace", viewModel.query.namespace],
    ["cell_key", viewModel.query.cell_key],
  ];
  baseEntries.forEach(([key, value]) => {
    if (value) {
      params.set(key, value);
    }
  });
  Object.entries(updates).forEach(([key, value]) => {
    if (!value || value.length === 0) {
      params.delete(key);
      return;
    }
    params.set(key, value);
  });
  const queryString = params.toString();
  return queryString.length > 0 ? `/?${queryString}` : "/";
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
          const href = buildQueryHref(viewModel, {
            cell_key: cellKey,
          });
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
  const relationRows = viewModel.control_relations?.ok
    ? viewModel.control_relations.data.items.length === 0
      ? '<tr><td colspan="5" class="muted">关系事件为空</td></tr>'
      : viewModel.control_relations.data.items
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.from)}</td><td>${escapeHtml(item.relation_type)}</td><td>${escapeHtml(item.to)}</td><td>${escapeHtml(item.scope ?? "")}</td><td>${escapeHtml(formatTime(item.updated_at))}</td></tr>`,
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
    : '<tr><td colspan="4" class="muted">输入 decision_id 查看命中链路</td></tr>';

  return (
    `<article class="card card-hover">` +
    `<h3>关系图视图</h3>` +
    `<p class="muted">上半区展示控制面关系边，下半区展示决策 trace 链路。</p>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>From</th><th>Relation</th><th>To</th><th>Scope</th><th>Updated</th></tr></thead><tbody>${relationRows}</tbody></table></div>` +
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
      `<input type="hidden" name="publish_id" value="${escapeHtml(viewModel.query.publish_id ?? "")}" />` +
      `<input type="hidden" name="decision_id" value="${escapeHtml(viewModel.query.decision_id ?? "")}" />` +
      `<input type="hidden" name="status" value="${escapeHtml(viewModel.query.status ?? "")}" />` +
      `<input type="hidden" name="profile" value="${escapeHtml(viewModel.query.profile ?? "")}" />` +
      `<input type="hidden" name="detail_mode" value="${escapeHtml(viewModel.query.detail_mode ?? "")}" />` +
      `<input type="hidden" name="namespace" value="${escapeHtml(viewModel.query.namespace ?? "")}" />` +
      `<input type="hidden" name="tab" value="${escapeHtml(viewModel.query.tab ?? "")}" />` +
      `<input type="hidden" name="widget" value="${escapeHtml(viewModel.query.widget ?? "")}" />` +
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

function buildDefaultModelTemplate(namespace: string): {
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
} {
  void namespace;
  const fixturePath = path.resolve(
    __dirname,
    "../../api/test/fixtures/same-company-derived.model.json",
  );
  const raw = fs.readFileSync(fixturePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`invalid default model fixture: ${fixturePath}`);
  }
  return parsed as {
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
  };
}

function buildDefaultModelJson(namespace: string): string {
  return JSON.stringify(buildDefaultModelTemplate(namespace), null, 2);
}

interface PublishedModelOverviewMetrics {
  publish_id: string;
  model_id: string;
  model_version: string;
  subject_types: number;
  categories: number;
  object_types: number;
  relation_types: number;
  rules: number;
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

  const modelMeta = asRecord(modelSnapshot.model_meta);
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
    model_id:
      typeof modelMeta?.model_id === "string" ? modelMeta.model_id : "-",
    model_version:
      typeof modelMeta?.version === "string" ? modelMeta.version : "-",
    subject_types: subjectTypeCatalog.length,
    categories: actionCatalog.length,
    object_types: objectTypeCatalog.length,
    relation_types: relationTypeCatalog.length,
    rules,
  };
}

function collectControlOverviewMetrics(viewModel: ConsolePageViewModel): {
  categories: number;
  subjects: number;
  objects: number;
  relations: number;
} {
  const categories = viewModel.control_catalogs?.ok
    ? new Set(
        viewModel.control_catalogs.data.items.flatMap((item) =>
          item.catalogs.action_catalog
            .map((action) => action.trim())
            .filter((action) => action.length > 0),
        ),
      ).size
    : 0;

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
    categories,
    subjects: subjectIdSet.size,
    objects,
    relations,
  };
}

function renderControlPlaneOverview(viewModel: ConsolePageViewModel): string {
  const namespace = viewModel.query.namespace ?? "tenant_a.crm";
  const overviewMetrics = collectControlOverviewMetrics(viewModel);
  const publishedModelMetrics = collectPublishedModelOverviewMetrics(viewModel);
  const modelRouteCount = viewModel.model_routes?.ok
    ? viewModel.model_routes.data.total_count
    : 0;
  const hiddenContext = renderHiddenContextFields(viewModel);
  const hiddenWithoutNamespace = renderHiddenContextFields(viewModel, [
    "namespace",
  ]);
  const defaultModel = buildDefaultModelTemplate(namespace);
  const defaultRule = defaultModel.policies.rules[0] ?? {};
  const defaultModelJson = escapeHtml(buildDefaultModelJson(namespace));
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
    (defaultModel.catalogs.subject_object_relation_type_catalog ?? []).join("\n"),
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

  const auditRows = viewModel.control_audits?.ok
    ? viewModel.control_audits.data.items
        .slice(0, 6)
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.event_type)}</td><td>${escapeHtml(item.target)}</td><td>${escapeHtml(item.operator)}</td><td>${escapeHtml(formatTime(item.created_at))}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="muted">审计数据加载失败</td></tr>';

  const catalogRows = viewModel.control_catalogs?.ok
    ? viewModel.control_catalogs.data.items
        .slice(0, 6)
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.system_id)}</td><td>${escapeHtml(item.namespace)}</td><td>${escapeHtml(item.catalogs.action_catalog.join(", "))}</td><td>${escapeHtml(item.catalogs.object_type_catalog.join(", "))}</td><td>${escapeHtml(item.catalogs.relation_type_catalog.join(", "))}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="5" class="muted">catalog 加载失败</td></tr>';

  const objectRows = viewModel.control_objects?.ok
    ? viewModel.control_objects.data.items
        .slice(0, 6)
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.object_id)}</td><td>${escapeHtml(item.object_type)}</td><td>${escapeHtml(item.sensitivity)}</td><td>${escapeHtml(item.owner_ref)}</td><td>${escapeHtml(item.labels.join(", "))}</td><td>${escapeHtml(formatTime(item.updated_at))}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="muted">object 加载失败</td></tr>';

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
      `<p class="muted">统计来源：publish_id=${escapeHtml(publishedModelMetrics.publish_id)} / model_id=${escapeHtml(publishedModelMetrics.model_id)} / version=${escapeHtml(publishedModelMetrics.model_version)}</p>` +
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

  const controlRuntimeHint =
    overviewMetrics.categories +
      overviewMetrics.subjects +
      overviewMetrics.objects +
      overviewMetrics.relations +
      modelRouteCount ===
    0
      ? '<p class="muted">当前运行态控制面为空（这不影响上方发布快照统计）。</p>'
      : "";

  const hasCatalogItems = Boolean(
    viewModel.control_catalogs?.ok &&
    viewModel.control_catalogs.data.items.length > 0,
  );
  const hasObjectItems = Boolean(
    viewModel.control_objects?.ok &&
    viewModel.control_objects.data.items.length > 0,
  );
  const hasModelRouteItems = Boolean(
    viewModel.model_routes?.ok && viewModel.model_routes.data.items.length > 0,
  );
  const hasAuditItems = Boolean(
    viewModel.control_audits?.ok &&
    viewModel.control_audits.data.items.length > 0,
  );
  const runtimeTablesEmpty =
    !hasCatalogItems &&
    !hasObjectItems &&
    !hasModelRouteItems &&
    !hasAuditItems;

  const runtimeTablesSection = runtimeTablesEmpty
    ? `<section class="runtime-empty-hint">` +
      `<p class="muted">当前命名空间暂无运行态数据（catalog / model route / object / audit）。</p>` +
      `<p class="muted">你可先只看上方发布快照统计；如需运行态回放，再在“高级运维（可选）”里按需维护。</p>` +
      `</section>`
    : "" +
      (viewModel.control_catalogs?.ok && !hasCatalogItems
        ? ""
        : `<div class="table-container management-table"><table class="data-table"><thead><tr><th>System</th><th>Namespace</th><th>Actions</th><th>Object Types</th><th>Relation Types</th></tr></thead><tbody>${catalogRows}</tbody></table></div>`) +
      (viewModel.model_routes?.ok && !hasModelRouteItems
        ? ""
        : `<div class="table-container management-table"><table class="data-table"><thead><tr><th>Tenant</th><th>Env</th><th>Model ID</th><th>Version</th><th>Publish ID</th><th>Namespace</th><th>Operator</th><th>Updated</th></tr></thead><tbody>${modelRouteRows}</tbody></table></div>`) +
      (viewModel.control_objects?.ok && !hasObjectItems
        ? ""
        : `<div class="table-container management-table"><table class="data-table"><thead><tr><th>Object ID</th><th>Type</th><th>Sensitivity</th><th>Owner</th><th>Labels</th><th>Updated</th></tr></thead><tbody>${objectRows}</tbody></table></div>`) +
      (viewModel.control_audits?.ok && !hasAuditItems
        ? ""
        : `<div class="table-container"><table class="data-table"><thead><tr><th>Event</th><th>Target</th><th>Operator</th><th>Created At</th></tr></thead><tbody>${auditRows}</tbody></table></div>`);

  return (
    `<article class="card card-hover">` +
    `<h3>控制面总览</h3>` +
    `<form class="filters toolbar" method="GET" action="/">` +
    `<label>命名空间 Namespace` +
    `<input type="text" name="namespace" value="${escapeHtml(namespace)}" placeholder="tenant_a.crm" />` +
    `</label>` +
    `<input type="hidden" name="publish_id" value="${escapeHtml(viewModel.query.publish_id ?? "")}" />` +
    `<input type="hidden" name="decision_id" value="${escapeHtml(viewModel.query.decision_id ?? "")}" />` +
    `<input type="hidden" name="simulation_id" value="${escapeHtml(viewModel.query.simulation_id ?? "")}" />` +
    `<input type="hidden" name="tab" value="${escapeHtml(viewModel.query.tab ?? "")}" />` +
    `<input type="hidden" name="widget" value="${escapeHtml(viewModel.query.widget ?? "")}" />` +
    `<input type="hidden" name="detail_mode" value="${escapeHtml(viewModel.query.detail_mode ?? "")}" />` +
    `<button type="submit" class="btn btn-primary">切换命名空间</button>` +
    `</form>` +
    publishedMetricsSection +
    `<p class="muted metric-caption">运行态控制面统计（subject 来自 relation 端点与 object.owner_ref 推断）</p>` +
    controlRuntimeHint +
    `<section class="decision-grid">` +
    `<div class="metric"><span>subjects</span><strong>${overviewMetrics.subjects}</strong></div>` +
    `<div class="metric"><span>categories(action)</span><strong>${overviewMetrics.categories}</strong></div>` +
    `<div class="metric"><span>objects</span><strong>${overviewMetrics.objects}</strong></div>` +
    `<div class="metric"><span>relations</span><strong>${overviewMetrics.relations}</strong></div>` +
    `<div class="metric"><span>model routes</span><strong>${modelRouteCount}</strong></div>` +
    `</section>` +
    `<p class="muted metric-caption">说明：下方维护操作只写入控制面运行态数据，不会回写“策略模型提交”卡片中的 JSON。</p>` +
    `<section class="management-grid model-submit-grid">` +
    `<form class="action-form model-submit-form" method="POST" action="/actions/publish/submit">` +
    `<h4>策略模型提交</h4>` +
    hiddenContext +
    `<label>发布ID Publish ID (可选)<input type="text" name="publish_id" placeholder="pub_20260304_001" /></label>` +
    `<label>档位 Profile<select name="profile"><option value="">auto</option><option value="baseline">baseline</option><option value="strict_compliance">strict_compliance</option></select></label>` +
    `<label>提交人 Submitted By<input type="text" name="submitted_by" value="console_operator" /></label>` +
    `<section class="model-editor" data-model-editor data-json-scope>` +
    `<div class="model-editor-head"><p class="muted">模型编辑模式</p>${renderModelEditorToggleSwitch()}</div>` +
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
    `<label>规则ID Rule ID<input type="text" value="${ruleId}" data-model-field="rule_id" /></label>` +
    `<label>规则效果 Rule Effect<select data-model-field="rule_effect"><option value="allow" ${ruleEffect === "allow" ? "selected" : ""}>allow</option><option value="deny" ${ruleEffect === "deny" ? "selected" : ""}>deny</option></select></label>` +
    `<label>规则优先级 Rule Priority<input type="number" min="1" value="${escapeHtml(rulePriority)}" data-model-field="rule_priority" /></label>` +
    `<label>规则动作 Rule Actions<textarea rows="3" data-model-field="rule_action_set">${ruleActionSet}</textarea></label>` +
    `<label>主体选择器 Subject Selector<textarea rows="3" data-model-field="rule_subject_selector">${ruleSubjectSelector}</textarea></label>` +
    `<label>客体选择器 Object Selector<textarea rows="3" data-model-field="rule_object_selector">${ruleObjectSelector}</textarea></label>` +
    `<label>强制义务 Mandatory Obligations<textarea rows="3" data-model-field="mandatory_obligations">${mandatoryObligations}</textarea></label>` +
    `</div>` +
    `<p class="muted model-editor-note">字段变更会自动同步到 JSON，可直接提交。</p>` +
    `</div>` +
    `<div class="json-view" data-json-view="raw" hidden>` +
    `<div class="raw-json-toolbar"><button type="button" class="btn btn-secondary" data-apply-model-json>从 JSON 刷新字段</button></div>` +
    `<label>模型JSON Model JSON<textarea name="model_json" rows="12" required data-model-json>${defaultModelJson}</textarea></label>` +
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
    `<details class="card card-hover advanced-ops-card">` +
    `<summary><strong>高级运维（可选）</strong>：Catalog / Object / Relation / Model Route 维护</summary>` +
    `<p class="muted">这些维护项用于构建运行态控制面（对象台账、关系边、路由），不会反向修改上方策略模型 JSON。</p>` +
    `<section class="management-grid">` +
    `<form class="action-form" method="POST" action="/actions/control/catalog/register">` +
    `<h4>Catalog 维护</h4>` +
    hiddenWithoutNamespace +
    `<label>系统ID System ID<input type="text" name="system_id" value="crm" required /></label>` +
    `<label>命名空间 Namespace<input type="text" name="namespace" value="${escapeHtml(namespace)}" required /></label>` +
    `<label>动作目录 Action Catalog(逗号/换行)<textarea name="action_catalog" rows="3" required>read,update,grant,publish</textarea></label>` +
    `<label>客体类型目录 Object Type Catalog<textarea name="object_type_catalog" rows="3" required>kb,agent</textarea></label>` +
    `<label>关系类型目录 Relation Type Catalog<textarea name="relation_type_catalog" rows="3" required>belongs_to,member_of,manages,derives_to</textarea></label>` +
    `<button type="submit" class="btn btn-primary">新增或更新 Catalog</button>` +
    `</form>` +
    `<form class="action-form" method="POST" action="/actions/control/object/upsert">` +
    `<h4>Object 维护</h4>` +
    hiddenWithoutNamespace +
    `<label>命名空间 Namespace<input type="text" name="namespace" value="${escapeHtml(namespace)}" required /></label>` +
    `<label>客体ID Object ID<input type="text" name="object_id" placeholder="obj_001" required /></label>` +
    `<label>客体类型 Object Type<input type="text" name="object_type" placeholder="kb" required /></label>` +
    `<label>敏感级别 Sensitivity<input type="text" name="sensitivity" value="normal" /></label>` +
    `<label>所有者引用 Owner Ref<input type="text" name="owner_ref" placeholder="user:alice" /></label>` +
    `<label>标签 Labels(逗号/换行)<textarea name="labels" rows="2" placeholder="internal,important"></textarea></label>` +
    `<button type="submit" class="btn btn-primary">新增或更新 Object</button>` +
    `</form>` +
    `<form class="action-form" method="POST" action="/actions/control/relation/event">` +
    `<h4>Relation 维护</h4>` +
    hiddenWithoutNamespace +
    `<label>操作 Operation<select name="operation"><option value="upsert">upsert</option><option value="delete">delete</option></select></label>` +
    `<label>命名空间 Namespace<input type="text" name="namespace" value="${escapeHtml(namespace)}" required /></label>` +
    `<label>起点 From<input type="text" name="from" placeholder="user:alice" required /></label>` +
    `<label>终点 To<input type="text" name="to" placeholder="obj_001" required /></label>` +
    `<label>关系类型 Relation Type<input type="text" name="relation_type" placeholder="member_of" required /></label>` +
    `<label>范围 Scope(可选)<input type="text" name="scope" placeholder="project:a" /></label>` +
    `<label>来源 Source(可选)<input type="text" name="source" placeholder="hr_sync" /></label>` +
    `<button type="submit" class="btn btn-primary">提交 Relation 事件</button>` +
    `</form>` +
    `<form class="action-form" method="POST" action="/actions/control/model-route/upsert">` +
    `<h4>模型路由维护</h4>` +
    hiddenWithoutNamespace +
    `<label>命名空间 Namespace<input type="text" name="namespace" value="${escapeHtml(namespace)}" required /></label>` +
    `<label>租户 Tenant ID<input type="text" name="tenant_id" value="${escapeHtml(namespace.split(".")[0] ?? "tenant_a")}" required /></label>` +
    `<label>环境 Environment<input type="text" name="environment" value="prod" required /></label>` +
    `<label>模型ID Model ID<input type="text" name="model_id" placeholder="tenant_a_authz_v1" required /></label>` +
    `<label>模型版本 Model Version(可选)<input type="text" name="model_version" placeholder="2026.03.04" /></label>` +
    `<label>发布ID Publish ID(可选)<input type="text" name="publish_id" placeholder="pub_xxx" /></label>` +
    `<label>操作人 Operator<input type="text" name="operator" value="console_operator" /></label>` +
    `<button type="submit" class="btn btn-primary">新增或更新 Model Route</button>` +
    `</form>` +
    `</section>` +
    `</details>` +
    runtimeTablesSection +
    `</article>`
  );
}

function renderComponentsIndexView(viewModel: ConsolePageViewModel): string {
  const widgetRows = renderWidgetRows(viewModel);
  const hiddenContext = renderHiddenContextFields(viewModel, ["tab"]);

  return (
    `<article class="card card-hover">` +
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
    const href = buildQueryHref(viewModel, {
      tab: item.id,
      widget: undefined,
    });
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
    `<input type="hidden" name="namespace" value="${escapeHtml(query.namespace ?? "tenant_a.crm")}" />` +
    `<input type="hidden" name="decision_id" value="${escapeHtml(query.decision_id ?? "")}" />` +
    `<input type="hidden" name="simulation_id" value="${escapeHtml(query.simulation_id ?? "")}" />` +
    `<input type="hidden" name="tab" value="${escapeHtml(query.tab ?? "")}" />` +
    `<input type="hidden" name="widget" value="${escapeHtml(query.widget ?? "")}" />` +
    `<input type="hidden" name="detail_mode" value="${escapeHtml(query.detail_mode ?? "")}" />` +
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

function renderDecisionQueryCard(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  return (
    `<article class="card card-hover">` +
    `<h3>决策回放查询</h3>` +
    `<form class="filters toolbar" method="GET" action="/">` +
    `<label class="field-wide">决策ID Decision ID` +
    `<input type="text" class="input-id-wide" name="decision_id" value="${escapeHtml(query.decision_id ?? "")}" placeholder="dec_xxx" />` +
    `</label>` +
    `<input type="hidden" name="publish_id" value="${escapeHtml(query.publish_id ?? "")}" />` +
    `<input type="hidden" name="status" value="${escapeHtml(query.status ?? "")}" />` +
    `<input type="hidden" name="profile" value="${escapeHtml(query.profile ?? "")}" />` +
    `<input type="hidden" name="namespace" value="${escapeHtml(query.namespace ?? "tenant_a.crm")}" />` +
    `<input type="hidden" name="tab" value="${escapeHtml(query.tab ?? "")}" />` +
    `<input type="hidden" name="widget" value="${escapeHtml(query.widget ?? "")}" />` +
    `<input type="hidden" name="detail_mode" value="${escapeHtml(query.detail_mode ?? "")}" />` +
    `<button type="submit" class="btn btn-primary">查询回放</button>` +
    `</form>` +
    `</article>`
  );
}

function renderContextQueryCard(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  return (
    `<article class="card card-hover">` +
    `<h3>上下文筛选</h3>` +
    `<form class="filters toolbar" method="GET" action="/">` +
    `<label>发布ID Publish ID` +
    `<input type="text" name="publish_id" value="${escapeHtml(query.publish_id ?? "")}" placeholder="pub_xxx" />` +
    `</label>` +
    `<label>决策ID Decision ID` +
    `<input type="text" name="decision_id" value="${escapeHtml(query.decision_id ?? "")}" placeholder="dec_xxx" />` +
    `</label>` +
    `<label>模拟ID Simulation ID` +
    `<input type="text" name="simulation_id" value="${escapeHtml(query.simulation_id ?? "")}" placeholder="sim_xxx" />` +
    `</label>` +
    `<label>命名空间 Namespace` +
    `<input type="text" name="namespace" value="${escapeHtml(query.namespace ?? "tenant_a.crm")}" placeholder="tenant_a.crm" />` +
    `</label>` +
    `<input type="hidden" name="status" value="${escapeHtml(query.status ?? "")}" />` +
    `<input type="hidden" name="profile" value="${escapeHtml(query.profile ?? "")}" />` +
    `<input type="hidden" name="tab" value="${escapeHtml(query.tab ?? "")}" />` +
    `<input type="hidden" name="widget" value="${escapeHtml(query.widget ?? "")}" />` +
    `<input type="hidden" name="detail_mode" value="${escapeHtml(query.detail_mode ?? "")}" />` +
    `<input type="hidden" name="limit" value="${escapeHtml(String(query.limit))}" />` +
    `<input type="hidden" name="offset" value="${escapeHtml(String(query.offset))}" />` +
    `<button type="submit" class="btn btn-primary">应用上下文</button>` +
    `</form>` +
    `</article>`
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
    return `${renderContextQueryCard(viewModel)}${renderSimulationView(viewModel)}`;
  }

  if (widget === "matrix") {
    return `${renderContextQueryCard(viewModel)}${renderMatrixView(viewModel)}`;
  }

  if (widget === "relation") {
    return `${renderContextQueryCard(viewModel)}${renderRelationView(viewModel)}`;
  }

  return renderControlPlaneOverview(viewModel);
}

export function renderConsolePage(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  const activeTab = resolveActiveTab(viewModel);
  const statusLabel = query.status ?? "all";
  const profileLabel = query.profile ?? "all";
  const decisionLabel = query.decision_id
    ? "已输入 decision_id"
    : "未输入 decision_id";
  const simulationLabel = query.simulation_id
    ? "已锁定 simulation_id"
    : "自动选择最新 simulation";
  const namespaceLabel = query.namespace ?? "tenant_a.crm";
  const tabLabel =
    TAB_ITEMS.find((item) => item.id === activeTab)?.label ?? "发布流程";
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
  const workflowStack = `${renderPublishDetail(viewModel.publish_detail, viewModel)}${decisionQueryCard}${renderDecisionDetail(viewModel.decision_detail)}`;
  const simulationStack = `${renderContextQueryCard(viewModel)}${renderSimulationView(viewModel)}${renderMatrixView(viewModel)}`;
  const relationsStack = `${renderContextQueryCard(viewModel)}${decisionQueryCard}${renderDecisionDetail(viewModel.decision_detail)}${renderRelationView(viewModel)}`;
  const controlStack = `${renderControlPlaneOverview(viewModel)}`;
  const componentsStack = `${renderComponentsIndexView(viewModel)}`;

  const pageTitle = query.widget
    ? `ACL 嵌入视图 - ${WIDGET_ITEMS.find((item) => item.id === query.widget)?.label ?? "Widget"}`
    : "ACL 治理控制台";

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

  const body = query.widget
    ? `<section class="embed-head card animate-enter">` +
      `<div class="hero-top"><h1>${escapeHtml(pageTitle)}</h1><span class="hero-pill">Embeddable Widget</span></div>` +
      `<p>widget=${escapeHtml(query.widget)} / API: ${escapeHtml(viewModel.api_base_url)} / 时间: ${escapeHtml(formatTime(viewModel.generated_at))}</p>` +
      `</section>` +
      `${renderFlash(viewModel)}` +
      `<section class="stack stack-main animate-enter delay-100">${renderEmbedWidget(viewModel, query.widget, publishListPanel)}</section>`
    : `<section class="hero animate-enter">` +
      `<div class="hero-top"><h1>ACL 治理控制台</h1><span class="hero-pill">Governance Console</span></div>` +
      `<p>发布流程治理 + 决策回放 + 控制面同步。API: ${escapeHtml(viewModel.api_base_url)}，生成时间: ${escapeHtml(formatTime(viewModel.generated_at))}</p>` +
      `<div class="hero-meta">` +
      `<span class="badge badge-info" data-tab-label="true">tab: ${escapeHtml(tabLabel)}</span>` +
      `<span class="badge badge-info">status: ${escapeHtml(statusLabel)}</span>` +
      `<span class="badge badge-neutral">profile: ${escapeHtml(profileLabel)}</span>` +
      `<span class="badge badge-primary">${escapeHtml(decisionLabel)}</span>` +
      `<span class="badge badge-neutral">${escapeHtml(simulationLabel)}</span>` +
      `<span class="badge badge-info">namespace: ${escapeHtml(namespaceLabel)}</span>` +
      `</div>` +
      `</section>` +
      renderTabNav(viewModel, activeTab) +
      renderFlash(viewModel) +
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
  ${echartsScriptTag}
  ${tabScriptTag}
</body>
</html>`;
}
