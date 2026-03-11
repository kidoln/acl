import type {
  ApiResult,
  ConsolePageViewModel,
  PublishRequestListResponse,
  PublishRequestRecord,
} from "../../types";
import {
  asRecord,
  buildScopedQueryHref,
  escapeHtml,
  formatTime,
  readPathString,
  renderApiResultError,
  renderHiddenContextFields,
  renderJsonToggleSwitch,
  renderRawJsonPanel,
  renderScopedHiddenContextFields,
  renderSwitchableJsonView,
} from "../shared";

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

function renderPublishDetailVisual(
  record: PublishRequestRecord,
  viewModel: ConsolePageViewModel,
): string {
  const payload = asRecord(record.payload) ?? {};
  const gateResult = asRecord(payload.gate_result);
  const gateValidation = asRecord(gateResult?.validation);
  const hasValidationPayload = gateValidation !== null;
  const validationSummary = asRecord(gateValidation?.summary);
  const validationIssues = Array.isArray(gateValidation?.issues)
    ? gateValidation.issues.filter(
        (item): item is Record<string, unknown> => asRecord(item) !== null,
      )
    : [];
  const gateItems = Array.isArray(gateResult?.gates)
    ? gateResult.gates.filter(
        (item): item is Record<string, unknown> => asRecord(item) !== null,
      )
    : [];
  const activationMeta = asRecord(payload.activation);
  const activationOperator =
    typeof activationMeta?.operator === "string"
      ? activationMeta.operator
      : "-";
  const activationTime =
    typeof activationMeta?.activated_at === "string"
      ? formatTime(activationMeta.activated_at)
      : "-";
  const modelSnapshot = asRecord(payload.model_snapshot) ?? {};
  const modelMeta = asRecord(modelSnapshot.model_meta);
  const modelId = typeof modelMeta?.model_id === "string" ? modelMeta.model_id : "-";
  const modelVersion =
    typeof modelMeta?.version === "string" ? modelMeta.version : "-";

  const gateRows = gateItems
    .map(
      (item) =>
        `<tr><td>${escapeHtml(readPathString(item, ["gate"], "-"))}</td><td>${escapeHtml(readPathString(item, ["level"], "-"))}</td><td>${escapeHtml(readPathString(item, ["decision"], "-"))}</td><td>${escapeHtml(readPathString(item, ["detail"], "-"))}</td></tr>`,
    )
    .join("");
  const gateRowsWithFallback =
    gateRows.length > 0
      ? gateRows
      : '<tr><td colspan="4" class="muted">暂无门禁记录</td></tr>';
  const gateSummaryRows = validationIssues
    .map(
      (issue) =>
        `<tr><td>${escapeHtml(readPathString(issue, ["code"], "-"))}</td><td>${escapeHtml(readPathString(issue, ["layer"], "-"))}</td><td>${escapeHtml(readPathString(issue, ["severity"], "-"))}</td><td>${escapeHtml(readPathString(issue, ["path"], "-"))}</td><td>${escapeHtml(readPathString(issue, ["message"], "-"))}</td></tr>`,
    )
    .join("");
  const gateSummaryRowsWithFallback =
    gateSummaryRows.length > 0
      ? gateSummaryRows
      : '<tr><td colspan="5" class="muted">暂无校验问题</td></tr>';

  return (
    `<section class="decision-grid">` +
    `<div class="metric"><span>状态</span><strong>${escapeHtml(record.status)}</strong></div>` +
    `<div class="metric"><span>最终结果</span><strong>${escapeHtml(record.final_result)}</strong></div>` +
    `<div class="metric"><span>Profile</span><strong>${escapeHtml(record.profile)}</strong></div>` +
    `<div class="metric"><span>更新时间</span><strong>${escapeHtml(formatTime(record.updated_at))}</strong></div>` +
    `</section>` +
    `<section class="kv-grid">` +
    `<div class="kv-item"><span>model_id</span><strong>${escapeHtml(modelId)}</strong></div>` +
    `<div class="kv-item"><span>model_version</span><strong>${escapeHtml(modelVersion)}</strong></div>` +
    `<div class="kv-item"><span>activation</span><strong>${escapeHtml(activationOperator)}</strong></div>` +
    `<div class="kv-item"><span>activated_at</span><strong>${escapeHtml(activationTime)}</strong></div>` +
    `</section>` +
    `<section class="table-card">` +
    `<h4>门禁 Gate</h4>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Gate</th><th>Level</th><th>Decision</th><th>Detail</th></tr></thead><tbody>${gateRowsWithFallback}</tbody></table></div>` +
    `</section>` +
    `<section class="table-card">` +
    `<h4>模型校验</h4>` +
    (hasValidationPayload
      ? `<section class="decision-grid">` +
        `<div class="metric"><span>rules</span><strong>${escapeHtml(String(readPathString(validationSummary ?? {}, ["rules"], "-")))}</strong></div>` +
        `<div class="metric"><span>relations</span><strong>${escapeHtml(String(readPathString(validationSummary ?? {}, ["relation_signatures"], "-")))}</strong></div>` +
        `<div class="metric"><span>conflicts</span><strong>${escapeHtml(String(readPathString(validationSummary ?? {}, ["conflicts"], "-")))}</strong></div>` +
        `</section>`
      : '<p class="muted">暂无校验摘要</p>') +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Code</th><th>Layer</th><th>Severity</th><th>Path</th><th>Message</th></tr></thead><tbody>${gateSummaryRowsWithFallback}</tbody></table></div>` +
    `</section>`
  );
}

export function renderPublishDetail(
  result: ApiResult<PublishRequestRecord> | undefined,
  viewModel: ConsolePageViewModel,
): string {
  if (!result) {
    return '<section class="card card-hover"><h3>发布详情</h3><p class="muted">从左侧列表选择 publish_id 后展示详情。</p></section>';
  }

  if (!result.ok) {
    return renderApiResultError(result);
  }

  const visualContent = renderPublishDetailVisual(result.data, viewModel);
  const rawContent = renderRawJsonPanel(result.data);

  return (
    `<section class=\"card card-hover\">` +
    `<div class="card-head"><div class="card-head-main"><h3>发布详情</h3><p class=\"muted\">publish_id: ${escapeHtml(result.data.publish_id)}</p></div>${renderJsonToggleSwitch()}</div>` +
    `${renderSwitchableJsonView(visualContent, rawContent)}` +
    `<section class="action-panel">${renderActionPanel(result, viewModel)}</section>` +
    `${renderPublishJourneyCard(result.data, viewModel)}` +
    `</section>`
  );
}

export function renderPublishSummary(viewModel: ConsolePageViewModel): string {
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

export function renderPublishListPanel(
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
    `<form class="filters toolbar" method="GET" action="/" data-control-incremental="true">` +
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

export function renderWorkflowGuideCard(viewModel: ConsolePageViewModel): string {
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
