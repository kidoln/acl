import { describe, expect, it } from 'vitest';

import { InMemoryPersistence } from '../src/memory';

describe('memory persistence', () => {
  it('stores and loads validation records', async () => {
    const store = new InMemoryPersistence();
    await store.saveValidation({
      validation_id: 'val_1',
      model_id: 'm1',
      created_at: '2026-03-04T00:00:00.000Z',
      payload: { valid: true },
    });

    const loaded = await store.getValidation('val_1');
    expect(loaded?.payload).toEqual({ valid: true });
  });

  it('stores and loads gate records', async () => {
    const store = new InMemoryPersistence();
    await store.saveGateReport({
      publish_id: 'pub_1',
      profile: 'baseline',
      final_result: 'passed',
      created_at: '2026-03-04T00:00:00.000Z',
      payload: { gates: [] },
    });

    const loaded = await store.getGateReport('pub_1');
    expect(loaded?.final_result).toBe('passed');
  });

  it('stores and loads decision records', async () => {
    const store = new InMemoryPersistence();
    await store.saveDecision({
      decision_id: 'dec_1',
      created_at: '2026-03-04T00:00:00.000Z',
      payload: {
        request: {
          subject_id: 'u1',
          action: 'read',
          object_id: 'o1',
        },
        matched_rules: ['r1'],
        overridden_rules: [],
        final_effect: 'allow',
        reason: 'ok',
        occurred_at: '2026-03-04T00:00:00.000Z',
      },
      traces: [{ rule_id: 'r1', status: 'matched' }],
    });

    const loaded = await store.getDecision('dec_1');
    expect(loaded?.payload.final_effect).toBe('allow');
  });

  it('stores and loads lifecycle reports', async () => {
    const store = new InMemoryPersistence();
    await store.saveLifecycleReport({
      lifecycle_id: 'lfc_1',
      event_type: 'subject_removed',
      target: 'user:alice',
      created_at: '2026-03-04T00:00:00.000Z',
      payload: {
        audit: {
          freeze_history: true,
        },
      },
    });

    const loaded = await store.getLifecycleReport('lfc_1');
    expect(loaded?.event_type).toBe('subject_removed');
    expect(loaded?.target).toBe('user:alice');
  });

  it('stores and loads publish requests', async () => {
    const store = new InMemoryPersistence();
    await store.savePublishRequest({
      publish_id: 'pub_1',
      profile: 'baseline',
      status: 'review_required',
      final_result: 'review_required',
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
      payload: {
        gate_result: {
          final_result: 'review_required',
        },
      },
    });

    const loaded = await store.getPublishRequest('pub_1');
    expect(loaded?.status).toBe('review_required');
    expect(loaded?.profile).toBe('baseline');
  });

  it('lists publish requests with pagination and filters', async () => {
    const store = new InMemoryPersistence();

    await store.savePublishRequest({
      publish_id: 'pub_1',
      profile: 'baseline',
      status: 'review_required',
      final_result: 'review_required',
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T01:00:00.000Z',
      payload: {},
    });
    await store.savePublishRequest({
      publish_id: 'pub_2',
      profile: 'strict_compliance',
      status: 'approved',
      final_result: 'passed',
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T02:00:00.000Z',
      payload: {},
    });

    const filtered = await store.listPublishRequests({
      status: 'approved',
      profile: 'strict_compliance',
      limit: 10,
      offset: 0,
    });
    expect(filtered.total_count).toBe(1);
    expect(filtered.items[0]?.publish_id).toBe('pub_2');
    expect(filtered.has_more).toBe(false);

    const paged = await store.listPublishRequests({
      limit: 1,
      offset: 0,
    });
    expect(paged.items).toHaveLength(1);
    expect(paged.has_more).toBe(true);
    expect(paged.next_offset).toBe(1);
  });

  it('stores and lists control-plane records, model routes and simulation reports', async () => {
    const store = new InMemoryPersistence();

    await store.upsertControlCatalog({
      key: 'crm::tenant_a.crm',
      system_id: 'crm',
      namespace: 'tenant_a.crm',
      catalogs: {
        action_catalog: ['read', 'update'],
        object_type_catalog: ['customer'],
        relation_type_catalog: ['owned_by'],
      },
      created_at: '2026-03-04T00:00:00.000Z',
      updated_at: '2026-03-04T00:00:00.000Z',
    });
    await store.upsertControlObject({
      key: 'tenant_a.crm::cust_1',
      namespace: 'tenant_a.crm',
      object_id: 'cust_1',
      object_type: 'customer',
      sensitivity: 'normal',
      owner_ref: 'user:alice',
      labels: ['vip'],
      updated_at: '2026-03-04T00:00:00.000Z',
    });
    await store.upsertControlRelation({
      key: 'tenant_a.crm::user:alice|cust_1|owned_by|',
      namespace: 'tenant_a.crm',
      from: 'user:alice',
      to: 'cust_1',
      relation_type: 'owned_by',
      updated_at: '2026-03-04T00:00:00.000Z',
    });
    await store.saveSimulationReport({
      report_id: 'sim_1',
      publish_id: 'pub_1',
      profile: 'baseline',
      generated_at: '2026-03-04T00:00:00.000Z',
      payload: {
        summary: {
          delta_allow_subject_count: 1,
        },
      },
    });
    await store.saveControlAudit({
      audit_id: 'ctrl_audit_1',
      event_type: 'control.catalog.registered',
      target: 'crm::tenant_a.crm',
      namespace: 'tenant_a.crm',
      operator: 'system',
      created_at: '2026-03-04T00:00:00.000Z',
      payload: {
        operation: 'created',
      },
    });
    await store.upsertModelRoute({
      key: 'tenant_a.crm::tenant_a::prod',
      namespace: 'tenant_a.crm',
      tenant_id: 'tenant_a',
      environment: 'prod',
      model_id: 'tenant_a_authz_v1',
      model_version: '2026.03.04',
      publish_id: 'pub_1',
      updated_at: '2026-03-04T00:00:00.000Z',
      operator: 'ops_admin',
    });

    const catalogs = await store.listControlCatalogs({
      namespace: 'tenant_a.crm',
      limit: 10,
      offset: 0,
    });
    expect(catalogs.total_count).toBe(1);
    expect(catalogs.items[0]?.system_id).toBe('crm');

    const objects = await store.listControlObjects({
      namespace: 'tenant_a.crm',
      limit: 10,
      offset: 0,
    });
    expect(objects.total_count).toBe(1);
    expect(objects.items[0]?.object_id).toBe('cust_1');

    const relations = await store.listControlRelations({
      namespace: 'tenant_a.crm',
      limit: 10,
      offset: 0,
    });
    expect(relations.total_count).toBe(1);
    expect(relations.items[0]?.relation_type).toBe('owned_by');

    const simulations = await store.listSimulationReports({
      publish_id: 'pub_1',
      limit: 10,
      offset: 0,
    });
    expect(simulations.total_count).toBe(1);
    expect(simulations.items[0]?.report_id).toBe('sim_1');

    const audits = await store.listControlAudits({
      namespace: 'tenant_a.crm',
      limit: 10,
      offset: 0,
    });
    expect(audits.total_count).toBe(1);
    expect(audits.items[0]?.event_type).toBe('control.catalog.registered');

    const routes = await store.listModelRoutes({
      namespace: 'tenant_a.crm',
      tenant_id: 'tenant_a',
      environment: 'prod',
      limit: 10,
      offset: 0,
    });
    expect(routes.total_count).toBe(1);
    expect(routes.items[0]?.model_id).toBe('tenant_a_authz_v1');
    expect(routes.items[0]?.model_version).toBe('2026.03.04');

    const route = await store.getModelRoute('tenant_a.crm::tenant_a::prod');
    expect(route?.publish_id).toBe('pub_1');
  });
});
