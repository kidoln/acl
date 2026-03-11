import type {
  ApiResult,
  ConsolePageViewModel,
  ControlObjectListResponse,
  DecisionRecordResponse,
} from "../../types";
import {
  asRecord,
  buildScopedQueryHref,
  collectRuntimeRouteOverview,
  escapeHtml,
  formatTime,
  hasRuntimeNamespaceOptions,
  pickStringArray,
  readPathString,
  renderInlineList,
  renderJsonToggleSwitch,
  renderRelationReplayToggleSwitch,
  renderApiResultError,
  renderNamespaceInputWithDatalist,
  renderNamespaceSelectOrInput,
  renderRawJsonPanel,
  renderScopedHiddenContextFields,
  renderSelectOptions,
  renderSwitchableJsonView,
} from "../shared";
import {
  buildInstanceGraphEdgeKey,
  buildInstanceGraphPayload,
  buildInstanceGraphEdgeLabel,
  buildRelationReplayFocusPayload,
} from "../graph";

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

export function renderDecisionDetail(
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

function buildDecisionOptions(
  viewModel: ConsolePageViewModel,
): { value: string; label: string }[] {
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

export function renderDecisionQueryCard(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  const decisionOptions = buildDecisionOptions(viewModel);
  const hasDecisionOptions = decisionOptions.length > 0;
  const hasNamespaceOptions = hasRuntimeNamespaceOptions(viewModel);
  const decisionHint = viewModel.decision_list
    ? viewModel.decision_list.ok
      ? hasDecisionOptions
        ? "从列表选择 decision_id 后查看关系回放。"
        : "暂无决策记录可供回放。"
      : `决策列表加载失败：${viewModel.decision_list.error}`
    : "正在加载决策列表。";
  const namespaceHint =
    viewModel.control_namespaces && !viewModel.control_namespaces.ok
      ? `命名空间列表加载失败：${viewModel.control_namespaces.error}`
      : hasNamespaceOptions
        ? "命名空间来自运行态实例索引。"
        : "暂无运行态命名空间可选，可手动输入。";
  const hiddenFields = renderScopedHiddenContextFields(viewModel, [
    "tab",
    "widget",
    "detail_mode",
    "profile",
  ]);
  return (
    `<article class="card card-hover story-entry-card">` +
    `<h3>从决策列表查看回放</h3>` +
    `<p class="muted">本页只围绕 decision trace 排查，不再混入发布/模拟筛选。</p>` +
    `<form class="filters toolbar" method="GET" action="/" data-control-incremental="true">` +
    `<label class="field-compact">决策ID Decision ID` +
    `<select name="decision_id" ${hasDecisionOptions ? "" : "disabled"}>` +
    renderSelectOptions({
      items: decisionOptions,
      selectedValue: query.decision_id,
      placeholder: "请选择决策 ID",
    }) +
    `</select>` +
    `</label>` +
    `<label class="field-compact">命名空间 Namespace` +
    renderNamespaceSelectOrInput({
      viewModel,
      selectedValue: query.namespace,
      placeholder: "tenant_a.crm",
    }) +
    `</label>` +
    `<span class="muted">${escapeHtml(decisionHint)} ${escapeHtml(namespaceHint)}</span>` +
    hiddenFields +
    `<button type="submit" class="btn btn-primary" ${hasDecisionOptions ? "" : "disabled"}>查看决策回放</button>` +
    `</form>` +
    `</article>`
  );
}

export function renderRelationContextCard(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  const decisionOptions = buildDecisionOptions(viewModel);
  const hasDecisionOptions = decisionOptions.length > 0;
  const hasNamespaceOptions = hasRuntimeNamespaceOptions(viewModel);
  const decisionHint = viewModel.decision_list
    ? viewModel.decision_list.ok
      ? hasDecisionOptions
        ? "选择 decision_id 会高亮回放路径。"
        : "暂无可回放的决策记录。"
      : `决策列表加载失败：${viewModel.decision_list.error}`
    : "正在加载决策列表。";
  const namespaceHint =
    viewModel.control_namespaces && !viewModel.control_namespaces.ok
      ? `命名空间列表加载失败：${viewModel.control_namespaces.error}`
      : hasNamespaceOptions
        ? "命名空间来自运行态实例索引。"
        : "暂无运行态命名空间可选，可手动输入。";
  const hiddenFields = renderScopedHiddenContextFields(viewModel, [
    "tab",
    "widget",
    "detail_mode",
    "profile",
    "expectation_run_id",
  ]);
  const clearDecisionHref = query.decision_id
    ? buildScopedQueryHref(
        viewModel,
        [
          "tab",
          "widget",
          "detail_mode",
          "namespace",
          "profile",
          "expectation_run_id",
        ],
        {
          tab: "relations",
          decision_id: undefined,
          expectation_run_id: undefined,
        },
      )
    : "";

  return (
    `<article class="card card-hover story-entry-card">` +
    `<h3>关系回放上下文</h3>` +
    `<p class="muted">先锁定命名空间，再选择 decision_id 回放；留空则只展示运行态。</p>` +
    `<form class="filters toolbar" method="GET" action="/" data-control-incremental="true">` +
    `<label class="field-compact">命名空间 Namespace` +
    renderNamespaceInputWithDatalist({
      viewModel,
      selectedValue: query.namespace ?? "tenant_a.crm",
      placeholder: "tenant_a.crm",
      datalistId: "namespace-options-relations",
    }) +
    `</label>` +
    `<label class="field-compact">决策ID Decision ID` +
    `<select name="decision_id" ${hasDecisionOptions ? "" : "disabled"}>` +
    renderSelectOptions({
      items: decisionOptions,
      selectedValue: query.decision_id,
      placeholder: "选择决策 ID（可选）",
    }) +
    `</select>` +
    `</label>` +
    `<span class="muted">${escapeHtml(decisionHint)} ${escapeHtml(namespaceHint)}</span>` +
    hiddenFields +
    `<button type="submit" class="btn btn-primary">应用上下文</button>` +
    `${clearDecisionHref ? `<a class="btn btn-secondary" href="${clearDecisionHref}">仅看运行态</a>` : ""}` +
    `</form>` +
    `</article>`
  );
}

function renderDefaultRouteSummary(
  route?: ReturnType<typeof collectRuntimeRouteOverview>["route_items"][number],
): string {
  if (!route) {
    return (
      `<div class="route-summary">` +
      `<div class="route-line"><span class="route-key">route</span><strong class="route-value">-</strong></div>` +
      `</div>`
    );
  }

  const tenantEnv = `${route.tenant_id}/${route.environment}`;
  const modelVersion = route.model_version || "-";
  const publishId = route.publish_id || "-";

  return (
    `<div class="route-summary">` +
    `<div class="route-line"><span class="route-key">tenant/env</span><strong class="route-value">${escapeHtml(
      tenantEnv,
    )}</strong></div>` +
    `<div class="route-line"><span class="route-key">model</span><strong class="route-value">${escapeHtml(
      route.model_id,
    )}<span class="route-sub">@${escapeHtml(
      modelVersion,
    )}</span></strong></div>` +
    `<div class="route-line"><span class="route-key">publish</span><strong class="route-value">${escapeHtml(
      publishId,
    )}</strong></div>` +
    `</div>`
  );
}

function renderRuntimeObjectRows(
  objects: ControlObjectListResponse["items"],
  input: {
    namespace: string;
    hiddenFields: string;
    focusObjectId?: string;
    focusOwnerRef?: string;
  },
): string {
  if (objects.length === 0) {
    return '<tr><td colspan="7" class="muted">当前命名空间暂无客体数据</td></tr>';
  }

  return objects
    .map((item) => {
      const isFocusObject =
        input.focusObjectId &&
        item.object_id.trim() === input.focusObjectId.trim();
      const isFocusOwner =
        input.focusOwnerRef &&
        item.owner_ref.trim() === input.focusOwnerRef.trim();
      const rowClass =
        isFocusObject || isFocusOwner ? ' class="runtime-focus-row"' : "";
      const deleteForm =
        `<form class="table-action" method="POST" action="/actions/control/object/delete" data-control-incremental="true" data-control-incremental-target="[data-relation-replay-card]" onsubmit="return confirm('确认删除该对象？')">` +
        input.hiddenFields +
        `<input type="hidden" name="namespace" value="${escapeHtml(input.namespace)}" />` +
        `<input type="hidden" name="object_id" value="${escapeHtml(item.object_id)}" />` +
        `<button type="submit" class="btn btn-secondary btn-inline">删除</button>` +
        `</form>`;
      return (
        `<tr${rowClass}>` +
        `<td>${escapeHtml(item.object_id)}</td>` +
        `<td>${escapeHtml(item.object_type)}</td>` +
        `<td>${escapeHtml(item.sensitivity ?? "")}</td>` +
        `<td>${escapeHtml(item.owner_ref ?? "")}</td>` +
        `<td>${escapeHtml((item.labels ?? []).join(", "))}</td>` +
        `<td>${escapeHtml(formatTime(item.updated_at))}</td>` +
        `<td>${deleteForm}</td>` +
        `</tr>`
      );
    })
    .join("");
}

export function renderRelationView(viewModel: ConsolePageViewModel): string {
  const namespace = viewModel.query.namespace ?? "tenant_a.crm";
  const hiddenContext = renderScopedHiddenContextFields(viewModel, ["namespace"]);
  const runtimeRouteOverview = collectRuntimeRouteOverview(viewModel);
  const latestRoute = runtimeRouteOverview.route_items[0];
  const relationReplayFocus = buildRelationReplayFocusPayload(viewModel);
  const runtimeRelationGraphPayloadJson = escapeHtml(
    JSON.stringify(buildInstanceGraphPayload(viewModel)),
  );
  const runtimeRelationGraphFocusJson = escapeHtml(
    JSON.stringify(relationReplayFocus),
  );
  const objectRows = viewModel.control_objects?.ok
    ? renderRuntimeObjectRows(viewModel.control_objects.data.items, {
        namespace,
        hiddenFields: hiddenContext,
        focusObjectId: relationReplayFocus.object_id,
        focusOwnerRef: relationReplayFocus.object_owner_ref,
      })
    : '<tr><td colspan="7" class="muted">客体台账加载失败</td></tr>';
  const objectCount = viewModel.control_objects?.ok
    ? viewModel.control_objects.data.total_count
    : 0;
  const relationCount = viewModel.control_relations?.ok
    ? viewModel.control_relations.data.total_count
    : 0;
  const relationRows = viewModel.control_relations?.ok
    ? viewModel.control_relations.data.items.length === 0
      ? '<tr><td colspan="6" class="muted">关系事件为空</td></tr>'
      : viewModel.control_relations.data.items
          .map((item) => {
            const edgeKey = buildInstanceGraphEdgeKey({
              from: item.from,
              to: item.to,
              label: buildInstanceGraphEdgeLabel(
                item.relation_type,
                item.scope,
              ),
              dashed: false,
            });
            const rowClass = relationReplayFocus.highlight_edge_keys.includes(
              edgeKey,
            )
              ? ' class="runtime-focus-row"'
              : "";
            const deleteForm =
              `<form class="table-action" method="POST" action="/actions/control/relation/event" data-control-incremental="true" data-control-incremental-target="[data-relation-replay-card]" onsubmit="return confirm('确认删除该关系？')">` +
              hiddenContext +
              `<input type="hidden" name="namespace" value="${escapeHtml(namespace)}" />` +
              `<input type="hidden" name="from" value="${escapeHtml(item.from)}" />` +
              `<input type="hidden" name="to" value="${escapeHtml(item.to)}" />` +
              `<input type="hidden" name="relation_type" value="${escapeHtml(item.relation_type)}" />` +
              `<input type="hidden" name="operation" value="delete" />` +
              (item.scope
                ? `<input type="hidden" name="scope" value="${escapeHtml(item.scope)}" />`
                : "") +
              `<button type="submit" class="btn btn-secondary btn-inline">删除</button>` +
              `</form>`;
            return (
              `<tr${rowClass}>` +
              `<td>${escapeHtml(item.from)}</td>` +
              `<td>${escapeHtml(item.relation_type)}</td>` +
              `<td>${escapeHtml(item.to)}</td>` +
              `<td>${escapeHtml(item.scope ?? "")}</td>` +
              `<td>${escapeHtml(formatTime(item.updated_at))}</td>` +
              `<td>${deleteForm}</td>` +
              `</tr>`
            );
          })
          .join("")
    : '<tr><td colspan="6" class="muted">关系数据加载失败</td></tr>';

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
    : `<p class="muted relation-replay-note">未选择 decision_id 时，上半区展示当前 namespace 的实际运行态 objects / relations；选择 decision 后 Graph 会高亮回放焦点。</p>`;

  const runtimeRouteSummary =
    runtimeRouteOverview.route_items.length > 0
      ? `<section class="kv-grid relation-replay-route">` +
        `<div class="kv-item"><span>namespace</span><strong>${escapeHtml(namespace)}</strong></div>` +
        `<div class="kv-item"><span>route count</span><strong>${runtimeRouteOverview.route_count}</strong></div>` +
        `<div class="kv-item route-default"><span>默认路由</span>${renderDefaultRouteSummary(
          latestRoute,
        )}</div>` +
        `</section>` +
        `<p class="muted relation-replay-note">路由按更新时间排序展示；实际命中由请求中的 tenant/environment 决定。</p>`
      : `<p class="muted relation-replay-note">当前 namespace 尚未配置 model_route，运行态不会自动切换到已发布模型。</p>`;
  const decisionTraceNote = relationReplayFocus.decision_id
    ? '<p class="muted relation-trace-note">决策 trace 已在上方“决策回放”卡片展示。</p>'
    : "";

  return (
    `<article class="card card-hover">` +
    `<h3>运行态关系回放</h3>` +
    `<p class="muted">上半区展示当前 namespace 已落库的运行态关系，可切换表格 / Graph；决策 trace 在上方卡片查看。</p>` +
    relationReplaySummary +
    runtimeRouteSummary +
    `<section class="relation-runtime-card" data-instance-editor data-subject-tree-direction="bottom-up">` +
    `<textarea hidden data-instance-graph-payload>${runtimeRelationGraphPayloadJson}</textarea>` +
    `<textarea hidden data-instance-graph-focus>${runtimeRelationGraphFocusJson}</textarea>` +
    `<div class="model-editor-head">` +
    `<p class="muted">运行态关系边 / Graph</p>` +
    `<div class="model-editor-head-actions">${renderRelationReplayToggleSwitch()}</div>` +
    `</div>` +
    `<section class="json-switchable" data-json-switchable>` +
    `<div class="json-view" data-json-view="visual">` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Object ID</th><th>Type</th><th>Sensitivity</th><th>Owner</th><th>Labels</th><th>Updated</th><th>操作</th></tr></thead><tbody>${objectRows}</tbody></table></div>` +
    `<p class="muted relation-runtime-count">当前运行态：objects=${objectCount}，relations=${relationCount}</p>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>From</th><th>Relation</th><th>To</th><th>Scope</th><th>Updated</th><th>操作</th></tr></thead><tbody>${relationRows}</tbody></table></div>` +
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
    decisionTraceNote +
    `</article>`
  );
}
