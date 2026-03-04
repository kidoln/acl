import type {
  ApiResult,
  ConsolePageViewModel,
  DecisionRecordResponse,
  PublishRequestListResponse,
  PublishRequestRecord,
} from './types';

function formatTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }
  return new Date(parsed).toLocaleString('zh-CN', { hour12: false });
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderHiddenContextFields(viewModel: ConsolePageViewModel): string {
  const fields: Array<[string, string | number | undefined]> = [
    ['status', viewModel.query.status],
    ['profile', viewModel.query.profile],
    ['limit', viewModel.query.limit],
    ['offset', viewModel.query.offset],
    ['decision_id', viewModel.query.decision_id],
    ['simulation_id', viewModel.query.simulation_id],
    ['namespace', viewModel.query.namespace],
    ['cell_key', viewModel.query.cell_key],
  ];

  return fields
    .filter(([, value]) => value !== undefined && String(value).length > 0)
    .map(
      ([name, value]) =>
        `<input type=\"hidden\" name=\"${name}\" value=\"${escapeHtml(String(value))}\" />`,
    )
    .join('');
}

function renderFlash(viewModel: ConsolePageViewModel): string {
  if (!viewModel.action_flash) {
    return '';
  }

  return `<section class=\"flash flash-${viewModel.action_flash.type}\">`
    + `<p>${escapeHtml(viewModel.action_flash.message)}</p>`
    + `</section>`;
}

function renderApiResultError<T>(result: ApiResult<T>): string {
  if (result.ok) {
    return '';
  }

  return `<div class=\"card error\">`
    + `<h3>数据加载失败</h3>`
    + `<p>${escapeHtml(result.error)}</p>`
    + `${result.status ? `<p class=\"muted\">HTTP ${result.status}</p>` : ''}`
    + `</div>`;
}

function renderPublishRows(
  result: ApiResult<PublishRequestListResponse>,
  viewModel: ConsolePageViewModel,
  selectedId?: string,
): string {
  if (!result.ok) {
    return '';
  }

  if (result.data.items.length === 0) {
    return '<tr><td colspan="6" class="muted">当前筛选条件下无发布请求</td></tr>';
  }

  return result.data.items
    .map((item) => {
      const selectedClass = selectedId === item.publish_id ? 'row-selected' : '';
      const detailHref = buildQueryHref(viewModel, {
        publish_id: item.publish_id,
      });
      const statusClass = `status-${item.status}`;

      return `<tr class=\"${selectedClass}\">`
        + `<td><a href=\"${detailHref}\">${escapeHtml(item.publish_id)}</a></td>`
        + `<td>${escapeHtml(item.profile)}</td>`
        + `<td><span class=\"status-tag ${statusClass}\">${escapeHtml(item.status)}</span></td>`
        + `<td>${escapeHtml(item.final_result)}</td>`
        + `<td>${escapeHtml(formatTime(item.updated_at))}</td>`
        + `<td>${escapeHtml(formatTime(item.created_at))}</td>`
        + `</tr>`;
    })
    .join('');
}

function renderReviewForm(record: PublishRequestRecord, viewModel: ConsolePageViewModel): string {
  const hiddenFields = renderHiddenContextFields(viewModel);

  return `<form class=\"action-form\" method=\"POST\" action=\"/actions/review\">`
    + `<h4>人工复核</h4>`
    + `<input type=\"hidden\" name=\"publish_id\" value=\"${escapeHtml(record.publish_id)}\" />`
    + hiddenFields
    + `<label>Decision`
    + `<select name=\"decision\">`
    + `<option value=\"approve\">approve</option>`
    + `<option value=\"reject\">reject</option>`
    + `</select></label>`
    + `<label>Reviewer<input type=\"text\" name=\"reviewer\" value=\"governance_lead\" required /></label>`
    + `<label>Reason<input type=\"text\" name=\"reason\" placeholder=\"临时豁免说明\" required /></label>`
    + `<label>Expires At (ISO 可选)<input type=\"text\" name=\"expires_at\" placeholder=\"2026-03-11T00:00:00.000Z\" /></label>`
    + `<button type=\"submit\" class=\"btn btn-primary\">提交复核</button>`
    + `</form>`;
}

function renderActivateForm(record: PublishRequestRecord, viewModel: ConsolePageViewModel): string {
  const hiddenFields = renderHiddenContextFields(viewModel);

  return `<form class=\"action-form\" method=\"POST\" action=\"/actions/activate\">`
    + `<h4>激活发布</h4>`
    + `<input type=\"hidden\" name=\"publish_id\" value=\"${escapeHtml(record.publish_id)}\" />`
    + hiddenFields
    + `<label>Operator<input type=\"text\" name=\"operator\" value=\"release_bot\" required /></label>`
    + `<button type=\"submit\" class=\"btn btn-primary\">执行激活</button>`
    + `</form>`;
}

function renderActionPanel(result: ApiResult<PublishRequestRecord>, viewModel: ConsolePageViewModel): string {
  if (!result.ok) {
    return '';
  }

  if (result.data.status === 'review_required') {
    return renderReviewForm(result.data, viewModel);
  }

  if (result.data.status === 'approved') {
    return renderActivateForm(result.data, viewModel);
  }

  return '<p class="muted">当前状态无需操作，可继续查看回放和审计详情。</p>';
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

  return `<div class=\"card card-hover\">`
    + `<h3>发布详情</h3>`
    + `<p class=\"muted\">publish_id: ${escapeHtml(result.data.publish_id)}</p>`
    + `<div class=\"action-panel\">${renderActionPanel(result, viewModel)}</div>`
    + `<pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>`
    + `</div>`;
}

function pickStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function renderInlineList(values: string[]): string {
  if (values.length === 0) {
    return '<span class="muted">(empty)</span>';
  }

  return values
    .map((value) => `<span class=\"chip\">${escapeHtml(value)}</span>`)
    .join(' ');
}

function renderDecisionStructured(result: DecisionRecordResponse): string {
  const payload = result.payload;
  const finalEffect = typeof payload.final_effect === 'string' ? payload.final_effect : 'unknown';
  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  const matchedRules = pickStringArray(payload, 'matched_rules');
  const overriddenRules = pickStringArray(payload, 'overridden_rules');
  const obligations = pickStringArray(payload, 'obligations');
  const advice = pickStringArray(payload, 'advice');

  return `<section class=\"decision-grid\">`
    + `<div class=\"metric\"><span>最终效果</span><strong>${escapeHtml(finalEffect)}</strong></div>`
    + `<div class=\"metric\"><span>命中规则</span><strong>${matchedRules.length}</strong></div>`
    + `<div class=\"metric\"><span>覆盖规则</span><strong>${overriddenRules.length}</strong></div>`
    + `<div class=\"metric\"><span>发生时间</span><strong>${escapeHtml(formatTime(result.created_at))}</strong></div>`
    + `</section>`
    + `${reason ? `<p><strong>原因:</strong> ${escapeHtml(reason)}</p>` : ''}`
    + `<p><strong>命中规则:</strong> ${renderInlineList(matchedRules)}</p>`
    + `<p><strong>覆盖规则:</strong> ${renderInlineList(overriddenRules)}</p>`
    + `<p><strong>Obligations:</strong> ${renderInlineList(obligations)}</p>`
    + `<p><strong>Advice:</strong> ${renderInlineList(advice)}</p>`;
}

function renderDecisionDetail(result: ApiResult<DecisionRecordResponse> | undefined): string {
  if (!result) {
    return '<div class="card card-hover"><h3>决策回放</h3><p class="muted">输入 decision_id 后可查看回放证据</p></div>';
  }

  if (!result.ok) {
    return renderApiResultError(result);
  }

  return `<div class=\"card card-hover\">`
    + `<h3>决策回放</h3>`
    + `<p class=\"muted\">decision_id: ${escapeHtml(result.data.decision_id)}</p>`
    + renderDecisionStructured(result.data)
    + `<pre>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre>`
    + `</div>`;
}

function readPathNumber(source: Record<string, unknown>, path: string[], fallback = 0): number {
  let cursor: unknown = source;
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null) {
      return fallback;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === 'number' ? cursor : fallback;
}

function readPathString(source: Record<string, unknown>, path: string[], fallback = ''): string {
  let cursor: unknown = source;
  for (const segment of path) {
    if (typeof cursor !== 'object' || cursor === null) {
      return fallback;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === 'string' ? cursor : fallback;
}

function buildQueryHref(viewModel: ConsolePageViewModel, updates: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  const baseEntries: Array<[string, string | undefined]> = [
    ['status', viewModel.query.status],
    ['profile', viewModel.query.profile],
    ['limit', String(viewModel.query.limit)],
    ['offset', String(viewModel.query.offset)],
    ['publish_id', viewModel.query.publish_id],
    ['decision_id', viewModel.query.decision_id],
    ['simulation_id', viewModel.query.simulation_id],
    ['namespace', viewModel.query.namespace],
    ['cell_key', viewModel.query.cell_key],
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
  return queryString.length > 0 ? `/?${queryString}` : '/';
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

  const subjects = Array.from(new Set(cells.map((cell) => readPathString(cell, ['subject_id'], ''))))
    .filter((value) => value.length > 0)
    .slice(0, 8);
  const objects = Array.from(new Set(cells.map((cell) => readPathString(cell, ['object_id'], ''))))
    .filter((value) => value.length > 0)
    .slice(0, 8);

  const rows = subjects.map((subjectId) => {
    const cols = objects.map((objectId) => {
      const scoped = cells.filter((cell) =>
        readPathString(cell, ['subject_id']) === subjectId
        && readPathString(cell, ['object_id']) === objectId,
      );
      if (scoped.length === 0) {
        return '<td class="muted">-</td>';
      }
      const sample = scoped[0];
      const cellKey = readPathString(sample, ['cell_key']);
      const changedCount = scoped.length;
      const allowGain = scoped.filter((cell) =>
        readPathString(cell, ['baseline_effect']) !== 'allow'
        && readPathString(cell, ['draft_effect']) === 'allow',
      ).length;
      const denyGain = scoped.filter((cell) =>
        readPathString(cell, ['baseline_effect']) !== 'deny'
        && readPathString(cell, ['draft_effect']) === 'deny',
      ).length;
      const href = buildQueryHref(viewModel, {
        cell_key: cellKey,
      });
      return `<td><a href="${href}" class="matrix-link">Δ${changedCount} / +A${allowGain} / +D${denyGain}</a></td>`;
    }).join('');
    return `<tr><th>${escapeHtml(subjectId)}</th>${cols}</tr>`;
  }).join('');

  const selectedCell = viewModel.query.cell_key
    ? cells.find((cell) => readPathString(cell, ['cell_key']) === viewModel.query.cell_key)
    : undefined;

  const drawer = selectedCell
    ? `<section class="drawer">`
      + `<h4>单元格详情抽屉</h4>`
      + `<p><strong>cell_key:</strong> ${escapeHtml(readPathString(selectedCell, ['cell_key']))}</p>`
      + `<p><strong>final_decision:</strong> ${escapeHtml(readPathString(selectedCell, ['draft_effect']))}</p>`
      + `<p><strong>baseline_decision:</strong> ${escapeHtml(readPathString(selectedCell, ['baseline_effect']))}</p>`
      + `<p><strong>effective_actions:</strong> ${escapeHtml(readPathString(selectedCell, ['action']))}</p>`
      + `<p><strong>matched_rules:</strong> ${escapeHtml(JSON.stringify((selectedCell.matched_rules ?? selectedCell.draft_matched_rules) as unknown) ?? '[]')}</p>`
      + `<p><strong>overridden_rules:</strong> ${escapeHtml(JSON.stringify((selectedCell.draft_overridden_rules ?? []) as unknown) ?? '[]')}</p>`
      + `<p><strong>relation_path:</strong> ${escapeHtml(readPathString(selectedCell, ['subject_id']))} -> ${escapeHtml(readPathString(selectedCell, ['object_id']))}</p>`
      + `</section>`
    : '<p class="muted">点击矩阵单元格可打开详情抽屉。</p>';

  return `<article class="card card-hover">`
    + `<h3>权限矩阵视图</h3>`
    + `<p class="muted">行轴=主体场景，列轴=客体场景，单元格展示变更密度并可钻取。</p>`
    + `<div class="table-container"><table class="data-table matrix-table"><thead><tr><th>Subject \\ Object</th>${objects.map((obj) => `<th>${escapeHtml(obj)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
    + drawer
    + `</article>`;
}

function renderRelationView(viewModel: ConsolePageViewModel): string {
  const relationRows = viewModel.control_relations?.ok
    ? (viewModel.control_relations.data.items.length === 0
      ? '<tr><td colspan="5" class="muted">关系事件为空</td></tr>'
      : viewModel.control_relations.data.items.map((item) =>
          `<tr><td>${escapeHtml(item.from)}</td><td>${escapeHtml(item.relation_type)}</td><td>${escapeHtml(item.to)}</td><td>${escapeHtml(item.scope ?? '')}</td><td>${escapeHtml(formatTime(item.updated_at))}</td></tr>`,
        ).join(''))
    : '<tr><td colspan="5" class="muted">关系数据加载失败</td></tr>';

  const traceRows = viewModel.decision_detail?.ok
    ? (viewModel.decision_detail.data.traces.length === 0
      ? '<tr><td colspan="4" class="muted">暂无 trace 记录</td></tr>'
      : viewModel.decision_detail.data.traces.map((trace) =>
          `<tr><td>${escapeHtml(readPathString(trace, ['rule_id'], 'unknown'))}</td><td>${escapeHtml(readPathString(trace, ['status'], 'unknown'))}</td><td>${escapeHtml(readPathString(trace, ['effect'], 'unknown'))}</td><td>${escapeHtml(readPathString(trace, ['reason'], ''))}</td></tr>`,
        ).join(''))
    : '<tr><td colspan="4" class="muted">输入 decision_id 查看命中链路</td></tr>';

  return `<article class="card card-hover">`
    + `<h3>关系图视图</h3>`
    + `<p class="muted">上半区展示控制面关系边，下半区展示决策 trace 链路。</p>`
    + `<div class="table-container"><table class="data-table"><thead><tr><th>From</th><th>Relation</th><th>To</th><th>Scope</th><th>Updated</th></tr></thead><tbody>${relationRows}</tbody></table></div>`
    + `<div class="table-container relation-trace"><table class="data-table"><thead><tr><th>Rule</th><th>Status</th><th>Effect</th><th>Reason</th></tr></thead><tbody>${traceRows}</tbody></table></div>`
    + `</article>`;
}

function renderSimulationView(viewModel: ConsolePageViewModel): string {
  if (!viewModel.simulation_detail?.ok) {
    return '<article class="card card-hover"><h3>影响面模拟视图</h3><p class="muted">选择 publish_id 后会自动加载最新模拟报告。</p></article>';
  }

  const report = viewModel.simulation_detail.data;
  const summary = report.summary;
  const recommendation = summary.publish_recommendation;
  const actionRows = report.action_change_matrix.length === 0
    ? '<tr><td colspan="7" class="muted">暂无动作变化</td></tr>'
    : report.action_change_matrix.map((row) => {
        const action = readPathString(row, ['action'], 'unknown');
        return `<tr>`
          + `<td>${escapeHtml(action)}</td>`
          + `<td>${readPathNumber(row, ['changed_count'])}</td>`
          + `<td>${readPathNumber(row, ['allow_to_deny'])}</td>`
          + `<td>${readPathNumber(row, ['deny_to_allow'])}</td>`
          + `<td>${readPathNumber(row, ['not_applicable_to_allow'])}</td>`
          + `<td>${readPathNumber(row, ['not_applicable_to_deny'])}</td>`
          + `<td>${readPathNumber(row, ['indeterminate_to_allow']) + readPathNumber(row, ['indeterminate_to_deny'])}</td>`
          + `</tr>`;
      }).join('');

  const simulationSelector = viewModel.simulation_list?.ok
    ? `<form class="filters toolbar" method="GET" action="/">`
      + `<label>Simulation Report`
      + `<select name="simulation_id">`
      + viewModel.simulation_list.data.items
        .map((item) => `<option value="${escapeHtml(item.report_id)}" ${item.report_id === report.report_id ? 'selected' : ''}>${escapeHtml(item.report_id)} | ${escapeHtml(formatTime(item.generated_at))}</option>`)
        .join('')
      + `</select></label>`
      + `<input type="hidden" name="publish_id" value="${escapeHtml(viewModel.query.publish_id ?? '')}" />`
      + `<input type="hidden" name="decision_id" value="${escapeHtml(viewModel.query.decision_id ?? '')}" />`
      + `<input type="hidden" name="status" value="${escapeHtml(viewModel.query.status ?? '')}" />`
      + `<input type="hidden" name="profile" value="${escapeHtml(viewModel.query.profile ?? '')}" />`
      + `<input type="hidden" name="namespace" value="${escapeHtml(viewModel.query.namespace ?? '')}" />`
      + `<button type="submit" class="btn btn-primary">切换报告</button>`
      + `</form>`
    : '';

  return `<article class="card card-hover">`
    + `<h3>影响面模拟视图</h3>`
    + `<p class="muted">模拟报告: ${escapeHtml(report.report_id)} / ${escapeHtml(formatTime(report.generated_at))}</p>`
    + simulationSelector
    + `<section class="decision-grid">`
    + `<div class="metric"><span>delta_allow_subject_count</span><strong>${summary.delta_allow_subject_count}</strong></div>`
    + `<div class="metric"><span>delta_deny_subject_count</span><strong>${summary.delta_deny_subject_count}</strong></div>`
    + `<div class="metric"><span>delta_high_sensitivity_object_count</span><strong>${summary.delta_high_sensitivity_object_count}</strong></div>`
    + `<div class="metric"><span>new_conflict_rule_count</span><strong>${summary.new_conflict_rule_count}</strong></div>`
    + `<div class="metric"><span>new_sod_violation_count</span><strong>${summary.new_sod_violation_count}</strong></div>`
    + `<div class="metric"><span>indeterminate_rate_estimation</span><strong>${summary.indeterminate_rate_estimation}</strong></div>`
    + `<div class="metric"><span>mandatory_obligations_pass_rate</span><strong>${summary.mandatory_obligations_pass_rate}</strong></div>`
    + `<div class="metric"><span>publish_recommendation</span><strong>${escapeHtml(recommendation)}</strong></div>`
    + `</section>`
    + `<div class="table-container"><table class="data-table"><thead><tr><th>Action</th><th>Changed</th><th>Allow→Deny</th><th>Deny→Allow</th><th>NA→Allow</th><th>NA→Deny</th><th>Indeterminate Δ</th></tr></thead><tbody>${actionRows}</tbody></table></div>`
    + `</article>`;
}

function renderControlPlaneOverview(viewModel: ConsolePageViewModel): string {
  const namespace = viewModel.query.namespace ?? 'tenant_a.crm';
  const catalogs = viewModel.control_catalogs?.ok ? viewModel.control_catalogs.data.total_count : 0;
  const objects = viewModel.control_objects?.ok ? viewModel.control_objects.data.total_count : 0;
  const relations = viewModel.control_relations?.ok ? viewModel.control_relations.data.total_count : 0;
  const audits = viewModel.control_audits?.ok ? viewModel.control_audits.data.total_count : 0;

  const auditRows = viewModel.control_audits?.ok
    ? (viewModel.control_audits.data.items.length === 0
      ? '<tr><td colspan="4" class="muted">暂无控制面审计事件</td></tr>'
      : viewModel.control_audits.data.items.slice(0, 6).map((item) =>
          `<tr><td>${escapeHtml(item.event_type)}</td><td>${escapeHtml(item.target)}</td><td>${escapeHtml(item.operator)}</td><td>${escapeHtml(formatTime(item.created_at))}</td></tr>`,
        ).join(''))
    : '<tr><td colspan="4" class="muted">审计数据加载失败</td></tr>';

  return `<article class="card card-hover">`
    + `<h3>控制面总览</h3>`
    + `<form class="filters toolbar" method="GET" action="/">`
    + `<label>Namespace`
    + `<input type="text" name="namespace" value="${escapeHtml(namespace)}" placeholder="tenant_a.crm" />`
    + `</label>`
    + `<input type="hidden" name="publish_id" value="${escapeHtml(viewModel.query.publish_id ?? '')}" />`
    + `<input type="hidden" name="decision_id" value="${escapeHtml(viewModel.query.decision_id ?? '')}" />`
    + `<input type="hidden" name="simulation_id" value="${escapeHtml(viewModel.query.simulation_id ?? '')}" />`
    + `<button type="submit" class="btn btn-primary">切换命名空间</button>`
    + `</form>`
    + `<section class="decision-grid">`
    + `<div class="metric"><span>catalogs</span><strong>${catalogs}</strong></div>`
    + `<div class="metric"><span>objects</span><strong>${objects}</strong></div>`
    + `<div class="metric"><span>relations</span><strong>${relations}</strong></div>`
    + `<div class="metric"><span>audits</span><strong>${audits}</strong></div>`
    + `</section>`
    + `<div class="table-container"><table class="data-table"><thead><tr><th>Event</th><th>Target</th><th>Operator</th><th>Created At</th></tr></thead><tbody>${auditRows}</tbody></table></div>`
    + `</article>`;
}

function renderPublishSummary(viewModel: ConsolePageViewModel): string {
  if (!viewModel.publish_list.ok) {
    return '<div class="badge-row"><span class="badge badge-danger">列表加载失败</span></div>';
  }

  const current = viewModel.publish_list.data.items.length;
  const total = viewModel.publish_list.data.total_count;
  const status = viewModel.query.status ?? 'all';
  const profile = viewModel.query.profile ?? 'all';

  return `<div class=\"badge-row\">`
    + `<span class=\"badge badge-info\">status: ${escapeHtml(status)}</span>`
    + `<span class=\"badge badge-neutral\">profile: ${escapeHtml(profile)}</span>`
    + `<span class=\"badge badge-primary\">当前 ${current} 条 / 总计 ${total} 条</span>`
    + `</div>`;
}

function renderPagination(
  viewModel: ConsolePageViewModel,
  prevQuery: URLSearchParams,
  nextQuery: URLSearchParams,
  hasPrev: boolean,
  hasNext: boolean,
): string {
  if (!viewModel.publish_list.ok) {
    return '';
  }

  const { items, offset, total_count: totalCount } = viewModel.publish_list.data;
  const start = items.length === 0 ? 0 : offset + 1;
  const end = items.length === 0 ? 0 : offset + items.length;
  const info = totalCount === 0 ? '当前无记录' : `第 ${start}-${end} 条，共 ${totalCount} 条`;

  const currentPage = Math.floor(offset / viewModel.query.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(totalCount / viewModel.query.limit));
  const nextPage = Math.min(currentPage + 1, totalPages);
  const prevPage = Math.max(currentPage - 1, 1);

  return `<div class=\"pagination-wrapper\">`
    + `<span class=\"pagination-info\">${info}</span>`
    + `<div class=\"pagination\">`
    + `${hasPrev
      ? `<a class=\"pagination-arrow\" href=\"/?${prevQuery.toString()}\" aria-label=\"上一页\">&lsaquo;</a>`
      : '<span class="pagination-arrow disabled" aria-hidden="true">&lsaquo;</span>'}`
    + `${hasPrev
      ? `<a class=\"pagination-item\" href=\"/?${prevQuery.toString()}\">${prevPage}</a>`
      : ''}`
    + `<span class=\"pagination-item active\">${currentPage}</span>`
    + `${hasNext
      ? `<a class=\"pagination-item\" href=\"/?${nextQuery.toString()}\">${nextPage}</a>`
      : ''}`
    + `${hasNext
      ? `<a class=\"pagination-arrow\" href=\"/?${nextQuery.toString()}\" aria-label=\"下一页\">&rsaquo;</a>`
      : '<span class="pagination-arrow disabled" aria-hidden="true">&rsaquo;</span>'}`
    + `</div>`
    + `</div>`;
}

export function renderConsolePage(viewModel: ConsolePageViewModel): string {
  const { query } = viewModel;
  const statusLabel = query.status ?? 'all';
  const profileLabel = query.profile ?? 'all';
  const decisionLabel = query.decision_id ? '已输入 decision_id' : '未输入 decision_id';
  const simulationLabel = query.simulation_id ? '已锁定 simulation_id' : '自动选择最新 simulation';
  const namespaceLabel = query.namespace ?? 'tenant_a.crm';
  const prevOffset = Math.max(query.offset - query.limit, 0);
  const hasPrev = query.offset > 0;
  const nextOffset = viewModel.publish_list.ok && viewModel.publish_list.data.has_more
    ? viewModel.publish_list.data.next_offset ?? query.offset + query.limit
    : query.offset;
  const hasNext = viewModel.publish_list.ok && viewModel.publish_list.data.has_more;

  const queryBase = new URLSearchParams();
  queryBase.set('limit', String(query.limit));
  queryBase.set('offset', String(query.offset));
  if (query.status) {
    queryBase.set('status', query.status);
  }
  if (query.profile) {
    queryBase.set('profile', query.profile);
  }
  if (query.publish_id) {
    queryBase.set('publish_id', query.publish_id);
  }
  if (query.decision_id) {
    queryBase.set('decision_id', query.decision_id);
  }
  if (query.simulation_id) {
    queryBase.set('simulation_id', query.simulation_id);
  }
  if (query.namespace) {
    queryBase.set('namespace', query.namespace);
  }
  if (query.cell_key) {
    queryBase.set('cell_key', query.cell_key);
  }

  const prevQuery = new URLSearchParams(queryBase);
  prevQuery.set('offset', String(prevOffset));
  const nextQuery = new URLSearchParams(queryBase);
  nextQuery.set('offset', String(nextOffset));

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ACL 治理控制台</title>
  <link rel="stylesheet" href="/assets/global.css" />
</head>
<body>
  <main class="shell">
    <section class="hero animate-enter">
      <div class="hero-top">
        <h1>ACL 治理控制台</h1>
        <span class="hero-pill">Governance Console</span>
      </div>
      <p>发布流程治理 + 决策回放 + 控制面同步。API: ${escapeHtml(viewModel.api_base_url)}，生成时间: ${escapeHtml(formatTime(viewModel.generated_at))}</p>
      <div class="hero-meta">
        <span class="badge badge-info">status: ${escapeHtml(statusLabel)}</span>
        <span class="badge badge-neutral">profile: ${escapeHtml(profileLabel)}</span>
        <span class="badge badge-primary">${escapeHtml(decisionLabel)}</span>
        <span class="badge badge-neutral">${escapeHtml(simulationLabel)}</span>
        <span class="badge badge-info">namespace: ${escapeHtml(namespaceLabel)}</span>
      </div>
    </section>

    ${renderFlash(viewModel)}

    <section class="grid">
      <article class="card card-hover animate-enter delay-100">
        <div class="section-head">
          <h2>发布请求列表</h2>
          ${renderPublishSummary(viewModel)}
        </div>
        <form class="filters toolbar" method="GET" action="/">
          <label>状态
            <select name="status">
              <option value="">全部</option>
              <option value="blocked" ${query.status === 'blocked' ? 'selected' : ''}>blocked</option>
              <option value="review_required" ${query.status === 'review_required' ? 'selected' : ''}>review_required</option>
              <option value="approved" ${query.status === 'approved' ? 'selected' : ''}>approved</option>
              <option value="rejected" ${query.status === 'rejected' ? 'selected' : ''}>rejected</option>
              <option value="published" ${query.status === 'published' ? 'selected' : ''}>published</option>
            </select>
          </label>

          <label>Profile
            <select name="profile">
              <option value="">全部</option>
              <option value="baseline" ${query.profile === 'baseline' ? 'selected' : ''}>baseline</option>
              <option value="strict_compliance" ${query.profile === 'strict_compliance' ? 'selected' : ''}>strict_compliance</option>
            </select>
          </label>

          <label>Limit
            <input type="number" min="1" max="100" name="limit" value="${query.limit}" />
          </label>

          <label>Offset
            <input type="number" min="0" name="offset" value="${query.offset}" />
          </label>

          <input type="hidden" name="namespace" value="${escapeHtml(query.namespace ?? 'tenant_a.crm')}" />
          <input type="hidden" name="decision_id" value="${escapeHtml(query.decision_id ?? '')}" />
          <input type="hidden" name="simulation_id" value="${escapeHtml(query.simulation_id ?? '')}" />

          <button type="submit" class="btn btn-primary">应用筛选</button>
        </form>

        ${renderApiResultError(viewModel.publish_list)}

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Publish ID</th>
                <th>Profile</th>
                <th>Status</th>
                <th>Final Result</th>
                <th>Updated At</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>${renderPublishRows(viewModel.publish_list, viewModel, query.publish_id)}</tbody>
          </table>
        </div>

        ${renderPagination(viewModel, prevQuery, nextQuery, hasPrev, hasNext)}
      </article>

      <section class="stack animate-enter delay-200">
        ${renderPublishDetail(viewModel.publish_detail, viewModel)}

        <article class="card card-hover">
          <h3>决策回放查询</h3>
          <form class="filters toolbar" method="GET" action="/">
            <label>Decision ID
              <input type="text" name="decision_id" value="${escapeHtml(query.decision_id ?? '')}" placeholder="dec_xxx" />
            </label>
            <input type="hidden" name="publish_id" value="${escapeHtml(query.publish_id ?? '')}" />
            <input type="hidden" name="status" value="${escapeHtml(query.status ?? '')}" />
            <input type="hidden" name="profile" value="${escapeHtml(query.profile ?? '')}" />
            <input type="hidden" name="namespace" value="${escapeHtml(query.namespace ?? 'tenant_a.crm')}" />
            <button type="submit" class="btn btn-primary">查询回放</button>
          </form>
        </article>

        ${renderDecisionDetail(viewModel.decision_detail)}
        ${renderSimulationView(viewModel)}
        ${renderMatrixView(viewModel)}
        ${renderRelationView(viewModel)}
        ${renderControlPlaneOverview(viewModel)}
      </section>
    </section>
  </main>
</body>
</html>`;
}
