import type {
  AclPersistence,
  ControlRelationListQuery,
  PersistedControlRelationRecord,
} from '@acl/persistence';
import type { ContextInferenceRule } from '@acl/shared-types';

const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_RELATIONS_SCAN = 500;
const UNKNOWN_OWNER = 'unknown';
const DEFAULT_STEP_MAX_DEPTH = 1;
const MIN_STEP_MAX_DEPTH = 1;
const MAX_STEP_MAX_DEPTH = 16;

type InferencePathStep = {
  relation_type: string;
  entity_side: 'from' | 'to';
  max_depth?: number;
};

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

async function resolveValuesByPath(input: {
  persistence: AclPersistence;
  namespace: string;
  entityId: string;
  rulePath: InferencePathStep[];
  maxScan: number;
}): Promise<string[]> {
  if (input.rulePath.length === 0) {
    return [];
  }

  let frontier = new Set<string>([input.entityId]);

  for (const step of input.rulePath) {
    const repeatDepth = Number.isInteger(step.max_depth)
      ? Math.min(Math.max(step.max_depth ?? DEFAULT_STEP_MAX_DEPTH, MIN_STEP_MAX_DEPTH), MAX_STEP_MAX_DEPTH)
      : DEFAULT_STEP_MAX_DEPTH;

    for (let depth = 0; depth < repeatDepth; depth += 1) {
      if (frontier.size === 0) {
        break;
      }

      const next = new Set<string>();
      for (const current of frontier) {
        const list = await listRelationsWithCap({
          persistence: input.persistence,
          query: {
            namespace: input.namespace,
            relation_type: step.relation_type,
            from: step.entity_side === 'from' ? current : undefined,
            to: step.entity_side === 'to' ? current : undefined,
          },
          maxScan: input.maxScan,
        });

        list.forEach((item) => {
          const opposite = step.entity_side === 'from' ? item.to : item.from;
          if (isNonEmptyString(opposite)) {
            next.add(opposite);
          }
        });
      }

      frontier = next;
    }
  }

  return Array.from(frontier);
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

async function resolveOwnerCompanyValues(input: {
  persistence: AclPersistence;
  namespace: string;
  inputObjectId: string;
  objectIds: string[];
  subjectPath: InferencePathStep[];
  maxScan: number;
}): Promise<{ ownerValues: string[]; inputObjectOwnerRef?: string }> {
  const ownerValues = new Set<string>();
  let inputObjectOwnerRef: string | undefined;

  for (const objectId of input.objectIds) {
    const objectRecord = await input.persistence.getControlObject(input.namespace, objectId);
    const ownerRef = objectRecord?.owner_ref;
    if (!isNonEmptyString(ownerRef) || ownerRef === UNKNOWN_OWNER) {
      continue;
    }

    if (objectId === input.inputObjectId) {
      inputObjectOwnerRef = ownerRef;
    }

    const ownerPathValues = await resolveValuesByPath({
      persistence: input.persistence,
      namespace: input.namespace,
      entityId: ownerRef,
      rulePath: input.subjectPath,
      maxScan: input.maxScan,
    });

    ownerPathValues.forEach((value) => ownerValues.add(value));
  }

  return {
    ownerValues: Array.from(ownerValues),
    inputObjectOwnerRef,
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
    const subjectPath = rule.subject_edges;
    const objectPath = rule.object_edges;

    const subjectValues = uniqueStrings(await resolveValuesByPath({
      persistence: input.persistence,
      namespace: input.namespace,
      entityId: input.subjectId,
      rulePath: subjectPath,
      maxScan,
    }));

    const objectValueSet = new Set<string>(await resolveValuesByPath({
      persistence: input.persistence,
      namespace: input.namespace,
      entityId: input.objectId,
      rulePath: objectPath,
      maxScan,
    }));

    let ownerRef: string | undefined;
    if (rule.object_owner_fallback === true) {
      const includeInputObject = rule.owner_fallback_include_input !== false;
      const traversalObjectIds = Array.from(
        new Set([
          ...(includeInputObject ? [input.objectId] : []),
          ...objectValueSet.values(),
        ]),
      );
      const ownerResolution = await resolveOwnerCompanyValues({
        persistence: input.persistence,
        namespace: input.namespace,
        inputObjectId: input.objectId,
        objectIds: traversalObjectIds,
        subjectPath,
        maxScan,
      });
      ownerRef = ownerResolution.inputObjectOwnerRef;
      ownerResolution.ownerValues.forEach((item) => objectValueSet.add(item));
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
