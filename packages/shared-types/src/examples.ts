import type { AuthzModelConfig } from './config';

export const minimalDraftModel: AuthzModelConfig = {
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
    relation_type_catalog: ['belongs_to', 'member_of', 'manages', 'derives_to'],
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
    conditional_required: [
      {
        when: 'object.sensitivity == high',
        add_fields: ['data_domain', 'retention_class'],
      },
    ],
  },
  relations: {
    subject_relations: [],
    object_relations: [],
    subject_object_relations: [],
  },
  policies: {
    rules: [
      {
        id: 'rule_read_kb',
        subject_selector: 'subject.relations includes member_of(group:g1)',
        object_selector: 'object.type == kb',
        action_set: ['read'],
        effect: 'allow',
        priority: 100,
      },
    ],
  },
  constraints: {
    sod_rules: [],
    cardinality_rules: [],
  },
  lifecycle: {
    event_rules: [
      {
        event_type: 'subject_removed',
        handler: 'revoke_direct_edges',
        required: true,
      },
    ],
  },
  consistency: {
    default_level: 'bounded_staleness',
    high_risk_level: 'strong',
    bounded_staleness_ms: 3000,
  },
  quality_guardrails: {
    attribute_quality: {
      authority_whitelist: ['hr_system'],
      freshness_ttl_sec: {
        department_membership: 900,
      },
      reject_unknown_source: true,
    },
    mandatory_obligations: ['audit_write'],
  },
};
