import { describe, expect, it } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

import { validateAuthzModel } from '../src/validator';

describe('authz model schema', () => {
  it('accepts minimal draft model', () => {
    const result = validateAuthzModel(minimalDraftModel);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
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
});
