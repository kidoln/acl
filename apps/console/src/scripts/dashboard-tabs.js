(() => {
  const TAB_LABEL_MAP = {
    workflow: "发布流程",
    simulation: "影响模拟",
    relations: "关系回放",
    control: "控制面维护",
    components: "组件索引",
  };

  const VALID_TABS = Object.keys(TAB_LABEL_MAP);

  function normalizeTab(value) {
    return VALID_TABS.includes(value) ? value : "workflow";
  }

  function escapeHtml(value) {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function parseArrayJson(value) {
    if (!value) {
      return "[]";
    }
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? JSON.stringify(parsed) : "[]";
    } catch {
      return "[]";
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
    const tabNav = document.querySelector(".tab-nav");
    if (!tabNav) {
      return;
    }

    const links = Array.from(tabNav.querySelectorAll(".tab-link[data-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-tab-panel]"));
    const tabBadge = document.querySelector("[data-tab-label]");
    const tabInputs = Array.from(
      document.querySelectorAll('input[name="tab"]'),
    );

    const setActiveTab = (tab, pushHistory) => {
      const picked = normalizeTab(tab);

      links.forEach((node) => {
        const linkTab = node.getAttribute("data-tab") || "";
        const matched = linkTab === picked;
        node.classList.toggle("active", matched);
        node.setAttribute("aria-selected", matched ? "true" : "false");
      });

      panels.forEach((node) => {
        const panelTab = node.getAttribute("data-tab-panel") || "";
        const matched = panelTab === picked;
        node.classList.toggle("active", matched);
        node.setAttribute("aria-hidden", matched ? "false" : "true");
      });

      tabInputs.forEach((input) => {
        input.value = picked;
      });

      if (tabBadge) {
        tabBadge.textContent = `tab: ${TAB_LABEL_MAP[picked] || picked}`;
      }

      const url = new URL(window.location.href);
      url.searchParams.set("tab", picked);
      url.searchParams.delete("widget");
      if (pushHistory) {
        window.history.pushState({ tab: picked }, "", url);
      } else {
        window.history.replaceState({ tab: picked }, "", url);
      }
    };

    links.forEach((node) => {
      node.addEventListener("click", (event) => {
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
        const targetTab = node.getAttribute("data-tab") || "workflow";
        setActiveTab(targetTab, true);
      });
    });

    window.addEventListener("popstate", () => {
      const tab =
        new URL(window.location.href).searchParams.get("tab") || "workflow";
      setActiveTab(tab, false);
    });

    const initTab =
      new URL(window.location.href).searchParams.get("tab") || "workflow";
    setActiveTab(initTab, false);
  }

  function initMatrixDrawer() {
    const drawer = document.querySelector("[data-matrix-drawer]");
    if (!drawer) {
      return;
    }

    const links = Array.from(
      document.querySelectorAll('.matrix-link[data-matrix-cell="true"]'),
    );
    if (links.length === 0) {
      return;
    }

    const cellInputs = Array.from(
      document.querySelectorAll('input[name="cell_key"]'),
    );
    const DRAWER_EMPTY_HTML =
      '<p class="muted">点击矩阵单元格可打开详情抽屉。</p>';

    const setActiveCell = (link, pushHistory) => {
      const cellKey = link.getAttribute("data-cell-key") || "";
      const draftEffect = link.getAttribute("data-draft-effect") || "";
      const baselineEffect = link.getAttribute("data-baseline-effect") || "";
      const action = link.getAttribute("data-action") || "";
      const subjectId = link.getAttribute("data-subject-id") || "";
      const objectId = link.getAttribute("data-object-id") || "";
      const matchedRules = parseArrayJson(
        link.getAttribute("data-matched-rules"),
      );
      const overriddenRules = parseArrayJson(
        link.getAttribute("data-overridden-rules"),
      );

      links.forEach((node) => node.classList.toggle("active", node === link));
      cellInputs.forEach((input) => {
        input.value = cellKey;
      });

      drawer.innerHTML =
        `<h4>单元格详情抽屉</h4>` +
        `<p><strong>cell_key:</strong> ${escapeHtml(cellKey)}</p>` +
        `<p><strong>final_decision:</strong> ${escapeHtml(draftEffect)}</p>` +
        `<p><strong>baseline_decision:</strong> ${escapeHtml(baselineEffect)}</p>` +
        `<p><strong>effective_actions:</strong> ${escapeHtml(action)}</p>` +
        `<p><strong>matched_rules:</strong> ${escapeHtml(matchedRules)}</p>` +
        `<p><strong>overridden_rules:</strong> ${escapeHtml(overriddenRules)}</p>` +
        `<p><strong>relation_path:</strong> ${escapeHtml(subjectId)} -> ${escapeHtml(objectId)}</p>`;

      const url = new URL(window.location.href);
      if (cellKey) {
        url.searchParams.set("cell_key", cellKey);
      } else {
        url.searchParams.delete("cell_key");
      }

      if (pushHistory) {
        window.history.pushState({ cell_key: cellKey }, "", url);
      } else {
        window.history.replaceState({ cell_key: cellKey }, "", url);
      }
    };

    links.forEach((node) => {
      node.addEventListener("click", (event) => {
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

    const queryCellKey = new URL(window.location.href).searchParams.get(
      "cell_key",
    );
    const initialLink =
      links.find(
        (node) => (node.getAttribute("data-cell-key") || "") === queryCellKey,
      ) || links.find((node) => node.classList.contains("active"));

    if (initialLink) {
      setActiveCell(initialLink, false);
    }

    window.addEventListener("popstate", () => {
      const targetCellKey = new URL(window.location.href).searchParams.get(
        "cell_key",
      );
      if (!targetCellKey) {
        links.forEach((node) => node.classList.remove("active"));
        cellInputs.forEach((input) => {
          input.value = "";
        });
        drawer.innerHTML = DRAWER_EMPTY_HTML;
        return;
      }
      const targetLink = links.find(
        (node) => (node.getAttribute("data-cell-key") || "") === targetCellKey,
      );
      if (targetLink) {
        setActiveCell(targetLink, false);
      }
    });
  }

  function initJsonViewToggles() {
    const toggles = Array.from(document.querySelectorAll("[data-json-toggle]"));
    if (toggles.length === 0) {
      return;
    }

    const applyMode = (switchable, buttons, mode) => {
      const availableModes = buttons
        .map((button) => button.getAttribute("data-mode") || "")
        .filter((item) => item.length > 0);
      if (availableModes.length === 0) {
        return;
      }
      const fallbackMode = availableModes.includes("visual")
        ? "visual"
        : availableModes[0];
      const picked = availableModes.includes(mode) ? mode : fallbackMode;
      const views = Array.from(switchable.querySelectorAll("[data-json-view]"));

      views.forEach((view) => {
        const currentMode = view.getAttribute("data-json-view") || "visual";
        view.hidden = currentMode !== picked;
      });

      buttons.forEach((button) => {
        const currentMode = button.getAttribute("data-mode") || "visual";
        const active = currentMode === picked;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });

      if (picked === "graph") {
        document.dispatchEvent(
          new CustomEvent("acl:model-graph-visible", {
            detail: {
              switchableId:
                switchable.getAttribute("data-json-switchable-id") || "",
            },
          }),
        );
      }
    };

    toggles.forEach((toggle) => {
      const scope =
        toggle.closest("[data-json-scope]") || toggle.closest(".card");
      if (!scope) {
        return;
      }

      const switchable = scope.querySelector("[data-json-switchable]");
      if (!switchable) {
        return;
      }
      if (!switchable.getAttribute("data-json-switchable-id")) {
        switchable.setAttribute(
          "data-json-switchable-id",
          `switchable_${Math.random().toString(36).slice(2, 10)}`,
        );
      }

      const buttons = Array.from(
        toggle.querySelectorAll(".json-toggle-btn[data-mode]"),
      );
      if (buttons.length === 0) {
        return;
      }

      applyMode(switchable, buttons, "visual");

      buttons.forEach((button) => {
        button.addEventListener("click", () => {
          const mode = button.getAttribute("data-mode") || "visual";
          applyMode(switchable, buttons, mode);
        });
      });
    });
  }

  function initModelEditors() {
    const editors = Array.from(
      document.querySelectorAll("[data-model-editor]"),
    );
    if (editors.length === 0) {
      return;
    }

    const readField = (editor, key) =>
      editor.querySelector(`[data-model-field="${key}"]`);

    const readFieldValue = (editor, key) => {
      const field = readField(editor, key);
      if (!field) {
        return "";
      }
      return typeof field.value === "string" ? field.value.trim() : "";
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

    const readTextList = (editor, key) =>
      parseCsvLines(readFieldValue(editor, key));

    const createSkeleton = (tenantId) => ({
      model_meta: {
        model_id: `${tenantId}_authz_v1`,
        tenant_id: tenantId,
        version: "2026.03.04",
        status: "draft",
        combining_algorithm: "deny-overrides",
      },
      catalogs: {
        action_catalog: [],
        subject_type_catalog: [],
        object_type_catalog: [],
        subject_relation_type_catalog: [],
        object_relation_type_catalog: [],
        subject_object_relation_type_catalog: [],
      },
      object_onboarding: {
        compatibility_mode: "compat_balanced",
        default_profile: "minimal",
        profiles: {
          minimal: {
            required_fields: [
              "tenant_id",
              "object_id",
              "object_type",
              "created_by",
            ],
            autofill: {
              owner_ref: "created_by",
              sensitivity: "normal",
            },
          },
        },
        conditional_required: [
          {
            when: "object.sensitivity == high",
            add_fields: ["data_domain", "retention_class"],
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
            event_type: "subject_removed",
            handler: "revoke_direct_edges",
            required: true,
          },
        ],
      },
      consistency: {
        default_level: "bounded_staleness",
        high_risk_level: "strong",
        bounded_staleness_ms: 3000,
      },
      quality_guardrails: {
        attribute_quality: {
          authority_whitelist: ["hr_system"],
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
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed;
        }
      } catch {
        return null;
      }
      return null;
    };

    const escapeHtml = (value) =>
      String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");

    const readCatalogItems = (model, key, options = {}) => {
      const normalize =
        typeof options.normalize === "function"
          ? options.normalize
          : (value) => value;
      if (!model.catalogs || typeof model.catalogs !== "object") {
        return [];
      }
      const values = model.catalogs[key];
      if (!Array.isArray(values)) {
        return [];
      }

      const seen = new Set();
      const result = [];
      values
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .forEach((item) => {
          const normalized = normalize(item);
          if (typeof normalized !== "string" || normalized.length === 0) {
            return;
          }
          if (seen.has(normalized)) {
            return;
          }
          seen.add(normalized);
          result.push(normalized);
        });
      return result;
    };

    const readRelationSignatureDomainTuples = (model, domainKey) => {
      const relationSignature =
        model.relation_signature && typeof model.relation_signature === "object"
          ? model.relation_signature
          : null;
      if (!relationSignature) {
        return [];
      }
      const tuples = relationSignature[domainKey];
      if (!Array.isArray(tuples)) {
        return [];
      }
      return tuples
        .map((tuple, index) => ({
          tuple,
          index,
        }))
        .filter(
          (item) =>
            item.tuple &&
            typeof item.tuple === "object" &&
            !Array.isArray(item.tuple),
        )
        .filter((item) => item.tuple.enabled !== false)
        .map((item) => ({
          index: item.index,
          relation_type:
            typeof item.tuple.relation_type === "string"
              ? item.tuple.relation_type.trim()
              : "",
          from_types: Array.isArray(item.tuple.from_types)
            ? item.tuple.from_types
                .filter((item) => typeof item === "string")
                .map((item) => item.trim().toLowerCase())
                .filter((item) => item.length > 0)
            : [],
          to_types: Array.isArray(item.tuple.to_types)
            ? item.tuple.to_types
                .filter((item) => typeof item === "string")
                .map((item) => item.trim().toLowerCase())
                .filter((item) => item.length > 0)
            : [],
        }));
    };

    const nodeColor = (type) => {
      if (type === "company") {
        return "#eaf2ff";
      }
      if (type === "department") {
        return "#eefaf1";
      }
      if (type === "user") {
        return "#fff6ea";
      }
      if (type === "kb") {
        return "#f2f0ff";
      }
      if (type === "subject_input") {
        return "#e8f1ff";
      }
      if (type === "object_input") {
        return "#fff3e7";
      }
      if (type === "inference_rule") {
        return "#e9f8ef";
      }
      if (type === "context_var") {
        return "#f3ebff";
      }
      if (type === "policy_rule") {
        return "#fff8e8";
      }
      if (type === "owner_fallback") {
        return "#f9eef6";
      }
      if (type === "from_type") {
        return "#e8f1ff";
      }
      if (type === "to_type") {
        return "#eefaf1";
      }
      if (type === "relation_type") {
        return "#f3ebff";
      }
      if (type === "both_type") {
        return "#eaf0ff";
      }
      if (type === "type") {
        return "#eaf0ff";
      }
      return "#f4f7fb";
    };

    const edgeColor = (relationType) => {
      if (relationType === "derives_to") {
        return "#365fb8";
      }
      if (relationType === "owned_by_department") {
        return "#287d4f";
      }
      if (relationType === "in_company") {
        return "#7f5ab9";
      }
      if (relationType === "subject_edge") {
        return "#1f6bc6";
      }
      if (relationType === "object_edge") {
        return "#cd6d1b";
      }
      if (relationType === "owner_fallback") {
        return "#ad4f8f";
      }
      if (relationType === "outputs") {
        return "#2d8a57";
      }
      if (relationType === "consumed_by") {
        return "#7f5ab9";
      }
      return "#5c6882";
    };

    const relationDomainColorMap = {
      subject: "#2f6fec",
      object: "#1d8f62",
      subject_object: "#7b4bd6",
    };

    const buildDomainGraphData = (model, domainConfig) => {
      const fromTypes = readCatalogItems(
        model,
        domainConfig.fromTypeCatalogKey,
        {
          normalize: (value) => value.toLowerCase(),
        },
      );
      const toTypes = readCatalogItems(model, domainConfig.toTypeCatalogKey, {
        normalize: (value) => value.toLowerCase(),
      });
      const relationTypes = readCatalogItems(
        model,
        domainConfig.relationCatalogKey,
      );
      const relationTypeSet = new Set(relationTypes);
      const fromTypeSet = new Set(fromTypes);
      const toTypeSet = new Set(toTypes);
      const signatureTuples = readRelationSignatureDomainTuples(
        model,
        domainConfig.signatureDomainKey,
      );

      const issues = [];
      const issueSet = new Set();
      const addIssue = (message, path) => {
        const key = `${message}|${path}`;
        if (issueSet.has(key)) {
          return;
        }
        issueSet.add(key);
        issues.push({
          code: "RELATION_SIGNATURE_MISMATCH",
          message,
          path,
        });
      };

      if (relationTypes.length > 0 && signatureTuples.length === 0) {
        addIssue(
          `${domainConfig.label} 已配置 relation_type，但 relation_signature.${domainConfig.signatureDomainKey} 为空。`,
          `/relation_signature/${domainConfig.signatureDomainKey}`,
        );
      }

      const typeNodeSet = new Set([...fromTypes, ...toTypes]);
      const relationTypesWithValidSignature = new Set();
      const edgeMap = new Map();
      const addEdge = (from, to, relationType, signatureMismatch) => {
        const edgeKey = `${from}->${to}->${relationType}`;
        const existing = edgeMap.get(edgeKey);
        if (existing) {
          if (signatureMismatch) {
            existing.signature_mismatch = true;
          }
          return;
        }
        edgeMap.set(edgeKey, {
          from,
          to,
          relation_type: relationType,
          source: "",
          dashed: false,
          signature_mismatch: signatureMismatch === true,
        });
      };

      signatureTuples.forEach((tuple) => {
        const tuplePath = `/relation_signature/${domainConfig.signatureDomainKey}/${tuple.index}`;
        if (tuple.relation_type.length === 0) {
          addIssue(
            `${domainConfig.label} 第 ${tuple.index + 1} 条签名缺少 relation_type。`,
            `${tuplePath}/relation_type`,
          );
          return;
        }

        const relationTypeKnown = relationTypeSet.has(tuple.relation_type);
        if (!relationTypeKnown) {
          addIssue(
            `${domainConfig.label} 签名 relation_type=${tuple.relation_type} 未在 ${domainConfig.relationCatalogKey} 注册。`,
            `${tuplePath}/relation_type`,
          );
        }

        const validFromTypes = [];
        tuple.from_types.forEach((fromType, fromIndex) => {
          if (fromTypeSet.has(fromType)) {
            validFromTypes.push(fromType);
            return;
          }
          addIssue(
            `${domainConfig.label} 签名 from_type=${fromType} 未在 ${domainConfig.fromTypeCatalogKey} 注册。`,
            `${tuplePath}/from_types/${fromIndex}`,
          );
        });

        const validToTypes = [];
        tuple.to_types.forEach((toType, toIndex) => {
          if (toTypeSet.has(toType)) {
            validToTypes.push(toType);
            return;
          }
          addIssue(
            `${domainConfig.label} 签名 to_type=${toType} 未在 ${domainConfig.toTypeCatalogKey} 注册。`,
            `${tuplePath}/to_types/${toIndex}`,
          );
        });

        if (validFromTypes.length === 0 || validToTypes.length === 0) {
          addIssue(
            `${domainConfig.label} relation_type=${tuple.relation_type} 未形成有效端点签名组合。`,
            tuplePath,
          );
          return;
        }

        relationTypesWithValidSignature.add(tuple.relation_type);
        validFromTypes.forEach((fromType) => {
          validToTypes.forEach((toType) => {
            const fromKey = `type:${fromType}`;
            const toKey = `type:${toType}`;
            typeNodeSet.add(fromType);
            typeNodeSet.add(toType);
            addEdge(fromKey, toKey, tuple.relation_type, !relationTypeKnown);
          });
        });
      });

      relationTypes.forEach((relationType) => {
        if (relationTypesWithValidSignature.has(relationType)) {
          return;
        }
        addIssue(
          `${domainConfig.label} relation_type=${relationType} 缺少可用签名元组。`,
          `/catalogs/${domainConfig.relationCatalogKey}`,
        );
      });

      const sortedFromTypes = [...fromTypes].sort((left, right) =>
        left.localeCompare(right),
      );
      const sortedToTypes = [...toTypes].sort((left, right) =>
        left.localeCompare(right),
      );
      const sortedFromTypeSet = new Set(sortedFromTypes);
      const sortedToTypeSet = new Set(sortedToTypes);
      const sortedTypeNodes = [...typeNodeSet]
        .filter((item) => item.length > 0)
        .sort((left, right) => left.localeCompare(right));
      const hasAnyNode = sortedTypeNodes.length > 0;
      if (hasAnyNode) {
        const marginX = 110;
        const marginY = 80;
        const columnCount = Math.min(
          4,
          Math.max(1, Math.ceil(Math.sqrt(sortedTypeNodes.length))),
        );
        const rowCount = Math.max(
          1,
          Math.ceil(sortedTypeNodes.length / columnCount),
        );
        const columnGap = 210;
        const rowGap = 118;
        const width = marginX * 2 + (columnCount - 1) * columnGap + 200;
        const height = marginY * 2 + (rowCount - 1) * rowGap + 40;
        const positionedNodes = sortedTypeNodes.map((typeName, index) => {
          const rowIndex = Math.floor(index / columnCount);
          const columnIndex = index % columnCount;
          const inFrom = sortedFromTypeSet.has(typeName);
          const inTo = sortedToTypeSet.has(typeName);
          const nodeType =
            inFrom && inTo ? "both_type" : inFrom ? "from_type" : "to_type";
          return {
            key: `type:${typeName}`,
            type: nodeType,
            name: typeName,
            label: typeName,
            x: marginX + columnIndex * columnGap,
            y: marginY + rowIndex * rowGap,
          };
        });

        return {
          issues,
          relationTypeCount: relationTypes.length,
          signatureTupleCount: signatureTuples.length,
          payload: {
            nodes: positionedNodes,
            edges: [...edgeMap.values()],
            width,
            height,
          },
        };
      }

      return {
        issues,
        relationTypeCount: relationTypes.length,
        signatureTupleCount: signatureTuples.length,
        payload: null,
      };
    };

    const relationGraphDomainConfig = {
      subject: {
        domainKey: "subject",
        label: "subject_relations",
        relationCatalogKey: "subject_relation_type_catalog",
        fromTypeCatalogKey: "subject_type_catalog",
        toTypeCatalogKey: "subject_type_catalog",
        signatureDomainKey: "subject_relations",
      },
      object: {
        domainKey: "object",
        label: "object_relations",
        relationCatalogKey: "object_relation_type_catalog",
        fromTypeCatalogKey: "object_type_catalog",
        toTypeCatalogKey: "object_type_catalog",
        signatureDomainKey: "object_relations",
      },
      subjectObject: {
        domainKey: "subject_object",
        label: "subject_object_relations",
        relationCatalogKey: "subject_object_relation_type_catalog",
        fromTypeCatalogKey: "subject_type_catalog",
        toTypeCatalogKey: "object_type_catalog",
        signatureDomainKey: "subject_object_relations",
      },
    };

    const buildCombinedSignatureGraphPayload = (
      domainPayloads,
      typeCatalogs,
    ) => {
      const nodeInfoMap = new Map();
      const membershipMap = new Map();
      const edgeMap = new Map();
      const subjectTypeSet = new Set(
        Array.isArray(typeCatalogs?.subjectTypes)
          ? typeCatalogs.subjectTypes
          : [],
      );
      const objectTypeSet = new Set(
        Array.isArray(typeCatalogs?.objectTypes)
          ? typeCatalogs.objectTypes
          : [],
      );

      const markMembership = (nodeKey, domainKey) => {
        const membership = membershipMap.get(nodeKey) || {
          subject: false,
          object: false,
        };
        if (domainKey === "subject") {
          membership.subject = true;
        }
        if (domainKey === "object") {
          membership.object = true;
        }
        if (domainKey === "subject_object") {
          membership.subject = true;
          membership.object = true;
        }
        membershipMap.set(nodeKey, membership);
      };

      Object.values(domainPayloads).forEach((item) => {
        if (!item || !item.payload) {
          return;
        }
        const { payload, domainKey } = item;
        payload.nodes.forEach((node) => {
          if (!node || typeof node !== "object") {
            return;
          }
          const nodeKey = typeof node.key === "string" ? node.key.trim() : "";
          if (nodeKey.length === 0) {
            return;
          }
          if (!nodeInfoMap.has(nodeKey)) {
            nodeInfoMap.set(nodeKey, {
              key: nodeKey,
              name:
                typeof node.name === "string" && node.name.trim().length > 0
                  ? node.name.trim()
                  : nodeKey,
              label:
                typeof node.label === "string" && node.label.trim().length > 0
                  ? node.label.trim()
                  : nodeKey,
            });
          }
          markMembership(nodeKey, domainKey);
        });

        payload.edges.forEach((edge) => {
          if (!edge || typeof edge !== "object") {
            return;
          }
          const from = typeof edge.from === "string" ? edge.from.trim() : "";
          const to = typeof edge.to === "string" ? edge.to.trim() : "";
          if (from.length === 0 || to.length === 0) {
            return;
          }
          const relationType =
            typeof edge.relation_type === "string"
              ? edge.relation_type.trim()
              : "";
          const edgeKey = `${from}->${to}->${relationType}->${domainKey}`;
          const existing = edgeMap.get(edgeKey);
          if (existing) {
            if (edge.signature_mismatch === true) {
              existing.signature_mismatch = true;
            }
            return;
          }
          edgeMap.set(edgeKey, {
            from,
            to,
            relation_type: relationType,
            source: "",
            dashed: edge.dashed === true,
            signature_mismatch: edge.signature_mismatch === true,
            domain: domainKey,
            domain_color:
              relationDomainColorMap[domainKey] ||
              relationDomainColorMap.subject,
          });
        });
      });

      if (nodeInfoMap.size === 0) {
        return null;
      }

      const subjectOnly = [];
      const bothSides = [];
      const objectOnly = [];
      [...nodeInfoMap.values()]
        .sort((left, right) => left.label.localeCompare(right.label))
        .forEach((node) => {
          const normalizedName = String(node.name || "")
            .trim()
            .toLowerCase();
          const inSubjectCatalog = subjectTypeSet.has(normalizedName);
          const inObjectCatalog = objectTypeSet.has(normalizedName);
          if (inSubjectCatalog && inObjectCatalog) {
            bothSides.push(node);
            return;
          }
          if (inSubjectCatalog) {
            subjectOnly.push(node);
            return;
          }
          if (inObjectCatalog) {
            objectOnly.push(node);
            return;
          }

          const membership = membershipMap.get(node.key) || {
            subject: false,
            object: false,
          };
          if (membership.subject && membership.object) {
            bothSides.push(node);
            return;
          }
          if (membership.subject) {
            subjectOnly.push(node);
            return;
          }
          if (membership.object) {
            objectOnly.push(node);
            return;
          }
          bothSides.push(node);
        });

      const columns = [subjectOnly, bothSides, objectOnly];
      const marginX = 120;
      const marginY = 80;
      const columnGap = 240;
      const rowGap = 102;
      const width = marginX * 2 + (columns.length - 1) * columnGap + 200;
      const maxRows = Math.max(...columns.map((column) => column.length), 1);
      const height = marginY * 2 + (maxRows - 1) * rowGap + 40;

      const nodes = [];
      columns.forEach((column, columnIndex) => {
        const columnHeight = (column.length - 1) * rowGap;
        const startY = (height - columnHeight) / 2;
        const x = marginX + columnIndex * columnGap;
        column.forEach((node, rowIndex) => {
          nodes.push({
            key: node.key,
            type: "type",
            name: node.name,
            label: node.label,
            x,
            y: startY + rowIndex * rowGap,
          });
        });
      });

      return {
        nodes,
        edges: [...edgeMap.values()],
        width,
        height,
      };
    };

    const readInferenceRules = (model) => {
      const contextInference =
        model.context_inference && typeof model.context_inference === "object"
          ? model.context_inference
          : null;
      if (!contextInference || !Array.isArray(contextInference.rules)) {
        return [];
      }

      return contextInference.rules
        .filter(
          (rule) => rule && typeof rule === "object" && !Array.isArray(rule),
        )
        .map((rule, index) => {
          const normalizeSelectors = (value) => {
            if (!Array.isArray(value)) {
              return [];
            }
            return value
              .filter(
                (selector) =>
                  selector &&
                  typeof selector === "object" &&
                  !Array.isArray(selector),
              )
              .map((selector) => ({
                relation_type:
                  typeof selector.relation_type === "string"
                    ? selector.relation_type.trim()
                    : "",
                entity_side: selector.entity_side === "to" ? "to" : "from",
              }))
              .filter((selector) => selector.relation_type.length > 0);
          };

          const id =
            typeof rule.id === "string" && rule.id.trim().length > 0
              ? rule.id.trim()
              : `inference_rule_${index + 1}`;
          const outputField =
            typeof rule.output_field === "string" &&
            rule.output_field.trim().length > 0
              ? rule.output_field.trim()
              : `context_field_${index + 1}`;

          return {
            id,
            output_field: outputField,
            subject_edges: normalizeSelectors(rule.subject_edges),
            object_edges: normalizeSelectors(rule.object_edges),
            object_owner_fallback: rule.object_owner_fallback === true,
            owner_fallback_include_input:
              rule.owner_fallback_include_input !== false,
          };
        });
    };

    const readPolicyRules = (model) => {
      if (!model.policies || typeof model.policies !== "object") {
        return [];
      }
      const rules = model.policies.rules;
      if (!Array.isArray(rules)) {
        return [];
      }
      return rules
        .filter(
          (rule) => rule && typeof rule === "object" && !Array.isArray(rule),
        )
        .map((rule, index) => ({
          id:
            typeof rule.id === "string" && rule.id.trim().length > 0
              ? rule.id.trim()
              : `policy_rule_${index + 1}`,
          subject_selector:
            typeof rule.subject_selector === "string"
              ? rule.subject_selector
              : "",
          object_selector:
            typeof rule.object_selector === "string"
              ? rule.object_selector
              : "",
          conditions:
            typeof rule.conditions === "string" ? rule.conditions : "",
        }));
    };

    const extractContextFields = (rule) => {
      const fields = new Set();
      const texts = [
        rule.subject_selector,
        rule.object_selector,
        rule.conditions,
      ];
      const matcher = /context\.([a-zA-Z0-9_]+)/g;

      texts.forEach((text) => {
        if (!text || typeof text !== "string") {
          return;
        }
        let matched = matcher.exec(text);
        while (matched) {
          if (typeof matched[1] === "string" && matched[1].length > 0) {
            fields.add(matched[1]);
          }
          matched = matcher.exec(text);
        }
        matcher.lastIndex = 0;
      });

      return fields;
    };

    const buildInferenceGraphPayload = (model) => {
      const inferenceRules = readInferenceRules(model);
      if (inferenceRules.length === 0) {
        return null;
      }

      const policyRules = readPolicyRules(model);
      const nodeMap = new Map();
      const edges = [];
      const columns = {
        input: new Set(),
        inference: new Set(),
        context: new Set(),
        policy: new Set(),
      };

      const addNode = (node, column) => {
        if (!nodeMap.has(node.key)) {
          nodeMap.set(node.key, node);
        }
        columns[column].add(node.key);
      };

      inferenceRules.forEach((rule) => {
        const inferenceNodeKey = `inference:${rule.id}`;
        addNode(
          {
            key: inferenceNodeKey,
            type: "inference_rule",
            name: rule.id,
            label: `rule:${rule.id}`,
          },
          "inference",
        );

        const contextKey = `context:${rule.output_field}`;
        addNode(
          {
            key: contextKey,
            type: "context_var",
            name: rule.output_field,
            label: `context.${rule.output_field}`,
          },
          "context",
        );

        edges.push({
          from: inferenceNodeKey,
          to: contextKey,
          relation_type: "outputs",
          source: "model",
          dashed: false,
        });

        rule.subject_edges.forEach((selector) => {
          const selectorKey = `subject_edge:${selector.relation_type}:${selector.entity_side}`;
          addNode(
            {
              key: selectorKey,
              type: "subject_input",
              name: `${selector.relation_type}:${selector.entity_side}`,
              label: `subject.${selector.relation_type}(${selector.entity_side})`,
            },
            "input",
          );
          edges.push({
            from: selectorKey,
            to: inferenceNodeKey,
            relation_type: "subject_edge",
            source: "context_inference",
            dashed: false,
          });
        });

        rule.object_edges.forEach((selector) => {
          const selectorKey = `object_edge:${selector.relation_type}:${selector.entity_side}`;
          addNode(
            {
              key: selectorKey,
              type: "object_input",
              name: `${selector.relation_type}:${selector.entity_side}`,
              label: `object.${selector.relation_type}(${selector.entity_side})`,
            },
            "input",
          );
          edges.push({
            from: selectorKey,
            to: inferenceNodeKey,
            relation_type: "object_edge",
            source: "context_inference",
            dashed: false,
          });
        });

        if (rule.object_owner_fallback) {
          const fallbackKey = `owner_fallback:${rule.id}`;
          addNode(
            {
              key: fallbackKey,
              type: "owner_fallback",
              name: rule.owner_fallback_include_input
                ? "owner_ref(include_input)"
                : "owner_ref(expanded_only)",
              label: rule.owner_fallback_include_input
                ? "owner_ref fallback (include input)"
                : "owner_ref fallback (expanded only)",
            },
            "input",
          );
          edges.push({
            from: fallbackKey,
            to: inferenceNodeKey,
            relation_type: "owner_fallback",
            source: "context_inference",
            dashed: true,
          });
        }
      });

      policyRules.forEach((rule) => {
        const fields = extractContextFields(rule);
        if (fields.size === 0) {
          return;
        }
        const policyKey = `policy:${rule.id}`;
        addNode(
          {
            key: policyKey,
            type: "policy_rule",
            name: rule.id,
            label: `policy:${rule.id}`,
          },
          "policy",
        );

        fields.forEach((field) => {
          const contextKey = `context:${field}`;
          if (!nodeMap.has(contextKey)) {
            addNode(
              {
                key: contextKey,
                type: "context_var",
                name: field,
                label: `context.${field}`,
              },
              "context",
            );
          }
          edges.push({
            from: contextKey,
            to: policyKey,
            relation_type: "consumed_by",
            source: "policy_selector",
            dashed: false,
          });
        });
      });

      const inputKeys = [...columns.input];
      const inferenceKeys = [...columns.inference];
      const contextKeys = [...columns.context];
      const policyKeys = [...columns.policy];
      const orderedColumns = [
        inputKeys,
        inferenceKeys,
        contextKeys,
        policyKeys,
      ];

      const marginX = 120;
      const marginY = 80;
      const columnGap = 260;
      const rowGap = 96;
      const width = marginX * 2 + (orderedColumns.length - 1) * columnGap + 180;
      const maxRows = Math.max(
        ...orderedColumns.map((items) => items.length),
        1,
      );
      const height = marginY * 2 + (maxRows - 1) * rowGap + 50;

      const positionedNodes = [];
      orderedColumns.forEach((keys, columnIndex) => {
        const sortedKeys = [...keys].sort((a, b) => {
          const left = nodeMap.get(a)?.label || a;
          const right = nodeMap.get(b)?.label || b;
          return left.localeCompare(right);
        });
        const columnHeight = (sortedKeys.length - 1) * rowGap;
        const startY = (height - columnHeight) / 2;
        const x = marginX + columnIndex * columnGap;
        sortedKeys.forEach((key, index) => {
          const node = nodeMap.get(key);
          if (!node) {
            return;
          }
          positionedNodes.push({
            ...node,
            x,
            y: startY + index * rowGap,
          });
        });
      });

      return {
        nodes: positionedNodes,
        edges,
        width,
        height,
      };
    };

    const chartInstances = new WeakMap();
    const activeChartContainers = new Set();
    let chartResizeBound = false;
    const clampChartWrapSize = (chartWrap, aspectRatio) => {
      if (!(chartWrap instanceof HTMLElement)) {
        return;
      }
      const card = chartWrap.closest(".model-graph-card");
      const cardInnerWidth =
        card instanceof HTMLElement
          ? Math.max(card.clientWidth - 20, 280)
          : 280;
      const maxHeight = Math.max(Math.floor(window.innerHeight * 0.8), 220);
      const minHeight = 220;

      let nextWidth;
      let nextHeight;

      if (aspectRatio && aspectRatio > 0) {
        // 根据长宽比适配：宽度充满父容器，高度根据长宽比计算
        nextWidth = cardInnerWidth;
        const viewportPadding = 50;
        const innerWidth = Math.max(nextWidth - viewportPadding * 2, 1);
        const innerHeight = innerWidth / aspectRatio;
        nextHeight = Math.min(
          Math.max(innerHeight + viewportPadding * 2, minHeight),
          maxHeight,
        );
      } else {
        nextWidth = Math.min(
          Math.max(chartWrap.clientWidth, 280),
          cardInnerWidth,
        );
        nextHeight = Math.min(
          Math.max(chartWrap.clientHeight, minHeight),
          maxHeight,
        );
      }

      if (Math.abs(nextWidth - chartWrap.clientWidth) > 1) {
        chartWrap.style.width = `${nextWidth}px`;
      }
      if (Math.abs(nextHeight - chartWrap.clientHeight) > 1) {
        chartWrap.style.height = `${nextHeight}px`;
      }
    };
    const chartResizeObserver =
      typeof window.ResizeObserver === "function"
        ? new window.ResizeObserver((entries) => {
            entries.forEach((entry) => {
              const target = entry.target;
              if (!(target instanceof HTMLElement)) {
                return;
              }
              const container = target.matches("[data-model-echart]")
                ? target
                : target.querySelector("[data-model-echart]");
              if (!(container instanceof HTMLElement)) {
                return;
              }
              const chartWrap = container.closest(".model-graph-chart-wrap");
              clampChartWrapSize(chartWrap);
              const chart = chartInstances.get(container);
              if (chart && typeof chart.resize === "function") {
                chart.resize();
              }
            });
          })
        : null;

    const bindChartResize = () => {
      if (chartResizeBound) {
        return;
      }
      chartResizeBound = true;
      window.addEventListener("resize", () => {
        activeChartContainers.forEach((container) => {
          if (!document.body.contains(container)) {
            const chart = chartInstances.get(container);
            if (chart && typeof chart.dispose === "function") {
              chart.dispose();
            }
            chartInstances.delete(container);
            activeChartContainers.delete(container);
            return;
          }
          renderEchartGraph(container);
        });
      });
    };

    const disposeChart = (container) => {
      const chart = chartInstances.get(container);
      if (chart && typeof chart.dispose === "function") {
        chart.dispose();
      }
      if (chartResizeObserver) {
        chartResizeObserver.unobserve(container);
        const chartWrap = container.closest(".model-graph-chart-wrap");
        if (chartWrap instanceof HTMLElement) {
          chartResizeObserver.unobserve(chartWrap);
        }
      }
      chartInstances.delete(container);
      activeChartContainers.delete(container);
    };

    const disposeChartsInPanel = (graphPanel) => {
      Array.from(graphPanel.querySelectorAll("[data-model-echart]")).forEach(
        (container) => {
          disposeChart(container);
        },
      );
    };

    const readGraphPayload = (container) => {
      const raw = container.getAttribute("data-graph-payload") || "";
      if (raw.length === 0) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
          return null;
        }
        const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
        const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
        return {
          nodes,
          edges,
          width: typeof parsed.width === "number" ? parsed.width : 0,
          height: typeof parsed.height === "number" ? parsed.height : 0,
        };
      } catch {
        return null;
      }
    };

    const renderEchartGraph = (container) => {
      const payload = readGraphPayload(container);
      if (!payload || payload.nodes.length === 0) {
        container.innerHTML =
          '<p class="muted model-graph-empty">Graph 数据为空。</p>';
        return;
      }

      const echartsGlobal = window.echarts;
      if (!echartsGlobal || typeof echartsGlobal.init !== "function") {
        container.innerHTML =
          '<p class="muted model-graph-empty">ECharts 未加载，暂无法渲染可拖拽图。</p>';
        return;
      }

      bindChartResize();

      const rawMinX = Math.min(
        ...payload.nodes.map((node) => Number(node.x) || 0),
      );
      const rawMaxX = Math.max(
        ...payload.nodes.map((node) => Number(node.x) || 0),
      );
      const rawMinY = Math.min(
        ...payload.nodes.map((node) => Number(node.y) || 0),
      );
      const rawMaxY = Math.max(
        ...payload.nodes.map((node) => Number(node.y) || 0),
      );

      const normalizedMinX = rawMinX;
      const normalizedMinY = rawMinY;
      const spanX = Math.max(rawMaxX - rawMinX, 1);
      const spanY = Math.max(rawMaxY - rawMinY, 1);
      const sourceAspect = Math.max(spanX / spanY, 0.1);

      const chartWrap = container.closest(".model-graph-chart-wrap");
      clampChartWrapSize(chartWrap, sourceAspect);

      // 从 chartWrap 读取尺寸（因为它刚刚被设置），而不是从 container
      const width = Math.max(
        chartWrap.clientWidth || container.clientWidth,
        320,
      );
      const height = Math.max(
        chartWrap.clientHeight || container.clientHeight,
        220,
      );
      // padding 需要足够大以容纳节点（symbolSize 最大 88，半径 44）
      const viewportPadding = 50;
      const viewportWidth = Math.max(width - viewportPadding * 2, 1);
      const viewportHeight = Math.max(height - viewportPadding * 2, 1);
      const targetAspect = Math.max(viewportWidth / viewportHeight, 0.1);

      let renderWidth = viewportWidth;
      let renderHeight = viewportHeight;
      if (sourceAspect > targetAspect) {
        renderHeight = renderWidth / sourceAspect;
      } else {
        renderWidth = renderHeight * sourceAspect;
      }

      const offsetX = (viewportWidth - renderWidth) / 2;
      const offsetY = (viewportHeight - renderHeight) / 2;

      const normalizedNodes = payload.nodes.map((node) => {
        const originalX = Number(node.x) || 0;
        const originalY = Number(node.y) || 0;
        const mappedX =
          viewportPadding +
          offsetX +
          ((originalX - normalizedMinX) / spanX) * renderWidth;
        const mappedY =
          viewportPadding +
          offsetY +
          ((originalY - normalizedMinY) / spanY) * renderHeight;
        return {
          ...node,
          x: mappedX,
          y: mappedY,
        };
      });

      const data = normalizedNodes.map((node) => ({
        id: node.key,
        name: node.label,
        node_type: node.type,
        node_name: node.name,
        x: Number(node.x) || 0,
        y: Number(node.y) || 0,
        draggable: true,
        symbol: "circle",
        symbolSize:
          node.type === "from_type" ||
          node.type === "to_type" ||
          node.type === "both_type" ||
          node.type === "type"
            ? 74
            : 88,
        itemStyle: {
          color: nodeColor(node.type),
          borderColor: "#c5d3ec",
          borderWidth: 1,
        },
        label: {
          show: true,
          formatter: (params) => {
            const type = String(params.data.node_type || "unknown");
            const name = String(params.data.node_name || "-");
            if (
              type === "from_type" ||
              type === "to_type" ||
              type === "both_type" ||
              type === "type"
            ) {
              return name;
            }
            return `${type}\n${name}`;
          },
          color: "#1f2937",
          fontSize: 11,
          fontWeight: 700,
          position: "inside",
          align: "center",
          verticalAlign: "middle",
          textBorderWidth: 0,
          textShadowBlur: 0,
          lineHeight: 15,
        },
        tooltip: {
          formatter: (params) => {
            const type = String(params.data.node_type || "unknown");
            const name = String(params.data.node_name || "-");
            if (
              type === "from_type" ||
              type === "to_type" ||
              type === "both_type" ||
              type === "type"
            ) {
              return `type:${name}`;
            }
            return `${type}:${name}`;
          },
        },
      }));
      const formatEdgeValue = (edge) => {
        const domainLabel =
          edge.domain === "subject"
            ? "subject"
            : edge.domain === "object"
              ? "object"
              : edge.domain === "subject_object"
                ? "subject_object"
                : "";
        if (edge.signature_mismatch === true) {
          return `⚠ signature_mismatch · ${edge.relation_type || "related_to"}`;
        }
        if (domainLabel.length > 0) {
          return `${domainLabel} · ${edge.relation_type || "related_to"}`;
        }
        if (edge.source && edge.source.length > 0) {
          return `${edge.relation_type || "related_to"} · ${edge.source}`;
        }
        return edge.relation_type || "related_to";
      };
      const resolveEdgeColor = (edge) =>
        edge.signature_mismatch === true
          ? "#d14343"
          : typeof edge.domain_color === "string" &&
              edge.domain_color.length > 0
            ? edge.domain_color
            : edgeColor(edge.relation_type || "");
      const links = payload.edges
        .filter((edge) => {
          const from = typeof edge.from === "string" ? edge.from.trim() : "";
          const to = typeof edge.to === "string" ? edge.to.trim() : "";
          return from.length > 0 && to.length > 0;
        })
        .map((edge) => {
          const isSelfLoop = edge.from === edge.to;
          return {
            source: edge.from,
            target: edge.to,
            value: formatEdgeValue(edge),
            lineStyle: {
              color: resolveEdgeColor(edge),
              width: edge.signature_mismatch === true ? 3 : 2,
              type:
                edge.signature_mismatch === true
                  ? "dashed"
                  : edge.dashed
                    ? "dashed"
                    : "solid",
              opacity: 0.92,
              curveness: isSelfLoop ? 0.5 : undefined,
            },
          };
        });

      let chart = chartInstances.get(container);
      if (!chart) {
        chart = echartsGlobal.init(container, undefined, {
          renderer: "canvas",
        });
        chartInstances.set(container, chart);
      }
      if (chartResizeObserver) {
        chartResizeObserver.observe(container);
        if (chartWrap instanceof HTMLElement) {
          chartResizeObserver.observe(chartWrap);
        }
      }

      chart.setOption(
        {
          animationDurationUpdate: 260,
          animationEasingUpdate: "cubicOut",
          tooltip: {
            trigger: "item",
            confine: true,
          },
          series: [
            {
              type: "graph",
              layout: "none",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              roam: true,
              zoom: 1,
              edgeSymbol: ["none", "arrow"],
              edgeSymbolSize: 8,
              autoCurveness: [0.12, 0.2, 0.28, 0.36],
              data,
              links,
              emphasis: {
                focus: "adjacency",
              },
              lineStyle: {
                opacity: 0.9,
              },
              edgeLabel: {
                show: true,
                formatter: (params) => String(params.data.value || ""),
                color: "#425978",
                fontSize: 10,
                backgroundColor: "transparent",
                textBorderWidth: 0,
                textBorderColor: "transparent",
                textShadowBlur: 0,
                textShadowColor: "transparent",
                padding: 0,
              },
            },
          ],
        },
        true,
      );
      chart.resize();
      window.setTimeout(() => {
        chart.resize();
      }, 36);
      activeChartContainers.add(container);
    };

    const hydrateGraphCharts = (graphPanel) => {
      const chartNodes = Array.from(
        graphPanel.querySelectorAll("[data-model-echart]"),
      );
      chartNodes.forEach((container) => {
        renderEchartGraph(container);
      });
    };

    const scheduleHydrateGraphCharts = (graphPanel) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          hydrateGraphCharts(graphPanel);
        });
      });
    };

    const renderGraphCard = ({ title, description, emptyMessage, payload }) => {
      if (!payload) {
        return (
          `<section class="model-graph-card">` +
          `<h5>${title}</h5>` +
          `<p class="muted model-graph-empty">${emptyMessage}</p>` +
          `</section>`
        );
      }

      return (
        `<section class="model-graph-card">` +
        `<h5>${title}</h5>` +
        `<p class="muted">${description}</p>` +
        `<div class="model-graph-chart-wrap">` +
        `<div class="model-graph-echart" data-model-echart data-graph-payload="${escapeHtml(JSON.stringify(payload))}" role="img" aria-label="${escapeHtml(title)}"></div>` +
        `</div>` +
        `</section>`
      );
    };

    const renderModelGraph = (graphPanel, model) => {
      const subjectDomain = buildDomainGraphData(
        model,
        relationGraphDomainConfig.subject,
      );
      const objectDomain = buildDomainGraphData(
        model,
        relationGraphDomainConfig.object,
      );
      const subjectObjectDomain = buildDomainGraphData(
        model,
        relationGraphDomainConfig.subjectObject,
      );
      const inferenceRuleCount = readInferenceRules(model).length;
      const relationSignatureIssues = [
        ...subjectDomain.issues,
        ...objectDomain.issues,
        ...subjectObjectDomain.issues,
      ];
      const relationSignatureMismatchCount = relationSignatureIssues.length;
      const signatureTupleTotal =
        subjectDomain.signatureTupleCount +
        objectDomain.signatureTupleCount +
        subjectObjectDomain.signatureTupleCount;
      const combinedGraphTypeCatalogs = {
        subjectTypes: readCatalogItems(model, "subject_type_catalog", {
          normalize: (value) => value.toLowerCase(),
        }),
        objectTypes: readCatalogItems(model, "object_type_catalog", {
          normalize: (value) => value.toLowerCase(),
        }),
      };
      const combinedSignaturePayload = buildCombinedSignatureGraphPayload(
        {
          subject: {
            domainKey: relationGraphDomainConfig.subject.domainKey,
            payload: subjectDomain.payload,
          },
          object: {
            domainKey: relationGraphDomainConfig.object.domainKey,
            payload: objectDomain.payload,
          },
          subjectObject: {
            domainKey: relationGraphDomainConfig.subjectObject.domainKey,
            payload: subjectObjectDomain.payload,
          },
        },
        combinedGraphTypeCatalogs,
      );
      const inferencePayload = buildInferenceGraphPayload(model);
      const relationIssueHtml =
        relationSignatureIssues.length === 0
          ? ""
          : `<section class="model-graph-card">` +
            `<h5>Relation Signature 校验结果</h5>` +
            relationSignatureIssues
              .slice(0, 8)
              .map(
                (issue) =>
                  `<p class="muted model-graph-empty">⚠ ${escapeHtml(
                    issue.message,
                  )}（${escapeHtml(issue.path)}）</p>`,
              )
              .join("") +
            `</section>`;

      disposeChartsInPanel(graphPanel);
      graphPanel.innerHTML =
        `<section class="model-graph-grid">` +
        relationIssueHtml +
        renderGraphCard({
          title: "统一关系签名图（合并）",
          description:
            "单图展示全部类型节点（左=subject，右=object，中=共享）；边为 relation_type，颜色区分：蓝=subject，绿=object，紫=subject_object。",
          emptyMessage:
            "暂无可合并的签名关系，请先配置 relation_signature 与 type/relation catalogs。",
          payload: combinedSignaturePayload,
        }) +
        renderGraphCard({
          title: "Context 推理过程图",
          description:
            "左到右展示：关系输入 → inference rule → context变量 → 被哪些 policy selector 消费。",
          emptyMessage:
            "暂无 context_inference.rules，可在 JSON 中配置推理规则后查看过程图。",
          payload: inferencePayload,
        }) +
        `</section>` +
        `<p class="muted model-graph-legend">说明：可鼠标拖拽节点、滚轮缩放画布；合并签名图中边颜色区分关系域（蓝=subject，绿=object，紫=subject_object）；虚线用于 owner_ref fallback 或签名异常，红色虚线表示签名与 catalog 不一致。</p>`;
      scheduleHydrateGraphCharts(graphPanel);
    };

    editors.forEach((editor) => {
      const textarea = editor.querySelector("[data-model-json]");
      const graphPanel = editor.querySelector("[data-model-graph]");
      const switchable = editor.querySelector("[data-json-switchable]");
      const templateSelect = editor.querySelector(
        "[data-model-template-select]",
      );
      const templateMapField = editor.querySelector(
        "[data-model-template-map]",
      );
      if (!textarea) {
        return;
      }
      const modelTemplateMap = (() => {
        if (!templateMapField) {
          return {};
        }
        const raw =
          templateMapField instanceof HTMLTextAreaElement
            ? templateMapField.value
            : templateMapField.textContent || "";
        if (raw.trim().length === 0) {
          return {};
        }
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
          }
        } catch {
          return {};
        }
        return {};
      })();

      const syncGraph = () => {
        if (!graphPanel) {
          return;
        }
        const parsedModel = parseModelJson(textarea);
        disposeChartsInPanel(graphPanel);
        if (!parsedModel) {
          graphPanel.innerHTML = `<p class="muted model-graph-empty">Graph 渲染失败：当前 JSON 非法，请先修复格式。</p>`;
          return;
        }
        renderModelGraph(graphPanel, parsedModel);
      };

      const syncToJson = () => {
        const tenantId = readFieldValue(editor, "tenant_id") || "tenant_a";
        const parsedModel = parseModelJson(textarea);
        const model = parsedModel || createSkeleton(tenantId);

        model.model_meta = {
          ...(model.model_meta || {}),
          model_id:
            readFieldValue(editor, "model_id") || `${tenantId}_authz_v1`,
          tenant_id: tenantId,
          version: readFieldValue(editor, "version") || "2026.03.04",
          status: "draft",
          combining_algorithm:
            readFieldValue(editor, "combining_algorithm") || "deny-overrides",
        };
        model.catalogs = {
          ...(model.catalogs || {}),
          action_catalog: readTextList(editor, "action_catalog"),
          subject_type_catalog: readTextList(editor, "subject_type_catalog"),
          object_type_catalog: readTextList(editor, "object_type_catalog"),
          subject_relation_type_catalog: readTextList(
            editor,
            "subject_relation_type_catalog",
          ),
          object_relation_type_catalog: readTextList(
            editor,
            "object_relation_type_catalog",
          ),
          subject_object_relation_type_catalog: readTextList(
            editor,
            "subject_object_relation_type_catalog",
          ),
        };

        if (!model.policies || typeof model.policies !== "object") {
          model.policies = { rules: [] };
        }
        const currentRules = Array.isArray(model.policies.rules)
          ? model.policies.rules
          : [];
        const firstRule =
          currentRules[0] &&
          typeof currentRules[0] === "object" &&
          !Array.isArray(currentRules[0])
            ? currentRules[0]
            : {};
        model.policies.rules = [
          {
            ...firstRule,
            id: readFieldValue(editor, "rule_id") || "rule_read_kb",
            subject_selector:
              readFieldValue(editor, "rule_subject_selector") ||
              "subject.relations includes member_of(group:g1)",
            object_selector:
              readFieldValue(editor, "rule_object_selector") ||
              "object.type == kb",
            action_set: readTextList(editor, "rule_action_set"),
            effect: readFieldValue(editor, "rule_effect") || "allow",
            priority: readNumber(editor, "rule_priority", 100),
          },
          ...currentRules.slice(1),
        ];

        if (
          !model.quality_guardrails ||
          typeof model.quality_guardrails !== "object"
        ) {
          model.quality_guardrails = {};
        }
        model.quality_guardrails = {
          ...(model.quality_guardrails || {}),
          mandatory_obligations: readTextList(editor, "mandatory_obligations"),
        };

        textarea.value = JSON.stringify(model, null, 2);
        syncGraph();
      };

      const syncFromJson = () => {
        const model = parseModelJson(textarea);
        if (!model) {
          window.alert("Model JSON 解析失败，请检查格式。");
          return;
        }

        const meta =
          model.model_meta && typeof model.model_meta === "object"
            ? model.model_meta
            : {};
        const catalogs =
          model.catalogs && typeof model.catalogs === "object"
            ? model.catalogs
            : {};
        const policies =
          model.policies && typeof model.policies === "object"
            ? model.policies
            : {};
        const rules = Array.isArray(policies.rules) ? policies.rules : [];
        const firstRule =
          rules[0] && typeof rules[0] === "object" && !Array.isArray(rules[0])
            ? rules[0]
            : {};
        const guardrails =
          model.quality_guardrails &&
          typeof model.quality_guardrails === "object"
            ? model.quality_guardrails
            : {};

        writeFieldValue(editor, "model_id", String(meta.model_id || ""));
        writeFieldValue(editor, "tenant_id", String(meta.tenant_id || ""));
        writeFieldValue(editor, "version", String(meta.version || ""));
        writeFieldValue(
          editor,
          "combining_algorithm",
          String(meta.combining_algorithm || "deny-overrides"),
        );

        writeFieldValue(
          editor,
          "action_catalog",
          Array.isArray(catalogs.action_catalog)
            ? catalogs.action_catalog.join("\n")
            : "",
        );
        writeFieldValue(
          editor,
          "subject_type_catalog",
          Array.isArray(catalogs.subject_type_catalog)
            ? catalogs.subject_type_catalog.join("\n")
            : "",
        );
        writeFieldValue(
          editor,
          "object_type_catalog",
          Array.isArray(catalogs.object_type_catalog)
            ? catalogs.object_type_catalog.join("\n")
            : "",
        );
        writeFieldValue(
          editor,
          "subject_relation_type_catalog",
          Array.isArray(catalogs.subject_relation_type_catalog)
            ? catalogs.subject_relation_type_catalog.join("\n")
            : "",
        );
        writeFieldValue(
          editor,
          "object_relation_type_catalog",
          Array.isArray(catalogs.object_relation_type_catalog)
            ? catalogs.object_relation_type_catalog.join("\n")
            : "",
        );
        writeFieldValue(
          editor,
          "subject_object_relation_type_catalog",
          Array.isArray(catalogs.subject_object_relation_type_catalog)
            ? catalogs.subject_object_relation_type_catalog.join("\n")
            : "",
        );

        writeFieldValue(editor, "rule_id", String(firstRule.id || ""));
        writeFieldValue(
          editor,
          "rule_effect",
          String(firstRule.effect || "allow"),
        );
        writeFieldValue(
          editor,
          "rule_priority",
          String(firstRule.priority || 100),
        );
        writeFieldValue(
          editor,
          "rule_action_set",
          Array.isArray(firstRule.action_set)
            ? firstRule.action_set.join("\n")
            : "",
        );
        writeFieldValue(
          editor,
          "rule_subject_selector",
          String(firstRule.subject_selector || ""),
        );
        writeFieldValue(
          editor,
          "rule_object_selector",
          String(firstRule.object_selector || ""),
        );

        writeFieldValue(
          editor,
          "mandatory_obligations",
          Array.isArray(guardrails.mandatory_obligations)
            ? guardrails.mandatory_obligations.join("\n")
            : "",
        );
        syncGraph();
      };

      const applyTemplate = (templateId) => {
        const normalizedTemplateId =
          typeof templateId === "string" ? templateId.trim() : "";
        if (normalizedTemplateId.length === 0) {
          return;
        }
        const nextTemplate = modelTemplateMap[normalizedTemplateId];
        if (
          !nextTemplate ||
          typeof nextTemplate !== "object" ||
          Array.isArray(nextTemplate)
        ) {
          return;
        }
        textarea.value = JSON.stringify(nextTemplate, null, 2);
        syncFromJson();
      };

      const fields = Array.from(editor.querySelectorAll("[data-model-field]"));
      fields.forEach((field) => {
        const eventType = field.tagName === "SELECT" ? "change" : "input";
        field.addEventListener(eventType, syncToJson);
      });

      if (templateSelect) {
        templateSelect.addEventListener("change", () => {
          applyTemplate(templateSelect.value);
        });
      }

      const applyJsonButton = editor.querySelector("[data-apply-model-json]");
      if (applyJsonButton) {
        applyJsonButton.addEventListener("click", syncFromJson);
      }

      textarea.addEventListener("input", syncGraph);
      syncToJson();

      document.addEventListener("acl:model-graph-visible", (event) => {
        if (!graphPanel || !switchable) {
          return;
        }
        const targetId =
          event.detail && typeof event.detail.switchableId === "string"
            ? event.detail.switchableId
            : "";
        const currentId =
          switchable.getAttribute("data-json-switchable-id") || "";
        if (targetId.length > 0 && currentId !== targetId) {
          return;
        }
        scheduleHydrateGraphCharts(graphPanel);
      });
    });
  }

  function init() {
    initTabNav();
    initMatrixDrawer();
    initJsonViewToggles();
    initModelEditors();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    return;
  }
  init();
})();
