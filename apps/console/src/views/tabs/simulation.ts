import type { ConsolePageViewModel } from "../../types";
import {
  buildScopedQueryHref,
  escapeHtml,
  formatTime,
  readPathString,
  renderNamespaceSelectOrInput,
  renderScopedHiddenContextFields,
  renderSelectOptions,
} from "../shared";

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

export function renderMatrixView(viewModel: ConsolePageViewModel): string {
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
  ).filter((value) => value.length > 0);
  const objects = Array.from(
    new Set(cells.map((cell) => readPathString(cell, ["object_id"], ""))),
  ).filter((value) => value.length > 0);

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

export function renderSimulationView(viewModel: ConsolePageViewModel): string {
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
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.action)}</td><td>${item.total_changed}</td><td>${item.allow_to_deny}</td><td>${item.deny_to_allow}</td><td>${item.na_to_allow}</td><td>${item.na_to_deny}</td><td>${item.indeterminate_delta}</td></tr>`,
          )
          .join("");
  const subjectRows =
    report.subject_change_rank.length === 0
      ? '<tr><td colspan="3" class="muted">暂无主体变化排行</td></tr>'
      : report.subject_change_rank
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.subject_id)}</td><td>${item.total_changed}</td><td>${item.max_risk_score}</td></tr>`,
          )
          .join("");
  const objectRows =
    report.object_change_rank.length === 0
      ? '<tr><td colspan="3" class="muted">暂无客体变化排行</td></tr>'
      : report.object_change_rank
          .map(
            (item) =>
              `<tr><td>${escapeHtml(item.object_id)}</td><td>${item.total_changed}</td><td>${escapeHtml(item.sensitivity)}</td></tr>`,
          )
          .join("");

  return (
    `<article class="card card-hover">` +
    `<h3>影响面模拟视图</h3>` +
    `<section class="decision-grid">` +
    `<div class="metric"><span>publish</span><strong>${escapeHtml(report.publish_id)}</strong></div>` +
    `<div class="metric"><span>baseline</span><strong>${escapeHtml(report.baseline_publish_id ?? "-")}</strong></div>` +
    `<div class="metric"><span>recommend</span><strong>${escapeHtml(recommendation)}</strong></div>` +
    `<div class="metric"><span>generated</span><strong>${escapeHtml(formatTime(report.generated_at))}</strong></div>` +
    `</section>` +
    `<p class="muted">${escapeHtml(summary.reason ?? "-")}</p>` +
    `<section class="table-card">` +
    `<h4>动作影响矩阵</h4>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Action</th><th>Changed</th><th>Allow→Deny</th><th>Deny→Allow</th><th>NA→Allow</th><th>NA→Deny</th><th>Indeterminate Δ</th></tr></thead><tbody>${actionRows}</tbody></table></div>` +
    `</section>` +
    `<section class="table-card">` +
    `<h4>主体影响排行</h4>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Top Impacted Subjects</th><th>Changed</th><th>Max Risk</th></tr></thead><tbody>${subjectRows}</tbody></table></div>` +
    `</section>` +
    `<section class="table-card">` +
    `<h4>客体影响排行</h4>` +
    `<div class="table-container"><table class="data-table"><thead><tr><th>Top Impacted Objects</th><th>Changed</th><th>Sensitivity</th></tr></thead><tbody>${objectRows}</tbody></table></div>` +
    `</section>` +
    `</article>`
  );
}

function buildPublishedPublishOptions(
  viewModel: ConsolePageViewModel,
): { value: string; label: string }[] {
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

export function renderSimulationContextCard(viewModel: ConsolePageViewModel): string {
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
    "tab",
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
    ? `<form class="filters toolbar" method="POST" action="/actions/simulation/generate" data-control-incremental="true">` +
      generationHiddenFields +
      `<input type="hidden" name="publish_id" value="${escapeHtml(query.publish_id)}" />` +
      `<button type="submit" class="btn btn-secondary">生成模拟报告</button>` +
      `<span class="muted">默认优先对比同模型上一条已发布版本；没有历史版本时按空基线生成。</span>` +
      `</form>`
    : `<p class="muted">选定 publish_id 后，才可以生成或刷新模拟报告。</p>`;
  return (
    `<article class="card card-hover story-entry-card">` +
    `<h3>从已发布列表选择发布单</h3>` +
    `<p class="muted">先锁定一条 publish，再看摘要、排行和矩阵；不要把 decision 查询混在这里。</p>` +
    `<form class="filters toolbar" method="GET" action="/" data-control-incremental="true">` +
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
    renderNamespaceSelectOrInput({
      viewModel,
      selectedValue: query.namespace ?? "tenant_a.crm",
      placeholder: "tenant_a.crm",
    }) +
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
