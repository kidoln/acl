import { describe, expect, it } from "vitest";

import { escapeHtml, renderConsolePage } from "../src/html";
import type { ConsolePageViewModel } from "../src/types";

describe("console html renderer", () => {
  it("escapes html in user-controlled text", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("renders review action form and decision structured panel", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "workflow",
        publish_id: "pub_1",
        decision_id: "dec_1",
        simulation_id: "sim_1",
        namespace: "tenant_a.crm",
        cell_key: "s1|o1|read",
        flash_type: "success",
        flash_message: "review 成功",
      },
      action_flash: {
        type: "success",
        message: "review 成功",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              publish_id: "pub_1",
              profile: "baseline",
              status: "review_required",
              final_result: "review_required",
              created_at: "2026-03-04T00:00:00.000Z",
              updated_at: "2026-03-04T00:00:00.000Z",
              payload: {},
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      published_publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              publish_id: "pub_1",
              profile: "baseline",
              status: "published",
              final_result: "passed",
              created_at: "2026-03-04T00:00:00.000Z",
              updated_at: "2026-03-04T00:00:00.000Z",
              payload: {},
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      decision_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              decision_id: "dec_1",
              created_at: "2026-03-04T00:00:00.000Z",
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      publish_detail: {
        ok: true,
        status: 200,
        data: {
          publish_id: "pub_1",
          profile: "baseline",
          status: "review_required",
          final_result: "review_required",
          created_at: "2026-03-04T00:00:00.000Z",
          updated_at: "2026-03-04T00:00:00.000Z",
          payload: {
            test: true,
          },
        },
      },
      decision_detail: {
        ok: true,
        status: 200,
        data: {
          decision_id: "dec_1",
          created_at: "2026-03-04T00:00:00.000Z",
          payload: {
            final_effect: "allow",
            reason: "matched allow rule",
            matched_rules: ["rule_a"],
            overridden_rules: ["rule_b"],
            obligations: ["audit_write"],
            advice: ["notify_owner"],
          },
          traces: [],
        },
      },
      simulation_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              report_id: "sim_1",
              publish_id: "pub_1",
              profile: "baseline",
              generated_at: "2026-03-04T00:00:00.000Z",
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      simulation_detail: {
        ok: true,
        status: 200,
        data: {
          report_id: "sim_1",
          generated_at: "2026-03-04T00:00:00.000Z",
          publish_id: "pub_1",
          profile: "baseline",
          summary: {
            delta_allow_subject_count: 1,
            delta_deny_subject_count: 0,
            delta_high_sensitivity_object_count: 0,
            new_conflict_rule_count: 0,
            new_sod_violation_count: 0,
            indeterminate_rate_estimation: 0,
            mandatory_obligations_pass_rate: 1,
            publish_recommendation: "通过",
          },
          top_impacted_subjects: [],
          top_impacted_objects: [],
          action_change_matrix: [
            {
              action: "read",
              changed_count: 1,
            },
          ],
          matrix_cells: [
            {
              cell_key: "s1|o1|read",
              subject_id: "s1",
              object_id: "o1",
              action: "read",
              baseline_effect: "not_applicable",
              draft_effect: "allow",
            },
          ],
        },
      },
      control_objects: {
        ok: true,
        status: 200,
        data: {
          namespace: "tenant_a.crm",
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      control_relations: {
        ok: true,
        status: 200,
        data: {
          namespace: "tenant_a.crm",
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      control_audits: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain("ACL 治理控制台");
    expect(html).toContain(
      '<link rel="stylesheet" href="/assets/global.css" />',
    );
    expect(html).not.toContain("<style>");
    expect(html).toContain("发布请求");
    expect(html).toContain("决策回放");
    expect(html).toContain("/actions/review");
    expect(html).toContain("你现在该怎么走");
    expect(html).toContain("去做风险评估");
    expect(html).toContain("最终效果");
    expect(html).toContain("review 成功");
    expect(html).toContain("system-notice system-notice-success");
    expect(html).toContain("系统通知 · 操作成功");
    expect(html).toContain('data-system-notice-close="true"');
    expect(html).toContain("tab-link active");
    expect(html).toContain("data-json-toggle");
    expect(html).toContain("data-json-switchable");
    expect(html).toContain(
      '<script src="/assets/dashboard-tabs.js" defer></script>',
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
  });

  it("renders activate action for approved publish request", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        publish_id: "pub_2",
        namespace: "tenant_a.crm",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      publish_detail: {
        ok: true,
        status: 200,
        data: {
          publish_id: "pub_2",
          profile: "baseline",
          status: "approved",
          final_result: "passed",
          created_at: "2026-03-04T00:00:00.000Z",
          updated_at: "2026-03-04T00:00:00.000Z",
          payload: {},
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain("/actions/activate");
    expect(html).toContain("执行激活");
    expect(html).toContain("去做风险评估");
  });

  it("keeps publish row navigation in workflow tab", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "simulation",
        publish_id: "pub_old",
        simulation_id: "sim_1",
        namespace: "tenant_a.crm",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              publish_id: "pub_target",
              profile: "baseline",
              status: "approved",
              final_result: "passed",
              created_at: "2026-03-04T00:00:00.000Z",
              updated_at: "2026-03-04T00:00:00.000Z",
              payload: {},
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain(
      '/?limit=20&offset=0&namespace=tenant_a.crm&tab=workflow&publish_id=pub_target',
    );
  });

  it("renders simulation tab and widget mode", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "simulation",
        widget: "simulation",
        publish_id: "pub_1",
        simulation_id: "sim_1",
        namespace: "tenant_a.crm",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      published_publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              publish_id: "pub_1",
              profile: "baseline",
              status: "published",
              final_result: "passed",
              created_at: "2026-03-04T00:00:00.000Z",
              updated_at: "2026-03-04T00:00:00.000Z",
              payload: {},
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      simulation_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              report_id: "sim_1",
              publish_id: "pub_1",
              profile: "baseline",
              generated_at: "2026-03-04T00:00:00.000Z",
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      simulation_detail: {
        ok: true,
        status: 200,
        data: {
          report_id: "sim_1",
          generated_at: "2026-03-04T00:00:00.000Z",
          publish_id: "pub_1",
          profile: "baseline",
          summary: {
            delta_allow_subject_count: 1,
            delta_deny_subject_count: 0,
            delta_high_sensitivity_object_count: 0,
            new_conflict_rule_count: 0,
            new_sod_violation_count: 0,
            indeterminate_rate_estimation: 0,
            mandatory_obligations_pass_rate: 1,
            publish_recommendation: "通过",
          },
          top_impacted_subjects: [],
          top_impacted_objects: [],
          action_change_matrix: [],
          matrix_cells: [],
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain("ACL 嵌入视图");
    expect(html).toContain("Embeddable Widget");
    expect(html).toContain("影响面模拟视图");
    expect(html).toContain("从已发布列表选择发布单");
    expect(html).toContain('<select name="publish_id"');
    expect(html).toContain('/actions/simulation/generate');
    expect(html).toContain('生成模拟报告');
    expect(html).toContain('默认优先对比同模型上一条已发布版本');
    expect(html).toContain("widget=simulation");
    expect(html).toContain("data-json-toggle");
    expect(html).not.toContain('role="tablist" aria-label="ACL 控制台一级标签"');
    expect(html).toContain("/assets/dashboard-tabs.js");
  });

  it("renders decision detail widget with replay-focused query card", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        widget: "decision_detail",
        tab: "relations",
        decision_id: "dec_9",
        publish_id: "pub_9",
        simulation_id: "sim_9",
        namespace: "tenant_a.crm",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      decision_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              decision_id: "dec_9",
              created_at: "2026-03-04T00:00:00.000Z",
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      decision_detail: {
        ok: true,
        status: 200,
        data: {
          decision_id: "dec_9",
          created_at: "2026-03-04T00:00:00.000Z",
          payload: {
            final_effect: "allow",
          },
          traces: [],
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain("从决策列表查看回放");
    expect(html).toContain('<select name="decision_id"');
    expect(html).toContain('name="namespace" value="tenant_a.crm"');
    expect(html).not.toContain('type="hidden" name="publish_id"');
    expect(html).not.toContain('type="hidden" name="simulation_id"');
  });

  it("renders per-card visual and raw json blocks for publish and decision detail", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "workflow",
        detail_mode: "raw",
        publish_id: "pub_raw",
        decision_id: "dec_raw",
        namespace: "tenant_a.crm",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      publish_detail: {
        ok: true,
        status: 200,
        data: {
          publish_id: "pub_raw",
          profile: "baseline",
          status: "review_required",
          final_result: "review_required",
          created_at: "2026-03-04T00:00:00.000Z",
          updated_at: "2026-03-04T00:00:00.000Z",
          payload: {
            gate_result: {
              gates: [],
            },
          },
        },
      },
      decision_detail: {
        ok: true,
        status: 200,
        data: {
          decision_id: "dec_raw",
          created_at: "2026-03-04T00:00:00.000Z",
          payload: {
            final_effect: "deny",
          },
          traces: [],
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain('data-json-view="visual"');
    expect(html).toContain('data-json-view="raw" hidden');
    expect(html).toContain('class="raw-json-panel"');
    expect(html).toContain("&quot;decision_id&quot;: &quot;dec_raw&quot;");
    expect(html).toContain("最终效果");
  });

  it("renders control tab actions", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "control",
        namespace: "tenant_a.crm",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              publish_id: "pub_control_1",
              profile: "baseline",
              status: "published",
              final_result: "passed",
              created_at: "2026-03-04T00:00:00.000Z",
              updated_at: "2026-03-04T00:00:00.000Z",
              payload: {
                model_snapshot: {
                  model_meta: {
                    model_id: "tenant_a_authz_v1",
                    version: "2026.03.04",
                  },
                  catalogs: {
                    action_catalog: ["read", "update"],
                    subject_type_catalog: ["user", "group"],
                    object_type_catalog: ["kb"],
                    relation_type_catalog: ["member_of"],
                  },
                  policies: {
                    rules: [{ id: "rule_1" }],
                  },
                },
              },
            },
          ],
          total_count: 1,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      control_objects: {
        ok: true,
        status: 200,
        data: {
          namespace: "tenant_a.crm",
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      control_relations: {
        ok: true,
        status: 200,
        data: {
          namespace: "tenant_a.crm",
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      control_audits: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain("控制面总览");
    expect(html).toContain("控制面怎么用");
    expect(html).toContain("1. 提交模型并发起发布");
    expect(html).toContain("2. 维护运行态对象与关系");
    expect(html).toContain("/actions/publish/submit");
    expect(html).toContain('data-model-jsoneditor-form="true"');
    expect(html).not.toContain("/actions/control/catalog/register");
    expect(html).toContain("/actions/control/object/upsert");
    expect(html).toContain("/actions/control/relation/event");
    expect(html).toContain("/actions/control/setup/apply");
    expect(html).toContain('name="fixture_id"');
    expect(html).toContain("样例1：同公司派生关系 setup");
    const fixtureIndex = html.indexOf("预置场景批量导入");
    const advancedOpsIndex = html.indexOf("高级运维（可选）");
    expect(fixtureIndex).toBeGreaterThanOrEqual(0);
    expect(advancedOpsIndex).toBeGreaterThanOrEqual(0);
    expect(fixtureIndex).toBeLessThan(advancedOpsIndex);
    expect(html).toContain("data-model-editor");
    expect(html).toContain("data-model-template-select");
    expect(html).toContain("样例2：虚拟团队 + 部门可见");
    expect(html).toContain("样例3：Model/Instance 混合判权");
    expect(html).toContain("data-json-toggle");
    expect(html).toContain('data-mode="graph"');
    expect(html).toContain("data-model-graph");
    expect(html).toContain("从 JSON 刷新字段");
    expect(html).toContain("发布快照统计");
    expect(html).toContain("统计来源：publish_id=pub_control_1");
    expect(html).toContain("<span>subject types</span><strong>2</strong>");
    expect(html).toContain("<span>policy rules</span><strong>1</strong>");
    expect(html).toContain("高级运维（可选）");
    expect(html).toContain("不会反向修改上方策略模型 JSON");
    expect(html).toContain("Expectation 决策演练 / 回放");
    expect(html).toContain("/actions/control/expectations/run");
    expect(html).toContain('data-expectation-preview-form="true"');
    expect(html).toContain('data-expectation-run-card');
    expect(html).toContain('data-expectation-run-section');
    expect(html).toContain("样例1：同公司派生关系 expectation");
    expect(html).toContain("Expectation JSON");
    expect(html).toContain(
      'id="tab-panel-control" role="tabpanel" aria-hidden="false"',
    );
    expect(html).toContain(
      'id="tab-panel-components" role="tabpanel" aria-hidden="true"',
    );
    expect(html).toContain("<span>subjects</span>");
    expect(html).toContain("<span>categories(action)</span>");
    expect(html).not.toContain("<span>audits</span>");
    // Policy Rules 列表渲染
    expect(html).toContain("Policy Rules 列表");
    expect(html).toContain("policy-rules-table");
    expect(html).toContain("规则编辑器");
  });

  it("keeps namespace switch focused on control context", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "control",
        namespace: "tenant_a.crm",
        publish_id: "pub_leak",
        decision_id: "dec_leak",
        simulation_id: "sim_leak",
        fixture_id: "01-same-company-derived",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    const formStart = html.indexOf('data-control-namespace-form="true"');
    const formEnd = html.indexOf("</form>", formStart);
    const namespaceForm =
      formStart >= 0 && formEnd > formStart
        ? html.slice(formStart, formEnd)
        : "";

    expect(html).toContain('data-control-namespace-form="true"');
    expect(namespaceForm).toContain('type="hidden" name="tab" value="control"');
    expect(namespaceForm).toContain('type="hidden" name="fixture_id" value="01-same-company-derived"');
    expect(namespaceForm).not.toContain('type="hidden" name="publish_id" value="pub_leak"');
    expect(namespaceForm).not.toContain('type="hidden" name="decision_id" value="dec_leak"');
    expect(namespaceForm).not.toContain('type="hidden" name="simulation_id" value="sim_leak"');
  });

  it("scopes tab navigation links by target tab", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "control",
        namespace: "tenant_a.crm",
        publish_id: "pub_nav",
        decision_id: "dec_nav",
        simulation_id: "sim_nav",
        fixture_id: "01-same-company-derived",
        expectation_run_id: "exp_nav",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain('href="/?limit=20&offset=0&publish_id=pub_nav&namespace=tenant_a.crm&tab=workflow"');
    expect(html).toContain('href="/?publish_id=pub_nav&simulation_id=sim_nav&namespace=tenant_a.crm&tab=simulation"');
    expect(html).toContain('href="/?decision_id=dec_nav&namespace=tenant_a.crm&tab=relations"');
    expect(html).toContain('href="/?fixture_id=01-same-company-derived&expectation_run_id=exp_nav&namespace=tenant_a.crm&tab=control"');
  });

  it("scopes component embed links by widget", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "components",
        namespace: "tenant_a.crm",
        publish_id: "pub_embed",
        decision_id: "dec_embed",
        simulation_id: "sim_embed",
        fixture_id: "01-same-company-derived",
        expectation_run_id: "exp_embed",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain('/?publish_id=pub_embed&namespace=tenant_a.crm&widget=publish_detail');
    expect(html).toContain('/?decision_id=dec_embed&namespace=tenant_a.crm&widget=decision_detail');
    expect(html).toContain('/?publish_id=pub_embed&simulation_id=sim_embed&namespace=tenant_a.crm&widget=simulation');
    expect(html).toContain('/?fixture_id=01-same-company-derived&expectation_run_id=exp_embed&namespace=tenant_a.crm&widget=control');
  });

  it("renders control hero badges without replay or simulation leakage", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "control",
        namespace: "tenant_a.crm",
        decision_id: "dec_hidden",
        simulation_id: "sim_hidden",
        fixture_id: "01-same-company-derived",
        expectation_run_id: "exp_demo",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    const heroEnd = html.indexOf("</section>");
    const hero = heroEnd > 0 ? html.slice(0, heroEnd) : html;
    expect(hero).toContain("tab: 控制面维护");
    expect(hero).toContain("namespace: tenant_a.crm");
    expect(hero).toContain("fixture: 01-same-company-derived");
    expect(hero).toContain("expectation: exp_demo");
    expect(hero).not.toContain("已输入 decision_id");
    expect(hero).not.toContain("已锁定 simulation_id");
    expect(hero).not.toContain("decision: dec_hidden");
    expect(hero).not.toContain("simulation: sim_hidden");
  });

  it("renders relations hero badges with decision-focused context", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "relations",
        namespace: "tenant_a.crm",
        decision_id: "dec_focus",
        publish_id: "pub_hidden",
        simulation_id: "sim_hidden",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    const heroEnd = html.indexOf("</section>");
    const hero = heroEnd > 0 ? html.slice(0, heroEnd) : html;
    expect(hero).toContain("tab: 关系回放");
    expect(hero).toContain("decision: dec_focus");
    expect(hero).toContain("namespace: tenant_a.crm");
    expect(hero).not.toContain("publish: pub_hidden");
    expect(hero).not.toContain("simulation: sim_hidden");
  });

  it("renders expectation run report with replay links", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-07T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "control",
        namespace: "tenant_acme.kb.same_company.demo",
        fixture_id: "01-same-company-derived",
        expectation_run_id: "exp_demo_1",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      control_objects: {
        ok: true,
        status: 200,
        data: {
          namespace: "tenant_acme.kb.same_company.demo",
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      control_relations: {
        ok: true,
        status: 200,
        data: {
          namespace: "tenant_acme.kb.same_company.demo",
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      control_audits: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
      expectation_run: {
        run_id: "exp_demo_1",
        fixture_id: "01-same-company-derived",
        namespace: "tenant_acme.kb.same_company.demo",
        tenant_id: "tenant_acme",
        environment: "prod",
        generated_at: "2026-03-07T00:00:00.000Z",
        summary: {
          total_count: 2,
          passed_count: 1,
          failed_count: 1,
          skipped_count: 0,
        },
        source: {
          expectation_file_name: "01-same-company-derived.expected.json",
          setup_source: "fixture",
          model_source: "route",
        },
        cases: [
          {
            name: "case_allow",
            mode: "model_route",
            status: "passed",
            expected_effect: "allow",
            actual_effect: "allow",
            decision_id: "dec_expect_1",
            reason: "matched allow rule",
            matched_rules: ["rule_1"],
            trace_matched_rules: ["rule_1"],
            relation_inference: {
              enabled: true,
              applied: true,
            },
            assertion_errors: [],
          },
          {
            name: "case_deny",
            mode: "model_route",
            status: "failed",
            expected_effect: "deny",
            actual_effect: "allow",
            reason: "unexpected allow",
            assertion_errors: ["final_effect mismatch"],
          },
        ],
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain("Expectation 演练结果");
    expect(html).toContain('data-expectation-run-section');
    expect(html).toContain("run_id=exp_demo_1");
    expect(html).toContain("dec_expect_1");
    expect(html).toContain("tab=relations");
    expect(html).toContain("expectation_run_id=exp_demo_1");
    expect(html).toContain("final_effect mismatch");
  });

  it("renders component index tab with embed widget table", () => {
    const model: ConsolePageViewModel = {
      api_base_url: "http://127.0.0.1:3010",
      generated_at: "2026-03-04T00:00:00.000Z",
      query: {
        limit: 20,
        offset: 0,
        tab: "components",
        namespace: "tenant_a.crm",
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [],
          total_count: 0,
          has_more: false,
          limit: 20,
          offset: 0,
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain(
      'id="tab-panel-components" role="tabpanel" aria-hidden="false"',
    );
    expect(html).toContain(
      'id="tab-panel-control" role="tabpanel" aria-hidden="true"',
    );
    expect(html).toContain("Widget ID");
    expect(html).toContain("publish_list");
    expect(html).toContain("widget=publish_list");
    expect(html).toContain(
      "该页面用于查看可嵌入组件与对应链接，不属于控制面运行态数据。",
    );
  });
});
