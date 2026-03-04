import { parseSelector } from '@acl/policy-dsl';
import type {
  AuthzModelConfig,
  DecisionEffect,
  DecisionRecord,
  PolicyRule,
} from '@acl/shared-types';

import type {
  DecisionInput,
  DecisionEvaluationResult,
  DecisionObject,
  DecisionSubject,
  EngineRelationFact,
  EvaluateDecisionRequest,
  RuleTrace,
} from './types';

type ClauseState = 'true' | 'false' | 'indeterminate';

interface RuleEvalResult {
  rule: PolicyRule;
  status: 'matched' | 'not_matched' | 'indeterminate';
  reason: string;
}

type ValidityState = 'active' | 'inactive' | 'indeterminate';

function resolvePath(input: DecisionInput, path: string): unknown {
  const roots: Record<string, unknown> = {
    subject: {
      id: input.subject.id,
      type: input.subject.type,
      state: input.subject.state,
      relations: input.subject.relations ?? [],
      ...(input.subject.attributes ?? {}),
    },
    object: {
      id: input.object.id,
      type: input.object.type,
      sensitivity: input.object.sensitivity,
      relations: input.object.relations ?? [],
      ...(input.object.attributes ?? {}),
    },
    context: input.context ?? {},
  };

  const segments = path.split('.').filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }

  let cursor: unknown = roots;
  for (const segment of segments) {
    if (typeof cursor !== 'object' || cursor === null) {
      return undefined;
    }

    const value = (cursor as Record<string, unknown>)[segment];
    if (value === undefined) {
      return undefined;
    }

    cursor = value;
  }

  return cursor;
}

function compareValue(left: unknown, right: string): ClauseState {
  if (left === undefined || left === null) {
    return 'indeterminate';
  }

  if (typeof left === 'string') {
    return left === right ? 'true' : 'false';
  }

  if (typeof left === 'number' || typeof left === 'boolean') {
    return String(left) === right ? 'true' : 'false';
  }

  return 'indeterminate';
}

function matchRelation(fact: EngineRelationFact, relation: string, args: Record<string, string>): boolean {
  if (fact.relation !== relation) {
    return false;
  }

  const factArgs = fact.args ?? {};
  return Object.entries(args).every(([key, value]) => factArgs[key] === value);
}

function evaluateSelector(selector: string, scope: 'subject_selector' | 'object_selector', input: DecisionInput): ClauseState {
  const parsed = parseSelector(selector, scope);
  if (!parsed.ok || !parsed.ast) {
    return 'indeterminate';
  }

  let hasIndeterminate = false;

  for (const clause of parsed.ast.clauses) {
    if (clause.type === 'comparison') {
      const left = resolvePath(input, clause.left);
      const state = compareValue(left, clause.right);
      if (state === 'false') {
        return 'false';
      }
      if (state === 'indeterminate') {
        hasIndeterminate = true;
      }
      continue;
    }

    const container = resolvePath(input, clause.left);
    if (!Array.isArray(container)) {
      hasIndeterminate = true;
      continue;
    }

    const expectedArgs = Object.fromEntries(clause.args.map((arg) => [arg.key, arg.value]));
    const matched = container.some((item) => {
      if (typeof item !== 'object' || item === null) {
        return false;
      }
      return matchRelation(item as EngineRelationFact, clause.relation, expectedArgs);
    });

    if (!matched) {
      return 'false';
    }
  }

  return hasIndeterminate ? 'indeterminate' : 'true';
}

function evaluateRule(rule: PolicyRule, input: DecisionInput): RuleEvalResult {
  if (!rule.action_set.includes(input.action)) {
    return {
      rule,
      status: 'not_matched',
      reason: 'action_not_applicable',
    };
  }

  const validityState = evaluateRuleValidity(rule, input);
  if (validityState === 'inactive') {
    return {
      rule,
      status: 'not_matched',
      reason: 'rule_not_in_validity_window',
    };
  }
  if (validityState === 'indeterminate') {
    return {
      rule,
      status: 'indeterminate',
      reason: 'validity_indeterminate',
    };
  }

  const subjectState = evaluateSelector(rule.subject_selector, 'subject_selector', input);
  if (subjectState === 'false') {
    return {
      rule,
      status: 'not_matched',
      reason: 'subject_selector_false',
    };
  }

  const objectState = evaluateSelector(rule.object_selector, 'object_selector', input);
  if (objectState === 'false') {
    return {
      rule,
      status: 'not_matched',
      reason: 'object_selector_false',
    };
  }

  let conditionState: ClauseState = 'true';
  if (rule.conditions) {
    conditionState = evaluateSelector(rule.conditions, 'object_selector', input);
    if (conditionState === 'false') {
      return {
        rule,
        status: 'not_matched',
        reason: 'conditions_false',
      };
    }
  }

  if (
    subjectState === 'indeterminate' ||
    objectState === 'indeterminate' ||
    conditionState === 'indeterminate'
  ) {
    return {
      rule,
      status: 'indeterminate',
      reason: 'selector_indeterminate',
    };
  }

  return {
    rule,
    status: 'matched',
    reason: 'rule_matched',
  };
}

function resolveDecisionTimestamp(input: DecisionInput): number {
  const raw = input.context?.request_time;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function evaluateRuleValidity(rule: PolicyRule, input: DecisionInput): ValidityState {
  if (!rule.validity) {
    return 'active';
  }

  const start = Date.parse(rule.validity.start);
  const end = Date.parse(rule.validity.end);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
    return 'indeterminate';
  }

  const now = resolveDecisionTimestamp(input);
  if (now < start || now > end) {
    return 'inactive';
  }

  return 'active';
}

function collectObligations(rules: PolicyRule[]): string[] {
  const obligations = new Set<string>();
  rules.forEach((rule) => {
    (rule.obligations ?? []).forEach((item) => obligations.add(item));
  });
  return Array.from(obligations);
}

function collectAdvice(rules: PolicyRule[]): string[] {
  const advice = new Set<string>();
  rules.forEach((rule) => {
    (rule.advice ?? []).forEach((item) => advice.add(item));
  });
  return Array.from(advice);
}

function toTrace(ruleEvals: RuleEvalResult[]): RuleTrace[] {
  return ruleEvals.map((item) => ({
    rule_id: item.rule.id,
    priority: item.rule.priority,
    effect: item.status === 'matched' ? item.rule.effect : 'unknown',
    status: item.status,
    reason: item.reason,
  }));
}

function sortByPriorityDesc(rules: PolicyRule[]): PolicyRule[] {
  return [...rules].sort((a, b) => b.priority - a.priority);
}

function evaluateByAlgorithm(
  model: AuthzModelConfig,
  ruleEvals: RuleEvalResult[],
): {
  finalEffect: DecisionEffect;
  matchedRules: PolicyRule[];
  overriddenRules: PolicyRule[];
  reason: string;
} {
  const matched = ruleEvals.filter((item) => item.status === 'matched').map((item) => item.rule);
  const indeterminateCount = ruleEvals.filter((item) => item.status === 'indeterminate').length;

  const allows = matched.filter((rule) => rule.effect === 'allow');
  const denies = matched.filter((rule) => rule.effect === 'deny');

  const algorithm = model.model_meta.combining_algorithm;

  if (algorithm === 'deny-overrides') {
    if (denies.length > 0) {
      return {
        finalEffect: 'deny',
        matchedRules: denies,
        overriddenRules: allows,
        reason: 'deny-overrides: deny rule matched',
      };
    }

    if (allows.length > 0) {
      return {
        finalEffect: 'allow',
        matchedRules: allows,
        overriddenRules: [],
        reason: 'deny-overrides: allow rule matched and no deny rule',
      };
    }

    return {
      finalEffect: indeterminateCount > 0 ? 'indeterminate' : 'not_applicable',
      matchedRules: [],
      overriddenRules: [],
      reason:
        indeterminateCount > 0
          ? 'deny-overrides: no matched rule, but selector evaluation indeterminate'
          : 'deny-overrides: no applicable rule',
    };
  }

  if (algorithm === 'permit-overrides') {
    if (allows.length > 0) {
      return {
        finalEffect: 'allow',
        matchedRules: allows,
        overriddenRules: denies,
        reason: 'permit-overrides: allow rule matched',
      };
    }

    if (denies.length > 0) {
      return {
        finalEffect: 'deny',
        matchedRules: denies,
        overriddenRules: [],
        reason: 'permit-overrides: deny rule matched and no allow rule',
      };
    }

    return {
      finalEffect: indeterminateCount > 0 ? 'indeterminate' : 'not_applicable',
      matchedRules: [],
      overriddenRules: [],
      reason:
        indeterminateCount > 0
          ? 'permit-overrides: no matched rule, but selector evaluation indeterminate'
          : 'permit-overrides: no applicable rule',
    };
  }

  if (algorithm === 'first-applicable') {
    for (const item of ruleEvals) {
      if (item.status === 'indeterminate') {
        return {
          finalEffect: 'indeterminate',
          matchedRules: [],
          overriddenRules: [],
          reason: `first-applicable: rule ${item.rule.id} is indeterminate`,
        };
      }
      if (item.status === 'matched') {
        return {
          finalEffect: item.rule.effect,
          matchedRules: [item.rule],
          overriddenRules: [],
          reason: `first-applicable: first matched rule ${item.rule.id}`,
        };
      }
    }

    return {
      finalEffect: 'not_applicable',
      matchedRules: [],
      overriddenRules: [],
      reason: 'first-applicable: no applicable rule',
    };
  }

  const topPriority = matched.length > 0 ? Math.max(...matched.map((rule) => rule.priority)) : undefined;

  if (topPriority !== undefined) {
    const topRules = matched.filter((rule) => rule.priority === topPriority);
    const topDenies = topRules.filter((rule) => rule.effect === 'deny');
    const topAllows = topRules.filter((rule) => rule.effect === 'allow');

    if (topDenies.length > 0) {
      return {
        finalEffect: 'deny',
        matchedRules: sortByPriorityDesc(topDenies),
        overriddenRules: matched.filter((rule) => rule.effect === 'allow'),
        reason: 'ordered-deny-overrides: top priority deny rule matched',
      };
    }

    if (topAllows.length > 0) {
      return {
        finalEffect: 'allow',
        matchedRules: sortByPriorityDesc(topAllows),
        overriddenRules: [],
        reason: 'ordered-deny-overrides: top priority allow rule matched',
      };
    }
  }

  return {
    finalEffect: indeterminateCount > 0 ? 'indeterminate' : 'not_applicable',
    matchedRules: [],
    overriddenRules: [],
    reason:
      indeterminateCount > 0
        ? 'ordered-deny-overrides: no matched rule, but selector evaluation indeterminate'
        : 'ordered-deny-overrides: no applicable rule',
  };
}

function buildDecisionRecord(
  model: AuthzModelConfig,
  input: DecisionInput,
  evaluated: ReturnType<typeof evaluateByAlgorithm>,
): DecisionRecord {
  return {
    request: {
      subject_id: input.subject.id,
      action: input.action,
      object_id: input.object.id,
      context: {
        model_id: model.model_meta.model_id,
        model_version: model.model_meta.version,
        ...(input.context ?? {}),
      },
    },
    matched_rules: evaluated.matchedRules.map((rule) => rule.id),
    overridden_rules: evaluated.overriddenRules.map((rule) => rule.id),
    final_effect: evaluated.finalEffect,
    reason: evaluated.reason,
    obligations: collectObligations(evaluated.matchedRules),
    advice: collectAdvice(evaluated.matchedRules),
    occurred_at: new Date().toISOString(),
  };
}

export function evaluateDecision(request: EvaluateDecisionRequest): DecisionEvaluationResult {
  const ruleEvals = request.model.policies.rules.map((rule) => evaluateRule(rule, request.input));
  const evaluated = evaluateByAlgorithm(request.model, ruleEvals);

  return {
    decision: buildDecisionRecord(request.model, request.input, evaluated),
    traces: toTrace(ruleEvals),
  };
}

export function makeSubject(input: Partial<DecisionSubject> & { id: string }): DecisionSubject {
  return {
    id: input.id,
    type: input.type,
    state: input.state,
    relations: input.relations ?? [],
    attributes: input.attributes ?? {},
  };
}

export function makeObject(input: Partial<DecisionObject> & { id: string }): DecisionObject {
  return {
    id: input.id,
    type: input.type,
    sensitivity: input.sensitivity,
    relations: input.relations ?? [],
    attributes: input.attributes ?? {},
  };
}
