import type { RelationEdge } from '@acl/shared-types';

import type {
  ExecuteSubjectRemovedInput,
  LifecycleHandlerName,
  LifecycleObjectSnapshot,
  SubjectRemovedExecutionResult,
} from './types';

const REQUIRED_HANDLERS: LifecycleHandlerName[] = [
  'revoke_direct_edges',
  'terminate_delegations',
  'recompute_inherited_permissions',
];

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort();
}

function isDelegationEdge(edge: RelationEdge): boolean {
  return /delegat/i.test(edge.relation_type);
}

function collectConfiguredHandlers(input: ExecuteSubjectRemovedInput): LifecycleHandlerName[] {
  const handlers = input.model.lifecycle.event_rules
    .filter((rule) => rule.event_type === 'subject_removed')
    .map((rule) => rule.handler)
    .filter(
      (handler): handler is LifecycleHandlerName =>
        handler === 'revoke_direct_edges' ||
        handler === 'terminate_delegations' ||
        handler === 'recompute_inherited_permissions',
    );

  return uniqueSorted(handlers) as LifecycleHandlerName[];
}

function getDirectEdges(subjectId: string, edges: RelationEdge[]): RelationEdge[] {
  return edges.filter((edge) => edge.from === subjectId || edge.to === subjectId);
}

function getRemainingEdges(subjectId: string, edges: RelationEdge[]): RelationEdge[] {
  return edges.filter((edge) => edge.from !== subjectId && edge.to !== subjectId);
}

function inferRecomputeTargets(revoked: RelationEdge[], subjectId: string): {
  subjects: string[];
  objects: string[];
} {
  const subjectIds = new Set<string>();
  const objectIds = new Set<string>();

  revoked.forEach((edge) => {
    if (edge.from !== subjectId) {
      subjectIds.add(edge.from);
      objectIds.add(edge.from);
    }
    if (edge.to !== subjectId) {
      subjectIds.add(edge.to);
      objectIds.add(edge.to);
    }
  });

  return {
    subjects: uniqueSorted(subjectIds),
    objects: uniqueSorted(objectIds),
  };
}

function normalizeSnapshots(input: LifecycleObjectSnapshot[] | undefined): LifecycleObjectSnapshot[] {
  if (!input || input.length === 0) {
    return [];
  }

  return input.filter((item) => item.object_id.trim().length > 0 && item.owner_ref.trim().length > 0);
}

export function executeSubjectRemovedLifecycle(
  input: ExecuteSubjectRemovedInput,
): SubjectRemovedExecutionResult {
  if (input.event.event_type !== 'subject_removed') {
    throw new Error(`unsupported event_type: ${input.event.event_type}`);
  }

  const subjectId = input.event.target;
  if (!subjectId || subjectId.trim().length === 0) {
    throw new Error('event.target is required');
  }

  const subjectRelations = input.model.relations.subject_relations;
  const objectRelations = input.model.relations.object_relations;
  const subjectObjectRelations = input.model.relations.subject_object_relations;

  const revokedSubject = getDirectEdges(subjectId, subjectRelations);
  const revokedObject = getDirectEdges(subjectId, objectRelations);
  const revokedSubjectObject = getDirectEdges(subjectId, subjectObjectRelations);

  const revokedEdges = [...revokedSubject, ...revokedObject, ...revokedSubjectObject];

  const terminatedDelegations = revokedSubjectObject.filter(isDelegationEdge);

  const recomputeTargets = inferRecomputeTargets(revokedEdges, subjectId);

  const snapshots = normalizeSnapshots(input.object_snapshots);
  const takeoverQueue = [] as SubjectRemovedExecutionResult['takeover_queue'];
  const ownershipReassigned = [] as SubjectRemovedExecutionResult['ownership_reassigned'];

  snapshots
    .filter((item) => item.owner_ref === subjectId)
    .forEach((item) => {
      const fallbackOwner = input.options?.fallback_owner?.trim();
      if (fallbackOwner && fallbackOwner !== subjectId) {
        ownershipReassigned.push({
          object_id: item.object_id,
          from_owner: subjectId,
          to_owner: fallbackOwner,
        });
        return;
      }

      takeoverQueue.push({
        object_id: item.object_id,
        sensitivity: item.sensitivity,
        reason: 'subject_removed_owner_missing',
      });
    });

  const configuredHandlers = collectConfiguredHandlers(input);
  const missingHandlers = REQUIRED_HANDLERS.filter((handler) => !configuredHandlers.includes(handler));

  const affectedSubjectIds = uniqueSorted(recomputeTargets.subjects);
  const affectedObjectIds = uniqueSorted(
    new Set([
      ...recomputeTargets.objects,
      ...ownershipReassigned.map((item) => item.object_id),
      ...takeoverQueue.map((item) => item.object_id),
    ]),
  );

  return {
    event: {
      event_type: 'subject_removed',
      target: subjectId,
      occurred_at: input.event.occurred_at,
      operator: input.event.operator,
    },
    handler_status: {
      configured: configuredHandlers,
      missing: missingHandlers,
      default_applied: missingHandlers.length > 0,
    },
    revoked_edges: revokedEdges,
    terminated_delegations: terminatedDelegations,
    recompute_summary: {
      mode: 'full_recompute_required',
      impacted_subject_ids: affectedSubjectIds,
      impacted_object_ids: affectedObjectIds,
    },
    ownership_reassigned: ownershipReassigned,
    takeover_queue: takeoverQueue,
    relation_snapshot: {
      before: {
        subject_relations: subjectRelations.length,
        object_relations: objectRelations.length,
        subject_object_relations: subjectObjectRelations.length,
      },
      after: {
        subject_relations: getRemainingEdges(subjectId, subjectRelations).length,
        object_relations: getRemainingEdges(subjectId, objectRelations).length,
        subject_object_relations: getRemainingEdges(subjectId, subjectObjectRelations).length,
      },
    },
    audit: {
      freeze_history: true,
      impact_report: {
        affected_subject_count: affectedSubjectIds.length,
        affected_object_count: affectedObjectIds.length,
        revoked_relation_count: revokedEdges.length,
        terminated_delegation_count: terminatedDelegations.length,
        reassigned_object_count: ownershipReassigned.length,
        takeover_queue_count: takeoverQueue.length,
      },
    },
  };
}
