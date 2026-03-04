import { describe, expect, it } from 'vitest';

import type { AuthzModelConfig } from '@acl/shared-types';

import { executeSubjectRemovedLifecycle } from '../src/subject-removed';

function makeModel(handlers: string[]): AuthzModelConfig {
  return {
    model_meta: {
      model_id: 'tenant_a_authz_v1',
      tenant_id: 'tenant_a',
      version: '2026.03.04',
      status: 'draft',
      combining_algorithm: 'deny-overrides',
    },
    catalogs: {
      action_catalog: ['read', 'update', 'grant'],
      subject_type_catalog: ['user', 'group'],
      object_type_catalog: ['kb', 'agent'],
      relation_type_catalog: ['member_of', 'manages', 'delegates_to', 'contains'],
    },
    object_onboarding: {
      compatibility_mode: 'compat_balanced',
      default_profile: 'minimal',
      profiles: {
        minimal: {
          required_fields: ['tenant_id', 'object_id', 'object_type', 'created_by'],
          autofill: {
            owner_ref: 'created_by',
            sensitivity: 'normal',
          },
        },
      },
      conditional_required: [],
    },
    relations: {
      subject_relations: [
        { from: 'user:alice', to: 'group:finance', relation_type: 'member_of' },
        { from: 'user:bob', to: 'group:finance', relation_type: 'member_of' },
      ],
      object_relations: [{ from: 'obj:1', to: 'obj:2', relation_type: 'contains' }],
      subject_object_relations: [
        { from: 'user:alice', to: 'obj:high-1', relation_type: 'manages' },
        { from: 'user:alice', to: 'user:bob', relation_type: 'delegates_to' },
      ],
    },
    policies: {
      rules: [
        {
          id: 'r1',
          subject_selector: 'subject.type == user',
          object_selector: 'object.type == kb',
          action_set: ['read'],
          effect: 'allow',
          priority: 10,
        },
      ],
    },
    constraints: {
      sod_rules: [],
      cardinality_rules: [],
    },
    lifecycle: {
      event_rules: handlers.map((handler) => ({
        event_type: 'subject_removed',
        handler,
        required: true,
      })),
    },
    consistency: {
      default_level: 'bounded_staleness',
      high_risk_level: 'strong',
      bounded_staleness_ms: 3000,
    },
    quality_guardrails: {
      attribute_quality: {
        authority_whitelist: ['hr_system'],
        freshness_ttl_sec: { department_membership: 900 },
        reject_unknown_source: true,
      },
      mandatory_obligations: ['audit_write'],
    },
  };
}

describe('executeSubjectRemovedLifecycle', () => {
  it('revokes direct relations and terminates delegations', () => {
    const model = makeModel([
      'revoke_direct_edges',
      'terminate_delegations',
      'recompute_inherited_permissions',
    ]);

    const result = executeSubjectRemovedLifecycle({
      model,
      event: {
        event_type: 'subject_removed',
        target: 'user:alice',
        occurred_at: '2026-03-04T00:00:00.000Z',
        operator: 'system',
      },
      object_snapshots: [{ object_id: 'obj:high-1', owner_ref: 'user:alice', sensitivity: 'high' }],
    });

    expect(result.revoked_edges).toHaveLength(3);
    expect(result.terminated_delegations).toHaveLength(1);
    expect(result.handler_status.missing).toEqual([]);
    expect(result.relation_snapshot.after.subject_relations).toBe(1);
    expect(result.relation_snapshot.after.subject_object_relations).toBe(0);
    expect(result.takeover_queue).toHaveLength(1);
    expect(result.audit.impact_report.revoked_relation_count).toBe(3);
  });

  it('reassigns ownership when fallback owner is provided', () => {
    const model = makeModel(['revoke_direct_edges']);

    const result = executeSubjectRemovedLifecycle({
      model,
      event: {
        event_type: 'subject_removed',
        target: 'user:alice',
        occurred_at: '2026-03-04T00:00:00.000Z',
        operator: 'system',
      },
      object_snapshots: [{ object_id: 'obj:high-1', owner_ref: 'user:alice', sensitivity: 'high' }],
      options: {
        fallback_owner: 'user:security-officer',
      },
    });

    expect(result.ownership_reassigned).toEqual([
      {
        object_id: 'obj:high-1',
        from_owner: 'user:alice',
        to_owner: 'user:security-officer',
      },
    ]);
    expect(result.takeover_queue).toHaveLength(0);
  });

  it('marks missing handlers and applies default semantics', () => {
    const model = makeModel(['revoke_direct_edges']);

    const result = executeSubjectRemovedLifecycle({
      model,
      event: {
        event_type: 'subject_removed',
        target: 'user:alice',
        occurred_at: '2026-03-04T00:00:00.000Z',
        operator: 'system',
      },
    });

    expect(result.handler_status.default_applied).toBe(true);
    expect(result.handler_status.missing).toEqual([
      'terminate_delegations',
      'recompute_inherited_permissions',
    ]);
  });
});
