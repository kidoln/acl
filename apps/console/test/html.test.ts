import { describe, expect, it } from 'vitest';

import { escapeHtml, renderConsolePage } from '../src/html';
import type { ConsolePageViewModel } from '../src/types';

describe('console html renderer', () => {
  it('escapes html in user-controlled text', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('renders review action form and decision structured panel', () => {
    const model: ConsolePageViewModel = {
      api_base_url: 'http://127.0.0.1:3010',
      generated_at: '2026-03-04T00:00:00.000Z',
      query: {
        limit: 20,
        offset: 0,
        tab: 'workflow',
        publish_id: 'pub_1',
        decision_id: 'dec_1',
        simulation_id: 'sim_1',
        namespace: 'tenant_a.crm',
        cell_key: 's1|o1|read',
        flash_type: 'success',
        flash_message: 'review 成功',
      },
      action_flash: {
        type: 'success',
        message: 'review 成功',
      },
      publish_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              publish_id: 'pub_1',
              profile: 'baseline',
              status: 'review_required',
              final_result: 'review_required',
              created_at: '2026-03-04T00:00:00.000Z',
              updated_at: '2026-03-04T00:00:00.000Z',
              payload: {},
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
          publish_id: 'pub_1',
          profile: 'baseline',
          status: 'review_required',
          final_result: 'review_required',
          created_at: '2026-03-04T00:00:00.000Z',
          updated_at: '2026-03-04T00:00:00.000Z',
          payload: {
            test: true,
          },
        },
      },
      decision_detail: {
        ok: true,
        status: 200,
        data: {
          decision_id: 'dec_1',
          created_at: '2026-03-04T00:00:00.000Z',
          payload: {
            final_effect: 'allow',
            reason: 'matched allow rule',
            matched_rules: ['rule_a'],
            overridden_rules: ['rule_b'],
            obligations: ['audit_write'],
            advice: ['notify_owner'],
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
              report_id: 'sim_1',
              publish_id: 'pub_1',
              profile: 'baseline',
              generated_at: '2026-03-04T00:00:00.000Z',
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
          report_id: 'sim_1',
          generated_at: '2026-03-04T00:00:00.000Z',
          publish_id: 'pub_1',
          profile: 'baseline',
          summary: {
            delta_allow_subject_count: 1,
            delta_deny_subject_count: 0,
            delta_high_sensitivity_object_count: 0,
            new_conflict_rule_count: 0,
            new_sod_violation_count: 0,
            indeterminate_rate_estimation: 0,
            mandatory_obligations_pass_rate: 1,
            publish_recommendation: '通过',
          },
          top_impacted_subjects: [],
          top_impacted_objects: [],
          action_change_matrix: [
            {
              action: 'read',
              changed_count: 1,
            },
          ],
          matrix_cells: [
            {
              cell_key: 's1|o1|read',
              subject_id: 's1',
              object_id: 'o1',
              action: 'read',
              baseline_effect: 'not_applicable',
              draft_effect: 'allow',
            },
          ],
        },
      },
      control_catalogs: {
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
          namespace: 'tenant_a.crm',
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
          namespace: 'tenant_a.crm',
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
    expect(html).toContain('ACL 治理控制台');
    expect(html).toContain('<link rel="stylesheet" href="/assets/global.css" />');
    expect(html).not.toContain('<style>');
    expect(html).toContain('发布请求列表');
    expect(html).toContain('决策回放');
    expect(html).toContain('/actions/review');
    expect(html).toContain('最终效果');
    expect(html).toContain('review 成功');
    expect(html).toContain('tab-link active');
    expect(html).toContain('<script src="/assets/dashboard-tabs.js" defer></script>');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
  });

  it('renders activate action for approved publish request', () => {
    const model: ConsolePageViewModel = {
      api_base_url: 'http://127.0.0.1:3010',
      generated_at: '2026-03-04T00:00:00.000Z',
      query: {
        limit: 20,
        offset: 0,
        publish_id: 'pub_2',
        namespace: 'tenant_a.crm',
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
          publish_id: 'pub_2',
          profile: 'baseline',
          status: 'approved',
          final_result: 'passed',
          created_at: '2026-03-04T00:00:00.000Z',
          updated_at: '2026-03-04T00:00:00.000Z',
          payload: {},
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain('/actions/activate');
    expect(html).toContain('执行激活');
  });

  it('renders simulation tab and widget mode', () => {
    const model: ConsolePageViewModel = {
      api_base_url: 'http://127.0.0.1:3010',
      generated_at: '2026-03-04T00:00:00.000Z',
      query: {
        limit: 20,
        offset: 0,
        tab: 'simulation',
        widget: 'simulation',
        publish_id: 'pub_1',
        simulation_id: 'sim_1',
        namespace: 'tenant_a.crm',
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
      simulation_list: {
        ok: true,
        status: 200,
        data: {
          items: [
            {
              report_id: 'sim_1',
              publish_id: 'pub_1',
              profile: 'baseline',
              generated_at: '2026-03-04T00:00:00.000Z',
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
          report_id: 'sim_1',
          generated_at: '2026-03-04T00:00:00.000Z',
          publish_id: 'pub_1',
          profile: 'baseline',
          summary: {
            delta_allow_subject_count: 1,
            delta_deny_subject_count: 0,
            delta_high_sensitivity_object_count: 0,
            new_conflict_rule_count: 0,
            new_sod_violation_count: 0,
            indeterminate_rate_estimation: 0,
            mandatory_obligations_pass_rate: 1,
            publish_recommendation: '通过',
          },
          top_impacted_subjects: [],
          top_impacted_objects: [],
          action_change_matrix: [],
          matrix_cells: [],
        },
      },
    };

    const html = renderConsolePage(model);
    expect(html).toContain('ACL 嵌入视图');
    expect(html).toContain('Embeddable Widget');
    expect(html).toContain('影响面模拟视图');
    expect(html).toContain('widget=simulation');
    expect(html).not.toContain('发布流程');
    expect(html).not.toContain('/assets/dashboard-tabs.js');
  });

  it('renders control tab actions', () => {
    const model: ConsolePageViewModel = {
      api_base_url: 'http://127.0.0.1:3010',
      generated_at: '2026-03-04T00:00:00.000Z',
      query: {
        limit: 20,
        offset: 0,
        tab: 'control',
        namespace: 'tenant_a.crm',
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
      control_catalogs: {
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
          namespace: 'tenant_a.crm',
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
          namespace: 'tenant_a.crm',
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
    expect(html).toContain('控制面总览');
    expect(html).toContain('/actions/publish/submit');
    expect(html).toContain('/actions/control/catalog/register');
    expect(html).toContain('/actions/control/object/upsert');
    expect(html).toContain('/actions/control/relation/event');
    expect(html).toContain('Widget ID');
  });
});
