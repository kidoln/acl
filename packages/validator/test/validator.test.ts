import { describe, expect, it } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

import { validateModelConfig } from '../src/validator';

describe('model validator', () => {
  it('passes baseline model with available obligation executors', () => {
    const result = validateModelConfig(minimalDraftModel, {
      available_obligation_executors: ['audit_write'],
    });

    expect(result.valid).toBe(true);
    expect(result.summary.blocking_issues).toBe(0);
  });

  it('accepts model without top-level relations block', () => {
    const model = { ...minimalDraftModel };
    delete model.relations;

    const result = validateModelConfig(model, {
      available_obligation_executors: ['audit_write'],
    });

    expect(result.valid).toBe(true);
  });

  it('detects unknown action in policy rule', () => {
    const badModel = {
      ...minimalDraftModel,
      policies: {
        rules: [
          {
            ...minimalDraftModel.policies.rules[0],
            action_set: ['read', 'delete'],
          },
        ],
      },
    };

    const result = validateModelConfig(badModel);
    expect(result.issues.some((issue) => issue.code === 'ACTION_NOT_REGISTERED')).toBe(true);
  });

  it('detects selector parse error', () => {
    const badModel = {
      ...minimalDraftModel,
      policies: {
        rules: [
          {
            ...minimalDraftModel.policies.rules[0],
            object_selector: 'object.type = kb',
          },
        ],
      },
    };

    const result = validateModelConfig(badModel);
    expect(result.issues.some((issue) => issue.code === 'SELECTOR_PARSE_ERROR')).toBe(true);
  });

  it('detects missing mandatory obligations for high sensitivity allow rule', () => {
    const badModel = {
      ...minimalDraftModel,
      policies: {
        rules: [
          {
            ...minimalDraftModel.policies.rules[0],
            object_selector: 'object.sensitivity == high',
            obligations: [],
          },
        ],
      },
    };

    const result = validateModelConfig(badModel);
    expect(result.issues.some((issue) => issue.code === 'MANDATORY_OBLIGATION_MISSING')).toBe(true);
  });

  it('detects unresolved conflict with same priority and opposite effect', () => {
    const base = minimalDraftModel.policies.rules[0];
    const badModel = {
      ...minimalDraftModel,
      model_meta: {
        ...minimalDraftModel.model_meta,
        combining_algorithm: 'first-applicable' as const,
      },
      policies: {
        rules: [
          base,
          {
            ...base,
            id: 'rule_read_kb_deny',
            effect: 'deny' as const,
          },
        ],
      },
    };

    const result = validateModelConfig(badModel);
    expect(result.issues.some((issue) => issue.code === 'RULE_CONFLICT_UNRESOLVED')).toBe(true);
  });

  it('detects subject_removed lifecycle handler missing', () => {
    const badModel = {
      ...minimalDraftModel,
      lifecycle: {
        event_rules: [
          {
            event_type: 'subject_removed',
            handler: 'revoke_direct_edges',
            required: false,
          },
        ],
      },
    };

    const result = validateModelConfig(badModel);
    expect(result.issues.some((issue) => issue.code === 'LIFECYCLE_HANDLER_MISSING')).toBe(true);
  });

  it('detects obligation executor not available', () => {
    const result = validateModelConfig(minimalDraftModel, {
      available_obligation_executors: ['dual_approval'],
    });

    expect(result.issues.some((issue) => issue.code === 'OBLIGATION_NOT_EXECUTABLE')).toBe(true);
  });

  it('detects SOD violation from constraints', () => {
    const model = {
      ...minimalDraftModel,
      policies: {
        rules: [
          {
            id: 'rule_allow_read',
            subject_selector: 'subject.relations includes member_of(group:g1)',
            object_selector: 'object.type == kb',
            action_set: ['read'],
            effect: 'allow' as const,
            priority: 100,
          },
          {
            id: 'rule_allow_update',
            subject_selector: 'subject.relations includes member_of(group:g1)',
            object_selector: 'object.type == kb',
            action_set: ['update'],
            effect: 'allow' as const,
            priority: 90,
          },
        ],
      },
      constraints: {
        sod_rules: [
          {
            id: 'sod_read_update',
            forbidden_combination: ['read', 'update'],
          },
        ],
        cardinality_rules: [],
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.code === 'SOD_VIOLATION')).toBe(true);
  });

  it('detects cardinality exceeded from provided counts', () => {
    const model = {
      ...minimalDraftModel,
      constraints: {
        ...minimalDraftModel.constraints,
        cardinality_rules: [
          {
            target: 'tenant_root',
            max_count: 2,
          },
        ],
      },
    };

    const result = validateModelConfig(model, {
      cardinality_counts: {
        tenant_root: 3,
      },
    });

    expect(result.issues.some((issue) => issue.code === 'CARDINALITY_EXCEEDED')).toBe(true);
  });

  it('detects duplicate rule id', () => {
    const base = minimalDraftModel.policies.rules[0];
    const badModel = {
      ...minimalDraftModel,
      policies: {
        rules: [
          base,
          {
            ...base,
            effect: 'deny' as const,
            priority: base.priority + 1,
          },
        ],
      },
    };

    const result = validateModelConfig(badModel);
    expect(result.issues.some((issue) => issue.code === 'DUPLICATE_RULE_ID')).toBe(true);
  });

  it('detects selector type mismatch', () => {
    const badModel = {
      ...minimalDraftModel,
      policies: {
        rules: [
          {
            ...minimalDraftModel.policies.rules[0],
            subject_selector: 'object.type == kb',
          },
        ],
      },
    };

    const result = validateModelConfig(badModel);
    expect(result.issues.some((issue) => issue.code === 'SELECTOR_TYPE_MISMATCH')).toBe(true);
  });

  it('marks priority collision as warning when algorithm can disambiguate', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = {
      ...minimalDraftModel,
      policies: {
        rules: [
          base,
          {
            ...base,
            id: 'rule_read_kb_deny',
            effect: 'deny' as const,
          },
        ],
      },
    };

    const result = validateModelConfig(model);
    const issue = result.issues.find((item) => item.code === 'PRIORITY_COLLISION');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
  });

  it('detects unreachable rule shadowed by higher priority', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = {
      ...minimalDraftModel,
      policies: {
        rules: [
          {
            ...base,
            id: 'rule_high',
            action_set: ['read', 'update'],
            priority: 200,
          },
          {
            ...base,
            id: 'rule_low',
            action_set: ['read'],
            priority: 100,
          },
        ],
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.code === 'RULE_UNREACHABLE')).toBe(true);
  });

  it('detects untrusted attribute source configuration', () => {
    const model = {
      ...minimalDraftModel,
      quality_guardrails: {
        ...minimalDraftModel.quality_guardrails,
        attribute_quality: {
          reject_unknown_source: true,
          authority_whitelist: [],
        },
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.code === 'ATTRIBUTE_SOURCE_UNTRUSTED')).toBe(true);
  });

  it('detects strict onboarding config missing conditional rules', () => {
    const model = {
      ...minimalDraftModel,
      object_onboarding: {
        ...minimalDraftModel.object_onboarding,
        compatibility_mode: 'compat_strict' as const,
        conditional_required: [],
      },
    };

    const result = validateModelConfig(model);
    expect(
      result.issues.some((issue) => issue.code === 'OBJECT_CONDITIONAL_REQUIRED_MISSING'),
    ).toBe(true);
  });

  it('detects unknown relation type in context inference rules', () => {
    const model = {
      ...minimalDraftModel,
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_same_scope',
            output_field: 'same_scope',
            subject_edges: [
              {
                relation_type: 'belongs_to',
                entity_side: 'from' as const,
              },
            ],
            object_edges: [
              {
                relation_type: 'unknown_scope_relation',
                entity_side: 'to' as const,
              },
            ],
          },
        ],
        constraints: {
          monotonic_only: true,
          stratified_negation: false,
        },
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.code === 'RELATION_TYPE_UNKNOWN')).toBe(true);
  });

  it('detects relation type configured for wrong relation domain when catalogs are split', () => {
    const catalogs = { ...minimalDraftModel.catalogs };
    delete catalogs.relation_type_catalog;

    const model = {
      ...minimalDraftModel,
      catalogs: {
        ...catalogs,
        subject_relation_type_catalog: ['member_of'],
        object_relation_type_catalog: ['derives_to'],
        subject_object_relation_type_catalog: ['owns'],
      },
      relations: {
        ...minimalDraftModel.relations,
        subject_relations: [
          {
            from: 'user:alice',
            to: 'group:ops',
            relation_type: 'derives_to',
          },
        ],
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.path === '/relations/subject_relations/0/relation_type')).toBe(
      true,
    );
  });

  it('accepts split relation catalogs and allows context paths to use subject_object relations', () => {
    const catalogs = { ...minimalDraftModel.catalogs };
    delete catalogs.relation_type_catalog;

    const model = {
      ...minimalDraftModel,
      catalogs: {
        ...catalogs,
        subject_relation_type_catalog: ['member_of', 'belongs_to'],
        object_relation_type_catalog: ['derives_to'],
        subject_object_relation_type_catalog: ['owns'],
      },
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_same_owner_group',
            output_field: 'same_owner_group',
            subject_edges: [
              {
                relation_type: 'member_of',
                entity_side: 'from' as const,
              },
            ],
            object_edges: [
              {
                relation_type: 'owns',
                entity_side: 'to' as const,
              },
            ],
          },
        ],
        constraints: {
          monotonic_only: true,
          stratified_negation: false,
        },
      },
    };

    const result = validateModelConfig(model);
    expect(result.valid).toBe(true);
  });

  it('detects action signature mismatch on policy subject/object/action tuple', () => {
    const model = {
      ...minimalDraftModel,
      action_signature: {
        tuples: [
          {
            subject_types: ['user'],
            object_types: ['agent'],
            actions: ['read'],
          },
        ],
      },
      policies: {
        rules: [
          {
            ...minimalDraftModel.policies.rules[0],
            subject_selector: 'subject.type == user',
            object_selector: 'object.type == kb',
            action_set: ['read'],
          },
        ],
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.code === 'ACTION_SIGNATURE_MISMATCH')).toBe(true);
  });

  it('detects inference rule unsafe when constraints are missing', () => {
    const model = {
      ...minimalDraftModel,
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_same_scope',
            output_field: 'same_scope',
            subject_edges: [
              {
                relation_type: 'member_of',
                entity_side: 'from' as const,
              },
            ],
            object_edges: [
              {
                relation_type: 'belongs_to',
                entity_side: 'to' as const,
              },
            ],
          },
        ],
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.code === 'INFERENCE_RULE_UNSAFE')).toBe(true);
  });

  it('detects decision_search pushdown unsafe config', () => {
    const model = {
      ...minimalDraftModel,
      decision_search: {
        enabled: true,
        pushdown: {
          mode: 'safe' as const,
          require_semantic_equivalence: false,
          allow_conservative_superset: false,
          max_candidates_scan: 1000,
        },
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.code === 'SEARCH_PUSHDOWN_UNSAFE')).toBe(true);
  });

  it('emits semantic drift warning for aggressive pushdown without strict equivalence', () => {
    const model = {
      ...minimalDraftModel,
      decision_search: {
        enabled: true,
        pushdown: {
          mode: 'aggressive' as const,
          require_semantic_equivalence: false,
          allow_conservative_superset: true,
          max_candidates_scan: 1000,
        },
      },
    };

    const result = validateModelConfig(model);
    const issue = result.issues.find((item) => item.code === 'SEARCH_SEMANTIC_DRIFT');
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe('warning');
  });
});
