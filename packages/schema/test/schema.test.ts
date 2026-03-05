import { describe, expect, it } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

import { validateAuthzModel } from '../src/validator';

describe('authz model schema', () => {
  it('accepts minimal draft model', () => {
    const result = validateAuthzModel(minimalDraftModel);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts model without top-level relations block', () => {
    const model = { ...minimalDraftModel };
    delete model.relations;

    const result = validateAuthzModel(model);
    expect(result.valid).toBe(true);
  });

  it('rejects published model with empty rules', () => {
    const badModel = {
      ...minimalDraftModel,
      model_meta: {
        ...minimalDraftModel.model_meta,
        status: 'published' as const,
      },
      policies: {
        rules: [],
      },
    };

    const result = validateAuthzModel(badModel);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/policies/rules')).toBe(true);
  });

  it('rejects bounded_staleness without bounded_staleness_ms', () => {
    const badModel = {
      ...minimalDraftModel,
      consistency: {
        default_level: 'bounded_staleness' as const,
        high_risk_level: 'strong' as const,
      },
    };

    const result = validateAuthzModel(badModel);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'required')).toBe(true);
  });

  it('accepts context inference rules in model config', () => {
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
                relation_type: 'member_of',
                entity_side: 'to' as const,
              },
            ],
            object_owner_fallback: false,
          },
        ],
      },
    };

    const result = validateAuthzModel(model);
    expect(result.valid).toBe(true);
  });

  it('accepts owner fallback when include_input is omitted', () => {
    const model = {
      ...minimalDraftModel,
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_owner_fallback_default_include',
            output_field: 'same_owner_scope',
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
            object_owner_fallback: true,
          },
        ],
      },
    };

    const result = validateAuthzModel(model);
    expect(result.valid).toBe(true);
  });

  it('accepts action signature + decision search with inference edges form', () => {
    const model = {
      ...minimalDraftModel,
      action_signature: {
        tuples: [
          {
            subject_types: ['user'],
            object_types: ['kb'],
            actions: ['read'],
          },
        ],
      },
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_same_scope_edges',
            output_field: 'same_scope',
            subject_edges: [
              {
                relation_type: 'member_of',
                entity_side: 'from' as const,
                max_depth: 2,
              },
            ],
            object_edges: [
              {
                relation_type: 'derives_to',
                entity_side: 'to' as const,
              },
            ],
            object_owner_fallback: true,
            owner_fallback_include_input: false,
          },
        ],
        constraints: {
          monotonic_only: true,
          stratified_negation: false,
        },
      },
      decision_search: {
        enabled: true,
        pushdown: {
          mode: 'safe' as const,
          require_semantic_equivalence: false,
          allow_conservative_superset: true,
          max_candidates_scan: 5000,
        },
      },
    };

    const result = validateAuthzModel(model);
    expect(result.valid).toBe(true);
  });

  it('rejects owner_fallback_include_input when object_owner_fallback is false', () => {
    const model = {
      ...minimalDraftModel,
      context_inference: {
        enabled: true,
        rules: [
          {
            id: 'infer_invalid_owner_fallback_combo',
            output_field: 'same_scope',
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
      },
    };

    const result = validateAuthzModel(model);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.instancePath === '/context_inference/rules/0/object_owner_fallback',
      ),
    ).toBe(true);
  });

  it('rejects decision_search.enabled=true without pushdown config', () => {
    const model = {
      ...minimalDraftModel,
      decision_search: {
        enabled: true,
      },
    };

    const result = validateAuthzModel(model);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/decision_search')).toBe(true);
  });

  it('accepts split relation type catalogs without legacy relation_type_catalog', () => {
    const remainingCatalogs = { ...minimalDraftModel.catalogs };
    delete remainingCatalogs.relation_type_catalog;
    const model = {
      ...minimalDraftModel,
      catalogs: {
        ...remainingCatalogs,
        subject_relation_type_catalog: ['member_of', 'belongs_to'],
        object_relation_type_catalog: ['derives_to'],
      },
    };

    const result = validateAuthzModel(model);
    expect(result.valid).toBe(true);
  });

  it('rejects partially configured split relation type catalogs', () => {
    const remainingCatalogs = { ...minimalDraftModel.catalogs };
    delete remainingCatalogs.relation_type_catalog;
    const model = {
      ...minimalDraftModel,
      catalogs: {
        ...remainingCatalogs,
        subject_relation_type_catalog: ['member_of'],
      },
    };

    const result = validateAuthzModel(model);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.instancePath === '/catalogs')).toBe(true);
  });
});
