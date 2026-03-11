import fs from "node:fs";
import path from "node:path";
import {
  listExpectationFixtureOptions,
  listSetupFixtureOptions,
  loadSetupFixtureById,
  type ControlSetupFixture,
} from "../../setup-fixtures";
import type {
  ApiResult,
  ConsolePageViewModel,
  ExpectationRunCaseResult,
  ExpectationRunReport,
  PublishRequestRecord,
} from "../../types";
import {
  asRecord,
  buildQueryHref,
  escapeHtml,
  collectRuntimeRouteOverview,
  formatTime,
  getModelMetaFromSnapshot,
  getModelSnapshotFromPublish,
  normalizeStringArray,
  pickPublishRecordForOverview,
  renderHiddenContextFields,
  renderModelEditorToggleSwitch,
  renderNamespaceInputWithDatalist,
  renderNamespaceStaticField,
  renderScopedHiddenContextFields,
  PublishedModelOverviewMetrics,
  RuntimeRouteOverview,
} from "../shared";
import {
  buildCurrentInstanceSnapshot,
  buildFixtureInstanceSnapshot,
  buildInstanceGraphPayload,
  buildInstanceSnapshotJson,
  InstanceSnapshotPayload,
} from "../graph";

interface ModelTemplate {
  model_meta: {
    model_id: string;
    tenant_id: string;
    version: string;
    status?: string;
    combining_algorithm?: string;
  };
  catalogs: {
    action_catalog: string[];
    subject_type_catalog: string[];
    object_type_catalog: string[];
    subject_relation_type_catalog?: string[];
    object_relation_type_catalog?: string[];
    subject_object_relation_type_catalog?: string[];
  };
  policies: {
    rules: Array<Record<string, unknown>>;
  };
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
    `../../../../api/test/fixtures/${fixtureFileName}`,
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
  const fixtureDir = path.resolve(__dirname, "../../../../api/test/fixtures");
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

function readFixtureFileContent(
  fixtureId: string,
  suffix: ".expected.json" | ".setup.json" | ".model.json",
): string {
  if (fixtureId.trim().length === 0 || !/^[a-zA-Z0-9._-]+$/u.test(fixtureId)) {
    return "";
  }

  try {
    return fs.readFileSync(
      path.resolve(
        __dirname,
        `../../../../api/test/fixtures/${fixtureId}${suffix}`,
      ),
      "utf-8",
    );
  } catch {
    return "";
  }
}

function renderExpectationRunStatus(
  status: ExpectationRunCaseResult["status"],
): string {
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
    "fixture_id",
  ]);

  return (
    `<section class="card card-hover expectation-run-card" data-expectation-run-card>` +
    `<h4>Expectation 决策演练 / 回放</h4>` +
    `<p class="muted">先从目录下拉选择 expectation 文件；执行时会按同名 fixture 读取决策输入，并调用真实的 <code>decisions:evaluate</code>。</p>` +
    `<form class="action-form setup-fixture-preview-form expectation-run-preview-form" method="GET" action="/" data-control-incremental="true" data-expectation-preview-form="true">` +
    hiddenWithoutExpectationFixture +
    `<div class="setup-fixture-preview-grid">` +
    renderNamespaceStaticField(input.namespace, "由上方控制面工作区切换") +
    `<label>Expectation<select name="fixture_id" id="expectation-fixture-id" ${input.fixture_select_attr}>${input.fixture_select_options}</select></label>` +
    `</div>` +
    `<p class="muted">选择即预载 expectation JSON；执行同名 fixture 的批量 Setup 时，系统会自动发布对应 model 并绑定 route。</p>` +
    `</form>` +
    `<form class="action-form expectation-run-form" method="POST" action="/actions/control/expectations/run" data-control-incremental="true">` +
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
    `<section class="management-grid advanced-ops-grid">` +
    `<form class="action-form advanced-ops-form" method="POST" action="/actions/control/object/upsert">` +
    `<h5>单对象 Upsert</h5>` +
    hiddenFields +
    `<input type="hidden" name="namespace" value="${escapeHtml(input.namespace)}" />` +
    `<label>Object ID<input type="text" name="object_id" placeholder="kb:wiki_core" required /></label>` +
    `<label>Object Type<input type="text" name="object_type" placeholder="kb" required /></label>` +
    `<label>Sensitivity<input type="text" name="sensitivity" placeholder="normal" /></label>` +
    `<label>Owner Ref<input type="text" name="owner_ref" placeholder="user:alice" /></label>` +
    `<label class="field-wide">Labels<textarea name="labels" rows="4" placeholder="finance\npii"></textarea></label>` +
    `<button type="submit" class="btn btn-secondary">写入对象</button>` +
    `</form>` +
    `<form class="action-form advanced-ops-form" method="POST" action="/actions/control/relation/event">` +
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
    `<form class="action-form advanced-ops-form" method="POST" action="/actions/control/model-route/upsert">` +
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

function renderControlContextCard(
  viewModel: ConsolePageViewModel,
  input: {
    namespace: string;
    fixture_id: string;
  },
): string {
  const hiddenFields = renderScopedHiddenContextFields(viewModel, [
    "tab",
    "widget",
    "detail_mode",
  ]);

  return (
    `<section class="card card-hover story-entry-card control-context-card">` +
    `<h4>控制面工作区</h4>` +
    `<p class="muted">统一切换命名空间，影响下方运行态 instance / expectation / 高级运维。</p>` +
    `<form class="filters toolbar" method="GET" action="/" data-control-incremental="true" data-control-namespace-form="true">` +
    `<label class="field-compact">命名空间 Namespace` +
    renderNamespaceInputWithDatalist({
      viewModel,
      selectedValue: input.namespace,
      placeholder: "tenant_a.crm",
      datalistId: "namespace-options-control-switch",
    }) +
    `</label>` +
    hiddenFields +
    `<input type="hidden" name="fixture_id" value="${escapeHtml(input.fixture_id)}" />` +
    `<button type="submit" class="btn btn-primary">切换命名空间</button>` +
    `</form>` +
    `</section>`
  );
}

export function renderControlJourneyCard(namespace: string): string {
  return (
    `<section class="story-card story-card-accent story-card-control">` +
    `<h4>控制面怎么用</h4>` +
    `<ol class="story-list">` +
    `<li>先在“控制面工作区”切换 namespace，确认当前运行态路由、对象和关系范围。</li>` +
    `<li>上半区只处理模型草稿与发布请求提交。</li>` +
    `<li>下半区只处理运行态 instance、route、object、relation 维护。</li>` +
    `<li>需要验证效果时，回到“发布流程”或“影响模拟”继续治理闭环。</li>` +
    `</ol>` +
    `<p class="muted">当前控制面命名空间：${escapeHtml(namespace)}</p>` +
    `</section>`
  );
}

export function renderControlPlaneOverview(viewModel: ConsolePageViewModel): string {
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
    activeSetupFixture?.fixture.route?.tenant_id ??
    currentRoute?.tenant_id ??
    "";
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

  const hasObjectItems = Boolean(stagedInstanceSnapshot.objects.length > 0);
  const hasRelationItems = Boolean(
    stagedInstanceSnapshot.relation_events.length > 0,
  );
  const hasModelRouteItems = Boolean(
    viewModel.model_routes?.ok && viewModel.model_routes.data.items.length > 0,
  );
  const hasAuditItems = Boolean(
    viewModel.control_audits?.ok && viewModel.control_audits.data.items.length > 0,
  );
  const modelRouteTableSection =
    viewModel.model_routes?.ok && !hasModelRouteItems
      ? ""
      : `<section class="runtime-table-card"><h4>模型路由 Model Routes</h4><div class="table-container management-table"><table class="data-table"><thead><tr><th>Tenant</th><th>Env</th><th>Model ID</th><th>Version</th><th>Publish ID</th><th>Namespace</th><th>Operator</th><th>Updated</th></tr></thead><tbody>${modelRouteRows}</tbody></table></div></section>`;
  const auditTableSection =
    viewModel.control_audits?.ok && !hasAuditItems
      ? ""
      : `<section class="runtime-table-card"><h4>审计事件 Audits</h4><div class="table-container"><table class="data-table"><thead><tr><th>Event</th><th>Target</th><th>Operator</th><th>Created At</th></tr></thead><tbody>${auditRows}</tbody></table></div></section>`;
  const objectTableSection = !hasObjectItems
    ? ""
    : `<section class="runtime-table-card"><h4>客体台账 Objects</h4><div class="table-container management-table"><table class="data-table"><thead><tr><th>Object ID</th><th>Type</th><th>Sensitivity</th><th>Owner</th><th>Labels</th><th>Updated</th></tr></thead><tbody>${objectRows}</tbody></table></div></section>`;
  const relationTableSection = !hasRelationItems
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
  const controlContextCard = renderControlContextCard(viewModel, {
    namespace,
    fixture_id: activeSetupFixtureId,
  });
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
    `<section class="stack expectation-run-stack" data-expectation-run-section>` +
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
    `<article class="card card-hover" data-relation-replay-card>` +
    `<h3>控制面总览</h3>` +
    controlContextCard +
    publishedMetricsSection +
    publishContextSection +
    runtimeRouteSection +
    defaultTemplateSection +
    `${renderControlJourneyCard(namespace)}` +
    `<p class="muted metric-caption">上半区聚焦模型发布与发布快照；运行态工作区切换在上方，instance 维护放在下方单独卡片。</p>` +
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
    `<div class="section-head section-head-lane"><h4>2. 维护运行态对象与关系</h4><span class="muted">使用上方工作区切换 namespace，预览 fixture、执行 setup，并维护 route/object/relation</span></div>` +
    `<section class="card card-hover instance-editor-card">` +
    `<h4>Instance 导入 / 维护 / 展示</h4>` +
    `<p class="muted">预置场景批量导入：可基于内置 fixture 或手工 JSON 一次性写入当前 namespace 的运行态数据；fixture 模式会自动发布同名 model 并绑定 route。</p>` +
    `<p class="muted">此卡片只维护运行态 instance 数据（model_route / object / relation），不会修改上方“策略模型提交”的 JSON。</p>` +
    runtimeSummarySection +
    `<section data-control-fixed-runtime>${fixedRuntimeSectionWithFallback}</section>` +
    `<form class="action-form setup-fixture-preview-form" method="GET" action="/" data-control-incremental="true" data-control-setup-form="true" data-control-setup-preview-form="true">` +
    `<h4>预置场景选择</h4>` +
    hiddenWithoutNamespace +
    `<input type="hidden" name="namespace" value="${escapeHtml(namespace)}" />` +
    `<div class="setup-fixture-preview-grid">` +
    renderNamespaceStaticField(namespace, "由上方控制面工作区切换") +
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
