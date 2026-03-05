import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

let app: FastifyInstance;
let previousPersistenceDriver: string | undefined;

function nextPublishId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

async function publishModelViaWorkflow(input: {
  publishId: string;
  model: Record<string, unknown>;
}) {
  const submit = await app.inject({
    method: 'POST',
    url: '/publish/submit',
    payload: {
      publish_id: input.publishId,
      profile: 'baseline',
      submitted_by: 'test_operator',
      model: input.model,
      options: {
        available_obligation_executors: ['audit_write'],
      },
    },
  });

  expect(submit.statusCode).toBe(200);
  const submitBody = submit.json() as {
    status: string;
  };

  if (submitBody.status === 'review_required') {
    const review = await app.inject({
      method: 'POST',
      url: '/publish/review',
      payload: {
        publish_id: input.publishId,
        decision: 'approve',
        reviewer: 'test_reviewer',
        reason: 'integration test approval',
        expires_at: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(review.statusCode).toBe(200);
  } else {
    expect(['approved', 'published']).toContain(submitBody.status);
  }

  const activate = await app.inject({
    method: 'POST',
    url: '/publish/activate',
    payload: {
      publish_id: input.publishId,
      operator: 'release_bot',
    },
  });
  expect(activate.statusCode).toBe(200);
}

describe('decision search integration', () => {
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

  it('external_snapshot mode: supports point decision evaluate without control-plane instance index', async () => {
    const namespace = `tenant_external_snapshot.kb.${Date.now()}`;
    const objectId = `kb:external_${Date.now()}`;

    const model = {
      ...minimalDraftModel,
      catalogs: {
        action_catalog: ['read'],
        subject_type_catalog: ['user'],
        object_type_catalog: ['kb'],
        relation_type_catalog: [],
      },
      policies: {
        rules: [
          {
            id: 'rule_external_snapshot_read',
            subject_selector: 'subject.type == user and context.same_department == true',
            object_selector: 'object.type == kb',
            action_set: ['read'],
            effect: 'allow',
            priority: 100,
          },
        ],
      },
      context_inference: {
        enabled: false,
        rules: [],
      },
    };

    const evaluateAllow = await app.inject({
      method: 'POST',
      url: '/decisions:evaluate',
      payload: {
        model,
        input: {
          action: 'read',
          subject: {
            id: 'user:bob',
            type: 'user',
          },
          object: {
            id: objectId,
            type: 'kb',
            sensitivity: 'normal',
          },
          context: {
            same_department: true,
          },
        },
        options: {
          strict_validation: false,
          relation_inference: {
            enabled: false,
            namespace,
          },
        },
      },
    });
    expect(evaluateAllow.statusCode).toBe(200);
    const evaluateAllowBody = evaluateAllow.json() as {
      decision: { final_effect: string };
      relation_inference?: { enabled: boolean; reason?: string };
    };
    expect(evaluateAllowBody.decision.final_effect).toBe('allow');
    expect(evaluateAllowBody.relation_inference?.enabled).toBe(false);
    expect(evaluateAllowBody.relation_inference?.reason).toBe('disabled_by_option');

    const evaluateDeny = await app.inject({
      method: 'POST',
      url: '/decisions:evaluate',
      payload: {
        model,
        input: {
          action: 'read',
          subject: {
            id: 'user:bob',
            type: 'user',
          },
          object: {
            id: objectId,
            type: 'kb',
            sensitivity: 'normal',
          },
          context: {
            same_department: false,
          },
        },
        options: {
          strict_validation: false,
          relation_inference: {
            enabled: false,
            namespace,
          },
        },
      },
    });
    expect(evaluateDeny.statusCode).toBe(200);
    const evaluateDenyBody = evaluateDeny.json() as {
      decision: { final_effect: string };
    };
    expect(evaluateDenyBody.decision.final_effect).toBe('not_applicable');

    const search = await app.inject({
      method: 'POST',
      url: '/decisions/search',
      payload: {
        model,
        input: {
          action: 'read',
          subject: {
            id: 'user:bob',
            type: 'user',
          },
          context: {
            same_department: true,
          },
        },
        page: {
          limit: 20,
        },
        options: {
          include_plan: true,
          strict_validation: false,
          relation_inference: {
            enabled: false,
            namespace,
          },
        },
      },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json() as {
      page: {
        total_count: number;
      };
      items: Array<{ object_id: string }>;
      relation_inference?: {
        enabled: boolean;
        reason?: string;
      };
      plan?: {
        candidate_count: number;
        allow_count: number;
      };
    };

    expect(searchBody.page.total_count).toBe(0);
    expect(searchBody.items).toHaveLength(0);
    expect(searchBody.relation_inference?.enabled).toBe(false);
    expect(searchBody.relation_inference?.reason).toBe('disabled_by_option');
    expect(searchBody.plan?.candidate_count).toBe(0);
    expect(searchBody.plan?.allow_count).toBe(0);
  });

  it('control_plane_index mode: searches visible object list by subject and action', async () => {
    const namespace = `tenant_search.kb.${Date.now()}`;
    const modelId = `tenant_search_authz_${Date.now()}`;
    const version = `2026.03.05.${Math.floor(Math.random() * 10000)}`;
    const publishId = nextPublishId('pub_search_same_dept');
    const objectRnd = `kb:rnd_${Date.now()}`;
    const objectSales = `kb:sales_${Date.now()}`;

    const registerCatalog = await app.inject({
      method: 'POST',
      url: '/control/catalogs:register',
      payload: {
        system_id: 'knowledge_search_service',
        namespace,
        catalogs: {
          action_catalog: ['read'],
          object_type_catalog: ['kb'],
          relation_type_catalog: ['belongs_to', 'owns'],
        },
      },
    });
    expect(registerCatalog.statusCode).toBe(200);

    const upsertObjects = await app.inject({
      method: 'POST',
      url: '/control/objects:upsert',
      payload: {
        namespace,
        objects: [
          {
            object_id: objectRnd,
            object_type: 'kb',
            owner_ref: 'user:alice',
            sensitivity: 'normal',
            labels: ['dept:rnd'],
          },
          {
            object_id: objectSales,
            object_type: 'kb',
            owner_ref: 'user:charlie',
            sensitivity: 'normal',
            labels: ['dept:sales'],
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
            from: 'user:bob',
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
        ],
      },
    });
    expect(relationEvents.statusCode).toBe(200);

    const model = {
      ...minimalDraftModel,
      model_meta: {
        ...minimalDraftModel.model_meta,
        model_id: modelId,
        tenant_id: 'tenant_search',
        version,
      },
      catalogs: {
        action_catalog: ['read'],
        subject_type_catalog: ['user'],
        object_type_catalog: ['kb'],
        relation_type_catalog: ['belongs_to', 'owns'],
      },
      policies: {
        rules: [
          {
            id: 'rule_same_department_search',
            subject_selector: 'subject.type == user and context.same_department == true',
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
            id: 'infer_same_department',
            output_field: 'same_department',
            subject_edges: [
              {
                relation_type: 'belongs_to',
                entity_side: 'from',
              },
            ],
            object_edges: [
              {
                relation_type: 'owns',
                entity_side: 'to',
              },
            ],
            object_owner_fallback: true,
          },
        ],
        constraints: {
          monotonic_only: true,
          stratified_negation: false,
        },
      },
    };

    await publishModelViaWorkflow({
      publishId,
      model: model as unknown as Record<string, unknown>,
    });

    const upsertRoute = await app.inject({
      method: 'POST',
      url: '/control/model-routes:upsert',
      payload: {
        namespace,
        routes: [
          {
            tenant_id: 'tenant_search',
            environment: 'prod',
            model_id: modelId,
            model_version: version,
            publish_id: publishId,
            operator: 'ops_search',
          },
        ],
      },
    });
    expect(upsertRoute.statusCode).toBe(200);

    const search = await app.inject({
      method: 'POST',
      url: '/decisions/search',
      payload: {
        model_route: {
          namespace,
          tenant_id: 'tenant_search',
          environment: 'prod',
        },
        input: {
          action: 'read',
          subject: {
            id: 'user:bob',
            type: 'user',
          },
        },
        filters: {
          object_type_in: ['kb'],
        },
        page: {
          limit: 20,
        },
        options: {
          include_plan: true,
        },
      },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json() as {
      page: {
        total_count: number;
        has_more: boolean;
      };
      items: Array<{
        object_id: string;
        final_effect: string;
      }>;
      relation_inference?: {
        enabled: boolean;
        applied_count: number;
      };
      plan?: {
        mode: string;
        candidate_count: number;
        allow_count: number;
      };
    };

    expect(searchBody.page.total_count).toBe(1);
    expect(searchBody.page.has_more).toBe(false);
    expect(searchBody.items).toHaveLength(1);
    expect(searchBody.items[0]?.object_id).toBe(objectRnd);
    expect(searchBody.items[0]?.final_effect).toBe('allow');
    expect(searchBody.relation_inference?.enabled).toBe(true);
    expect(searchBody.relation_inference?.applied_count).toBeGreaterThan(0);
    expect(searchBody.plan?.mode).toContain('pushdown_with_residual');
    expect(searchBody.plan?.candidate_count).toBe(2);
    expect(searchBody.plan?.allow_count).toBe(1);
  });
});
