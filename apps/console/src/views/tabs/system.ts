import type { ConsolePageViewModel } from "../../types";
import {
  asRecord,
  escapeHtml,
  formatTime,
  getModelSnapshotFromPublish,
  normalizeStringArray,
  pickPublishRecordForOverview,
  renderModelEditorToggleSwitch,
  renderNamespaceStaticField,
} from "../shared";
import {
  buildCurrentInstanceSnapshot,
  buildInstanceGraphPayload,
  buildInstanceSnapshotJson,
  type InstanceSnapshotPayload,
} from "../graph";

interface NormalizedModelSnapshot {
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

function buildFallbackModelSnapshot(): NormalizedModelSnapshot {
  return {
    model_meta: {
      model_id: "-",
      tenant_id: "-",
      version: "-",
      status: "unknown",
      combining_algorithm: "deny-overrides",
    },
    catalogs: {
      action_catalog: [],
      subject_type_catalog: [],
      object_type_catalog: [],
      subject_relation_type_catalog: [],
      object_relation_type_catalog: [],
      subject_object_relation_type_catalog: [],
    },
    policies: {
      rules: [],
    },
    quality_guardrails: {
      attribute_quality: {},
      mandatory_obligations: [],
    },
  };
}

function normalizeModelSnapshot(
  snapshot: Record<string, unknown> | null,
): NormalizedModelSnapshot {
  if (!snapshot) {
    return buildFallbackModelSnapshot();
  }

  const modelMeta = asRecord(snapshot.model_meta) ?? {};
  const catalogs = asRecord(snapshot.catalogs) ?? {};
  const policies = asRecord(snapshot.policies) ?? {};
  const guardrails = asRecord(snapshot.quality_guardrails) ?? {};
  const rules = Array.isArray(policies.rules)
    ? policies.rules.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];

  return {
    model_meta: {
      model_id:
        typeof modelMeta.model_id === "string" && modelMeta.model_id.length > 0
          ? modelMeta.model_id
          : "-",
      tenant_id:
        typeof modelMeta.tenant_id === "string" && modelMeta.tenant_id.length > 0
          ? modelMeta.tenant_id
          : "-",
      version:
        typeof modelMeta.version === "string" && modelMeta.version.length > 0
          ? modelMeta.version
          : "-",
      status: typeof modelMeta.status === "string" ? modelMeta.status : undefined,
      combining_algorithm:
        typeof modelMeta.combining_algorithm === "string"
          ? modelMeta.combining_algorithm
          : "deny-overrides",
    },
    catalogs: {
      action_catalog: normalizeStringArray(catalogs.action_catalog),
      subject_type_catalog: normalizeStringArray(catalogs.subject_type_catalog),
      object_type_catalog: normalizeStringArray(catalogs.object_type_catalog),
      subject_relation_type_catalog: normalizeStringArray(
        catalogs.subject_relation_type_catalog,
      ),
      object_relation_type_catalog: normalizeStringArray(
        catalogs.object_relation_type_catalog,
      ),
      subject_object_relation_type_catalog: normalizeStringArray(
        catalogs.subject_object_relation_type_catalog,
      ),
    },
    policies: {
      rules,
    },
    quality_guardrails: {
      attribute_quality: asRecord(guardrails.attribute_quality) ?? {},
      mandatory_obligations: normalizeStringArray(
        guardrails.mandatory_obligations,
      ),
    },
    relation_signature: asRecord(snapshot.relation_signature) ?? undefined,
    action_signature: asRecord(snapshot.action_signature) ?? undefined,
    context_inference: asRecord(snapshot.context_inference) ?? undefined,
    decision_search: asRecord(snapshot.decision_search) ?? undefined,
  };
}

function collectRuntimeOverviewMetrics(
  snapshot: InstanceSnapshotPayload,
): { subjects: number; objects: number; relations: number } {
  const objects = snapshot.objects.length;
  const relations = snapshot.relation_events.length;
  const objectIdSet = new Set<string>();
  const subjectIdSet = new Set<string>();

  snapshot.objects.forEach((item) => {
    const objectId = item.object_id.trim();
    if (objectId.length > 0) {
      objectIdSet.add(objectId);
    }

    const ownerRef = (item.owner_ref ?? "").trim();
    if (ownerRef.length > 0) {
      subjectIdSet.add(ownerRef);
    }
  });

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

  snapshot.relation_events.forEach((item) => {
    addSubjectCandidate(item.from);
    addSubjectCandidate(item.to);
  });

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
    .slice(0, 20)
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.object_id)}</td><td>${escapeHtml(item.object_type)}</td><td>${escapeHtml(item.sensitivity ?? "")}</td><td>${escapeHtml(item.owner_ref ?? "")}</td><td>${escapeHtml((item.labels ?? []).join(", "))}</td><td>${escapeHtml(item.updated_at ? formatTime(item.updated_at) : "-")}</td></tr>`,
    )
    .join("");
}

function renderInstanceRelationRows(
  relationEvents: InstanceSnapshotPayload["relation_events"],
): string {
  return relationEvents
    .slice(0, 20)
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.from)}</td><td>${escapeHtml(item.relation_type)}</td><td>${escapeHtml(item.to)}</td><td>${escapeHtml(item.scope ?? "")}</td><td>${escapeHtml(item.updated_at ? formatTime(item.updated_at) : "-")}</td></tr>`,
    )
    .join("");
}

export function renderSystemStatusOverview(viewModel: ConsolePageViewModel): string {
  const namespace = viewModel.query.namespace ?? "tenant_a.crm";
  const sourceRecord = pickPublishRecordForOverview(viewModel);
  const sourceSnapshot = sourceRecord
    ? getModelSnapshotFromPublish(sourceRecord)
    : null;
  const normalizedModel = normalizeModelSnapshot(sourceSnapshot);
  const modelSource = sourceSnapshot ?? buildFallbackModelSnapshot();
  const modelJson = escapeHtml(JSON.stringify(modelSource, null, 2));
  const modelSourceHint = sourceRecord
    ? `来源 publish_id=${escapeHtml(sourceRecord.publish_id)} / status=${escapeHtml(sourceRecord.status)} / updated=${escapeHtml(formatTime(sourceRecord.updated_at))}`
    : "当前未找到可解析的发布快照，展示占位模型结构。";

  const defaultRule = normalizedModel.policies.rules[0] ?? {};
  const policyRulesRows = normalizedModel.policies.rules
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

  const actionCatalog = escapeHtml(
    normalizedModel.catalogs.action_catalog.join("\n"),
  );
  const subjectTypeCatalog = escapeHtml(
    normalizedModel.catalogs.subject_type_catalog.join("\n"),
  );
  const objectTypeCatalog = escapeHtml(
    normalizedModel.catalogs.object_type_catalog.join("\n"),
  );
  const subjectRelationTypeCatalog = escapeHtml(
    (normalizedModel.catalogs.subject_relation_type_catalog ?? []).join("\n"),
  );
  const objectRelationTypeCatalog = escapeHtml(
    (normalizedModel.catalogs.object_relation_type_catalog ?? []).join("\n"),
  );
  const subjectObjectRelationTypeCatalog = escapeHtml(
    (normalizedModel.catalogs.subject_object_relation_type_catalog ?? []).join(
      "\n",
    ),
  );
  const mandatoryObligations = escapeHtml(
    normalizedModel.quality_guardrails.mandatory_obligations.join("\n"),
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

  const currentInstanceSnapshot = buildCurrentInstanceSnapshot(
    viewModel,
    namespace,
  );
  const instanceOverview = collectRuntimeOverviewMetrics(
    currentInstanceSnapshot,
  );
  const instanceGraphPayload = buildInstanceGraphPayload(viewModel, {
    objects: currentInstanceSnapshot.objects,
    relations: currentInstanceSnapshot.relation_events,
  });
  const instanceGraphPayloadJson = escapeHtml(
    JSON.stringify(instanceGraphPayload),
  );
  const instanceSnapshotJson = escapeHtml(
    buildInstanceSnapshotJson(currentInstanceSnapshot),
  );

  const hasObjectItems = currentInstanceSnapshot.objects.length > 0;
  const hasRelationItems = currentInstanceSnapshot.relation_events.length > 0;
  const objectRows = renderInstanceObjectRows(currentInstanceSnapshot.objects);
  const relationRows = renderInstanceRelationRows(
    currentInstanceSnapshot.relation_events,
  );
  const objectTableSection = !hasObjectItems
    ? ""
    : `<section class="runtime-table-card" data-instance-table data-instance-table-type="objects" data-instance-table-page-size="20" data-instance-table-total="${currentInstanceSnapshot.objects.length}"><h4>客体台账 Objects</h4><div class="table-container management-table"><table class="data-table"><thead><tr><th>Object ID</th><th>Type</th><th>Sensitivity</th><th>Owner</th><th>Labels</th><th>Updated</th></tr></thead><tbody>${objectRows}</tbody></table></div><div class="pagination-wrapper" data-instance-pagination></div></section>`;
  const relationTableSection = !hasRelationItems
    ? ""
    : `<section class="runtime-table-card" data-instance-table data-instance-table-type="relations" data-instance-table-page-size="20" data-instance-table-total="${currentInstanceSnapshot.relation_events.length}"><h4>关系边 Relations</h4><div class="table-container management-table"><table class="data-table"><thead><tr><th>From</th><th>Relation</th><th>To</th><th>Scope</th><th>Updated</th></tr></thead><tbody>${relationRows}</tbody></table></div><div class="pagination-wrapper" data-instance-pagination></div></section>`;
  const objectRelationSectionWithFallback =
    objectTableSection + relationTableSection;
  const objectRelationSection =
    objectRelationSectionWithFallback.length > 0
      ? objectRelationSectionWithFallback
      : `<section class="runtime-empty-hint">` +
        `<p class="muted">当前命名空间暂无客体台账与关系边数据。</p>` +
        `</section>`;

  const auditRows = viewModel.control_audits?.ok
    ? viewModel.control_audits.data.items
        .slice(0, 6)
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.event_type)}</td><td>${escapeHtml(item.target)}</td><td>${escapeHtml(item.operator)}</td><td>${escapeHtml(formatTime(item.created_at))}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="muted">审计数据加载失败</td></tr>';

  const modelRouteRows = viewModel.model_routes?.ok
    ? viewModel.model_routes.data.items
        .slice(0, 6)
        .map(
          (item) =>
            `<tr><td>${escapeHtml(item.tenant_id)}</td><td>${escapeHtml(item.environment)}</td><td>${escapeHtml(item.model_id)}</td><td>${escapeHtml(item.model_version ?? "-")}</td><td>${escapeHtml(item.publish_id ?? "-")}</td><td>${escapeHtml(item.namespace)}</td><td>${escapeHtml(item.operator)}</td><td>${escapeHtml(formatTime(item.updated_at))}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="8" class="muted">model route 加载失败</td></tr>';

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
  const fixedRuntimeSection = modelRouteTableSection + auditTableSection;
  const fixedRuntimeSectionWithFallback =
    fixedRuntimeSection.length > 0
      ? fixedRuntimeSection
      : `<section class="runtime-empty-hint">` +
        `<p class="muted">当前命名空间暂无模型路由与审计事件数据。</p>` +
        `</section>`;

  return (
    `<article class="card card-hover">` +
    `<h3>系统状态</h3>` +
    `<p class="muted">展示当前生效策略模型与运行态 instance 快照（只读视图）。</p>` +
    `<section class="control-lane">` +
    `<div class="section-head section-head-lane"><h4>1. 当前策略模型</h4><span class="muted">与发布快照保持一致的模型定义</span></div>` +
    `<section class="management-grid model-submit-grid">` +
    `<form class="action-form model-submit-form" data-model-jsoneditor-form="true">` +
    `<h4>策略模型快照</h4>` +
    `<p class="muted">${modelSourceHint}</p>` +
    `<section class="model-editor" data-model-editor data-model-editor-readonly="true" data-json-scope>` +
    `<div class="model-editor-head">` +
    `<p class="muted">模型视图</p>` +
    `<div class="model-editor-head-actions">${renderModelEditorToggleSwitch()}</div>` +
    `</div>` +
    `<section class="json-switchable" data-json-switchable>` +
    `<div class="json-view" data-json-view="visual">` +
    `<div class="model-editor-grid">` +
    `<label>模型ID Model ID<input type="text" value="${escapeHtml(normalizedModel.model_meta.model_id)}" data-model-field="model_id" readonly /></label>` +
    `<label>租户ID Tenant ID<input type="text" value="${escapeHtml(normalizedModel.model_meta.tenant_id)}" data-model-field="tenant_id" readonly /></label>` +
    `<label>版本 Version<input type="text" value="${escapeHtml(normalizedModel.model_meta.version)}" data-model-field="version" readonly /></label>` +
    `<label>合并算法 Combining Algorithm<select data-model-field="combining_algorithm" disabled><option value="deny-overrides" ${normalizedModel.model_meta.combining_algorithm === "deny-overrides" ? "selected" : ""}>deny-overrides</option><option value="permit-overrides" ${normalizedModel.model_meta.combining_algorithm === "permit-overrides" ? "selected" : ""}>permit-overrides</option><option value="first-applicable" ${normalizedModel.model_meta.combining_algorithm === "first-applicable" ? "selected" : ""}>first-applicable</option></select></label>` +
    `<label>动作目录 Action Catalog<textarea rows="3" data-model-field="action_catalog" readonly>${actionCatalog}</textarea></label>` +
    `<label>主体类型目录 Subject Type Catalog<textarea rows="3" data-model-field="subject_type_catalog" readonly>${subjectTypeCatalog}</textarea></label>` +
    `<label>客体类型目录 Object Type Catalog<textarea rows="3" data-model-field="object_type_catalog" readonly>${objectTypeCatalog}</textarea></label>` +
    `<label>主体关系目录 Subject Relation Catalog<textarea rows="3" data-model-field="subject_relation_type_catalog" readonly>${subjectRelationTypeCatalog}</textarea></label>` +
    `<label>客体关系目录 Object Relation Catalog<textarea rows="3" data-model-field="object_relation_type_catalog" readonly>${objectRelationTypeCatalog}</textarea></label>` +
    `<label>主体-客体关系目录 Subject-Object Relation Catalog<textarea rows="3" data-model-field="subject_object_relation_type_catalog" readonly>${subjectObjectRelationTypeCatalog}</textarea></label>` +
    `<label>强制义务 Mandatory Obligations<textarea rows="3" data-model-field="mandatory_obligations" readonly>${mandatoryObligations}</textarea></label>` +
    `</div>` +
    `<div class="policy-rules-section">` +
    `<h5>Policy Rules 列表 <span class="muted">(${normalizedModel.policies.rules.length} 条)</span></h5>` +
    `<div class="table-container"><table class="data-table policy-rules-table"><thead><tr><th>Rule ID</th><th>效果</th><th>优先级</th><th>动作</th><th>主体选择器</th><th>客体选择器</th></tr></thead><tbody>${policyRulesRows}</tbody></table></div>` +
    `</div>` +
    `<details class="policy-rule-editor">` +
    `<summary><strong>规则预览</strong>（仅展示首条）</summary>` +
    `<div class="model-editor-grid rule-editor-grid">` +
    `<label>规则ID Rule ID<input type="text" value="${ruleId}" data-model-field="rule_id" readonly /></label>` +
    `<label>规则效果 Rule Effect<select data-model-field="rule_effect" disabled><option value="allow" ${ruleEffect === "allow" ? "selected" : ""}>allow</option><option value="deny" ${ruleEffect === "deny" ? "selected" : ""}>deny</option></select></label>` +
    `<label>规则优先级 Rule Priority<input type="number" min="1" value="${escapeHtml(rulePriority)}" data-model-field="rule_priority" readonly /></label>` +
    `<label>规则动作 Rule Actions<textarea rows="3" data-model-field="rule_action_set" readonly>${ruleActionSet}</textarea></label>` +
    `<label>主体选择器 Subject Selector<textarea rows="3" data-model-field="rule_subject_selector" readonly>${ruleSubjectSelector}</textarea></label>` +
    `<label>客体选择器 Object Selector<textarea rows="3" data-model-field="rule_object_selector" readonly>${ruleObjectSelector}</textarea></label>` +
    `</div>` +
    `</details>` +
    `<p class="muted model-editor-note">只读展示：如需编辑，请在“控制面维护”进行。</p>` +
    `</div>` +
    `<div class="json-view" data-json-view="raw" hidden>` +
    `<label>模型JSON Model JSON<textarea rows="12" data-model-json readonly>${modelJson}</textarea></label>` +
    `</div>` +
    `<div class="json-view" data-json-view="graph" hidden>` +
    `<section class="model-graph" data-model-graph>` +
    `<p class="muted model-graph-placeholder">Graph 视图会根据 catalogs、relation_signature 与 context_inference 展示模型定义层关系结构与推理过程。</p>` +
    `</section>` +
    `</div>` +
    `</section>` +
    `</section>` +
    `</form>` +
    `</section>` +
    `</section>` +
    `<section class="control-lane">` +
    `<div class="section-head section-head-lane"><h4>2. 当前运行态 Instance</h4><span class="muted">对象与关系快照 + Graph + JSON</span></div>` +
    `<section class="card card-hover instance-editor-card">` +
    `<h4>Instance 运行态快照</h4>` +
    `<p class="muted">命名空间：${escapeHtml(namespace)}（只读视图）</p>` +
    `<section data-control-runtime-summary>` +
    `<p class="muted metric-caption">运行态控制面统计（subject 来自 relation 端点与 object.owner_ref 推断）</p>` +
    `<section class="decision-grid">` +
    `<div class="metric"><span>subjects</span><strong>${instanceOverview.subjects}</strong></div>` +
    `<div class="metric"><span>objects</span><strong>${instanceOverview.objects}</strong></div>` +
    `<div class="metric"><span>relations</span><strong>${instanceOverview.relations}</strong></div>` +
    `<div class="metric"><span>model routes</span><strong>${viewModel.model_routes?.ok ? viewModel.model_routes.data.total_count : 0}</strong></div>` +
    `</section>` +
    `</section>` +
    `<section data-control-fixed-runtime>${fixedRuntimeSectionWithFallback}</section>` +
    `<section class="model-editor" data-instance-editor>` +
    `<section class="instance-object-relation-block" data-json-scope>` +
    `<div class="model-editor-head">` +
    `<p class="muted">客体台账 / 关系边视图</p>` +
    `<div class="model-editor-head-actions">${renderModelEditorToggleSwitch()}</div>` +
    `</div>` +
    renderNamespaceStaticField(namespace) +
    `<section class="json-switchable" data-json-switchable>` +
    `<div class="json-view" data-json-view="visual">` +
    `<section data-control-object-relation-visual>${objectRelationSection}</section>` +
    `</div>` +
    `<div class="json-view" data-json-view="graph" hidden>` +
    `<section class="model-graph" data-instance-graph data-subject-tree-direction="bottom-up">` +
    `<textarea hidden data-instance-graph-payload>${instanceGraphPayloadJson}</textarea>` +
    `<p class="muted model-graph-placeholder">Graph 视图展示当前命名空间 instance 的关系（relation_events + object.owner_ref）。</p>` +
    `<div class="instance-graph-layout-bar"><span class="muted">Subject 树方向</span><div class="json-toggle" role="tablist" aria-label="Subject 树方向"><button type="button" class="json-toggle-btn active" data-instance-subject-direction-btn="bottom-up" aria-pressed="true">自下而上</button><button type="button" class="json-toggle-btn" data-instance-subject-direction-btn="top-down" aria-pressed="false">自上而下</button></div></div>` +
    `<div class="model-graph-chart-wrap"><div class="instance-graph-actions"><button type="button" class="model-graph-node-hide" data-instance-hide-node title="先点击一个节点，再点击隐藏" disabled>隐藏节点</button><button type="button" class="model-graph-zoom-reset" title="重置缩放并恢复全部节点">重置</button></div><div class="model-graph-echart" data-instance-echart role="img" aria-label="Instance 关系图"></div></div>` +
    `<p class="muted model-graph-legend">说明：左侧 subject 节点按模型定义的 type 分层树状布局（同 type 同层，可切换自下而上/自上而下）；边标签为 relation_type（含 scope）；虚线代表 owner_ref 关系。</p>` +
    `</section>` +
    `</div>` +
    `<div class="json-view" data-json-view="raw" hidden>` +
    `<label>Instance JSON<textarea rows="16" data-instance-json-textarea readonly>${instanceSnapshotJson}</textarea></label>` +
    `<p class="muted model-editor-note">只读展示：namespace、objects、relation_events（可选 model_routes）。</p>` +
    `</div>` +
    `</section>` +
    `</section>` +
    `</section>` +
    `</section>` +
    `</section>` +
    `</article>`
  );
}
