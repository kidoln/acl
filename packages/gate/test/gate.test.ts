import { describe, expect, it } from 'vitest';

import { minimalDraftModel } from '@acl/shared-types';

import { runPublishGate } from '../src/gate';

describe('publish gate', () => {
  it('passes baseline profile for minimal valid model', () => {
    const result = runPublishGate({
      model: minimalDraftModel,
      profile: 'baseline',
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('passed');
    expect(result.gates).toHaveLength(0);
  });

  it('blocks on P0 when schema validation fails', () => {
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

    const result = runPublishGate({
      model: badModel,
      profile: 'baseline',
    });

    expect(result.final_result).toBe('blocked');
    expect(result.gates.some((gate) => gate.level === 'P0')).toBe(true);
  });

  it('requires review on P2 in baseline profile', () => {
    const result = runPublishGate({
      model: minimalDraftModel,
      profile: 'baseline',
      metrics_override: {
        simulation: {
          indeterminate_rate: 0.03,
        },
      },
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('review_required');
    expect(result.review_required).toBe(true);
    expect(result.gates.some((gate) => gate.rule_id === 'p2_indeterminate_rate')).toBe(true);
  });

  it('creates governance tickets for P3 warnings', () => {
    const result = runPublishGate({
      model: minimalDraftModel,
      profile: 'baseline',
      metrics_override: {
        quality: {
          unreachable_rule_ratio: 0.2,
          priority_collision_ratio: 0.2,
        },
      },
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('passed_with_ticket');
    expect(result.tickets.length).toBeGreaterThan(0);
  });

  it('strict profile blocks when mandatory obligation is missing', () => {
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

    const result = runPublishGate({
      model: badModel,
      profile: 'strict_compliance',
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('blocked');
    expect(result.gates.some((gate) => gate.code === 'MANDATORY_OBLIGATION_MISSING')).toBe(true);
  });

  it('baseline blocks when SOD violation is detected', () => {
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

    const result = runPublishGate({
      model,
      profile: 'baseline',
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('blocked');
    expect(result.gates.some((gate) => gate.code === 'SOD_VIOLATION')).toBe(true);
  });

  it('strict profile blocks when cardinality exceeded', () => {
    const model = {
      ...minimalDraftModel,
      constraints: {
        ...minimalDraftModel.constraints,
        cardinality_rules: [
          {
            target: 'tenant_root',
            max_count: 1,
          },
        ],
      },
    };

    const result = runPublishGate({
      model,
      profile: 'strict_compliance',
      validator_options: {
        available_obligation_executors: ['audit_write'],
        cardinality_counts: {
          tenant_root: 2,
        },
      },
    });

    expect(result.final_result).toBe('blocked');
    expect(result.gates.some((gate) => gate.code === 'CARDINALITY_EXCEEDED')).toBe(true);
  });

  it('baseline profile requires review when lifecycle takeover backlog is high', () => {
    const result = runPublishGate({
      model: minimalDraftModel,
      profile: 'baseline',
      metrics_override: {
        lifecycle: {
          takeover_queue_backlog_count: 12,
          takeover_queue_max_pending_hours: 12,
        },
      },
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('review_required');
    expect(result.gates.some((gate) => gate.rule_id === 'p2_lifecycle_takeover_backlog')).toBe(true);
  });

  it('strict profile requires review when lifecycle takeover backlog is non-zero', () => {
    const result = runPublishGate({
      model: minimalDraftModel,
      profile: 'strict_compliance',
      metrics_override: {
        lifecycle: {
          takeover_queue_backlog_count: 1,
          takeover_queue_max_pending_hours: 1,
        },
      },
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('review_required');
    expect(result.gates.some((gate) => gate.rule_id === 'p1_lifecycle_takeover_backlog')).toBe(true);
  });

  it('blocks when duplicate rule id exists', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = {
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

    const result = runPublishGate({
      model,
      profile: 'baseline',
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('blocked');
    expect(result.gates.some((gate) => gate.code === 'DUPLICATE_RULE_ID')).toBe(true);
  });

  it('blocks when selector type mismatch exists', () => {
    const model = {
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

    const result = runPublishGate({
      model,
      profile: 'baseline',
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('blocked');
    expect(result.gates.some((gate) => gate.code === 'SELECTOR_TYPE_MISMATCH')).toBe(true);
  });

  it('strict profile blocks when compat_strict misses conditional required rules', () => {
    const model = {
      ...minimalDraftModel,
      object_onboarding: {
        ...minimalDraftModel.object_onboarding,
        compatibility_mode: 'compat_strict' as const,
        conditional_required: [],
      },
    };

    const result = runPublishGate({
      model,
      profile: 'strict_compliance',
      validator_options: {
        available_obligation_executors: ['audit_write'],
      },
    });

    expect(result.final_result).toBe('blocked');
    expect(result.gates.some((gate) => gate.code === 'OBJECT_PROFILE_REQUIRED_MISSING')).toBe(true);
  });
});
