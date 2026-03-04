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
        relation_type_catalog: [],
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

    const readRelationItems = (model, key) => {
      if (!model.relations || typeof model.relations !== "object") {
        return [];
      }
      const items = model.relations[key];
      if (!Array.isArray(items)) {
        return [];
      }
      return items
        .filter(
          (item) => item && typeof item === "object" && !Array.isArray(item),
        )
        .map((item) => ({
          from: typeof item.from === "string" ? item.from.trim() : "",
          to: typeof item.to === "string" ? item.to.trim() : "",
          relation_type:
            typeof item.relation_type === "string"
              ? item.relation_type.trim()
              : "",
          source: typeof item.source === "string" ? item.source.trim() : "",
        }))
        .filter((item) => item.from.length > 0 && item.to.length > 0);
    };

    const parseEntityRef = (value) => {
      const raw = String(value || "").trim();
      const parts = raw.split(":");
      const head = parts[0] || "";
      const tail = parts.slice(1).join(":");
      const type = head.trim().toLowerCase() || "unknown";
      const name =
        tail.trim().length > 0 ? tail.trim() : head.trim() || "unknown";
      return {
        key: raw,
        type,
        name,
        label: `${type}:${name}`,
      };
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
      return "#5c6882";
    };

    const buildSubjectGraphPayload = (model) => {
      const edges = readRelationItems(model, "subject_relations");
      if (edges.length === 0) {
        return null;
      }

      const levelOrder = ["company", "department", "user"];
      const nodeMap = new Map();
      edges.forEach((edge) => {
        [edge.from, edge.to].forEach((value) => {
          if (!nodeMap.has(value)) {
            nodeMap.set(value, parseEntityRef(value));
          }
        });
      });

      const levels = new Map();
      nodeMap.forEach((node) => {
        const level = levelOrder.includes(node.type) ? node.type : "other";
        if (!levels.has(level)) {
          levels.set(level, []);
        }
        levels.get(level).push(node);
      });

      const orderedLevels = [...levelOrder, "other"].filter((key) =>
        levels.has(key),
      );
      const maxColumns = Math.max(
        ...orderedLevels.map((key) => levels.get(key).length),
        1,
      );
      const horizontalGap = 210;
      const verticalGap = 140;
      const marginX = 110;
      const marginY = 70;
      const width = marginX * 2 + (maxColumns - 1) * horizontalGap + 40;
      const height =
        marginY * 2 + (orderedLevels.length - 1) * verticalGap + 40;

      const positionedNodes = [];
      const positionedNodeMap = new Map();
      orderedLevels.forEach((level, rowIndex) => {
        const rowNodes = levels
          .get(level)
          .sort((a, b) => a.label.localeCompare(b.label));
        const rowWidth = (rowNodes.length - 1) * horizontalGap;
        const rowStartX = (width - rowWidth) / 2;
        const y = marginY + rowIndex * verticalGap;
        rowNodes.forEach((node, columnIndex) => {
          const nextNode = {
            ...node,
            x: rowStartX + columnIndex * horizontalGap,
            y,
          };
          positionedNodes.push(nextNode);
          positionedNodeMap.set(node.key, nextNode);
        });
      });

      return {
        nodes: positionedNodes,
        edges: edges.map((edge) => ({
          ...edge,
          dashed: edge.source === "derived_closure",
        })),
        width,
        height,
      };
    };

    const computeDepth = (nodes, edges) => {
      const incoming = new Map();
      nodes.forEach((node) => {
        incoming.set(node.key, 0);
      });
      edges.forEach((edge) => {
        if (incoming.has(edge.to)) {
          incoming.set(edge.to, incoming.get(edge.to) + 1);
        }
      });

      const queue = [];
      const depthMap = new Map();
      nodes.forEach((node) => {
        const degree = incoming.get(node.key) || 0;
        if (degree === 0) {
          queue.push(node.key);
          depthMap.set(node.key, 0);
        }
      });

      while (queue.length > 0) {
        const current = queue.shift();
        const currentDepth = depthMap.get(current) || 0;
        edges
          .filter((edge) => edge.from === current)
          .forEach((edge) => {
            const nextDepth = Math.max(
              depthMap.get(edge.to) || 0,
              currentDepth + 1,
            );
            depthMap.set(edge.to, nextDepth);
            incoming.set(edge.to, (incoming.get(edge.to) || 1) - 1);
            if ((incoming.get(edge.to) || 0) <= 0) {
              queue.push(edge.to);
            }
          });
      }

      nodes.forEach((node) => {
        if (!depthMap.has(node.key)) {
          depthMap.set(node.key, 0);
        }
      });
      return depthMap;
    };

    const buildObjectGraphPayload = (model) => {
      const edges = readRelationItems(model, "object_relations");
      if (edges.length === 0) {
        return null;
      }

      const objectTypeCatalog =
        model.catalogs &&
        typeof model.catalogs === "object" &&
        Array.isArray(model.catalogs.object_type_catalog)
          ? model.catalogs.object_type_catalog
              .filter((item) => typeof item === "string")
              .map((item) => item.trim().toLowerCase())
              .filter((item) => item.length > 0)
          : [];
      const objectTypeSet = new Set(objectTypeCatalog);

      const nodeMap = new Map();
      edges.forEach((edge) => {
        [edge.from, edge.to].forEach((value) => {
          if (!nodeMap.has(value)) {
            nodeMap.set(value, parseEntityRef(value));
          }
        });
      });

      const objectNodes = [...nodeMap.values()].filter((node) =>
        objectTypeSet.has(node.type),
      );
      const objectNodeSet = new Set(objectNodes.map((node) => node.key));
      const contextNodes = [...nodeMap.values()].filter(
        (node) => !objectNodeSet.has(node.key),
      );

      if (objectNodes.length === 0) {
        return {
          invalid: true,
        };
      }

      const deriveEdges = edges.filter(
        (edge) =>
          edge.relation_type === "derives_to" &&
          objectNodeSet.has(edge.from) &&
          objectNodeSet.has(edge.to),
      );
      const ownershipEdges = edges.filter(
        (edge) =>
          objectNodeSet.has(edge.from) && edge.relation_type !== "derives_to",
      );

      const depthMap = computeDepth(objectNodes, deriveEdges);
      const maxDepth = Math.max(
        ...objectNodes.map((node) => depthMap.get(node.key) || 0),
        0,
      );
      const columns = new Map();
      objectNodes.forEach((node) => {
        const depth = depthMap.get(node.key) || 0;
        if (!columns.has(depth)) {
          columns.set(depth, []);
        }
        columns.get(depth).push(node);
      });

      const marginX = 120;
      const marginY = 80;
      const columnGap = 220;
      const rowGap = 120;
      const contextColumnX = marginX + (maxDepth + 1) * columnGap + 220;
      const width =
        contextNodes.length > 0
          ? contextColumnX + 200
          : marginX * 2 + maxDepth * columnGap + 220;
      const maxObjectRows = Math.max(
        ...[...columns.values()].map((group) => group.length),
        1,
      );
      const contextRows = Math.max(contextNodes.length, 1);
      const contentRows = Math.max(maxObjectRows, contextRows);
      const height = marginY * 2 + (contentRows - 1) * rowGap + 30;

      const positionedNodes = [];
      const positionedNodeMap = new Map();

      [...columns.keys()]
        .sort((a, b) => a - b)
        .forEach((depth) => {
          const columnNodes = columns
            .get(depth)
            .sort((a, b) => a.label.localeCompare(b.label));
          const columnHeight = (columnNodes.length - 1) * rowGap;
          const startY = (height - columnHeight) / 2;
          const x = marginX + depth * columnGap;
          columnNodes.forEach((node, index) => {
            const nextNode = {
              ...node,
              x,
              y: startY + index * rowGap,
            };
            positionedNodes.push(nextNode);
            positionedNodeMap.set(node.key, nextNode);
          });
        });

      const sortedContextNodes = contextNodes.sort((a, b) =>
        a.label.localeCompare(b.label),
      );
      const contextHeight = (sortedContextNodes.length - 1) * rowGap;
      const contextStartY = (height - contextHeight) / 2;
      sortedContextNodes.forEach((node, index) => {
        const nextNode = {
          ...node,
          x: contextColumnX,
          y: contextStartY + index * rowGap,
        };
        positionedNodes.push(nextNode);
        positionedNodeMap.set(node.key, nextNode);
      });

      return {
        nodes: positionedNodes,
        edges: [
          ...deriveEdges.map((edge) => ({ ...edge, dashed: false })),
          ...ownershipEdges.map((edge) => ({
            ...edge,
            dashed: edge.source === "derived_closure",
          })),
        ],
        width,
        height,
      };
    };

    const chartInstances = new WeakMap();
    const activeChartContainers = new Set();
    let chartResizeBound = false;

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
      if (chartWrap instanceof HTMLElement) {
        const wrapWidth = Math.max(chartWrap.clientWidth, 320);
        const idealHeight = Math.round(wrapWidth / sourceAspect);
        const nextHeight = Math.max(220, Math.min(idealHeight, 760));
        const currentHeight = Math.round(chartWrap.getBoundingClientRect().height);
        if (Math.abs(nextHeight - currentHeight) > 1) {
          chartWrap.style.height = `${nextHeight}px`;
        }
      }

      const width = Math.max(container.clientWidth, 320);
      const height = Math.max(container.clientHeight, 220);
      const viewportPadding = 44;
      const viewportWidth = Math.max(width - viewportPadding * 2, 1);
      const viewportHeight = Math.max(height - viewportPadding * 2, 1);
      const targetAspect = Math.max(
        viewportWidth / viewportHeight,
        0.1,
      );

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
        symbolSize: 88,
        itemStyle: {
          color: nodeColor(node.type),
          borderColor: "#c5d3ec",
          borderWidth: 1,
        },
        label: {
          show: true,
          formatter: (params) =>
            `${String(params.data.node_type || "unknown")}\n${String(params.data.node_name || "-")}`,
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
          formatter: (params) =>
            `${String(params.data.node_type || "unknown")}:${String(params.data.node_name || "-")}`,
        },
      }));

      const links = payload.edges.map((edge) => ({
        source: edge.from,
        target: edge.to,
        value:
          edge.source && edge.source.length > 0
            ? `${edge.relation_type || "related_to"} · ${edge.source}`
            : edge.relation_type || "related_to",
        lineStyle: {
          color: edgeColor(edge.relation_type || ""),
          width: 2,
          type: edge.dashed ? "dashed" : "solid",
          opacity: 0.92,
          curveness: 0.08,
        },
      }));

      let chart = chartInstances.get(container);
      if (!chart) {
        chart = echartsGlobal.init(container, undefined, {
          renderer: "canvas",
        });
        chartInstances.set(container, chart);
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

      if (payload.invalid === true) {
        return (
          `<section class="model-graph-card">` +
          `<h5>${title}</h5>` +
          `<p class="muted model-graph-empty">未识别到 object 节点，请检查 catalogs.object_type_catalog 与 object_relations 是否匹配。</p>` +
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
      const subjectCount = readRelationItems(model, "subject_relations").length;
      const objectCount = readRelationItems(model, "object_relations").length;
      const subjectPayload = buildSubjectGraphPayload(model);
      const objectPayload = buildObjectGraphPayload(model);

      disposeChartsInPanel(graphPanel);
      graphPanel.innerHTML =
        `<div class="model-graph-summary">` +
        `<span>subject_relations: <strong>${subjectCount}</strong></span>` +
        `<span>object_relations: <strong>${objectCount}</strong></span>` +
        `</div>` +
        `<section class="model-graph-grid">` +
        renderGraphCard({
          title: "Subject 层级图",
          description:
            "按 company → department → user 排布，支持拖拽节点重新组织视角。",
          emptyMessage:
            "暂无 subject_relations，可在 JSON 中补充 user/department/company 边。",
          payload: subjectPayload,
        }) +
        renderGraphCard({
          title: "Object 衍生图",
          description:
            "主链路展示 derives_to；对象到组织的 owned_by / in_company 边用于补充上下文。",
          emptyMessage:
            "暂无 object_relations，可在 JSON 中补充 derives_to / owned_by_department / in_company 边。",
          payload: objectPayload,
        }) +
        `</section>` +
        `<p class="muted model-graph-legend">说明：可鼠标拖拽节点、滚轮缩放画布；虚线表示 source=derived_closure。</p>`;
      scheduleHydrateGraphCharts(graphPanel);
    };

    editors.forEach((editor) => {
      const textarea = editor.querySelector("[data-model-json]");
      const graphPanel = editor.querySelector("[data-model-graph]");
      const switchable = editor.querySelector("[data-json-switchable]");
      if (!textarea) {
        return;
      }

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
          relation_type_catalog: readTextList(editor, "relation_type_catalog"),
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
          "relation_type_catalog",
          Array.isArray(catalogs.relation_type_catalog)
            ? catalogs.relation_type_catalog.join("\n")
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

      const fields = Array.from(editor.querySelectorAll("[data-model-field]"));
      fields.forEach((field) => {
        const eventType = field.tagName === "SELECT" ? "change" : "input";
        field.addEventListener(eventType, syncToJson);
      });

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
