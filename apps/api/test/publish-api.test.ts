import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

let app: FastifyInstance;
let previousPersistenceDriver: string | undefined;

function nextPublishId(prefix: string): string {
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

function buildSubmitBody(publishId: string, takeoverBacklog?: number) {
  return {
    model: minimalDraftModel,
    publish_id: publishId,
    profile: 'baseline' as const,
    options: {
      available_obligation_executors: ['audit_write'],
      lifecycle_takeover_backlog_count: takeoverBacklog,
      lifecycle_takeover_max_pending_hours: takeoverBacklog ? 8 : 0,
    },
  };
}

async function publishModelViaWorkflow(input: {
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

describe('publish api integration', () => {
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

  it('lists publish requests with status/profile filters', async () => {
    const publishId = nextPublishId('pub_list');

    const submit = await app.inject({
      method: 'POST',
      url: '/publish/submit',
      payload: buildSubmitBody(publishId),
    });
    expect(submit.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: '/publish/requests?status=approved&profile=baseline&limit=50&offset=0',
    });
    expect(list.statusCode).toBe(200);

    const listBody = list.json() as {
      items: Array<{ publish_id: string; status: string; profile: string }>;
      total_count: number;
      has_more: boolean;
      next_offset?: number;
    };

    expect(listBody.total_count).toBeGreaterThan(0);
    expect(listBody.items.some((item) => item.publish_id === publishId)).toBe(true);

    const detail = await app.inject({
      method: 'GET',
      url: `/publish/requests/${publishId}`,
    });
    expect(detail.statusCode).toBe(200);

    const legacyDetail = await app.inject({
      method: 'GET',
      url: `/publish:requests/${publishId}`,
    });
    expect(legacyDetail.statusCode).toBe(200);
  });

  it('rejects review when expires_at is already expired', async () => {
    const publishId = nextPublishId('pub_expired');

    const submit = await app.inject({
      method: 'POST',
      url: '/publish/submit',
      payload: buildSubmitBody(publishId, 12),
    });
    expect(submit.statusCode).toBe(200);

    const review = await app.inject({
      method: 'POST',
      url: '/publish/review',
      payload: {
        publish_id: publishId,
        decision: 'approve',
        reviewer: 'governance_lead',
        reason: 'temporary exception',
        expires_at: '2000-01-01T00:00:00.000Z',
      },
    });
    expect(review.statusCode).toBe(409);

    const reviewBody = review.json() as {
      code: string;
      message: string;
    };

    expect(reviewBody.code).toBe('INVALID_STATE');
    expect(reviewBody.message).toContain('later than review time');
  });

  it('publishes successfully after valid review approval', async () => {
    const publishId = nextPublishId('pub_ok');

    const submit = await app.inject({
      method: 'POST',
      url: '/publish/submit',
      payload: buildSubmitBody(publishId, 11),
    });
    expect(submit.statusCode).toBe(200);

    const review = await app.inject({
      method: 'POST',
      url: '/publish/review',
      payload: {
        publish_id: publishId,
        decision: 'approve',
        reviewer: 'governance_lead',
        reason: 'risk accepted with controls',
        expires_at: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(review.statusCode).toBe(200);

    const activate = await app.inject({
      method: 'POST',
      url: '/publish/activate',
      payload: {
        publish_id: publishId,
        operator: 'release_bot',
      },
    });
    expect(activate.statusCode).toBe(200);

    const activateBody = activate.json() as {
      status: string;
      payload: {
        activation?: {
          operator: string;
          activated_at: string;
        };
      };
    };

    expect(activateBody.status).toBe('published');
    expect(activateBody.payload.activation?.operator).toBe('release_bot');
  });

  it('does not allow catalog registration and still syncs objects/relations', async () => {
    const catalogs = await app.inject({
      method: 'POST',
      url: '/control/catalogs:register',
      payload: {
        system_id: 'crm',
        namespace: 'tenant_a.crm',
        catalogs: {
          action_catalog: ['read', 'update'],
          object_type_catalog: ['customer'],
          relation_type_catalog: ['owned_by'],
        },
      },
    });
    expect(catalogs.statusCode).toBe(404);

    const listCatalogs = await app.inject({
      method: 'GET',
      url: '/control/catalogs',
    });
    expect(listCatalogs.statusCode).toBe(404);

    const upsertObjects = await app.inject({
      method: 'POST',
      url: '/control/objects:upsert',
      payload: {
        namespace: 'tenant_a.crm',
        objects: [
          {
            object_id: 'cust_1',
            object_type: 'customer',
            owner_ref: 'user:alice',
            sensitivity: 'normal',
          },
        ],
      },
    });
    expect(upsertObjects.statusCode).toBe(200);

    const listObjects = await app.inject({
      method: 'GET',
      url: '/control/objects?namespace=tenant_a.crm',
    });
    expect(listObjects.statusCode).toBe(200);
    const listObjectsBody = listObjects.json() as {
      total_count: number;
      items: Array<{ object_id: string }>;
      has_more: boolean;
    };
    expect(listObjectsBody.total_count).toBe(1);
    expect(listObjectsBody.items[0]?.object_id).toBe('cust_1');
    expect(listObjectsBody.has_more).toBe(false);

    const syncRelations = await app.inject({
      method: 'POST',
      url: '/control/relations:events',
      payload: {
        namespace: 'tenant_a.crm',
        events: [
          {
            from: 'user:alice',
            to: 'cust_1',
            relation_type: 'owned_by',
            operation: 'upsert',
          },
        ],
      },
    });
    expect(syncRelations.statusCode).toBe(200);

    const listRelations = await app.inject({
      method: 'GET',
      url: '/control/relations?namespace=tenant_a.crm',
    });
    expect(listRelations.statusCode).toBe(200);
    const listRelationsBody = listRelations.json() as {
      total_count: number;
      items: Array<{ relation_type: string }>;
      has_more: boolean;
    };
    expect(listRelationsBody.total_count).toBe(1);
    expect(listRelationsBody.items[0]?.relation_type).toBe('owned_by');
    expect(listRelationsBody.has_more).toBe(false);

    const listAudits = await app.inject({
      method: 'GET',
      url: '/control/audits?namespace=tenant_a.crm&limit=20&offset=0',
    });
    expect(listAudits.statusCode).toBe(200);
    const listAuditsBody = listAudits.json() as {
      total_count: number;
      items: Array<{ event_type: string; namespace: string }>;
    };
    expect(listAuditsBody.total_count).toBeGreaterThan(0);
    expect(
      listAuditsBody.items.some(
        (item) =>
          item.namespace === 'tenant_a.crm'
          && item.event_type.startsWith('control.'),
      ),
    ).toBe(true);
  });

  it('returns publish simulation delta report and supports persisted query', async () => {
    const baselineModel = {
      ...minimalDraftModel,
      policies: {
        rules: [],
      },
    };

    const simulate = await app.inject({
      method: 'POST',
      url: '/publish:simulate',
      payload: {
        model: minimalDraftModel,
        baseline_model: baselineModel,
        profile: 'baseline',
        options: {
          available_obligation_executors: ['audit_write'],
        },
        top_n: 5,
      },
    });
    expect(simulate.statusCode).toBe(200);

    const simulateBody = simulate.json() as {
      report_id: string;
      publish_id: string;
      summary: {
        publish_recommendation: string;
        mandatory_obligations_pass_rate: number;
        delta_allow_subject_count: number;
      };
      action_change_matrix: Array<{ action: string; changed_count: number }>;
      gate_result: {
        final_result: string;
      };
    };

    expect(simulateBody.report_id.startsWith('sim_')).toBe(true);
    expect(['通过', '需复核', '禁止发布']).toContain(simulateBody.summary.publish_recommendation);
    expect(simulateBody.summary.mandatory_obligations_pass_rate).toBeGreaterThan(0);
    expect(simulateBody.summary.delta_allow_subject_count).toBeGreaterThan(0);
    expect(simulateBody.action_change_matrix.length).toBeGreaterThan(0);
    expect(['passed', 'review_required', 'blocked', 'passed_with_ticket']).toContain(
      simulateBody.gate_result.final_result,
    );

    const listReports = await app.inject({
      method: 'GET',
      url: `/publish/simulations?publish_id=${encodeURIComponent(simulateBody.publish_id)}&limit=20&offset=0`,
    });
    expect(listReports.statusCode).toBe(200);
    const listReportsBody = listReports.json() as {
      total_count: number;
      items: Array<{ report_id: string }>;
    };
    expect(listReportsBody.total_count).toBeGreaterThan(0);
    expect(listReportsBody.items.some((item) => item.report_id === simulateBody.report_id)).toBe(true);

    const listByProfile = await app.inject({
      method: 'GET',
      url: '/publish/simulations?profile=baseline&limit=20&offset=0',
    });
    expect(listByProfile.statusCode).toBe(200);
    const listByProfileBody = listByProfile.json() as {
      total_count: number;
      items: Array<{ report_id: string }>;
    };
    expect(listByProfileBody.total_count).toBeGreaterThan(0);
    expect(listByProfileBody.items.some((item) => item.report_id === simulateBody.report_id)).toBe(true);

    const getReport = await app.inject({
      method: 'GET',
      url: `/publish/simulations/${simulateBody.report_id}`,
    });
    expect(getReport.statusCode).toBe(200);
    const getReportBody = getReport.json() as {
      report_id: string;
      summary: {
        delta_allow_subject_count: number;
      };
    };
    expect(getReportBody.report_id).toBe(simulateBody.report_id);
    expect(getReportBody.summary.delta_allow_subject_count).toBeGreaterThan(0);
  });

  it('evaluates object onboarding required fields by compatibility mode', async () => {
    const strictModel = {
      ...minimalDraftModel,
      object_onboarding: {
        ...minimalDraftModel.object_onboarding,
        compatibility_mode: 'compat_strict' as const,
      },
    };

    const check = await app.inject({
      method: 'POST',
      url: '/objects:onboard-check',
      payload: {
        model: strictModel,
        object: {
          tenant_id: 'tenant_a',
          object_id: 'obj_001',
          object_type: 'kb',
          created_by: 'user:alice',
          sensitivity: 'high',
        },
      },
    });
    expect(check.statusCode).toBe(200);

    const checkBody = check.json() as {
      accepted: boolean;
      blocking_errors: string[];
      detail: {
        conditional_missing: string[];
      };
    };

    expect(checkBody.accepted).toBe(false);
    expect(checkBody.detail.conditional_missing.length).toBeGreaterThan(0);
    expect(checkBody.blocking_errors).toContain('OBJECT_CONDITIONAL_REQUIRED_MISSING');
  });

  it('resolves decision model by tenant route in control plane', async () => {
    const modelId = `tenant_a_authz_route_${Date.now()}`;
    const v1 = `2026.03.04.${Math.floor(Math.random() * 1000)}`;
    const v2 = `2026.03.04.${Math.floor(Math.random() * 1000) + 1000}`;
    const publishV1 = nextPublishId('pub_route_v1');
    const publishV2 = nextPublishId('pub_route_v2');

    const modelV1 = {
      ...minimalDraftModel,
      model_meta: {
        ...minimalDraftModel.model_meta,
        model_id: modelId,
        tenant_id: 'tenant_a',
        version: v1,
      },
      policies: {
        rules: [
          {
            id: 'rule_route_deny',
            subject_selector: 'subject.relations includes member_of(group:g1)',
            object_selector: 'object.type == kb',
            action_set: ['read'],
            effect: 'deny',
            priority: 100,
          },
        ],
      },
    };
    const modelV2 = {
      ...minimalDraftModel,
      model_meta: {
        ...minimalDraftModel.model_meta,
        model_id: modelId,
        tenant_id: 'tenant_a',
        version: v2,
      },
      policies: {
        rules: [
          {
            id: 'rule_route_allow',
            subject_selector: 'subject.relations includes member_of(group:g1)',
            object_selector: 'object.type == kb',
            action_set: ['read'],
            effect: 'allow',
            priority: 100,
          },
        ],
      },
    };

    await publishModelViaWorkflow({
      publishId: publishV1,
      model: modelV1 as unknown as Record<string, unknown>,
    });
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 2);
    });
    await publishModelViaWorkflow({
      publishId: publishV2,
      model: modelV2 as unknown as Record<string, unknown>,
    });

    const upsertRoute = await app.inject({
      method: 'POST',
      url: '/control/model-routes:upsert',
      payload: {
        namespace: 'tenant_a.crm',
        routes: [
          {
            tenant_id: 'tenant_a',
            environment: 'prod',
            model_id: modelId,
            operator: 'ops_admin',
          },
        ],
      },
    });
    expect(upsertRoute.statusCode).toBe(200);
    const upsertBody = upsertRoute.json() as {
      created_count: number;
      items: Array<{ model_version?: string; publish_id?: string }>;
    };
    expect(upsertBody.created_count).toBe(1);
    expect(upsertBody.items[0]?.model_version).toBe(v2);
    expect(upsertBody.items[0]?.publish_id).toBe(publishV2);

    const listRoutes = await app.inject({
      method: 'GET',
      url: '/control/model-routes?namespace=tenant_a.crm&tenant_id=tenant_a&environment=prod',
    });
    expect(listRoutes.statusCode).toBe(200);
    const listRoutesBody = listRoutes.json() as {
      total_count: number;
      items: Array<{ model_id: string; model_version?: string }>;
    };
    expect(listRoutesBody.total_count).toBeGreaterThan(0);
    expect(
      listRoutesBody.items.some((item) => item.model_id === modelId && item.model_version === v2),
    ).toBe(true);

    const evaluate = await app.inject({
      method: 'POST',
      url: '/decisions:evaluate',
      payload: {
        model_route: {
          namespace: 'tenant_a.crm',
          tenant_id: 'tenant_a',
          environment: 'prod',
        },
        input: {
          action: 'read',
          subject: {
            id: 'user:alice',
            type: 'user',
            relations: [
              {
                relation: 'member_of',
                args: {
                  group: 'g1',
                },
              },
            ],
          },
          object: {
            id: 'kb:doc_1',
            type: 'kb',
            sensitivity: 'normal',
          },
        },
      },
    });
    expect(evaluate.statusCode).toBe(200);
    const evaluateBody = evaluate.json() as {
      decision: { final_effect: string };
      resolved_model?: { model_id: string; version: string };
      resolved_route?: { publish_id?: string };
    };
    expect(evaluateBody.decision.final_effect).toBe('allow');
    expect(evaluateBody.resolved_model?.model_id).toBe(modelId);
    expect(evaluateBody.resolved_model?.version).toBe(v2);
    expect(evaluateBody.resolved_route?.publish_id).toBe(publishV2);
  });

  it('infers same-department visibility from control-plane relations', async () => {
    const namespace = `tenant_auto.kb.${Date.now()}`;
    const modelId = `tenant_auto_authz_${Date.now()}`;
    const version = `2026.03.04.${Math.floor(Math.random() * 10000)}`;
    const publishId = nextPublishId('pub_infer_same_dept');
    const objectId = `kb:auto_${Date.now()}`;

    const upsertObject = await app.inject({
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
    expect(upsertObject.statusCode).toBe(200);

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

    const sameDeptModel = {
      ...minimalDraftModel,
      model_meta: {
        ...minimalDraftModel.model_meta,
        model_id: modelId,
        tenant_id: 'tenant_auto',
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
            id: 'rule_same_department_kb_read',
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
      model: sameDeptModel as unknown as Record<string, unknown>,
    });

    const upsertRoute = await app.inject({
      method: 'POST',
      url: '/control/model-routes:upsert',
      payload: {
        namespace,
        routes: [
          {
            tenant_id: 'tenant_auto',
            environment: 'prod',
            model_id: modelId,
            model_version: version,
            publish_id: publishId,
            operator: 'ops_auto',
          },
        ],
      },
    });
    expect(upsertRoute.statusCode).toBe(200);

    const evaluateSameDept = await app.inject({
      method: 'POST',
      url: '/decisions:evaluate',
      payload: {
        model_route: {
          namespace,
          tenant_id: 'tenant_auto',
          environment: 'prod',
        },
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
        },
      },
    });
    expect(evaluateSameDept.statusCode).toBe(200);
    const sameDeptBody = evaluateSameDept.json() as {
      decision: { final_effect: string };
      relation_inference?: {
        applied: boolean;
        namespace?: string;
        rules?: Array<{
          id: string;
          matched: boolean;
          object_owner_ref?: string;
        }>;
      };
    };
    expect(sameDeptBody.decision.final_effect).toBe('allow');
    expect(sameDeptBody.relation_inference?.applied).toBe(true);
    expect(sameDeptBody.relation_inference?.namespace).toBe(namespace);
    expect(sameDeptBody.relation_inference?.rules?.[0]?.id).toBe('infer_same_department');
    expect(sameDeptBody.relation_inference?.rules?.[0]?.matched).toBe(true);
    expect(sameDeptBody.relation_inference?.rules?.[0]?.object_owner_ref).toBe('user:alice');

    const evaluateCrossDept = await app.inject({
      method: 'POST',
      url: '/decisions:evaluate',
      payload: {
        model_route: {
          namespace,
          tenant_id: 'tenant_auto',
          environment: 'prod',
        },
        input: {
          action: 'read',
          subject: {
            id: 'user:charlie',
            type: 'user',
          },
          object: {
            id: objectId,
            type: 'kb',
            sensitivity: 'normal',
          },
        },
      },
    });
    expect(evaluateCrossDept.statusCode).toBe(200);
    const crossDeptBody = evaluateCrossDept.json() as {
      decision: { final_effect: string };
      relation_inference?: {
        rules?: Array<{
          matched: boolean;
        }>;
      };
    };
    expect(crossDeptBody.decision.final_effect).toBe('not_applicable');
    expect(crossDeptBody.relation_inference?.rules?.[0]?.matched).toBe(false);
  });

});
