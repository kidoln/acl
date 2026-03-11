import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

let app: FastifyInstance;
let previousPersistenceDriver: string | undefined;

function nextId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizeLegacyRelationCatalog(model: Record<string, unknown>): Record<string, unknown> {
  const nextModel = structuredClone(model) as Record<string, unknown>;
  const catalogs =
    nextModel.catalogs && typeof nextModel.catalogs === 'object' && !Array.isArray(nextModel.catalogs)
      ? (nextModel.catalogs as Record<string, unknown>)
      : null;
  if (!catalogs) {
    return nextModel;
  }

  const toStringList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];

  const buildSignatureTuples = (
    relationTypes: string[],
    fromTypes: string[],
    toTypes: string[],
  ): Array<{ relation_type: string; from_types: string[]; to_types: string[] }> =>
    relationTypes.map((relationType) => ({
      relation_type: relationType,
      from_types: fromTypes,
      to_types: toTypes,
    }));

  const legacyRelationCatalog = toStringList(catalogs.relation_type_catalog);

  if (legacyRelationCatalog.length > 0) {
    if (!Array.isArray(catalogs.subject_relation_type_catalog)) {
      catalogs.subject_relation_type_catalog = legacyRelationCatalog;
    }
    if (!Array.isArray(catalogs.object_relation_type_catalog)) {
      catalogs.object_relation_type_catalog = legacyRelationCatalog;
    }
    delete catalogs.relation_type_catalog;
  }

  if (!Array.isArray(catalogs.subject_object_relation_type_catalog)) {
    catalogs.subject_object_relation_type_catalog = [];
  }

  const subjectTypeCatalog = toStringList(catalogs.subject_type_catalog);
  const objectTypeCatalog = toStringList(catalogs.object_type_catalog);
  const subjectRelationCatalog = toStringList(catalogs.subject_relation_type_catalog);
  const objectRelationCatalog = toStringList(catalogs.object_relation_type_catalog);
  const subjectObjectRelationCatalog = toStringList(catalogs.subject_object_relation_type_catalog);

  const relationSignature =
    nextModel.relation_signature
    && typeof nextModel.relation_signature === 'object'
    && !Array.isArray(nextModel.relation_signature)
      ? (nextModel.relation_signature as Record<string, unknown>)
      : null;

  if (legacyRelationCatalog.length > 0 || !relationSignature) {
    nextModel.relation_signature = {
      subject_relations: buildSignatureTuples(
        subjectRelationCatalog,
        subjectTypeCatalog,
        subjectTypeCatalog,
      ),
      object_relations: buildSignatureTuples(
        objectRelationCatalog,
        objectTypeCatalog,
        objectTypeCatalog,
      ),
      subject_object_relations: buildSignatureTuples(
        subjectObjectRelationCatalog,
        subjectTypeCatalog,
        objectTypeCatalog,
      ),
    };
    return nextModel;
  }

  if (!Array.isArray(relationSignature.subject_relations)) {
    relationSignature.subject_relations = buildSignatureTuples(
      subjectRelationCatalog,
      subjectTypeCatalog,
      subjectTypeCatalog,
    );
  }
  if (!Array.isArray(relationSignature.object_relations)) {
    relationSignature.object_relations = buildSignatureTuples(
      objectRelationCatalog,
      objectTypeCatalog,
      objectTypeCatalog,
    );
  }
  if (!Array.isArray(relationSignature.subject_object_relations)) {
    relationSignature.subject_object_relations = buildSignatureTuples(
      subjectObjectRelationCatalog,
      subjectTypeCatalog,
      objectTypeCatalog,
    );
  }

  return nextModel;
}

function buildSameDepartmentModel(input: {
  modelId: string;
  tenantId: string;
  version: string;
}): Record<string, unknown> {
  const model = {
    ...minimalDraftModel,
    model_meta: {
      ...minimalDraftModel.model_meta,
      model_id: input.modelId,
      tenant_id: input.tenantId,
      version: input.version,
      combining_algorithm: 'permit-overrides',
    },
    catalogs: {
      action_catalog: ['read'],
      subject_type_catalog: ['user', 'department'],
      object_type_catalog: ['kb', 'department'],
      relation_type_catalog: ['belongs_to'],
    },
    policies: {
      rules: [
        {
          id: 'rule_same_department',
          subject_selector: 'subject.type == user and context.same_department == true',
          object_selector: 'object.type == kb',
          action_set: ['read'],
          effect: 'allow',
          priority: 100,
        },
        {
          id: 'rule_default_deny',
          subject_selector: 'subject.type == user',
          object_selector: 'object.type == kb',
          action_set: ['read'],
          effect: 'deny',
          priority: 1,
        },
      ],
    },
    context_inference: {
      enabled: true,
      rules: [
        {
          id: 'infer_same_department',
          output_field: 'same_department',
          subject_edges: [
            { relation_type: 'belongs_to', entity_side: 'from' },
          ],
          object_edges: [
            { relation_type: 'belongs_to', entity_side: 'from' },
          ],
        },
      ],
      constraints: { monotonic_only: true, stratified_negation: false },
    },
  };

  return normalizeLegacyRelationCatalog(model as Record<string, unknown>);
}

async function evaluateDecision(input: {
  model: Record<string, unknown>;
  namespace: string;
  subjectId: string;
  objectId: string;
}): Promise<string> {
  const evaluate = await app.inject({
    method: 'POST',
    url: '/decisions:evaluate',
    payload: {
      model: input.model,
      input: {
        action: 'read',
        subject: { id: input.subjectId, type: 'user' },
        object: { id: input.objectId, type: 'kb', sensitivity: 'normal' },
      },
      options: {
        relation_inference: {
          namespace: input.namespace,
        },
      },
    },
  });

  expect(evaluate.statusCode).toBe(200);
  const body = evaluate.json() as { decision: { final_effect: string } };
  return body.decision.final_effect;
}

async function searchDecisions(input: {
  model: Record<string, unknown>;
  namespace: string;
  subjectId: string;
}): Promise<string[]> {
  const search = await app.inject({
    method: 'POST',
    url: '/decisions/search',
    payload: {
      model: input.model,
      input: {
        action: 'read',
        subject: { id: input.subjectId, type: 'user' },
      },
      filters: {
        object_type_in: ['kb'],
      },
      page: {
        limit: 20,
      },
      options: {
        relation_inference: {
          namespace: input.namespace,
        },
      },
    },
  });

  expect(search.statusCode).toBe(200);
  const body = search.json() as { items: Array<{ object_id: string }> };
  return body.items.map((item) => item.object_id);
}

describe('control relation delete consistency', () => {
  beforeEach(async () => {
    previousPersistenceDriver = process.env.ACL_PERSISTENCE_DRIVER;
    process.env.ACL_PERSISTENCE_DRIVER = 'memory';
    vi.resetModules();
    const moduleRef = await import('../src/main');
    app = moduleRef.app;
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    if (previousPersistenceDriver === undefined) {
      delete process.env.ACL_PERSISTENCE_DRIVER;
    } else {
      process.env.ACL_PERSISTENCE_DRIVER = previousPersistenceDriver;
    }
  });

  it('deletes relation and updates list/evaluate/decision_search', async () => {
    const namespace = `tenant_rel_delete.${Date.now()}`;
    const model = buildSameDepartmentModel({
      modelId: nextId('model_rel_delete'),
      tenantId: 'tenant_rel_delete',
      version: '2026.03.11.001',
    });
    const objectId = `kb:doc_${Date.now()}`;

    const upsertObjects = await app.inject({
      method: 'POST',
      url: '/control/objects:upsert',
      payload: {
        namespace,
        objects: [
          {
            object_id: objectId,
            object_type: 'kb',
            owner_ref: 'user:alice',
            sensitivity: 'normal',
          },
        ],
      },
    });
    expect(upsertObjects.statusCode).toBe(200);

    const relationEvents = await app.inject({
      method: 'POST',
      url: '/control/relations:events',
      payload: {
        namespace,
        events: [
          {
            from: 'user:bob',
            to: 'department:rnd',
            relation_type: 'belongs_to',
            operation: 'upsert',
          },
          {
            from: objectId,
            to: 'department:rnd',
            relation_type: 'belongs_to',
            operation: 'upsert',
          },
        ],
      },
    });
    expect(relationEvents.statusCode).toBe(200);

    const beforeList = await app.inject({
      method: 'GET',
      url: `/control/relations?namespace=${encodeURIComponent(namespace)}&limit=20&offset=0`,
    });
    expect(beforeList.statusCode).toBe(200);
    const beforeBody = beforeList.json() as { items: Array<{ from: string; to: string }> };
    expect(beforeBody.items.some((item) => item.from === 'user:bob' && item.to === 'department:rnd')).toBe(true);

    const allowEffect = await evaluateDecision({
      model,
      namespace,
      subjectId: 'user:bob',
      objectId,
    });
    expect(allowEffect).toBe('allow');

    const searchBefore = await searchDecisions({
      model,
      namespace,
      subjectId: 'user:bob',
    });
    expect(searchBefore).toContain(objectId);

    const deleteEvent = await app.inject({
      method: 'POST',
      url: '/control/relations:events',
      payload: {
        namespace,
        events: [
          {
            from: 'user:bob',
            to: 'department:rnd',
            relation_type: 'belongs_to',
            operation: 'delete',
          },
        ],
      },
    });
    expect(deleteEvent.statusCode).toBe(200);
    const deleteBody = deleteEvent.json() as { deleted_count: number };
    expect(deleteBody.deleted_count).toBe(1);

    const afterList = await app.inject({
      method: 'GET',
      url: `/control/relations?namespace=${encodeURIComponent(namespace)}&limit=20&offset=0`,
    });
    expect(afterList.statusCode).toBe(200);
    const afterBody = afterList.json() as { items: Array<{ from: string; to: string }> };
    expect(afterBody.items.some((item) => item.from === 'user:bob' && item.to === 'department:rnd')).toBe(false);
    expect(afterBody.items.some((item) => item.from === objectId && item.to === 'department:rnd')).toBe(true);

    const denyEffect = await evaluateDecision({
      model,
      namespace,
      subjectId: 'user:bob',
      objectId,
    });
    expect(denyEffect).toBe('deny');

    const searchAfter = await searchDecisions({
      model,
      namespace,
      subjectId: 'user:bob',
    });
    expect(searchAfter).not.toContain(objectId);
  });

  it('supports resource migration: old group loses access, new group gains access', async () => {
    const namespace = `tenant_rel_migration.${Date.now()}`;
    const model = buildSameDepartmentModel({
      modelId: nextId('model_rel_migration'),
      tenantId: 'tenant_rel_migration',
      version: '2026.03.11.002',
    });
    const objectId = `kb:migrate_${Date.now()}`;

    const upsertObjects = await app.inject({
      method: 'POST',
      url: '/control/objects:upsert',
      payload: {
        namespace,
        objects: [
          {
            object_id: objectId,
            object_type: 'kb',
            owner_ref: 'user:alice',
            sensitivity: 'normal',
          },
        ],
      },
    });
    expect(upsertObjects.statusCode).toBe(200);

    const relationEvents = await app.inject({
      method: 'POST',
      url: '/control/relations:events',
      payload: {
        namespace,
        events: [
          {
            from: 'user:alice',
            to: 'department:rnd',
            relation_type: 'belongs_to',
            operation: 'upsert',
          },
          {
            from: 'user:charlie',
            to: 'department:sales',
            relation_type: 'belongs_to',
            operation: 'upsert',
          },
          {
            from: objectId,
            to: 'department:rnd',
            relation_type: 'belongs_to',
            operation: 'upsert',
          },
        ],
      },
    });
    expect(relationEvents.statusCode).toBe(200);

    const beforeAlice = await evaluateDecision({
      model,
      namespace,
      subjectId: 'user:alice',
      objectId,
    });
    expect(beforeAlice).toBe('allow');

    const beforeCharlie = await evaluateDecision({
      model,
      namespace,
      subjectId: 'user:charlie',
      objectId,
    });
    expect(beforeCharlie).toBe('deny');

    const migrationEvents = await app.inject({
      method: 'POST',
      url: '/control/relations:events',
      payload: {
        namespace,
        events: [
          {
            from: objectId,
            to: 'department:rnd',
            relation_type: 'belongs_to',
            operation: 'delete',
          },
          {
            from: objectId,
            to: 'department:sales',
            relation_type: 'belongs_to',
            operation: 'upsert',
          },
        ],
      },
    });
    expect(migrationEvents.statusCode).toBe(200);

    const afterAlice = await evaluateDecision({
      model,
      namespace,
      subjectId: 'user:alice',
      objectId,
    });
    expect(afterAlice).toBe('deny');

    const afterCharlie = await evaluateDecision({
      model,
      namespace,
      subjectId: 'user:charlie',
      objectId,
    });
    expect(afterCharlie).toBe('allow');
  });
});
