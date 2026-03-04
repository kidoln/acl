import { describe, expect, it } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

import { evaluateConstraints } from '../src/evaluator';

describe('constraints evaluator', () => {
  it('returns no violations for baseline model', () => {
    const result = evaluateConstraints({
      model: minimalDraftModel,
    });

    expect(result.violations).toHaveLength(0);
  });

  it('detects SOD violation when forbidden action combination can be granted together', () => {
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

    const result = evaluateConstraints({ model });
    expect(result.summary.sod_violation_count).toBe(1);
    expect(result.violations[0]?.code).toBe('SOD_VIOLATION');
  });

  it('detects cardinality exceeded', () => {
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

    const result = evaluateConstraints({
      model,
      cardinality_counts: {
        tenant_root: 3,
      },
    });

    expect(result.summary.cardinality_exceeded_count).toBe(1);
    expect(result.violations[0]?.code).toBe('CARDINALITY_EXCEEDED');
  });
});
