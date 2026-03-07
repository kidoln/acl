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
  it("returns actionable guidance when route is missing before evaluation", async () => {
    const client = {
      listModelRoutes: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 1,
          offset: 0,
        },
      }),
      evaluateDecision: vi.fn(),
    };

    const result = await runExpectationSimulation({
      client: client as unknown as AclApiClient,
      namespace: "tenant_a.crm",
      execution_plan: executionPlan,
      expectation_json: expectationJson,
      expectation_file_name: "01-same-company-derived.expected.json",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toContain("批量 Setup 只会写入对象与关系，不会自动绑定 route");
    expect(result.error).toContain("Model Route Upsert");
    expect(client.evaluateDecision).not.toHaveBeenCalled();
  });

  it("rewrites routed evaluation errors into operator-friendly guidance", async () => {
    const client = {
      listModelRoutes: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        data: {
          items: [
            {
              key: "tenant_a.crm::tenant_acme::prod",
              namespace: "tenant_a.crm",
              tenant_id: "tenant_acme",
              environment: "prod",
              model_id: "tenant_acme_same_company_visibility",
              model_version: "2026.03.05",
              operator: "console_operator",
              updated_at: "2026-03-07T00:00:00.000Z",
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 1,
          offset: 0,
        },
      }),
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
