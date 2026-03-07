import { describe, expect, it, vi } from "vitest";

import type { AclApiClient } from "../src/acl-api-client";
import {
  runExpectationSimulation,
  type AppliedExpectationExecutionPlan,
} from "../src/expectation-runner";

const executionPlan: AppliedExpectationExecutionPlan = {
  fixture_id: "01-same-company-derived",
  tenant_id: "tenant_acme",
  environment: "prod",
  decision_inputs: [
    {
      name: "same_company_can_read_source_object",
      input: {
        action: "read",
        subject: {
          id: "user:bob",
          type: "user",
        },
        object: {
          id: "kb:wiki_core",
          type: "kb",
          sensitivity: "normal",
          attributes: {
            is_derived: false,
          },
        },
      },
    },
  ],
};

const expectationJson = JSON.stringify({
  decision_expectations: [
    {
      name: "same_company_can_read_source_object",
      mode: "model_route",
      expected_effect: "allow",
      expected_any_rule_matched: true,
      expected_rules: {
        infer_same_company_direct: {
          matched: true,
          subject_values_contains: ["company:acme"],
          object_values_contains: ["company:acme"],
          object_owner_ref: "user:alice",
        },
      },
      expected_matched_rules_contains: [],
      expected_trace_matched_rules_contains: [],
      expected_relation_inference: {
        enabled: null,
        applied: true,
        reason: null,
      },
      expected_context_values: {},
    },
  ],
});

describe("expectation runner", () => {
  it("calls decision evaluate directly without route precheck", async () => {
    const client = {
      evaluateDecision: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          decision_id: "dec_001",
          decision: {
            final_effect: "allow",
            reason: "matched",
            matched_rules: ["infer_same_company_direct"],
          },
          traces: [
            {
              rule_id: "infer_same_company_direct",
              status: "matched",
            },
          ],
          relation_inference: {
            enabled: true,
            applied: true,
            reason: null,
            rules: [
              {
                id: "infer_same_company_direct",
                matched: true,
                subject_values: ["company:acme"],
                object_values: ["company:acme"],
                object_owner_ref: "user:alice",
              },
            ],
          },
        },
      }),
    };

    const result = await runExpectationSimulation({
      client: client as unknown as AclApiClient,
      namespace: "tenant_a.crm",
      execution_plan: executionPlan,
      expectation_json: expectationJson,
      expectation_file_name: "01-same-company-derived.expected.json",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.report.fixture_id).toBe("01-same-company-derived");
    expect(result.report.summary.passed_count).toBe(1);
    expect(client.evaluateDecision).toHaveBeenCalledTimes(1);
  });

  it("rewrites routed evaluation errors into operator-friendly guidance", async () => {
    const client = {
      evaluateDecision: vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        error: "model route not found or mapped published model is unavailable",
      }),
    };

    const result = await runExpectationSimulation({
      client: client as unknown as AclApiClient,
      namespace: "tenant_a.crm",
      execution_plan: executionPlan,
      expectation_json: expectationJson,
      expectation_file_name: "01-same-company-derived.expected.json",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.report.summary.failed_count).toBe(1);
    expect(result.report.cases[0]?.reason).toContain("model route 不可用");
    expect(result.report.cases[0]?.assertion_errors[0]).toContain("绑定到可用的已发布模型");
  });
});
