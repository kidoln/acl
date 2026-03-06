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

  const legacyRelationCatalog = Array.isArray(catalogs.relation_type_catalog)
    ? catalogs.relation_type_catalog
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : [];

  if (legacyRelationCatalog.length > 0) {
    if (!Array.isArray(catalogs.subject_relation_type_catalog)) {
      catalogs.subject_relation_type_catalog = legacyRelationCatalog;
    }
    if (!Array.isArray(catalogs.object_relation_type_catalog)) {
      catalogs.object_relation_type_catalog = legacyRelationCatalog;
    }
    delete catalogs.relation_type_catalog;
    delete nextModel.relation_signature;
  }

  if (!Array.isArray(catalogs.subject_object_relation_type_catalog)) {
    catalogs.subject_object_relation_type_catalog = [];
  }

  return nextModel;
}

async function setupNamespace(input: {
  namespace: string;
  catalogs: {
    action_catalog: string[];
    object_type_catalog: string[];
    relation_type_catalog: string[];
  };
  objects: Array<{
    object_id: string;
    object_type: string;
    owner_ref: string;
    sensitivity: string;
  }>;
  relations: Array<{
    from: string;
    to: string;
    relation_type: string;
  }>;
}) {
  const registerCatalog = await app.inject({
    method: 'POST',
    url: '/control/catalogs:register',
    payload: {
      system_id: 'test_system',
      namespace: input.namespace,
      catalogs: input.catalogs,
    },
  });
  expect(registerCatalog.statusCode).toBe(200);

  if (input.objects.length > 0) {
    const upsertObjects = await app.inject({
      method: 'POST',
      url: '/control/objects:upsert',
      payload: {
        namespace: input.namespace,
        objects: input.objects,
      },
    });
    expect(upsertObjects.statusCode).toBe(200);
  }

  if (input.relations.length > 0) {
    const relationEvents = await app.inject({
      method: 'POST',
      url: '/control/relations:events',
      payload: {
        namespace: input.namespace,
        events: input.relations.map((r) => ({ ...r, operation: 'upsert' })),
      },
    });
    expect(relationEvents.statusCode).toBe(200);
  }
}

async function publishAndActivate(input: {
  publishId: string;
  model: Record<string, unknown>;
}) {
  const normalizedModel = normalizeLegacyRelationCatalog(input.model);
  const submit = await app.inject({
    method: 'POST',
    url: '/publish/submit',
    payload: {
      publish_id: input.publishId,
      profile: 'baseline',
      submitted_by: 'test_operator',
      model: normalizedModel,
      options: {
        available_obligation_executors: ['audit_write'],
      },
    },
  });
  expect(submit.statusCode).toBe(200);

  const submitBody = submit.json() as {
    status: string;
    gate_result?: {
      final_result?: string;
      gates?: Array<Record<string, unknown>>;
    };
  };
  if (submitBody.status === 'review_required') {
    const review = await app.inject({
      method: 'POST',
      url: '/publish/review',
      payload: {
        publish_id: input.publishId,
        decision: 'approve',
        reviewer: 'test_reviewer',
        reason: 'config options test approval',
        expires_at: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(review.statusCode).toBe(200);
  }

  const activate = await app.inject({
    method: 'POST',
    url: '/publish/activate',
    payload: {
      publish_id: input.publishId,
      operator: 'release_bot',
    },
  });
  expect(
    activate.statusCode,
    `publish activate failed, submit status=${submitBody.status}, final=${submitBody.gate_result?.final_result ?? '-'}, gates=${JSON.stringify(submitBody.gate_result?.gates ?? [])}, body=${activate.body}`,
  ).toBe(200);
}

async function setupRoute(input: {
  namespace: string;
  tenantId: string;
  modelId: string;
  version: string;
  publishId: string;
}) {
  const upsertRoute = await app.inject({
    method: 'POST',
    url: '/control/model-routes:upsert',
    payload: {
      namespace: input.namespace,
      routes: [
        {
          tenant_id: input.tenantId,
          environment: 'prod',
          model_id: input.modelId,
          model_version: input.version,
          publish_id: input.publishId,
          operator: 'ops_test',
        },
      ],
    },
  });
  expect(upsertRoute.statusCode).toBe(200);
}

describe('config options comprehensive tests', () => {
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

  describe('owner_fallback_include_input option', () => {
    it('positive: owner_fallback_include_input=true includes input object owner in fallback', async () => {
      const namespace = `tenant_owner_include_true.${Date.now()}`;
      const modelId = `model_owner_include_true_${Date.now()}`;
      const publishId = nextId('pub_owner_include_true');
      const objectId = `kb:direct_obj_${Date.now()}`;
      const derivedObjectId = `kb:derived_obj_${Date.now()}`;

      await setupNamespace({
        namespace,
        catalogs: {
          action_catalog: ['read'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to_department', 'belongs_to_company', 'derives_to'],
        },
        objects: [
          { object_id: objectId, object_type: 'kb', owner_ref: 'user:alice', sensitivity: 'normal' },
          { object_id: derivedObjectId, object_type: 'kb', owner_ref: 'user:eve', sensitivity: 'normal' },
        ],
        relations: [
          { from: 'user:alice', to: 'department:rnd', relation_type: 'belongs_to_department' },
          { from: 'user:bob', to: 'department:rnd', relation_type: 'belongs_to_department' },
          { from: 'department:rnd', to: 'company:acme', relation_type: 'belongs_to_company' },
          { from: 'user:eve', to: 'department:ops', relation_type: 'belongs_to_department' },
          { from: 'department:ops', to: 'company:otherco', relation_type: 'belongs_to_company' },
          { from: objectId, to: derivedObjectId, relation_type: 'derives_to' },
        ],
      });

      const model = {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          model_id: modelId,
          tenant_id: 'tenant_owner_include_true',
          version: '2026.03.05.001',
        },
        catalogs: {
          action_catalog: ['read'],
          subject_type_catalog: ['user'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to_department', 'belongs_to_company', 'derives_to'],
        },
        policies: {
          rules: [
            {
              id: 'rule_same_company_direct',
              subject_selector: 'subject.type == user and context.same_company_direct == true',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
          ],
        },
        context_inference: {
          enabled: true,
          rules: [
            {
              id: 'infer_same_company_direct',
              output_field: 'same_company_direct',
              subject_edges: [
                { relation_type: 'belongs_to_department', entity_side: 'from' },
                { relation_type: 'belongs_to_company', entity_side: 'from' },
              ],
              object_edges: [
                { relation_type: 'derives_to', entity_side: 'from' },
              ],
              object_owner_fallback: true,
              owner_fallback_include_input: true,
            },
          ],
          constraints: { monotonic_only: true, stratified_negation: false },
        },
      };

      await publishAndActivate({ publishId, model });
      await setupRoute({ namespace, tenantId: 'tenant_owner_include_true', modelId, version: '2026.03.05.001', publishId });

      const evaluate = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: { namespace, tenant_id: 'tenant_owner_include_true', environment: 'prod' },
          input: {
            action: 'read',
            subject: { id: 'user:bob', type: 'user' },
            object: { id: objectId, type: 'kb', sensitivity: 'normal' },
          },
        },
      });

      expect(evaluate.statusCode).toBe(200);
      const body = evaluate.json() as any;
      expect(body.decision.final_effect).toBe('allow');
      expect(body.relation_inference?.applied).toBe(true);
      const rule = body.relation_inference?.rules?.find((r: any) => r.id === 'infer_same_company_direct');
      expect(rule?.matched).toBe(true);
      expect(rule?.object_owner_ref).toBe('user:alice');
      expect(rule?.subject_values).toContain('company:acme');
      expect(rule?.object_values).toContain('company:acme');
    });

    it('negative: owner_fallback_include_input=false excludes input object owner from fallback', async () => {
      const namespace = `tenant_owner_include_false.${Date.now()}`;
      const modelId = `model_owner_include_false_${Date.now()}`;
      const publishId = nextId('pub_owner_include_false');
      const sourceObjectId = `kb:source_obj_${Date.now()}`;
      const derivedObjectId = `kb:derived_obj_${Date.now()}`;

      await setupNamespace({
        namespace,
        catalogs: {
          action_catalog: ['read'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to_department', 'belongs_to_company', 'derives_to'],
        },
        objects: [
          { object_id: sourceObjectId, object_type: 'kb', owner_ref: 'user:alice', sensitivity: 'normal' },
          { object_id: derivedObjectId, object_type: 'kb', owner_ref: 'user:external', sensitivity: 'normal' },
        ],
        relations: [
          { from: 'user:alice', to: 'department:rnd', relation_type: 'belongs_to_department' },
          { from: 'user:bob', to: 'department:rnd', relation_type: 'belongs_to_department' },
          { from: 'department:rnd', to: 'company:acme', relation_type: 'belongs_to_company' },
          { from: 'user:external', to: 'department:ext', relation_type: 'belongs_to_department' },
          { from: 'department:ext', to: 'company:external', relation_type: 'belongs_to_company' },
          { from: sourceObjectId, to: derivedObjectId, relation_type: 'derives_to' },
        ],
      });

      const model = {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          model_id: modelId,
          tenant_id: 'tenant_owner_include_false',
          version: '2026.03.05.002',
        },
        catalogs: {
          action_catalog: ['read'],
          subject_type_catalog: ['user'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to_department', 'belongs_to_company', 'derives_to'],
        },
        policies: {
          rules: [
            {
              id: 'rule_same_company_via_source',
              subject_selector: 'subject.type == user and context.same_company_via_source == true',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
          ],
        },
        context_inference: {
          enabled: true,
          rules: [
            {
              id: 'infer_same_company_via_source',
              output_field: 'same_company_via_source',
              subject_edges: [
                { relation_type: 'belongs_to_department', entity_side: 'from' },
                { relation_type: 'belongs_to_company', entity_side: 'from' },
              ],
              object_edges: [
                { relation_type: 'derives_to', entity_side: 'to' },
              ],
              object_owner_fallback: true,
              owner_fallback_include_input: false,
            },
          ],
          constraints: { monotonic_only: true, stratified_negation: false },
        },
      };

      await publishAndActivate({ publishId, model });
      await setupRoute({ namespace, tenantId: 'tenant_owner_include_false', modelId, version: '2026.03.05.002', publishId });

      // When querying derived object, only source object's owner should be used for fallback
      const evaluate = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: { namespace, tenant_id: 'tenant_owner_include_false', environment: 'prod' },
          input: {
            action: 'read',
            subject: { id: 'user:bob', type: 'user' },
            object: { id: derivedObjectId, type: 'kb', sensitivity: 'normal' },
          },
        },
      });

      expect(evaluate.statusCode).toBe(200);
      const body = evaluate.json() as any;
      // Bob (company:acme) should be able to read derived object because source owner alice is also in company:acme
      expect(body.decision.final_effect).toBe('allow');
      const rule = body.relation_inference?.rules?.find((r: any) => r.id === 'infer_same_company_via_source');
      expect(rule?.matched).toBe(true);
      expect(rule?.subject_values).toContain('company:acme');
      expect(rule?.object_values).toContain('company:acme');
    });
  });

  describe('object_owner_fallback option', () => {
    it('positive: object_owner_fallback=true enables owner-based inference', async () => {
      const namespace = `tenant_fallback_true.${Date.now()}`;
      const modelId = `model_fallback_true_${Date.now()}`;
      const publishId = nextId('pub_fallback_true');
      const objectId = `kb:fallback_obj_${Date.now()}`;

      await setupNamespace({
        namespace,
        catalogs: {
          action_catalog: ['read'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to'],
        },
        objects: [
          { object_id: objectId, object_type: 'kb', owner_ref: 'user:alice', sensitivity: 'normal' },
        ],
        relations: [
          { from: 'user:alice', to: 'group:g1', relation_type: 'belongs_to' },
          { from: 'user:bob', to: 'group:g1', relation_type: 'belongs_to' },
        ],
      });

      const model = {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          model_id: modelId,
          tenant_id: 'tenant_fallback_true',
          version: '2026.03.05.003',
        },
        catalogs: {
          action_catalog: ['read'],
          subject_type_catalog: ['user'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to'],
        },
        policies: {
          rules: [
            {
              id: 'rule_same_group',
              subject_selector: 'subject.type == user and context.same_group == true',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
          ],
        },
        context_inference: {
          enabled: true,
          rules: [
            {
              id: 'infer_same_group',
              output_field: 'same_group',
              subject_edges: [
                { relation_type: 'belongs_to', entity_side: 'from' },
              ],
              object_edges: [{ relation_type: 'belongs_to', entity_side: 'from' }],
              object_owner_fallback: true,
              owner_fallback_include_input: true,
            },
          ],
          constraints: { monotonic_only: true, stratified_negation: false },
        },
      };

      await publishAndActivate({ publishId, model });
      await setupRoute({ namespace, tenantId: 'tenant_fallback_true', modelId, version: '2026.03.05.003', publishId });

      const evaluate = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: { namespace, tenant_id: 'tenant_fallback_true', environment: 'prod' },
          input: {
            action: 'read',
            subject: { id: 'user:bob', type: 'user' },
            object: { id: objectId, type: 'kb', sensitivity: 'normal' },
          },
        },
      });

      expect(evaluate.statusCode).toBe(200);
      const body = evaluate.json() as any;
      expect(body.decision.final_effect).toBe('allow');
      const rule = body.relation_inference?.rules?.find((r: any) => r.id === 'infer_same_group');
      expect(rule?.matched).toBe(true);
      expect(rule?.object_owner_ref).toBe('user:alice');
    });

    it('negative: object_owner_fallback=false disables owner-based inference', async () => {
      const namespace = `tenant_fallback_false.${Date.now()}`;
      const modelId = `model_fallback_false_${Date.now()}`;
      const publishId = nextId('pub_fallback_false');
      const objectId = `kb:no_fallback_obj_${Date.now()}`;

      await setupNamespace({
        namespace,
        catalogs: {
          action_catalog: ['read'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to'],
        },
        objects: [
          { object_id: objectId, object_type: 'kb', owner_ref: 'user:alice', sensitivity: 'normal' },
        ],
        relations: [
          { from: 'user:alice', to: 'group:g1', relation_type: 'belongs_to' },
          { from: 'user:bob', to: 'group:g1', relation_type: 'belongs_to' },
        ],
      });

      const model = {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          model_id: modelId,
          tenant_id: 'tenant_fallback_false',
          version: '2026.03.05.004',
        },
        catalogs: {
          action_catalog: ['read'],
          subject_type_catalog: ['user'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to'],
        },
        policies: {
          rules: [
            {
              id: 'rule_same_group_no_fallback',
              subject_selector: 'subject.type == user and context.same_group == true',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
          ],
        },
        context_inference: {
          enabled: true,
          rules: [
            {
              id: 'infer_same_group_no_fallback',
              output_field: 'same_group',
              subject_edges: [
                { relation_type: 'belongs_to', entity_side: 'from' },
              ],
              object_edges: [{ relation_type: 'belongs_to', entity_side: 'from' }],
              object_owner_fallback: false,
            },
          ],
          constraints: { monotonic_only: true, stratified_negation: false },
        },
      };

      await publishAndActivate({ publishId, model });
      await setupRoute({ namespace, tenantId: 'tenant_fallback_false', modelId, version: '2026.03.05.004', publishId });

      const evaluate = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: { namespace, tenant_id: 'tenant_fallback_false', environment: 'prod' },
          input: {
            action: 'read',
            subject: { id: 'user:bob', type: 'user' },
            object: { id: objectId, type: 'kb', sensitivity: 'normal' },
          },
        },
      });

      expect(evaluate.statusCode).toBe(200);
      const body = evaluate.json() as any;
      expect(body.decision.final_effect).toBe('not_applicable');
      const rule = body.relation_inference?.rules?.find((r: any) => r.id === 'infer_same_group_no_fallback');
      expect(rule?.matched).toBe(false);
    });
  });

  describe('compatibility_mode options', () => {
    it('positive: compat_open allows object with missing conditional fields', async () => {
      const model = {
        ...minimalDraftModel,
        object_onboarding: {
          compatibility_mode: 'compat_open',
          default_profile: 'minimal',
          profiles: {
            minimal: {
              required_fields: ['tenant_id', 'object_id', 'object_type', 'created_by'],
              autofill: { owner_ref: 'created_by', sensitivity: 'normal' },
            },
          },
          conditional_required: [
            { when: 'object.sensitivity == high', add_fields: ['data_domain', 'retention_class'] },
          ],
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(true);
    });

    it('positive: compat_balanced enforces profile required but allows conditional deferred', async () => {
      const model = {
        ...minimalDraftModel,
        object_onboarding: {
          compatibility_mode: 'compat_balanced',
          default_profile: 'minimal',
          profiles: {
            minimal: {
              required_fields: ['tenant_id', 'object_id', 'object_type', 'created_by'],
              autofill: { owner_ref: 'created_by', sensitivity: 'normal' },
            },
          },
          conditional_required: [
            { when: 'object.sensitivity == high', add_fields: ['data_domain', 'retention_class'] },
          ],
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(true);
    });

    it('negative: compat_strict requires all conditional fields for high sensitivity', async () => {
      const strictModel = {
        ...minimalDraftModel,
        object_onboarding: {
          compatibility_mode: 'compat_strict',
          default_profile: 'minimal',
          profiles: {
            minimal: {
              required_fields: ['tenant_id', 'object_id', 'object_type', 'created_by'],
              autofill: { owner_ref: 'created_by', sensitivity: 'normal' },
            },
          },
          conditional_required: [
            { when: 'object.sensitivity == high', add_fields: ['data_domain', 'retention_class'] },
          ],
        },
      };

      const check = await app.inject({
        method: 'POST',
        url: '/objects:onboard-check',
        payload: {
          model: strictModel,
          object: {
            tenant_id: 'tenant_a',
            object_id: 'obj_high_sens',
            object_type: 'kb',
            created_by: 'user:alice',
            sensitivity: 'high',
          },
        },
      });

      expect(check.statusCode).toBe(200);
      const body = check.json() as any;
      expect(body.accepted).toBe(false);
      expect(body.blocking_errors).toContain('OBJECT_CONDITIONAL_REQUIRED_MISSING');
    });
  });

  describe('decision_search.pushdown options', () => {
    it('positive: safe mode with require_semantic_equivalence=true', async () => {
      const model = {
        ...minimalDraftModel,
        decision_search: {
          enabled: true,
          pushdown: {
            mode: 'safe',
            require_semantic_equivalence: true,
            allow_conservative_superset: false,
            max_candidates_scan: 5000,
          },
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(true);
    });

    it('positive: safe mode with allow_conservative_superset=true', async () => {
      const model = {
        ...minimalDraftModel,
        decision_search: {
          enabled: true,
          pushdown: {
            mode: 'safe',
            require_semantic_equivalence: false,
            allow_conservative_superset: true,
            max_candidates_scan: 5000,
          },
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(true);
    });

    it('negative: unsafe pushdown config triggers SEARCH_PUSHDOWN_UNSAFE', async () => {
      const model = {
        ...minimalDraftModel,
        decision_search: {
          enabled: true,
          pushdown: {
            mode: 'safe',
            require_semantic_equivalence: false,
            allow_conservative_superset: false,
            max_candidates_scan: 1000,
          },
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(false);
      expect(body.issues.some((issue: any) => issue.code === 'SEARCH_PUSHDOWN_UNSAFE')).toBe(true);
    });
  });

  describe('action_signature options', () => {
    it('positive: action signature allows valid subject/object/action tuple', async () => {
      const model = {
        ...minimalDraftModel,
        action_signature: {
          tuples: [
            {
              subject_types: ['user'],
              object_types: ['kb'],
              actions: ['read', 'update'],
              enabled: true,
            },
          ],
        },
        policies: {
          rules: [
            {
              id: 'rule_valid_signature',
              subject_selector: 'subject.type == user',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
          ],
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(true);
    });

    it('negative: action signature mismatch triggers ACTION_SIGNATURE_MISMATCH', async () => {
      const model = {
        ...minimalDraftModel,
        action_signature: {
          tuples: [
            {
              subject_types: ['user'],
              object_types: ['agent'],
              actions: ['read'],
              enabled: true,
            },
          ],
        },
        policies: {
          rules: [
            {
              id: 'rule_signature_mismatch',
              subject_selector: 'subject.type == user',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
          ],
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(false);
      expect(body.issues.some((issue: any) => issue.code === 'ACTION_SIGNATURE_MISMATCH')).toBe(true);
    });

    it('positive: multiple action signature tuples combine correctly', async () => {
      const model = {
        ...minimalDraftModel,
        action_signature: {
          tuples: [
            {
              subject_types: ['user'],
              object_types: ['kb'],
              actions: ['read'],
              enabled: true,
            },
            {
              subject_types: ['user'],
              object_types: ['kb'],
              actions: ['update'],
              enabled: true,
            },
          ],
        },
        policies: {
          rules: [
            {
              id: 'rule_multi_tuple_read',
              subject_selector: 'subject.type == user',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
            {
              id: 'rule_multi_tuple_update',
              subject_selector: 'subject.type == user',
              object_selector: 'object.type == kb',
              action_set: ['update'],
              effect: 'allow',
              priority: 90,
            },
          ],
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(true);
    });

    it('positive: enabled=false tuple is ignored', async () => {
      const model = {
        ...minimalDraftModel,
        action_signature: {
          tuples: [
            {
              subject_types: ['user'],
              object_types: ['agent'],
              actions: ['read'],
              enabled: false,
            },
            {
              subject_types: ['user'],
              object_types: ['kb'],
              actions: ['read'],
              enabled: true,
            },
          ],
        },
        policies: {
          rules: [
            {
              id: 'rule_enabled_tuple',
              subject_selector: 'subject.type == user',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
          ],
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(true);
    });
  });

  describe('context_inference edge cases', () => {
    it('positive: empty object_edges with object_owner_fallback=true uses only owner path', async () => {
      const namespace = `tenant_empty_edges.${Date.now()}`;
      const modelId = `model_empty_edges_${Date.now()}`;
      const publishId = nextId('pub_empty_edges');
      const objectId = `kb:empty_edges_obj_${Date.now()}`;

      await setupNamespace({
        namespace,
        catalogs: {
          action_catalog: ['read'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to'],
        },
        objects: [
          { object_id: objectId, object_type: 'kb', owner_ref: 'user:alice', sensitivity: 'normal' },
        ],
        relations: [
          { from: 'user:alice', to: 'team:t1', relation_type: 'belongs_to' },
          { from: 'user:bob', to: 'team:t1', relation_type: 'belongs_to' },
        ],
      });

      const model = {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          model_id: modelId,
          tenant_id: 'tenant_empty_edges',
          version: '2026.03.05.006',
        },
        catalogs: {
          action_catalog: ['read'],
          subject_type_catalog: ['user'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to'],
        },
        policies: {
          rules: [
            {
              id: 'rule_same_team_via_owner',
              subject_selector: 'subject.type == user and context.same_team == true',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
          ],
        },
        context_inference: {
          enabled: true,
          rules: [
            {
              id: 'infer_same_team',
              output_field: 'same_team',
              subject_edges: [{ relation_type: 'belongs_to', entity_side: 'from' }],
              object_edges: [{ relation_type: 'belongs_to', entity_side: 'from' }],
              object_owner_fallback: true,
              owner_fallback_include_input: true,
            },
          ],
          constraints: { monotonic_only: true, stratified_negation: false },
        },
      };

      await publishAndActivate({ publishId, model });
      await setupRoute({ namespace, tenantId: 'tenant_empty_edges', modelId, version: '2026.03.05.006', publishId });

      const evaluate = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: { namespace, tenant_id: 'tenant_empty_edges', environment: 'prod' },
          input: {
            action: 'read',
            subject: { id: 'user:bob', type: 'user' },
            object: { id: objectId, type: 'kb', sensitivity: 'normal' },
          },
        },
      });

      expect(evaluate.statusCode).toBe(200);
      const body = evaluate.json() as any;
      expect(body.decision.final_effect).toBe('allow');
    });

    it('negative: missing constraints triggers INFERENCE_RULE_UNSAFE', async () => {
      const model = {
        ...minimalDraftModel,
        context_inference: {
          enabled: true,
          rules: [
            {
              id: 'infer_unsafe',
              output_field: 'same_scope',
              subject_edges: [{ relation_type: 'member_of', entity_side: 'from' }],
              object_edges: [{ relation_type: 'owns', entity_side: 'to' }],
            },
          ],
        },
      };

      const validate = await app.inject({
        method: 'POST',
        url: '/models:validate',
        payload: {
          model,
          options: { available_obligation_executors: ['audit_write'] },
        },
      });

      expect(validate.statusCode).toBe(200);
      const body = validate.json() as any;
      expect(body.valid).toBe(false);
      expect(body.issues.some((issue: any) => issue.code === 'INFERENCE_RULE_UNSAFE')).toBe(true);
    });

    it('positive: multiple inference rules compute independently', async () => {
      const namespace = `tenant_multi_rules.${Date.now()}`;
      const modelId = `model_multi_rules_${Date.now()}`;
      const publishId = nextId('pub_multi_rules');
      const objectId = `kb:multi_rules_obj_${Date.now()}`;

      await setupNamespace({
        namespace,
        catalogs: {
          action_catalog: ['read'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to_dept', 'belongs_to_org'],
        },
        objects: [
          { object_id: objectId, object_type: 'kb', owner_ref: 'user:alice', sensitivity: 'normal' },
        ],
        relations: [
          { from: 'user:alice', to: 'dept:rnd', relation_type: 'belongs_to_dept' },
          { from: 'user:bob', to: 'dept:rnd', relation_type: 'belongs_to_dept' },
          { from: 'dept:rnd', to: 'org:acme', relation_type: 'belongs_to_org' },
          { from: 'user:charlie', to: 'dept:sales', relation_type: 'belongs_to_dept' },
          { from: 'dept:sales', to: 'org:acme', relation_type: 'belongs_to_org' },
        ],
      });

      const model = {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          model_id: modelId,
          tenant_id: 'tenant_multi_rules',
          version: '2026.03.05.007',
        },
        catalogs: {
          action_catalog: ['read'],
          subject_type_catalog: ['user'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to_dept', 'belongs_to_org'],
        },
        policies: {
          rules: [
            {
              id: 'rule_same_dept',
              subject_selector: 'subject.type == user and context.same_department == true',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 100,
            },
            {
              id: 'rule_same_org',
              subject_selector: 'subject.type == user and context.same_organization == true',
              object_selector: 'object.type == kb',
              action_set: ['read'],
              effect: 'allow',
              priority: 90,
            },
          ],
        },
        context_inference: {
          enabled: true,
          rules: [
            {
              id: 'infer_same_dept',
              output_field: 'same_department',
              subject_edges: [{ relation_type: 'belongs_to_dept', entity_side: 'from' }],
              object_edges: [{ relation_type: 'belongs_to_dept', entity_side: 'from' }],
              object_owner_fallback: true,
              owner_fallback_include_input: true,
            },
            {
              id: 'infer_same_org',
              output_field: 'same_organization',
              subject_edges: [
                { relation_type: 'belongs_to_dept', entity_side: 'from' },
                { relation_type: 'belongs_to_org', entity_side: 'from' },
              ],
              object_edges: [{ relation_type: 'belongs_to_dept', entity_side: 'from' }],
              object_owner_fallback: true,
              owner_fallback_include_input: true,
            },
          ],
          constraints: { monotonic_only: true, stratified_negation: false },
        },
      };

      await publishAndActivate({ publishId, model });
      await setupRoute({ namespace, tenantId: 'tenant_multi_rules', modelId, version: '2026.03.05.007', publishId });

      const evaluateSameDept = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: { namespace, tenant_id: 'tenant_multi_rules', environment: 'prod' },
          input: {
            action: 'read',
            subject: { id: 'user:bob', type: 'user' },
            object: { id: objectId, type: 'kb', sensitivity: 'normal' },
          },
        },
      });

      expect(evaluateSameDept.statusCode).toBe(200);
      const sameDeptBody = evaluateSameDept.json() as any;
      expect(sameDeptBody.decision.final_effect).toBe('allow');
      const deptRule = sameDeptBody.relation_inference?.rules?.find((r: any) => r.id === 'infer_same_dept');
      expect(deptRule?.matched).toBe(true);
      const orgRule = sameDeptBody.relation_inference?.rules?.find((r: any) => r.id === 'infer_same_org');
      expect(orgRule?.matched).toBe(true);

      const evaluateCrossDept = await app.inject({
        method: 'POST',
        url: '/decisions:evaluate',
        payload: {
          model_route: { namespace, tenant_id: 'tenant_multi_rules', environment: 'prod' },
          input: {
            action: 'read',
            subject: { id: 'user:charlie', type: 'user' },
            object: { id: objectId, type: 'kb', sensitivity: 'normal' },
          },
        },
      });

      expect(evaluateCrossDept.statusCode).toBe(200);
      const crossDeptBody = evaluateCrossDept.json() as any;
      expect(crossDeptBody.decision.final_effect).toBe('allow');
      const crossDeptRule = crossDeptBody.relation_inference?.rules?.find((r: any) => r.id === 'infer_same_dept');
      expect(crossDeptRule?.matched).toBe(false);
      const crossOrgRule = crossDeptBody.relation_inference?.rules?.find((r: any) => r.id === 'infer_same_org');
      expect(crossOrgRule?.matched).toBe(true);
    });
  });
});
