import type { ConsolePageViewModel, ConsoleTab, ConsoleWidget } from "../types";
import {
  TAB_ITEMS,
  WIDGET_ITEMS,
  buildScopedQueryHref,
  escapeHtml,
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
import { renderSystemStatusOverview } from "./tabs/system";

interface ConsoleTabLink {
  id: ConsoleTab;
  label: string;
  href: string;
}

interface ConsolePanelsPayload {
  workflow: string;
  system: string;
  simulation: string;
  relations: string;
  control: string;
  components: string;
}

interface ConsolePagePayload {
  pageTitle: string;
  isEmbed: boolean;
  activeTab: ConsoleTab;
  tabItems: typeof TAB_ITEMS;
  tabLinks: ConsoleTabLink[];
  query: ConsolePageViewModel["query"];
  apiBaseUrl: string;
  generatedAt: string;
  panels: ConsolePanelsPayload;
  embedWidgetHtml: string;
  systemNoticeHtml: string;
}

function resolveActiveTab(viewModel: ConsolePageViewModel): ConsoleTab {
  return viewModel.query.tab ?? "workflow";
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
  const systemStack = `${renderSystemStatusOverview(viewModel)}`;
  const simulationStack = `${renderSimulationContextCard(viewModel)}${renderSimulationView(viewModel)}${renderMatrixView(viewModel)}`;
  const relationsStack = `${renderRelationContextCard(viewModel)}${renderDecisionDetail(viewModel.decision_detail)}${renderRelationView(viewModel)}`;
  const controlStack = `${renderControlPlaneOverview(viewModel)}`;
  const componentsStack = `${renderComponentsIndexView(viewModel)}`;

  const pageTitle = query.widget
    ? `ACL 嵌入视图 - ${WIDGET_ITEMS.find((item) => item.id === query.widget)?.label ?? "Widget"}`
    : "ACL 控制台";

  const tabLinks = TAB_ITEMS.map((item) => ({
    id: item.id,
    label: item.label,
    href: buildScopedQueryHref(
      viewModel,
      getScopedFieldNamesForTab(item.id),
      {
        tab: item.id,
        widget: undefined,
      },
    ),
  }));

  const panels: ConsolePanelsPayload = {
    workflow:
      `${publishListPanel}` +
      `<section class="stack animate-enter delay-200" data-workflow-detail-stack>${workflowStack}</section>`,
    system: systemStack,
    simulation: simulationStack,
    relations: relationsStack,
    control: controlStack,
    components: componentsStack,
  };

  const payload: ConsolePagePayload = {
    pageTitle,
    isEmbed: Boolean(query.widget),
    activeTab,
    tabItems: TAB_ITEMS,
    tabLinks,
    query,
    apiBaseUrl: viewModel.api_base_url,
    generatedAt: viewModel.generated_at,
    panels,
    embedWidgetHtml: query.widget
      ? renderEmbedWidget(viewModel, query.widget, publishListPanel)
      : "",
    systemNoticeHtml: renderFlash(viewModel),
  };

  const payloadJson = JSON.stringify(payload).replace(/</g, "\\u003c");

  const vueScriptTag =
    '<script src="/assets/vue.global.prod.js" defer></script>';
  const appScriptTag =
    '<script src="/assets/console-app.js" defer></script>';
  const echartsScriptTag =
    '<script src="/assets/echarts.min.js" defer></script>';
  const tabScriptTag =
    '<script src="/assets/dashboard-tabs.js" defer></script>';

  const body = `<div id="app"></div>` +
    `<script type="application/json" id="acl-console-payload">${payloadJson}</script>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="stylesheet" href="/assets/global.css" />
</head>
<body>
  ${body}
  ${vueScriptTag}
  ${appScriptTag}
  ${echartsScriptTag}
  ${tabScriptTag}
</body>
</html>`;
}
