import type { PolicyRule } from '@acl/shared-types';

import type {
  ConstraintEvaluationInput,
  ConstraintEvaluationResult,
  ConstraintViolation,
} from './types';

interface RuleGroup {
  key: string;
  subject_selector: string;
  object_selector: string;
  actions: Set<string>;
  rule_ids: string[];
}

function buildRuleGroups(rules: PolicyRule[]): RuleGroup[] {
  const groups = new Map<string, RuleGroup>();

  for (const rule of rules) {
    if (rule.effect !== 'allow') {
      continue;
    }

    const key = `${rule.subject_selector}|||${rule.object_selector}`;
    const current = groups.get(key) ?? {
      key,
      subject_selector: rule.subject_selector,
      object_selector: rule.object_selector,
      actions: new Set<string>(),
      rule_ids: [],
    };

    rule.action_set.forEach((action) => current.actions.add(action));
    current.rule_ids.push(rule.id);
    groups.set(key, current);
  }

  return Array.from(groups.values());
}

function evaluateSod(input: ConstraintEvaluationInput): ConstraintViolation[] {
  const groups = buildRuleGroups(input.model.policies.rules);
  const violations: ConstraintViolation[] = [];

  input.model.constraints.sod_rules.forEach((rule, ruleIndex) => {
    const forbidden = new Set(rule.forbidden_combination);

    groups.forEach((group) => {
      const allIncluded = Array.from(forbidden).every((action) => group.actions.has(action));
      if (!allIncluded) {
        return;
      }

      violations.push({
        code: 'SOD_VIOLATION',
        message: `sod rule ${rule.id} violated by rule group ${group.key}`,
        path: `/constraints/sod_rules/${ruleIndex}`,
        detail: {
          sod_rule_id: rule.id,
          forbidden_combination: rule.forbidden_combination,
          matched_rule_ids: group.rule_ids,
          subject_selector: group.subject_selector,
          object_selector: group.object_selector,
        },
      });
    });
  });

  return violations;
}

function evaluateCardinality(input: ConstraintEvaluationInput): ConstraintViolation[] {
  const counts = input.cardinality_counts ?? {};
  const violations: ConstraintViolation[] = [];

  input.model.constraints.cardinality_rules.forEach((rule, ruleIndex) => {
    const current = counts[rule.target] ?? 0;
    if (current <= rule.max_count) {
      return;
    }

    violations.push({
      code: 'CARDINALITY_EXCEEDED',
      message: `target ${rule.target} count ${current} exceeds max_count ${rule.max_count}`,
      path: `/constraints/cardinality_rules/${ruleIndex}`,
      detail: {
        target: rule.target,
        current_count: current,
        max_count: rule.max_count,
      },
    });
  });

  return violations;
}

export function evaluateConstraints(input: ConstraintEvaluationInput): ConstraintEvaluationResult {
  const sodViolations = evaluateSod(input);
  const cardinalityViolations = evaluateCardinality(input);

  const violations = [...sodViolations, ...cardinalityViolations];

  return {
    violations,
    summary: {
      sod_violation_count: sodViolations.length,
      cardinality_exceeded_count: cardinalityViolations.length,
    },
  };
}
