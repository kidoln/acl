import type { ConsolePageViewModel, ConsoleTab, ConsoleWidget } from "../types";
import {
  TAB_ITEMS,
  WIDGET_ITEMS,
  buildScopedQueryHref,
  escapeHtml,
  formatTime,
  getScopedFieldNamesForTab,
  renderFlash,
} from "./shared";
import { renderComponentsIndexView } from "./components";
import {
  renderPublishDetail,
  renderPublishListPanel,
  renderWorkflowGuideCard,
} from "./tabs/workflow";
import {
  renderMatrixView,
  renderSimulationContextCard,
  renderSimulationView,
} from "./tabs/simulation";
import {
  renderDecisionDetail,
  renderDecisionQueryCard,
  renderRelationContextCard,
  renderRelationView,
} from "./tabs/relations";
import { renderControlPlaneOverview } from "./tabs/control";

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

function renderHeroMeta(
  viewModel: ConsolePageViewModel,
  activeTab: ConsoleTab,
): string {
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
    return `${renderRelationContextCard(viewModel)}${renderDecisionDetail(viewModel.decision_detail)}${renderRelationView(viewModel)}`;
  }

  return renderControlPlaneOverview(viewModel);
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
  const workflowStack = `${renderPublishDetail(viewModel.publish_detail, viewModel)}${renderWorkflowGuideCard(viewModel)}`;
  const simulationStack = `${renderSimulationContextCard(viewModel)}${renderSimulationView(viewModel)}${renderMatrixView(viewModel)}`;
  const relationsStack = `${renderRelationContextCard(viewModel)}${renderDecisionDetail(viewModel.decision_detail)}${renderRelationView(viewModel)}`;
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
  <main class="shell ${query.widget ? "embed-shell" : "console-shell"}">
    ${body}
  </main>
  ${systemNotice}
  ${echartsScriptTag}
  ${tabScriptTag}
</body>
</html>`;
}
