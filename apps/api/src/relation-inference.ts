import type {
  AclPersistence,
  ControlRelationListQuery,
  PersistedControlRelationRecord,
} from '@acl/persistence';
import type { ContextInferenceRule } from '@acl/shared-types';

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_RELATIONS_SCAN = 500;
const UNKNOWN_OWNER = 'unknown';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function hasIntersection(left: string[], right: string[]): boolean {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

async function listRelationsWithCap(input: {
  persistence: AclPersistence;
  query: ControlRelationListQuery;
  maxScan: number;
}): Promise<PersistedControlRelationRecord[]> {
  const list: PersistedControlRelationRecord[] = [];
  let offset = 0;

  while (list.length < input.maxScan) {
    const limit = Math.min(DEFAULT_PAGE_LIMIT, input.maxScan - list.length);
    const result = await input.persistence.listControlRelations({
      ...input.query,
      limit,
      offset,
    });

    list.push(...result.items);

    if (!result.has_more || result.next_offset === undefined) {
      break;
    }
    offset = result.next_offset;
  }

  return list;
}

async function resolveValuesByEdges(input: {
  persistence: AclPersistence;
  namespace: string;
  entityId: string;
  ruleEdges: ContextInferenceRule['subject_edges'];
  maxScan: number;
}): Promise<string[]> {
  const values = new Set<string>();

  for (const edge of input.ruleEdges) {
    const list = await listRelationsWithCap({
      persistence: input.persistence,
      query: {
        namespace: input.namespace,
        relation_type: edge.relation_type,
        from: edge.entity_side === 'from' ? input.entityId : undefined,
        to: edge.entity_side === 'to' ? input.entityId : undefined,
      },
      maxScan: input.maxScan,
    });

    list.forEach((item) => {
      const opposite = edge.entity_side === 'from' ? item.to : item.from;
      if (isNonEmptyString(opposite)) {
        values.add(opposite);
      }
    });
  }

  return Array.from(values);
}

export interface RelationInferenceRuleResult {
  id: string;
  output_field: string;
  matched: boolean;
  subject_values: string[];
  object_values: string[];
  object_owner_ref?: string;
}

export interface RelationInferenceResult {
  contextPatch: Record<string, unknown>;
  metadata: {
    applied: boolean;
    namespace: string;
    rules: RelationInferenceRuleResult[];
  };
}

export async function inferContextFromControlPlane(input: {
  persistence: AclPersistence;
  namespace: string;
  subjectId: string;
  objectId: string;
  rules: ContextInferenceRule[];
  maxRelationsScan?: number;
}): Promise<RelationInferenceResult> {
  const maxScan = Number.isInteger(input.maxRelationsScan) && input.maxRelationsScan
    ? Math.min(Math.max(input.maxRelationsScan, 50), 2000)
    : DEFAULT_MAX_RELATIONS_SCAN;

  const contextPatch: Record<string, unknown> = {};
  const ruleResults: RelationInferenceRuleResult[] = [];

  for (const rule of input.rules) {
    const subjectValues = uniqueStrings(await resolveValuesByEdges({
      persistence: input.persistence,
      namespace: input.namespace,
      entityId: input.subjectId,
      ruleEdges: rule.subject_edges,
      maxScan,
    }));

    const objectValueSet = new Set<string>(await resolveValuesByEdges({
      persistence: input.persistence,
      namespace: input.namespace,
      entityId: input.objectId,
      ruleEdges: rule.object_edges,
      maxScan,
    }));

    let ownerRef: string | undefined;
    if (rule.object_owner_fallback === true) {
      const objectRecord = await input.persistence.getControlObject(input.namespace, input.objectId);
      const candidateOwner = objectRecord?.owner_ref;
      if (isNonEmptyString(candidateOwner) && candidateOwner !== UNKNOWN_OWNER) {
        ownerRef = candidateOwner;
        const ownerValues = await resolveValuesByEdges({
          persistence: input.persistence,
          namespace: input.namespace,
          entityId: candidateOwner,
          ruleEdges: rule.subject_edges,
          maxScan,
        });
        ownerValues.forEach((item) => objectValueSet.add(item));
      }
    }

    const objectValues = uniqueStrings(Array.from(objectValueSet));
    const matched = hasIntersection(subjectValues, objectValues);
    contextPatch[rule.output_field] = matched;

    ruleResults.push({
      id: rule.id,
      output_field: rule.output_field,
      matched,
      subject_values: subjectValues,
      object_values: objectValues,
      object_owner_ref: ownerRef,
    });
  }

  return {
    contextPatch,
    metadata: {
      applied: true,
      namespace: input.namespace,
      rules: ruleResults,
    },
  };
}
