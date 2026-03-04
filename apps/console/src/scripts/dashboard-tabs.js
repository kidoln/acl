(() => {
  const TAB_LABEL_MAP = {
    workflow: '发布流程',
    simulation: '影响模拟',
    relations: '关系回放',
    control: '控制面维护',
    components: '组件索引',
  };

  const VALID_TABS = Object.keys(TAB_LABEL_MAP);

  function normalizeTab(value) {
    return VALID_TABS.includes(value) ? value : 'workflow';
  }

  function escapeHtml(value) {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function parseArrayJson(value) {
    if (!value) {
      return '[]';
    }
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? JSON.stringify(parsed) : '[]';
    } catch {
      return '[]';
    }
  }

  function parseCsvLines(value) {
    if (!value) {
      return [];
    }
    return Array.from(
      new Set(
        value
          .split(/[\n,，]/g)
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    );
  }

  function initTabNav() {
    const tabNav = document.querySelector('.tab-nav');
    if (!tabNav) {
      return;
    }

    const links = Array.from(tabNav.querySelectorAll('.tab-link[data-tab]'));
    const panels = Array.from(document.querySelectorAll('[data-tab-panel]'));
    const tabBadge = document.querySelector('[data-tab-label]');
    const tabInputs = Array.from(document.querySelectorAll('input[name="tab"]'));

    const setActiveTab = (tab, pushHistory) => {
      const picked = normalizeTab(tab);

      links.forEach((node) => {
        const linkTab = node.getAttribute('data-tab') || '';
        const matched = linkTab === picked;
        node.classList.toggle('active', matched);
        node.setAttribute('aria-selected', matched ? 'true' : 'false');
      });

      panels.forEach((node) => {
        const panelTab = node.getAttribute('data-tab-panel') || '';
        const matched = panelTab === picked;
        node.classList.toggle('active', matched);
        node.setAttribute('aria-hidden', matched ? 'false' : 'true');
      });

      tabInputs.forEach((input) => {
        input.value = picked;
      });

      if (tabBadge) {
        tabBadge.textContent = `tab: ${TAB_LABEL_MAP[picked] || picked}`;
      }

      const url = new URL(window.location.href);
      url.searchParams.set('tab', picked);
      url.searchParams.delete('widget');
      if (pushHistory) {
        window.history.pushState({ tab: picked }, '', url);
      } else {
        window.history.replaceState({ tab: picked }, '', url);
      }
    };

    links.forEach((node) => {
      node.addEventListener('click', (event) => {
        if (event.defaultPrevented) {
          return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        const targetTab = node.getAttribute('data-tab') || 'workflow';
        setActiveTab(targetTab, true);
      });
    });

    window.addEventListener('popstate', () => {
      const tab = new URL(window.location.href).searchParams.get('tab') || 'workflow';
      setActiveTab(tab, false);
    });

    const initTab = new URL(window.location.href).searchParams.get('tab') || 'workflow';
    setActiveTab(initTab, false);
  }

  function initMatrixDrawer() {
    const drawer = document.querySelector('[data-matrix-drawer]');
    if (!drawer) {
      return;
    }

    const links = Array.from(document.querySelectorAll('.matrix-link[data-matrix-cell="true"]'));
    if (links.length === 0) {
      return;
    }

    const cellInputs = Array.from(document.querySelectorAll('input[name="cell_key"]'));
    const DRAWER_EMPTY_HTML = '<p class="muted">点击矩阵单元格可打开详情抽屉。</p>';

    const setActiveCell = (link, pushHistory) => {
      const cellKey = link.getAttribute('data-cell-key') || '';
      const draftEffect = link.getAttribute('data-draft-effect') || '';
      const baselineEffect = link.getAttribute('data-baseline-effect') || '';
      const action = link.getAttribute('data-action') || '';
      const subjectId = link.getAttribute('data-subject-id') || '';
      const objectId = link.getAttribute('data-object-id') || '';
      const matchedRules = parseArrayJson(link.getAttribute('data-matched-rules'));
      const overriddenRules = parseArrayJson(link.getAttribute('data-overridden-rules'));

      links.forEach((node) => node.classList.toggle('active', node === link));
      cellInputs.forEach((input) => {
        input.value = cellKey;
      });

      drawer.innerHTML = `<h4>单元格详情抽屉</h4>`
        + `<p><strong>cell_key:</strong> ${escapeHtml(cellKey)}</p>`
        + `<p><strong>final_decision:</strong> ${escapeHtml(draftEffect)}</p>`
        + `<p><strong>baseline_decision:</strong> ${escapeHtml(baselineEffect)}</p>`
        + `<p><strong>effective_actions:</strong> ${escapeHtml(action)}</p>`
        + `<p><strong>matched_rules:</strong> ${escapeHtml(matchedRules)}</p>`
        + `<p><strong>overridden_rules:</strong> ${escapeHtml(overriddenRules)}</p>`
        + `<p><strong>relation_path:</strong> ${escapeHtml(subjectId)} -> ${escapeHtml(objectId)}</p>`;

      const url = new URL(window.location.href);
      if (cellKey) {
        url.searchParams.set('cell_key', cellKey);
      } else {
        url.searchParams.delete('cell_key');
      }

      if (pushHistory) {
        window.history.pushState({ cell_key: cellKey }, '', url);
      } else {
        window.history.replaceState({ cell_key: cellKey }, '', url);
      }
    };

    links.forEach((node) => {
      node.addEventListener('click', (event) => {
        if (event.defaultPrevented) {
          return;
        }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        setActiveCell(node, true);
      });
    });

    const queryCellKey = new URL(window.location.href).searchParams.get('cell_key');
    const initialLink =
      links.find((node) => (node.getAttribute('data-cell-key') || '') === queryCellKey)
      || links.find((node) => node.classList.contains('active'));

    if (initialLink) {
      setActiveCell(initialLink, false);
    }

    window.addEventListener('popstate', () => {
      const targetCellKey = new URL(window.location.href).searchParams.get('cell_key');
      if (!targetCellKey) {
        links.forEach((node) => node.classList.remove('active'));
        cellInputs.forEach((input) => {
          input.value = '';
        });
        drawer.innerHTML = DRAWER_EMPTY_HTML;
        return;
      }
      const targetLink = links.find((node) => (node.getAttribute('data-cell-key') || '') === targetCellKey);
      if (targetLink) {
        setActiveCell(targetLink, false);
      }
    });
  }

  function initJsonViewToggles() {
    const toggles = Array.from(document.querySelectorAll('[data-json-toggle]'));
    if (toggles.length === 0) {
      return;
    }

    const applyMode = (switchable, buttons, mode) => {
      const picked = mode === 'raw' ? 'raw' : 'visual';
      const views = Array.from(switchable.querySelectorAll('[data-json-view]'));

      views.forEach((view) => {
        const currentMode = view.getAttribute('data-json-view') || 'visual';
        view.hidden = currentMode !== picked;
      });

      buttons.forEach((button) => {
        const currentMode = button.getAttribute('data-mode') || 'visual';
        const active = currentMode === picked;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    };

    toggles.forEach((toggle) => {
      const scope = toggle.closest('[data-json-scope]') || toggle.closest('.card');
      if (!scope) {
        return;
      }

      const switchable = scope.querySelector('[data-json-switchable]');
      if (!switchable) {
        return;
      }

      const buttons = Array.from(toggle.querySelectorAll('.json-toggle-btn[data-mode]'));
      if (buttons.length === 0) {
        return;
      }

      applyMode(switchable, buttons, 'visual');

      buttons.forEach((button) => {
        button.addEventListener('click', () => {
          const mode = button.getAttribute('data-mode') || 'visual';
          applyMode(switchable, buttons, mode);
        });
      });
    });
  }

  function initModelEditors() {
    const editors = Array.from(document.querySelectorAll('[data-model-editor]'));
    if (editors.length === 0) {
      return;
    }

    const readField = (editor, key) =>
      editor.querySelector(`[data-model-field="${key}"]`);

    const readFieldValue = (editor, key) => {
      const field = readField(editor, key);
      if (!field) {
        return '';
      }
      return typeof field.value === 'string' ? field.value.trim() : '';
    };

    const writeFieldValue = (editor, key, value) => {
      const field = readField(editor, key);
      if (!field) {
        return;
      }
      field.value = value;
    };

    const readNumber = (editor, key, fallback) => {
      const value = Number(readFieldValue(editor, key));
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
    };

    const readTextList = (editor, key) => parseCsvLines(readFieldValue(editor, key));

    const createSkeleton = (tenantId) => ({
      model_meta: {
        model_id: `${tenantId}_authz_v1`,
        tenant_id: tenantId,
        version: '2026.03.04',
        status: 'draft',
        combining_algorithm: 'deny-overrides',
      },
      catalogs: {
        action_catalog: [],
        subject_type_catalog: [],
        object_type_catalog: [],
        relation_type_catalog: [],
      },
      object_onboarding: {
        compatibility_mode: 'compat_balanced',
        default_profile: 'minimal',
        profiles: {
          minimal: {
            required_fields: ['tenant_id', 'object_id', 'object_type', 'created_by'],
            autofill: {
              owner_ref: 'created_by',
              sensitivity: 'normal',
            },
          },
        },
        conditional_required: [
          {
            when: 'object.sensitivity == high',
            add_fields: ['data_domain', 'retention_class'],
          },
        ],
      },
      relations: {
        subject_relations: [],
        object_relations: [],
        subject_object_relations: [],
      },
      policies: {
        rules: [],
      },
      constraints: {
        sod_rules: [],
        cardinality_rules: [],
      },
      lifecycle: {
        event_rules: [
          {
            event_type: 'subject_removed',
            handler: 'revoke_direct_edges',
            required: true,
          },
        ],
      },
      consistency: {
        default_level: 'bounded_staleness',
        high_risk_level: 'strong',
        bounded_staleness_ms: 3000,
      },
      quality_guardrails: {
        attribute_quality: {
          authority_whitelist: ['hr_system'],
          freshness_ttl_sec: {
            department_membership: 900,
          },
          reject_unknown_source: true,
        },
        mandatory_obligations: [],
      },
    });

    const parseModelJson = (textarea) => {
      try {
        const parsed = JSON.parse(textarea.value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        return null;
      }
      return null;
    };

    editors.forEach((editor) => {
      const textarea = editor.querySelector('[data-model-json]');
      if (!textarea) {
        return;
      }

      const syncToJson = () => {
        const tenantId = readFieldValue(editor, 'tenant_id') || 'tenant_a';
        const parsedModel = parseModelJson(textarea);
        const model = parsedModel || createSkeleton(tenantId);

        model.model_meta = {
          ...(model.model_meta || {}),
          model_id: readFieldValue(editor, 'model_id') || `${tenantId}_authz_v1`,
          tenant_id: tenantId,
          version: readFieldValue(editor, 'version') || '2026.03.04',
          status: 'draft',
          combining_algorithm: readFieldValue(editor, 'combining_algorithm') || 'deny-overrides',
        };
        model.catalogs = {
          ...(model.catalogs || {}),
          action_catalog: readTextList(editor, 'action_catalog'),
          subject_type_catalog: readTextList(editor, 'subject_type_catalog'),
          object_type_catalog: readTextList(editor, 'object_type_catalog'),
          relation_type_catalog: readTextList(editor, 'relation_type_catalog'),
        };

        if (!model.policies || typeof model.policies !== 'object') {
          model.policies = { rules: [] };
        }
        const currentRules = Array.isArray(model.policies.rules) ? model.policies.rules : [];
        const firstRule = currentRules[0] && typeof currentRules[0] === 'object' && !Array.isArray(currentRules[0])
          ? currentRules[0]
          : {};
        model.policies.rules = [
          {
            ...firstRule,
            id: readFieldValue(editor, 'rule_id') || 'rule_read_kb',
            subject_selector:
              readFieldValue(editor, 'rule_subject_selector')
              || 'subject.relations includes member_of(group:g1)',
            object_selector:
              readFieldValue(editor, 'rule_object_selector')
              || 'object.type == kb',
            action_set: readTextList(editor, 'rule_action_set'),
            effect: readFieldValue(editor, 'rule_effect') || 'allow',
            priority: readNumber(editor, 'rule_priority', 100),
          },
          ...currentRules.slice(1),
        ];

        if (!model.quality_guardrails || typeof model.quality_guardrails !== 'object') {
          model.quality_guardrails = {};
        }
        model.quality_guardrails = {
          ...(model.quality_guardrails || {}),
          mandatory_obligations: readTextList(editor, 'mandatory_obligations'),
        };

        textarea.value = JSON.stringify(model, null, 2);
      };

      const syncFromJson = () => {
        const model = parseModelJson(textarea);
        if (!model) {
          window.alert('Model JSON 解析失败，请检查格式。');
          return;
        }

        const meta = model.model_meta && typeof model.model_meta === 'object' ? model.model_meta : {};
        const catalogs = model.catalogs && typeof model.catalogs === 'object' ? model.catalogs : {};
        const policies = model.policies && typeof model.policies === 'object' ? model.policies : {};
        const rules = Array.isArray(policies.rules) ? policies.rules : [];
        const firstRule = rules[0] && typeof rules[0] === 'object' && !Array.isArray(rules[0]) ? rules[0] : {};
        const guardrails =
          model.quality_guardrails && typeof model.quality_guardrails === 'object'
            ? model.quality_guardrails
            : {};

        writeFieldValue(editor, 'model_id', String(meta.model_id || ''));
        writeFieldValue(editor, 'tenant_id', String(meta.tenant_id || ''));
        writeFieldValue(editor, 'version', String(meta.version || ''));
        writeFieldValue(editor, 'combining_algorithm', String(meta.combining_algorithm || 'deny-overrides'));

        writeFieldValue(
          editor,
          'action_catalog',
          Array.isArray(catalogs.action_catalog) ? catalogs.action_catalog.join('\n') : '',
        );
        writeFieldValue(
          editor,
          'subject_type_catalog',
          Array.isArray(catalogs.subject_type_catalog) ? catalogs.subject_type_catalog.join('\n') : '',
        );
        writeFieldValue(
          editor,
          'object_type_catalog',
          Array.isArray(catalogs.object_type_catalog) ? catalogs.object_type_catalog.join('\n') : '',
        );
        writeFieldValue(
          editor,
          'relation_type_catalog',
          Array.isArray(catalogs.relation_type_catalog) ? catalogs.relation_type_catalog.join('\n') : '',
        );

        writeFieldValue(editor, 'rule_id', String(firstRule.id || ''));
        writeFieldValue(editor, 'rule_effect', String(firstRule.effect || 'allow'));
        writeFieldValue(editor, 'rule_priority', String(firstRule.priority || 100));
        writeFieldValue(
          editor,
          'rule_action_set',
          Array.isArray(firstRule.action_set) ? firstRule.action_set.join('\n') : '',
        );
        writeFieldValue(editor, 'rule_subject_selector', String(firstRule.subject_selector || ''));
        writeFieldValue(editor, 'rule_object_selector', String(firstRule.object_selector || ''));

        writeFieldValue(
          editor,
          'mandatory_obligations',
          Array.isArray(guardrails.mandatory_obligations)
            ? guardrails.mandatory_obligations.join('\n')
            : '',
        );
      };

      const fields = Array.from(editor.querySelectorAll('[data-model-field]'));
      fields.forEach((field) => {
        const eventType = field.tagName === 'SELECT' ? 'change' : 'input';
        field.addEventListener(eventType, syncToJson);
      });

      const applyJsonButton = editor.querySelector('[data-apply-model-json]');
      if (applyJsonButton) {
        applyJsonButton.addEventListener('click', syncFromJson);
      }

      syncToJson();
    });
  }

  function init() {
    initTabNav();
    initMatrixDrawer();
    initJsonViewToggles();
    initModelEditors();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
    return;
  }
  init();
})();
