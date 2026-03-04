import { describe, expect, it } from 'vitest';

import type { AuthzModelConfig } from '@acl/shared-types';
import { minimalDraftModel } from '@acl/shared-types';

import { evaluateDecision, makeObject, makeSubject } from '../src/evaluator';

function makeInput() {
  return {
    action: 'read',
    subject: makeSubject({
      id: 'u1',
      type: 'user',
      relations: [{ relation: 'member_of', args: { group: 'g1' } }],
    }),
    object: makeObject({
      id: 'obj1',
      type: 'kb',
      sensitivity: 'normal',
    }),
    context: {},
  };
}

function withRules(model: AuthzModelConfig, rules: AuthzModelConfig['policies']['rules']): AuthzModelConfig {
  return {
    ...model,
    policies: {
      rules,
    },
  };
}

describe('engine evaluateDecision', () => {
  it('returns allow for baseline model', () => {
    const result = evaluateDecision({
      model: minimalDraftModel,
      input: makeInput(),
    });

    expect(result.decision.final_effect).toBe('allow');
    expect(result.decision.matched_rules).toContain('rule_read_kb');
  });

  it('deny-overrides should prefer deny when allow and deny both matched', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = withRules(minimalDraftModel, [
      base,
      {
        ...base,
        id: 'rule_read_kb_deny',
        effect: 'deny',
      },
    ]);

    const result = evaluateDecision({
      model,
      input: makeInput(),
    });

    expect(result.decision.final_effect).toBe('deny');
    expect(result.decision.matched_rules).toContain('rule_read_kb_deny');
    expect(result.decision.overridden_rules).toContain('rule_read_kb');
  });

  it('permit-overrides should prefer allow', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = withRules(
      {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          combining_algorithm: 'permit-overrides',
        },
      },
      [
        {
          ...base,
          id: 'rule_read_kb_deny',
          effect: 'deny',
        },
        base,
      ],
    );

    const result = evaluateDecision({ model, input: makeInput() });
    expect(result.decision.final_effect).toBe('allow');
  });

  it('first-applicable should use first matched rule in order', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = withRules(
      {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          combining_algorithm: 'first-applicable',
        },
      },
      [
        {
          ...base,
          id: 'first_deny',
          effect: 'deny',
        },
        base,
      ],
    );

    const result = evaluateDecision({ model, input: makeInput() });
    expect(result.decision.final_effect).toBe('deny');
    expect(result.decision.matched_rules).toEqual(['first_deny']);
  });

  it('ordered-deny-overrides should choose top priority match first', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = withRules(
      {
        ...minimalDraftModel,
        model_meta: {
          ...minimalDraftModel.model_meta,
          combining_algorithm: 'ordered-deny-overrides',
        },
      },
      [
        {
          ...base,
          id: 'low_priority_deny',
          effect: 'deny',
          priority: 10,
        },
        {
          ...base,
          id: 'high_priority_allow',
          effect: 'allow',
          priority: 100,
        },
      ],
    );

    const result = evaluateDecision({ model, input: makeInput() });
    expect(result.decision.final_effect).toBe('allow');
    expect(result.decision.matched_rules).toEqual(['high_priority_allow']);
  });

  it('returns indeterminate when selector depends on missing attributes', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = withRules(minimalDraftModel, [
      {
        ...base,
        id: 'rule_missing_context',
        object_selector: 'object.owner == alice',
      },
    ]);

    const result = evaluateDecision({ model, input: makeInput() });
    expect(result.decision.final_effect).toBe('indeterminate');
  });

  it('collects obligations from matched rules', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = withRules(minimalDraftModel, [
      {
        ...base,
        obligations: ['audit_write', 'step_up_mfa'],
        advice: ['notify_owner'],
      },
    ]);

    const result = evaluateDecision({ model, input: makeInput() });
    expect(result.decision.obligations).toEqual(['audit_write', 'step_up_mfa']);
    expect(result.decision.advice).toEqual(['notify_owner']);
  });

  it('does not match rule when validity window is expired', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = withRules(minimalDraftModel, [
      {
        ...base,
        validity: {
          start: '2020-01-01T00:00:00.000Z',
          end: '2020-12-31T23:59:59.000Z',
        },
      },
    ]);

    const result = evaluateDecision({ model, input: makeInput() });
    expect(result.decision.final_effect).toBe('not_applicable');
    expect(result.traces[0]?.reason).toBe('rule_not_in_validity_window');
  });

  it('matches rule inside validity window using context.request_time', () => {
    const base = minimalDraftModel.policies.rules[0];
    const model = withRules(minimalDraftModel, [
      {
        ...base,
        validity: {
          start: '2026-01-01T00:00:00.000Z',
          end: '2026-12-31T23:59:59.000Z',
        },
      },
    ]);

    const input = {
      ...makeInput(),
      context: {
        request_time: '2026-03-04T10:00:00.000Z',
      },
    };

    const result = evaluateDecision({ model, input });
    expect(result.decision.final_effect).toBe('allow');
  });
});
