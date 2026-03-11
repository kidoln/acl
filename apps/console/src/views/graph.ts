import type { ConsolePageViewModel } from "../types";
import type { ControlSetupFixture } from "../setup-fixtures";
import {
  asRecord,
  getModelSnapshotFromPublish,
  normalizeStringArray,
  pickPublishRecordForOverview,
  readPathString,
} from "./shared";

export interface InstanceGraphPayload {
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

export interface RelationReplayFocusPayload {
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

export interface InstanceGraphSource {
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

export interface InstanceSnapshotPayload {
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
  const subjectRelationItems = Array.isArray(
    relationSignature?.subject_relations,
  )
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

export function buildInstanceGraphEdgeLabel(
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

export function buildInstanceGraphEdgeKey(input: {
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

export function buildRelationReplayFocusPayload(
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
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
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
  const pathToObject = findShortestDirectedEdgePath(
    graphEdges,
    subjectId,
    objectId,
  );
  let pathFound = false;
  if (pathToObject.length > 0) {
    pathFound = true;
    pathToObject.forEach((edge) => {
      highlightEdgeKeys.add(buildInstanceGraphEdgeKey(edge));
      highlightNodeIds.add(edge.from);
      highlightNodeIds.add(edge.to);
    });
  } else if (ownerRef.length > 0) {
    const pathToOwner = findShortestDirectedEdgePath(
      graphEdges,
      subjectId,
      ownerRef,
    );
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
        (edge) => buildInstanceGraphEdgeKey(edge) === ownerEdgeKey,
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

export function buildInstanceGraphPayload(
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
      objectType.length > 0 ? `${objectId} (${objectType})` : objectId;
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

export function buildCurrentInstanceSnapshot(
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

export function buildFixtureInstanceSnapshot(
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

export function buildInstanceSnapshotJson(
  snapshot: InstanceSnapshotPayload,
): string {
  return JSON.stringify(snapshot, null, 2);
}
