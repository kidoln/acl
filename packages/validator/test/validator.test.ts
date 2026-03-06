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

  it('rejects deprecated top-level relations block in model', () => {
    const model = {
      ...minimalDraftModel,
      relations: {
        subject_relations: [],
        object_relations: [],
        subject_object_relations: [],
      } as Record<string, unknown>,
    };

    const result = validateModelConfig(model, {
      available_obligation_executors: ['audit_write'],
    });

    expect(result.valid).toBe(false);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'SCHEMA_VALIDATION_FAILED'
          && issue.path === '/'
          && issue.message.includes('additional properties'),
      ),
    ).toBe(true);
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

  it('detects relation signature relation_type configured for wrong relation domain', () => {
    const model = {
      ...minimalDraftModel,
      catalogs: {
        ...minimalDraftModel.catalogs,
        subject_relation_type_catalog: ['member_of'],
        object_relation_type_catalog: ['derives_to'],
        subject_object_relation_type_catalog: ['owns'],
      },
      relation_signature: {
        ...minimalDraftModel.relation_signature,
        subject_relations: [
          {
            relation_type: 'derives_to',
            from_types: ['user'],
            to_types: ['group'],
          },
        ],
      },
    };

    const result = validateModelConfig(model);
    expect(
      result.issues.some(
        (issue) => issue.path === '/relation_signature/subject_relations/0/relation_type',
      ),
    ).toBe(true);
  });

  it('detects relation signature endpoint type mismatch', () => {
    const model = {
      ...minimalDraftModel,
      relation_signature: {
        ...minimalDraftModel.relation_signature,
        subject_relations: [
          {
            relation_type: 'belongs_to',
            from_types: ['external_user'],
            to_types: ['group'],
          },
        ],
      },
      catalogs: {
        ...minimalDraftModel.catalogs,
        subject_type_catalog: ['user', 'group'],
      },
    };

    const result = validateModelConfig(model);
    expect(result.issues.some((issue) => issue.code === 'RELATION_SIGNATURE_MISMATCH')).toBe(true);
  });

  it('accepts relation signature tuples when catalogs and endpoint types match', () => {
    const model = {
      ...minimalDraftModel,
      relation_signature: {
        ...minimalDraftModel.relation_signature,
        subject_relations: [
          {
            relation_type: 'member_of',
            from_types: ['user'],
            to_types: ['group'],
          },
        ],
      },
    };

    const result = validateModelConfig(model, {
      available_obligation_executors: ['audit_write'],
    });
    expect(result.issues.some((issue) => issue.code === 'RELATION_SIGNATURE_MISMATCH')).toBe(false);
  });

  it('accepts split relation catalogs and allows context paths to use subject_object relations', () => {
    const model = {
      ...minimalDraftModel,
      catalogs: {
        ...minimalDraftModel.catalogs,
        subject_relation_type_catalog: ['member_of', 'belongs_to'],
        object_relation_type_catalog: ['derives_to'],
        subject_object_relation_type_catalog: ['owns'],
      },
      relation_signature: {
        subject_relations: [
          {
            relation_type: 'member_of',
            from_types: ['user'],
            to_types: ['group'],
          },
          {
            relation_type: 'belongs_to',
            from_types: ['user'],
            to_types: ['group'],
          },
        ],
        object_relations: [
          {
            relation_type: 'derives_to',
            from_types: ['kb'],
            to_types: ['kb'],
          },
        ],
        subject_object_relations: [
          {
            relation_type: 'owns',
            from_types: ['user'],
            to_types: ['kb'],
          },
        ],
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

  it('accepts owner fallback include_input true/false when object_owner_fallback is true', () => {
    const buildModel = (ownerFallbackIncludeInput: boolean) => ({
      ...minimalDraftModel,
      context_inference: {
        enabled: true,
        rules: [
          {
            id: `infer_same_scope_${ownerFallbackIncludeInput ? 'include' : 'exclude'}`,
            output_field: `same_scope_${ownerFallbackIncludeInput ? 'include' : 'exclude'}`,
            subject_edges: [
              {
                relation_type: 'member_of',
                entity_side: 'from' as const,
              },
            ],
            object_edges: [
              {
                relation_type: 'derives_to',
                entity_side: 'to' as const,
              },
            ],
            object_owner_fallback: true,
            owner_fallback_include_input: ownerFallbackIncludeInput,
          },
        ],
        constraints: {
          monotonic_only: true,
          stratified_negation: false,
        },
      },
    });

    [true, false].forEach((ownerFallbackIncludeInput) => {
      const result = validateModelConfig(buildModel(ownerFallbackIncludeInput));
      expect(result.valid).toBe(true);
      expect(
        result.issues.some(
          (issue) =>
            issue.code === 'INFERENCE_RULE_UNSAFE' &&
            issue.path === '/context_inference/rules/0/owner_fallback_include_input',
        ),
      ).toBe(false);
    });
  });

  it('accepts object_owner_fallback=true when include_input is omitted', () => {
    const model = {
      ...minimalDraftModel,
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_same_scope_owner_default',
            output_field: 'same_scope_owner_default',
            subject_edges: [
              {
                relation_type: 'member_of',
                entity_side: 'from' as const,
              },
            ],
            object_edges: [
              {
                relation_type: 'derives_to',
                entity_side: 'to' as const,
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

    const result = validateModelConfig(model);
    expect(result.valid).toBe(true);
  });

  it('detects owner_fallback_include_input configured when object_owner_fallback is disabled', () => {
    const model = {
      ...minimalDraftModel,
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_invalid_owner_fallback_combo',
            output_field: 'same_scope_invalid_owner_fallback',
            subject_edges: [
              {
                relation_type: 'member_of',
                entity_side: 'from' as const,
              },
            ],
            object_edges: [
              {
                relation_type: 'derives_to',
                entity_side: 'to' as const,
              },
            ],
            object_owner_fallback: false,
            owner_fallback_include_input: true,
          },
        ],
        constraints: {
          monotonic_only: true,
          stratified_negation: false,
        },
      },
    };

    const result = validateModelConfig(model);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'INFERENCE_RULE_UNSAFE' &&
          issue.path === '/context_inference/rules/0/owner_fallback_include_input',
      ),
    ).toBe(true);
  });

  it('detects owner_fallback_include_input configured without object_owner_fallback', () => {
    const model = {
      ...minimalDraftModel,
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_missing_owner_fallback_switch',
            output_field: 'same_scope_missing_owner_fallback_switch',
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
            owner_fallback_include_input: false,
          },
        ],
        constraints: {
          monotonic_only: true,
          stratified_negation: false,
        },
      },
    };

    const result = validateModelConfig(model);
    expect(
      result.issues.some(
        (issue) =>
          issue.code === 'INFERENCE_RULE_UNSAFE' &&
          issue.path === '/context_inference/rules/0/owner_fallback_include_input',
      ),
    ).toBe(true);
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
