(() => {
  const TAB_LABEL_MAP = {
    workflow: "发布流程",
    system: "系统状态",
    simulation: "影响模拟",
    relations: "关系回放",
    control: "控制面维护",
    components: "组件索引",
  };

  const VALID_TABS = Object.keys(TAB_LABEL_MAP);
  const DASHBOARD_RUNTIME = {
    syncActiveTabFromUrl: null,
    applyMatrixDrawerLink: null,
    syncMatrixDrawerFromUrl: null,
    hydrateModelGraphs: null,
    renderVisibleInstanceGraphs: null,
    handleInstanceResize: null,
  };
  const TAB_CLEAR_PARAMS = {
    workflow: ["decision_id", "simulation_id", "cell_key"],
    system: [
      "decision_id",
      "simulation_id",
      "cell_key",
      "fixture_id",
      "expectation_run_id",
      "status",
      "profile",
    ],
    simulation: ["decision_id", "cell_key"],
    relations: ["simulation_id", "cell_key"],
    control: ["publish_id", "decision_id", "simulation_id", "cell_key"],
    components: [
      "publish_id",
      "decision_id",
      "simulation_id",
      "cell_key",
      "status",
      "profile",
    ],
  };

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

  function formatTime(value) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return value;
    }
    return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
  }

  function normalizePositiveInt(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
  }

  const CONTROL_INCREMENTAL_FORM_SELECTOR =
    'form[data-control-incremental="true"]';
  const CONTROL_INCREMENTAL_REPLACE_SELECTORS = [
    "main.shell > .hero",
    "[data-control-runtime-summary]",
    "[data-control-fixed-runtime]",
    "[data-control-object-relation-visual]",
    'form[data-control-namespace-form="true"]',
    'form[data-control-setup-form="true"]',
    'form[data-control-instance-json-form="true"]',
    "[data-expectation-run-section]",
    '[data-tab-panel="simulation"]',
    '[data-tab-panel="relations"]',
  ];
  const VANILLA_JSONEDITOR_MODULE_PATH = "/assets/vanilla-jsoneditor.js";
  let vanillaJsonEditorModulePromise = null;

  function loadVanillaJsonEditorModule() {
    if (vanillaJsonEditorModulePromise) {
      return vanillaJsonEditorModulePromise;
    }

    vanillaJsonEditorModulePromise = import(
      VANILLA_JSONEDITOR_MODULE_PATH
    ).catch((error) => {
      vanillaJsonEditorModulePromise = null;
      throw error;
    });
    return vanillaJsonEditorModulePromise;
  }

  function initControlIncrementalRefresh() {
    if (
      document.body.getAttribute("data-control-incremental-refresh-bound") ===
      "true"
    ) {
      return;
    }
    document.body.setAttribute(
      "data-control-incremental-refresh-bound",
      "true",
    );

    const replaceBySelector = (nextDoc, selector) => {
      const currentNode = document.querySelector(selector);
      const nextNode = nextDoc.querySelector(selector);
      if (!currentNode || !nextNode) {
        return false;
      }
      currentNode.replaceWith(nextNode.cloneNode(true));
      return true;
    };

    const syncFlashSection = (nextDoc) => {
      const currentFlash = document.querySelector(".system-notice-layer");
      const nextFlash = nextDoc.querySelector(".system-notice-layer");
      if (currentFlash && nextFlash) {
        currentFlash.replaceWith(nextFlash.cloneNode(true));
        return true;
      }
      if (currentFlash && !nextFlash) {
        currentFlash.remove();
        return true;
      }
      if (!currentFlash && nextFlash) {
        document.body.append(nextFlash.cloneNode(true));
        return true;
      }
      return false;
    };

    const readTextPayload = (node) => {
      if (node instanceof HTMLTextAreaElement) {
        return node.value;
      }
      return node.textContent || "";
    };

    const writeTextPayload = (node, value) => {
      if (node instanceof HTMLTextAreaElement) {
        node.value = value;
        return;
      }
      node.textContent = value;
    };

    const syncInstanceGraphPayload = (nextDoc) => {
      const currentPayloadNode = document.querySelector(
        "[data-instance-graph-payload]",
      );
      const nextPayloadNode = nextDoc.querySelector(
        "[data-instance-graph-payload]",
      );
      if (!currentPayloadNode || !nextPayloadNode) {
        return false;
      }

      const nextValue = readTextPayload(nextPayloadNode);
      const currentValue = readTextPayload(currentPayloadNode);
      if (currentValue === nextValue) {
        return false;
      }

      writeTextPayload(currentPayloadNode, nextValue);
      const switchable = currentPayloadNode.closest("[data-json-switchable]");
      const graphView = switchable?.querySelector('[data-json-view="graph"]');
      if (graphView && !graphView.hidden) {
        document.dispatchEvent(
          new CustomEvent("acl:model-graph-visible", {
            detail: {
              switchableId:
                switchable.getAttribute("data-json-switchable-id") || "",
            },
          }),
        );
      }
      return true;
    };

    const applyControlPartialUpdate = (nextDoc, selectors) => {
      let changed = false;
      selectors.forEach((selector) => {
        if (replaceBySelector(nextDoc, selector)) {
          changed = true;
        }
      });
      if (syncFlashSection(nextDoc)) {
        changed = true;
      }
      if (syncInstanceGraphPayload(nextDoc)) {
        changed = true;
      }
      if (nextDoc.title && nextDoc.title.trim().length > 0) {
        document.title = nextDoc.title;
      }
      return changed;
    };

    const resolveIncrementalReplaceSelectors = (form) => {
      const customTargets = parseCsvLines(
        form.getAttribute("data-control-incremental-target") || "",
      );
      if (customTargets.length > 0) {
        return customTargets;
      }
      return CONTROL_INCREMENTAL_REPLACE_SELECTORS;
    };

    const restoreWindowScroll = (x, y) => {
      const targetX = Number.isFinite(x) ? x : 0;
      const targetY = Number.isFinite(y) ? y : 0;

      window.scrollTo({
        left: targetX,
        top: targetY,
        behavior: "auto",
      });

      window.requestAnimationFrame(() => {
        window.scrollTo({
          left: targetX,
          top: targetY,
          behavior: "auto",
        });
      });
    };

    const readAnchorContext = (form) => {
      if (!(form instanceof HTMLFormElement)) {
        return null;
      }

      if (form.matches('form[data-expectation-preview-form="true"]')) {
        const card = form.closest("[data-expectation-run-section]");
        if (!(card instanceof HTMLElement)) {
          return null;
        }
        return {
          selector: "[data-expectation-run-section]",
          top: card.getBoundingClientRect().top,
        };
      }

      return null;
    };

    const restoreAnchorContext = (anchorContext) => {
      if (!anchorContext) {
        return;
      }

      const restore = () => {
        const node = document.querySelector(anchorContext.selector);
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const delta = node.getBoundingClientRect().top - anchorContext.top;
        if (Math.abs(delta) > 1) {
          window.scrollBy({ left: 0, top: delta, behavior: "auto" });
        }
      };

      restore();
      window.requestAnimationFrame(() => {
        restore();
        window.requestAnimationFrame(restore);
      });
    };

    const toGetRequestUrl = (form) => {
      const actionUrl = new URL(
        form.getAttribute("action") || window.location.href,
        window.location.href,
      );
      const formData = new FormData(form);
      const params = new URLSearchParams();
      formData.forEach((value, key) => {
        if (typeof value === "string") {
          params.append(key, value);
        }
      });
      actionUrl.search = params.toString();
      return actionUrl.toString();
    };

    const fallbackNativeSubmit = (form) => {
      form.setAttribute("data-control-incremental-bypass", "true");
      form.removeAttribute("data-control-incremental-pending");
      HTMLFormElement.prototype.submit.call(form);
    };

    const buildPostBody = (form) => {
      const formData = new FormData(form);
      let hasBinaryPayload = false;
      const urlencoded = new URLSearchParams();
      formData.forEach((value, key) => {
        if (typeof value === "string") {
          urlencoded.append(key, value);
          return;
        }
        hasBinaryPayload = true;
      });
      return hasBinaryPayload ? formData : urlencoded;
    };

    document.addEventListener("submit", async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) {
        return;
      }
      if (!form.matches(CONTROL_INCREMENTAL_FORM_SELECTOR)) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      if (form.getAttribute("data-control-incremental-bypass") === "true") {
        form.removeAttribute("data-control-incremental-bypass");
        return;
      }
      if (form.getAttribute("data-control-incremental-pending") === "true") {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      form.setAttribute("data-control-incremental-pending", "true");

      const submitButtons = Array.from(
        form.querySelectorAll('button[type="submit"], input[type="submit"]'),
      );
      const prevDisabledStates = submitButtons.map((button) => button.disabled);
      submitButtons.forEach((button) => {
        button.disabled = true;
      });

      let usedNativeFallback = false;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const anchorContext = readAnchorContext(form);
      try {
        const method = (form.getAttribute("method") || "GET")
          .trim()
          .toUpperCase();
        let response;
        if (method === "GET") {
          const requestUrl = toGetRequestUrl(form);
          response = await fetch(requestUrl, {
            method: "GET",
            headers: {
              Accept: "text/html,application/xhtml+xml",
            },
          });
        } else {
          const requestUrl = new URL(
            form.getAttribute("action") || window.location.href,
            window.location.href,
          );
          const body = buildPostBody(form);
          response = await fetch(requestUrl.toString(), {
            method,
            body,
            headers: {
              Accept: "text/html,application/xhtml+xml",
            },
          });
        }

        const contentType = response.headers.get("content-type") || "";
        if (!response.ok || !contentType.includes("text/html")) {
          usedNativeFallback = true;
          fallbackNativeSubmit(form);
          return;
        }

        const html = await response.text();
        const nextDoc = new DOMParser().parseFromString(html, "text/html");
        const changed = applyControlPartialUpdate(
          nextDoc,
          resolveIncrementalReplaceSelectors(form),
        );
        if (!changed) {
          usedNativeFallback = true;
          fallbackNativeSubmit(form);
          return;
        }

        if (response.url && response.url.length > 0) {
          window.history.replaceState(window.history.state, "", response.url);
        }

        document.dispatchEvent(new CustomEvent("acl:control-partial-updated"));

        if (anchorContext) {
          restoreAnchorContext(anchorContext);
        } else {
          restoreWindowScroll(scrollX, scrollY);
        }
      } catch {
        usedNativeFallback = true;
        fallbackNativeSubmit(form);
      } finally {
        if (!usedNativeFallback) {
          form.removeAttribute("data-control-incremental-pending");
          submitButtons.forEach((button, index) => {
            if (!button.isConnected) {
              return;
            }
            button.disabled = prevDisabledStates[index] ?? false;
          });
        }
      }
    });
  }

  function initSystemNotices() {
    if (document.body.getAttribute("data-system-notice-bound") === "true") {
      return;
    }
    document.body.setAttribute("data-system-notice-bound", "true");

    const NOTICE_SELECTOR = ".system-notice-layer";
    const NOTICE_CLOSE_DELAY_MS = 4200;
    const NOTICE_EXIT_DURATION_MS = 180;

    const stripFlashQueryParams = () => {
      const nextUrl = new URL(window.location.href);
      let changed = false;
      ["flash_type", "flash_message"].forEach((key) => {
        if (!nextUrl.searchParams.has(key)) {
          return;
        }
        nextUrl.searchParams.delete(key);
        changed = true;
      });
      if (!changed) {
        return;
      }
      const nextLocation = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
      window.history.replaceState(window.history.state, "", nextLocation);
    };

    const clearDismissTimer = (layer) => {
      const timerId = Number(
        layer.getAttribute("data-system-notice-timer-id") || "",
      );
      if (Number.isInteger(timerId) && timerId > 0) {
        window.clearTimeout(timerId);
      }
      layer.removeAttribute("data-system-notice-timer-id");
    };

    const dismissNotice = (layer) => {
      if (!(layer instanceof HTMLElement)) {
        return;
      }
      clearDismissTimer(layer);
      if (layer.getAttribute("data-system-notice-dismissed") === "true") {
        return;
      }
      layer.setAttribute("data-system-notice-dismissed", "true");
      layer.classList.add("is-leaving");
      window.setTimeout(() => {
        if (layer.isConnected) {
          layer.remove();
        }
      }, NOTICE_EXIT_DURATION_MS);
    };

    const bindCloseButton = (layer) => {
      const closeButton = layer.querySelector("[data-system-notice-close]");
      if (!(closeButton instanceof HTMLButtonElement)) {
        return;
      }
      if (
        closeButton.getAttribute("data-system-notice-close-bound") === "true"
      ) {
        return;
      }
      closeButton.setAttribute("data-system-notice-close-bound", "true");
      closeButton.addEventListener("click", () => {
        dismissNotice(layer);
      });
    };

    const activateNotice = () => {
      const layer = document.querySelector(NOTICE_SELECTOR);
      if (!(layer instanceof HTMLElement)) {
        return;
      }

      if (layer.parentElement !== document.body) {
        document.body.append(layer);
      }

      layer.classList.remove("is-leaving");
      layer.removeAttribute("data-system-notice-dismissed");
      bindCloseButton(layer);
      clearDismissTimer(layer);

      const timerId = window.setTimeout(() => {
        dismissNotice(layer);
      }, NOTICE_CLOSE_DELAY_MS);
      layer.setAttribute("data-system-notice-timer-id", String(timerId));

      window.requestAnimationFrame(() => {
        stripFlashQueryParams();
      });
    };

    activateNotice();
    document.addEventListener("acl:control-partial-updated", activateNotice);
  }

  function initSetupFixturePreviewForm() {
    if (
      document.body.getAttribute("data-control-setup-preview-bound") === "true"
    ) {
      return;
    }
    document.body.setAttribute("data-control-setup-preview-bound", "true");

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) {
        return;
      }
      if (
        !target.matches(
          'form[data-control-setup-preview-form="true"] select[name="fixture_id"], form[data-expectation-preview-form="true"] select[name="fixture_id"]',
        )
      ) {
        return;
      }
      const form = target.closest(
        'form[data-control-setup-preview-form="true"], form[data-expectation-preview-form="true"]',
      );
      if (!(form instanceof HTMLFormElement)) {
        return;
      }
      form.requestSubmit();
    });
  }

  function initJsonFilePickers() {
    if (document.body.getAttribute("data-json-file-picker-bound") === "true") {
      return;
    }
    document.body.setAttribute("data-json-file-picker-bound", "true");

    document.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      if (!target.matches("input[type=file][data-json-file-input]")) {
        return;
      }

      const [file] = Array.from(target.files || []);
      if (!file) {
        return;
      }

      const textareaId = target.getAttribute("data-json-file-target") || "";
      const textarea = document.getElementById(textareaId);
      if (!(textarea instanceof HTMLTextAreaElement)) {
        return;
      }

      try {
        textarea.value = await file.text();
      } catch {
        return;
      }

      const fileNameTargetId =
        target.getAttribute("data-json-file-name-target") || "";
      const fileNameTarget = document.getElementById(fileNameTargetId);
      if (fileNameTarget instanceof HTMLInputElement) {
        fileNameTarget.value = file.name;
      }

      const fixtureTargetId =
        target.getAttribute("data-json-file-fixture-target") || "";
      const fixtureTarget = document.getElementById(fixtureTargetId);
      if (
        fixtureTarget instanceof HTMLInputElement ||
        fixtureTarget instanceof HTMLSelectElement
      ) {
        const matched = file.name.match(/^(.*)\.expected\.json$/u);
        if (matched && matched[1]) {
          fixtureTarget.value = matched[1];
        }
      }

      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function initTabNav() {
    const tabNav = document.querySelector(".tab-nav");
    if (!tabNav) {
      return;
    }

    const setActiveTab = (tab, pushHistory) => {
      const picked = normalizeTab(tab);
      const links = Array.from(tabNav.querySelectorAll(".tab-link[data-tab]"));
      const panels = Array.from(document.querySelectorAll("[data-tab-panel]"));
      const tabBadge = document.querySelector("[data-tab-label]");
      const tabInputs = Array.from(
        document.querySelectorAll('input[name="tab"]'),
      );

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
      (TAB_CLEAR_PARAMS[picked] || []).forEach((key) => {
        url.searchParams.delete(key);
      });
      if (pushHistory) {
        window.history.pushState({ tab: picked }, "", url);
      } else {
        window.history.replaceState({ tab: picked }, "", url);
      }
    };

    if (tabNav.getAttribute("data-tab-nav-bound") !== "true") {
      tabNav.setAttribute("data-tab-nav-bound", "true");
      tabNav.addEventListener("click", (event) => {
        const target = event.target;
        const node =
          target instanceof Element
            ? target.closest(".tab-link[data-tab]")
            : null;
        if (!(node instanceof HTMLAnchorElement) || !tabNav.contains(node)) {
          return;
        }
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
    }

    DASHBOARD_RUNTIME.syncActiveTabFromUrl = () => {
      const tab =
        new URL(window.location.href).searchParams.get("tab") || "workflow";
      setActiveTab(tab, false);
    };

    if (
      document.body.getAttribute("data-dashboard-popstate-bound") !== "true"
    ) {
      document.body.setAttribute("data-dashboard-popstate-bound", "true");
      window.addEventListener("popstate", () => {
        if (typeof DASHBOARD_RUNTIME.syncActiveTabFromUrl === "function") {
          DASHBOARD_RUNTIME.syncActiveTabFromUrl();
        }
        if (typeof DASHBOARD_RUNTIME.syncMatrixDrawerFromUrl === "function") {
          DASHBOARD_RUNTIME.syncMatrixDrawerFromUrl();
        }
      });
    }

    DASHBOARD_RUNTIME.syncActiveTabFromUrl();
  }

  function initMatrixDrawer() {
    const DRAWER_EMPTY_HTML =
      '<p class="muted">点击矩阵单元格可打开详情抽屉。</p>';

    const readMatrixState = () => {
      const drawer = document.querySelector("[data-matrix-drawer]");
      if (!(drawer instanceof HTMLElement)) {
        return null;
      }

      return {
        drawer,
        links: Array.from(
          document.querySelectorAll('.matrix-link[data-matrix-cell="true"]'),
        ),
        cellInputs: Array.from(
          document.querySelectorAll('input[name="cell_key"]'),
        ),
      };
    };

    const clearActiveCell = () => {
      const state = readMatrixState();
      if (!state) {
        return;
      }
      state.links.forEach((node) => node.classList.remove("active"));
      state.cellInputs.forEach((input) => {
        input.value = "";
      });
      state.drawer.innerHTML = DRAWER_EMPTY_HTML;
    };

    const setActiveCell = (link, pushHistory) => {
      const state = readMatrixState();
      if (!state || !state.links.includes(link)) {
        return;
      }

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

      state.links.forEach((node) =>
        node.classList.toggle("active", node === link),
      );
      state.cellInputs.forEach((input) => {
        input.value = cellKey;
      });

      state.drawer.innerHTML =
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

    DASHBOARD_RUNTIME.applyMatrixDrawerLink = (link, pushHistory) => {
      setActiveCell(link, pushHistory);
    };

    DASHBOARD_RUNTIME.syncMatrixDrawerFromUrl = () => {
      const state = readMatrixState();
      if (!state || state.links.length === 0) {
        return;
      }
      const targetCellKey = new URL(window.location.href).searchParams.get(
        "cell_key",
      );
      if (!targetCellKey) {
        clearActiveCell();
        return;
      }
      const targetLink = state.links.find(
        (node) => (node.getAttribute("data-cell-key") || "") === targetCellKey,
      );
      if (!targetLink) {
        clearActiveCell();
        return;
      }
      setActiveCell(targetLink, false);
    };

    if (
      document.body.getAttribute("data-matrix-drawer-click-bound") !== "true"
    ) {
      document.body.setAttribute("data-matrix-drawer-click-bound", "true");
      document.addEventListener("click", (event) => {
        const target = event.target;
        const node =
          target instanceof Element
            ? target.closest('.matrix-link[data-matrix-cell="true"]')
            : null;
        if (!(node instanceof HTMLAnchorElement)) {
          return;
        }
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
        if (typeof DASHBOARD_RUNTIME.applyMatrixDrawerLink === "function") {
          DASHBOARD_RUNTIME.applyMatrixDrawerLink(node, true);
        }
      });
    }

    DASHBOARD_RUNTIME.syncMatrixDrawerFromUrl();
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
      if (!(toggle instanceof HTMLElement)) {
        return;
      }
      if (toggle.getAttribute("data-json-toggle-bound") === "true") {
        return;
      }

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

      toggle.setAttribute("data-json-toggle-bound", "true");
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

    const nodeSymbol = (type) => {
      if (type === "subject_input" || type === "object_input") {
        return "circle";
      }
      if (type === "owner_fallback") {
        return "triangle";
      }
      if (type === "inference_rule") {
        return "roundRect";
      }
      if (type === "context_var") {
        return "diamond";
      }
      if (type === "policy_rule") {
        return "rect";
      }
      return "circle";
    };

    const nodeSymbolSize = (type) => {
      if (
        type === "from_type" ||
        type === "to_type" ||
        type === "both_type" ||
        type === "type"
      ) {
        return 74;
      }
      if (type === "subject_input" || type === "object_input") {
        return 82;
      }
      if (type === "owner_fallback") {
        return [98, 72];
      }
      if (type === "inference_rule") {
        return [150, 62];
      }
      if (type === "context_var") {
        return [132, 84];
      }
      if (type === "policy_rule") {
        return [142, 58];
      }
      return 88;
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
      // padding 需要足够大以容纳节点（圆/矩形/菱形等不同 symbolSize）
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
        symbol: nodeSymbol(node.type),
        symbolSize: nodeSymbolSize(node.type),
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
              preserveAspect: true,
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              roam: true,
              zoom: 0.9,
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

      // 绑定 zoom reset 按钮点击事件
      const resetBtn = chartWrap?.querySelector(".model-graph-zoom-reset");
      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          chart.dispatchAction({
            type: "restore",
          });
        });
      }
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
        `<button type="button" class="model-graph-zoom-reset" title="重置缩放">重置</button>` +
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
      const relationSignatureIssues = [
        ...subjectDomain.issues,
        ...objectDomain.issues,
        ...subjectObjectDomain.issues,
      ];
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
            "左到右展示：关系输入 → inference rule → context变量 → 被哪些 policy selector 消费；形状约定：输入圆形、fallback三角形、rule圆角矩形、context菱形、policy矩形。",
          emptyMessage:
            "暂无 context_inference.rules，可在 JSON 中配置推理规则后查看过程图。",
          payload: inferencePayload,
        }) +
        `</section>` +
        `<p class="muted model-graph-legend">说明：可鼠标拖拽节点、滚轮缩放画布；合并签名图中边颜色区分关系域（蓝=subject，绿=object，紫=subject_object）；虚线用于 owner_ref fallback 或签名异常，红色虚线表示签名与 catalog 不一致。</p>`;
      scheduleHydrateGraphCharts(graphPanel);
    };

    DASHBOARD_RUNTIME.hydrateModelGraphs = (targetSwitchableId) => {
      const currentEditors = Array.from(
        document.querySelectorAll("[data-model-editor]"),
      );
      currentEditors.forEach((editor) => {
        if (!(editor instanceof HTMLElement)) {
          return;
        }
        const graphPanel = editor.querySelector("[data-model-graph]");
        const switchable = editor.querySelector("[data-json-switchable]");
        if (!(graphPanel instanceof HTMLElement) || !switchable) {
          return;
        }
        const currentId =
          switchable.getAttribute("data-json-switchable-id") || "";
        if (targetSwitchableId.length > 0 && currentId !== targetSwitchableId) {
          return;
        }
        scheduleHydrateGraphCharts(graphPanel);
      });
    };

    if (
      document.body.getAttribute("data-model-graph-visible-bound") !== "true"
    ) {
      document.body.setAttribute("data-model-graph-visible-bound", "true");
      document.addEventListener("acl:model-graph-visible", (event) => {
        const targetSwitchableId =
          event && event.detail && typeof event.detail.switchableId === "string"
            ? event.detail.switchableId
            : "";
        if (typeof DASHBOARD_RUNTIME.hydrateModelGraphs === "function") {
          DASHBOARD_RUNTIME.hydrateModelGraphs(targetSwitchableId);
        }
        if (
          typeof DASHBOARD_RUNTIME.renderVisibleInstanceGraphs === "function"
        ) {
          DASHBOARD_RUNTIME.renderVisibleInstanceGraphs(targetSwitchableId);
        }
      });
    }

    editors.forEach((editor) => {
      if (
        !(editor instanceof HTMLElement) ||
        editor.getAttribute("data-model-editor-bound") === "true"
      ) {
        return;
      }
      editor.setAttribute("data-model-editor-bound", "true");

      const textarea = editor.querySelector("[data-model-json]");
      const graphPanel = editor.querySelector("[data-model-graph]");
      const templateSelect = editor.querySelector(
        "[data-model-template-select]",
      );
      const templateMapField = editor.querySelector(
        "[data-model-template-map]",
      );
      if (!textarea) {
        return;
      }
      const isReadonly =
        editor.getAttribute("data-model-editor-readonly") === "true";
      const notifyRichEditorRefresh = () => {
        textarea.dispatchEvent(new Event("acl:jsoneditor-refresh"));
      };
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
        notifyRichEditorRefresh();
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
        notifyRichEditorRefresh();
        syncFromJson();
      };

      if (!isReadonly) {
        const fields = Array.from(
          editor.querySelectorAll("[data-model-field]"),
        );
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
        return;
      }

      textarea.addEventListener("input", syncGraph);
      syncGraph();
    });
  }

  function initInstanceJsonEditors() {
    const forms = Array.from(
      new Set(
        Array.from(
          document.querySelectorAll(
            'form[data-control-instance-json-form="true"], form[data-model-jsoneditor-form="true"], [data-instance-jsoneditor-target]',
          ),
        )
          .map((node) =>
            node instanceof HTMLFormElement ? node : node.closest("form"),
          )
          .filter((form) => form instanceof HTMLFormElement),
      ),
    );
    if (forms.length === 0) {
      return;
    }

    const toTextContent = (content) => {
      if (!content || typeof content !== "object") {
        return "";
      }
      if (
        Object.prototype.hasOwnProperty.call(content, "json") &&
        content.json !== undefined
      ) {
        return JSON.stringify(content.json, null, 2);
      }
      if (typeof content.text === "string") {
        return content.text;
      }
      return "";
    };

    const parseTextareaContent = (raw) => {
      if (!raw || raw.trim().length === 0) {
        return {
          content: {
            json: {},
          },
          mode: "tree",
        };
      }
      try {
        return {
          content: {
            json: JSON.parse(raw),
          },
          mode: "tree",
        };
      } catch {
        return {
          content: {
            text: raw,
          },
          mode: "text",
        };
      }
    };

    const formatContentErrors = (contentErrors) => {
      if (!contentErrors || typeof contentErrors !== "object") {
        return "";
      }
      if (
        contentErrors.parseError &&
        typeof contentErrors.parseError.message === "string"
      ) {
        const line =
          Number.isFinite(contentErrors.parseError.line) &&
          contentErrors.parseError.line > 0
            ? ` (line ${contentErrors.parseError.line})`
            : "";
        return `JSON 解析失败${line}: ${contentErrors.parseError.message}`;
      }
      if (Array.isArray(contentErrors.validationErrors)) {
        if (contentErrors.validationErrors.length === 0) {
          return "";
        }
        return `JSON 校验发现 ${contentErrors.validationErrors.length} 个问题`;
      }
      return "JSON 内容存在错误";
    };

    const bindEditorFocusPreventScroll = (editorTarget) => {
      if (!(editorTarget instanceof HTMLElement)) {
        return;
      }

      const focusTargets = Array.from(
        editorTarget.querySelectorAll(".jse-hidden-input"),
      );
      focusTargets.forEach((focusTarget) => {
        if (
          !(focusTarget instanceof HTMLElement) ||
          focusTarget.getAttribute(
            "data-instance-jsoneditor-focus-prevent-scroll-bound",
          ) === "true"
        ) {
          return;
        }

        const nativeFocus = focusTarget.focus;
        if (typeof nativeFocus !== "function") {
          return;
        }

        focusTarget.setAttribute(
          "data-instance-jsoneditor-focus-prevent-scroll-bound",
          "true",
        );

        focusTarget.focus = function patchedFocus(options) {
          try {
            if (options && typeof options === "object") {
              nativeFocus.call(this, {
                ...options,
                preventScroll: true,
              });
              return;
            }
            nativeFocus.call(this, { preventScroll: true });
          } catch {
            nativeFocus.call(this, options);
          }
        };
      });
    };

    const bindEditorExpandScrollGuard = (editorTarget) => {
      if (
        !(editorTarget instanceof HTMLElement) ||
        editorTarget.getAttribute(
          "data-instance-jsoneditor-scroll-guard-bound",
        ) === "true"
      ) {
        return null;
      }

      editorTarget.setAttribute(
        "data-instance-jsoneditor-scroll-guard-bound",
        "true",
      );

      const expansionActionSelector = [
        "button.jse-expand",
        "button.jse-expand-items",
        "button.jse-expand-all",
        "button.jse-collapse-all",
      ].join(",");
      const modeActionLabels = new Set(["text", "tree", "table"]);
      const popupTriggerSelector = [
        "button.jse-contextmenu",
        "button.jse-open-dropdown",
        "button.jse-context-menu-button",
        "button.jse-navigation-bar-button",
        "button.jse-color-picker-button",
      ].join(",");
      const treeNodeSelector = [
        ".jse-contents .jse-row",
        ".jse-contents .jse-key",
        ".jse-contents .jse-value",
        ".jse-contents .jse-index",
        ".jse-contents .jse-bracket",
        ".jse-contents .jse-delimiter",
        ".jse-contents .jse-collapsed-items",
        ".jse-contents .jse-context-menu-anchor",
        ".jse-contents button",
      ].join(",");
      const popupRootSelector = ".jse-absolute-popup";

      const readWindowScrollPosition = () => ({
        x: window.scrollX || window.pageXOffset || 0,
        y: window.scrollY || window.pageYOffset || 0,
      });

      const resolveTargetElement = (target) => {
        if (target instanceof Element) {
          return target;
        }
        if (target instanceof Node) {
          return target.parentElement;
        }
        return null;
      };

      const resolveGuardAction = (target) => {
        const targetElement = resolveTargetElement(target);
        if (!targetElement) {
          return {
            type: "",
            trigger: null,
          };
        }
        const expansionTrigger = targetElement.closest(expansionActionSelector);
        if (expansionTrigger) {
          return {
            type: "expand",
            trigger: expansionTrigger,
          };
        }
        const treeNodeTrigger = targetElement.closest(treeNodeSelector);
        if (treeNodeTrigger) {
          return {
            type: "tree-node",
            trigger: treeNodeTrigger,
          };
        }
        const modeButton = targetElement.closest(".jse-menu button");
        if (!modeButton) {
          const popupTrigger = targetElement.closest(popupTriggerSelector);
          if (!popupTrigger) {
            return {
              type: "",
              trigger: null,
            };
          }
          return {
            type: "popup-toggle",
            trigger: popupTrigger,
          };
        }
        const modeLabel = modeButton.textContent
          ? modeButton.textContent.trim().toLowerCase()
          : "";
        if (!modeActionLabels.has(modeLabel)) {
          const popupTrigger = targetElement.closest(popupTriggerSelector);
          if (!popupTrigger) {
            return {
              type: "",
              trigger: null,
            };
          }
          return {
            type: "popup-toggle",
            trigger: popupTrigger,
          };
        }
        return {
          type: "mode-switch",
          trigger: modeButton,
        };
      };

      const restoreWindowScrollPosition = (anchorPosition) => {
        if (!anchorPosition) {
          return;
        }
        const restore = () => {
          const currentX = window.scrollX || window.pageXOffset || 0;
          const currentY = window.scrollY || window.pageYOffset || 0;
          if (
            Math.abs(currentX - anchorPosition.x) > 1 ||
            Math.abs(currentY - anchorPosition.y) > 1
          ) {
            window.scrollTo(anchorPosition.x, anchorPosition.y);
          }
        };
        window.requestAnimationFrame(() => {
          restore();
          window.requestAnimationFrame(restore);
        });
      };

      let pendingAnchorPosition = null;
      let pendingModeAnchorPosition = null;
      let popupAnchorPosition = null;
      let popupOpened = false;
      let popupObserver = null;
      let popupGuardDisposed = false;

      const hasPopupOpened = () =>
        Boolean(editorTarget.querySelector(popupRootSelector));

      const disposePopupGuard = () => {
        if (popupGuardDisposed) {
          return;
        }
        popupGuardDisposed = true;
        if (popupObserver) {
          popupObserver.disconnect();
          popupObserver = null;
        }
        window.removeEventListener("mousedown", onGlobalPopupInteraction, true);
        window.removeEventListener("click", onGlobalPopupInteraction, true);
        window.removeEventListener("wheel", onGlobalPopupInteraction, true);
        window.removeEventListener("keydown", onGlobalPopupInteraction, true);
        window.removeEventListener("focusin", onGlobalPopupInteraction, true);
      };

      const ensureEditorAlive = () => {
        if (document.body.contains(editorTarget)) {
          return true;
        }
        disposePopupGuard();
        return false;
      };

      const syncPopupState = () => {
        if (!ensureEditorAlive()) {
          return;
        }
        const nextPopupOpened = hasPopupOpened();
        if (nextPopupOpened && !popupOpened) {
          popupOpened = true;
          popupAnchorPosition =
            popupAnchorPosition || readWindowScrollPosition();
          return;
        }
        if (!nextPopupOpened && popupOpened) {
          popupOpened = false;
          restoreWindowScrollPosition(popupAnchorPosition);
          popupAnchorPosition = null;
        }
      };

      const onGlobalPopupInteraction = () => {
        if (!popupOpened || !ensureEditorAlive()) {
          return;
        }
        const anchorPosition =
          popupAnchorPosition || readWindowScrollPosition();
        popupAnchorPosition = anchorPosition;
        window.requestAnimationFrame(() => {
          syncPopupState();
          if (popupOpened) {
            restoreWindowScrollPosition(anchorPosition);
          }
        });
      };

      if (typeof window.MutationObserver === "function") {
        popupObserver = new window.MutationObserver(() => {
          syncPopupState();
        });
        popupObserver.observe(editorTarget, {
          childList: true,
          subtree: true,
        });
      }
      window.addEventListener("mousedown", onGlobalPopupInteraction, true);
      window.addEventListener("click", onGlobalPopupInteraction, true);
      window.addEventListener("wheel", onGlobalPopupInteraction, true);
      window.addEventListener("keydown", onGlobalPopupInteraction, true);
      window.addEventListener("focusin", onGlobalPopupInteraction, true);
      syncPopupState();

      editorTarget.addEventListener(
        "pointerdown",
        (event) => {
          const action = resolveGuardAction(event.target);
          if (!action.trigger) {
            return;
          }
          const anchorPosition = readWindowScrollPosition();
          pendingAnchorPosition = anchorPosition;
          if (action.type === "mode-switch") {
            pendingModeAnchorPosition = anchorPosition;
          } else if (action.type === "popup-toggle") {
            popupAnchorPosition = anchorPosition;
          }
        },
        true,
      );

      editorTarget.addEventListener(
        "click",
        (event) => {
          const action = resolveGuardAction(event.target);
          if (!action.trigger) {
            return;
          }
          const anchorPosition =
            pendingAnchorPosition || readWindowScrollPosition();
          pendingAnchorPosition = null;
          if (action.type === "mode-switch") {
            pendingModeAnchorPosition = anchorPosition;
          } else if (action.type === "popup-toggle") {
            popupAnchorPosition = anchorPosition;
          }
          restoreWindowScrollPosition(anchorPosition);
        },
        true,
      );

      editorTarget.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key !== "Enter" &&
            event.key !== " " &&
            event.key !== "Spacebar"
          ) {
            return;
          }
          const action = resolveGuardAction(event.target);
          if (!action.trigger) {
            return;
          }
          const anchorPosition = readWindowScrollPosition();
          if (action.type === "mode-switch") {
            pendingModeAnchorPosition = anchorPosition;
          } else if (action.type === "popup-toggle") {
            popupAnchorPosition = anchorPosition;
          }
          restoreWindowScrollPosition(anchorPosition);
        },
        true,
      );

      editorTarget.addEventListener(
        "focusin",
        (event) => {
          const action = resolveGuardAction(event.target);
          if (action.type !== "tree-node") {
            return;
          }
          const anchorPosition =
            pendingAnchorPosition || readWindowScrollPosition();
          pendingAnchorPosition = null;
          restoreWindowScrollPosition(anchorPosition);
        },
        true,
      );

      return {
        restoreWindowScrollPosition,
        dispose: disposePopupGuard,
        consumeModeAnchorPosition: () => {
          const anchorPosition = pendingModeAnchorPosition;
          pendingModeAnchorPosition = null;
          return anchorPosition;
        },
      };
    };

    forms.forEach((form) => {
      if (
        !(form instanceof HTMLFormElement) ||
        form.getAttribute("data-instance-jsoneditor-bound") === "true"
      ) {
        return;
      }

      const textarea = form.querySelector("[data-instance-json-textarea]");
      const textareaField = form.querySelector(
        "[data-instance-json-textarea-field]",
      );
      const editorWrapper = form.querySelector(
        "[data-instance-json-rich-editor]",
      );
      const editorTarget = form.querySelector(
        "[data-instance-jsoneditor-target]",
      );
      const resetButton = form.querySelector(
        "[data-instance-jsoneditor-reset]",
      );
      const statusNode = form.querySelector(
        "[data-instance-jsoneditor-status]",
      );

      if (
        !(textarea instanceof HTMLTextAreaElement) ||
        !(editorWrapper instanceof HTMLElement) ||
        !(editorTarget instanceof HTMLElement)
      ) {
        return;
      }

      form.setAttribute("data-instance-jsoneditor-bound", "true");
      let editor = null;
      let editorReady = false;
      let scrollGuard = null;
      const compactTableWelcomeButtons = () => {
        const nestedArrayButtons = Array.from(
          editorTarget.querySelectorAll(
            ".jse-table-mode-welcome .jse-nested-arrays button.jse-nested-array-action",
          ),
        );
        nestedArrayButtons.forEach((button) => {
          if (!(button instanceof HTMLElement)) {
            return;
          }
          button.style.setProperty("min-height", "20px", "important");
          button.style.setProperty("padding", "2px 8px", "important");
          button.style.setProperty("line-height", "1.2", "important");
          button.style.setProperty("border-radius", "6px", "important");
          button.style.setProperty("font-size", "12px", "important");
        });
      };
      const scheduleCompactTableWelcomeButtons = () => {
        window.requestAnimationFrame(() => {
          compactTableWelcomeButtons();
        });
      };

      const updateStatus = (message, isError) => {
        if (!(statusNode instanceof HTMLElement)) {
          return;
        }
        statusNode.textContent = message;
        statusNode.setAttribute(
          "data-instance-jsoneditor-status-type",
          isError ? "error" : "info",
        );
      };
      const dispatchTextareaInput = () => {
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      };

      const syncTextareaFromEditor = () => {
        if (
          !editorReady ||
          !editor ||
          typeof editor.get !== "function" ||
          !(textarea instanceof HTMLTextAreaElement)
        ) {
          return;
        }
        try {
          const content = editor.get();
          const nextText = toTextContent(content);
          if (typeof nextText === "string" && textarea.value !== nextText) {
            textarea.value = nextText;
          }
        } catch {
          // ignore
        }
      };

      loadVanillaJsonEditorModule()
        .then((module) => {
          if (!document.body.contains(form)) {
            return;
          }

          const createJSONEditor =
            module && typeof module.createJSONEditor === "function"
              ? module.createJSONEditor
              : null;
          if (!createJSONEditor) {
            updateStatus("结构化编辑器加载失败，已降级为文本模式。", true);
            return;
          }

          const modeEnum =
            module && module.Mode && typeof module.Mode === "object"
              ? module.Mode
              : null;
          const modeTree =
            modeEnum && typeof modeEnum.tree === "string"
              ? modeEnum.tree
              : "tree";
          const modeText =
            modeEnum && typeof modeEnum.text === "string"
              ? modeEnum.text
              : "text";

          const initial = parseTextareaContent(textarea.value);
          editor = createJSONEditor({
            target: editorTarget,
            props: {
              content: initial.content,
              mode: initial.mode === "text" ? modeText : modeTree,
              mainMenuBar: true,
              navigationBar: true,
              statusBar: true,
              onChange: (updatedContent, _previousContent, status) => {
                const nextText = toTextContent(updatedContent);
                if (
                  typeof nextText === "string" &&
                  textarea.value !== nextText
                ) {
                  textarea.value = nextText;
                  dispatchTextareaInput();
                }
                const errorMessage = formatContentErrors(status?.contentErrors);
                if (errorMessage.length > 0) {
                  updateStatus(errorMessage, true);
                  return;
                }
                updateStatus(
                  "结构化编辑器已启用：支持层级折叠、节点级值编辑与搜索。",
                  false,
                );
              },
              onChangeMode: () => {
                if (!scrollGuard) {
                  scheduleCompactTableWelcomeButtons();
                  bindEditorFocusPreventScroll(editorTarget);
                  return;
                }
                const anchorPosition = scrollGuard.consumeModeAnchorPosition();
                if (!anchorPosition) {
                  scheduleCompactTableWelcomeButtons();
                  bindEditorFocusPreventScroll(editorTarget);
                  return;
                }
                scrollGuard.restoreWindowScrollPosition(anchorPosition);
                scheduleCompactTableWelcomeButtons();
                bindEditorFocusPreventScroll(editorTarget);
              },
            },
          });
          scrollGuard = bindEditorExpandScrollGuard(editorTarget);
          bindEditorFocusPreventScroll(editorTarget);
          editorReady = true;
          scheduleCompactTableWelcomeButtons();

          editorWrapper.hidden = false;
          if (textareaField instanceof HTMLElement) {
            textareaField.setAttribute(
              "data-jsoneditor-fallback-hidden",
              "true",
            );
          }

          form.addEventListener("submit", () => {
            syncTextareaFromEditor();
          });

          const refreshEditorFromTextarea = (syncStatus) => {
            if (!editor || typeof editor.updateProps !== "function") {
              return;
            }
            const parsed = parseTextareaContent(textarea.value);
            editor.updateProps({
              content: parsed.content,
              mode: parsed.mode === "text" ? modeText : modeTree,
            });
            if (!syncStatus) {
              scheduleCompactTableWelcomeButtons();
              bindEditorFocusPreventScroll(editorTarget);
              return;
            }
            updateStatus(
              parsed.mode === "text"
                ? "文本中包含非法 JSON，已切换文本模式展示。"
                : "已从文本重新加载为结构化树视图。",
              parsed.mode === "text",
            );
            scheduleCompactTableWelcomeButtons();
            bindEditorFocusPreventScroll(editorTarget);
          };

          textarea.addEventListener("acl:jsoneditor-refresh", () => {
            refreshEditorFromTextarea(false);
          });

          if (resetButton instanceof HTMLButtonElement) {
            resetButton.addEventListener("click", () => {
              refreshEditorFromTextarea(true);
            });
          }
        })
        .catch(() => {
          updateStatus("结构化编辑器加载失败，已降级为文本模式。", true);
        });
    });
  }

  function initInstanceEditors() {
    const editors = Array.from(
      document.querySelectorAll("[data-instance-editor]"),
    );
    if (editors.length === 0) {
      return;
    }

    const chartInstances = new WeakMap();
    const activeChartContainers = new Set();
    let resizeBound = false;
    let chartResizeObserver = null;
    let resizeRenderFrame = 0;
    const pendingRenderEditors = new Set();
    const instanceCanvasWidth = 800;
    const instanceCanvasHeight = 600;
    const instanceSourceAspect = Math.max(
      instanceCanvasWidth / instanceCanvasHeight,
      0.1,
    );
    const defaultSubjectTreeDirection = "bottom-up";
    const validSubjectTreeDirections = new Set(["bottom-up", "top-down"]);

    const normalizeSubjectTreeDirection = (value) =>
      validSubjectTreeDirections.has(value)
        ? value
        : defaultSubjectTreeDirection;

    const readSubjectTreeDirection = (editor) =>
      normalizeSubjectTreeDirection(
        editor.getAttribute("data-subject-tree-direction") || "",
      );

    const writeSubjectTreeDirection = (editor, direction) => {
      editor.setAttribute(
        "data-subject-tree-direction",
        normalizeSubjectTreeDirection(direction),
      );
    };

    const hiddenNodeIdsByEditor = new WeakMap();
    const selectedNodeIdByEditor = new WeakMap();
    const manualNodePositionsByEditor = new WeakMap();
    const skipChartSnapshotEditors = new WeakSet();

    const readHiddenNodeIds = (editor) => {
      const current = hiddenNodeIdsByEditor.get(editor);
      if (current instanceof Set) {
        return current;
      }
      const next = new Set();
      hiddenNodeIdsByEditor.set(editor, next);
      return next;
    };

    const readSelectedNodeId = (editor) => {
      const value = selectedNodeIdByEditor.get(editor);
      return typeof value === "string" ? value : "";
    };

    const writeSelectedNodeId = (editor, nodeId) => {
      if (typeof nodeId === "string" && nodeId.length > 0) {
        selectedNodeIdByEditor.set(editor, nodeId);
        return;
      }
      selectedNodeIdByEditor.delete(editor);
    };

    const clearGraphVisibilityState = (editor) => {
      hiddenNodeIdsByEditor.delete(editor);
      writeSelectedNodeId(editor, "");
    };

    const readManualNodePositionMap = (editor) => {
      const current = manualNodePositionsByEditor.get(editor);
      if (current instanceof Map) {
        return current;
      }
      const next = new Map();
      manualNodePositionsByEditor.set(editor, next);
      return next;
    };

    const clearManualNodePositions = (editor) => {
      manualNodePositionsByEditor.delete(editor);
    };

    const skipNextChartSnapshot = (editor) => {
      if (editor instanceof HTMLElement) {
        skipChartSnapshotEditors.add(editor);
      }
    };

    const shouldSkipChartSnapshot = (editor) => {
      if (!(editor instanceof HTMLElement)) {
        return false;
      }
      if (!skipChartSnapshotEditors.has(editor)) {
        return false;
      }
      skipChartSnapshotEditors.delete(editor);
      return true;
    };

    const snapshotManualNodePositionsFromChart = (editor, chart) => {
      if (!chart || typeof chart.getOption !== "function") {
        return;
      }
      const chartOption = chart.getOption();
      const seriesList = Array.isArray(chartOption?.series)
        ? chartOption.series
        : [];
      if (seriesList.length === 0) {
        return;
      }
      const graphSeries =
        seriesList.find((series) => series && series.type === "graph") ||
        seriesList[0];
      const dataList = Array.isArray(graphSeries?.data) ? graphSeries.data : [];
      if (dataList.length === 0) {
        return;
      }
      const manualNodePositionMap = readManualNodePositionMap(editor);
      dataList.forEach((item) => {
        const nodeId =
          typeof item?.node_id === "string"
            ? item.node_id
            : typeof item?.id === "string"
              ? item.id
              : "";
        const x = Number(item?.x);
        const y = Number(item?.y);
        if (nodeId.length === 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
          return;
        }
        manualNodePositionMap.set(nodeId, { x, y });
      });
    };

    const updateHideNodeButtonState = (editor, visibleNodeIdSet) => {
      const hideNodeBtn = editor.querySelector("[data-instance-hide-node]");
      if (!(hideNodeBtn instanceof HTMLButtonElement)) {
        return;
      }
      const selectedNodeId = readSelectedNodeId(editor);
      const canHide =
        selectedNodeId.length > 0 && visibleNodeIdSet.has(selectedNodeId);
      hideNodeBtn.disabled = !canHide;
      hideNodeBtn.setAttribute("aria-disabled", canHide ? "false" : "true");
      hideNodeBtn.title = canHide
        ? `隐藏节点：${selectedNodeId}`
        : "先点击一个节点，再点击隐藏";
    };

    const queueEditorRender = (editor) => {
      if (!(editor instanceof HTMLElement)) {
        return;
      }
      pendingRenderEditors.add(editor);
      if (resizeRenderFrame !== 0) {
        return;
      }
      resizeRenderFrame = window.requestAnimationFrame(() => {
        resizeRenderFrame = 0;
        pendingRenderEditors.forEach((queuedEditor) => {
          renderGraph(queuedEditor);
        });
        pendingRenderEditors.clear();
      });
    };
    const fitInstanceChartWrapByAspect = (chartWrap, preferredHeight) => {
      if (!(chartWrap instanceof HTMLElement)) {
        return;
      }
      const minHeight = 220;
      const maxHeight = Math.max(Math.floor(window.innerHeight * 0.8), 260);
      const nextHeight = Math.max(
        minHeight,
        Math.min(preferredHeight, maxHeight),
      );
      if (Math.abs(nextHeight - chartWrap.clientHeight) > 1) {
        chartWrap.style.height = `${nextHeight}px`;
      }
      chartWrap.style.width = "100%";
      chartWrap.style.maxWidth = "100%";
      chartWrap.style.marginLeft = "0";
      chartWrap.style.marginRight = "0";
    };

    const disposeChart = (container) => {
      const chart = chartInstances.get(container);
      if (chart && typeof chart.dispose === "function") {
        chart.dispose();
      }
      chartInstances.delete(container);
      activeChartContainers.delete(container);
      if (chartResizeObserver) {
        chartResizeObserver.unobserve(container);
        const chartWrap = container.closest(".model-graph-chart-wrap");
        if (chartWrap instanceof HTMLElement) {
          chartResizeObserver.unobserve(chartWrap);
        }
      }
    };

    const bindResize = () => {
      if (resizeBound) {
        return;
      }
      resizeBound = true;

      // 使用 ResizeObserver 监听容器大小变化
      if (typeof window.ResizeObserver === "function") {
        chartResizeObserver = new window.ResizeObserver((entries) => {
          const renderEditors = new Set();
          for (const entry of entries) {
            const target = entry.target;
            const container =
              target.hasAttribute("data-instance-echart") ||
              target.hasAttribute("data-model-echart")
                ? target
                : target.querySelector("[data-instance-echart]") ||
                  target.querySelector("[data-model-echart]");
            if (container) {
              const editor = container.closest("[data-instance-editor]");
              if (editor instanceof HTMLElement) {
                renderEditors.add(editor);
                continue;
              }
              const chart = chartInstances.get(container);
              if (chart && typeof chart.resize === "function") {
                chart.resize();
              }
            }
          }
          renderEditors.forEach((editor) => {
            queueEditorRender(editor);
          });
        });
      }

      DASHBOARD_RUNTIME.handleInstanceResize = () => {
        activeChartContainers.forEach((container) => {
          if (!document.body.contains(container)) {
            disposeChart(container);
            return;
          }
          const editor = container.closest("[data-instance-editor]");
          if (editor instanceof HTMLElement) {
            queueEditorRender(editor);
            return;
          }
          const chart = chartInstances.get(container);
          if (chart && typeof chart.resize === "function") {
            chart.resize();
          }
        });
      };

      if (
        document.body.getAttribute("data-instance-editor-resize-bound") !==
        "true"
      ) {
        document.body.setAttribute("data-instance-editor-resize-bound", "true");
        window.addEventListener("resize", () => {
          if (typeof DASHBOARD_RUNTIME.handleInstanceResize === "function") {
            DASHBOARD_RUNTIME.handleInstanceResize();
          }
        });
      }
    };

    const normalizeStringArray = (input) => {
      if (!Array.isArray(input)) {
        return [];
      }
      return Array.from(
        new Set(
          input
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
        ),
      );
    };

    const normalizeSubjectTypeEdges = (input) => {
      if (!Array.isArray(input)) {
        return [];
      }
      const dedupKeys = new Set();
      const normalizedEdges = [];
      input.forEach((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return;
        }
        const fromType =
          typeof item.from_type === "string" ? item.from_type.trim() : "";
        const toType =
          typeof item.to_type === "string" ? item.to_type.trim() : "";
        if (fromType.length === 0 || toType.length === 0) {
          return;
        }
        const edgeKey = `${fromType}->${toType}`;
        if (dedupKeys.has(edgeKey)) {
          return;
        }
        dedupKeys.add(edgeKey);
        normalizedEdges.push({
          fromType,
          toType,
        });
      });
      return normalizedEdges;
    };

    const inferEntityTypeFromId = (entityId) => {
      if (typeof entityId !== "string") {
        return "";
      }
      const separatorIndex = entityId.indexOf(":");
      if (separatorIndex <= 0) {
        return "";
      }
      return entityId.slice(0, separatorIndex).trim();
    };

    const buildPayloadFromInstanceJson = (editor, fallbackSubjectLayout) => {
      const textarea = editor.querySelector("[data-instance-json-textarea]");
      if (!(textarea instanceof HTMLTextAreaElement)) {
        return null;
      }

      let parsed;
      try {
        parsed = JSON.parse(textarea.value);
      } catch {
        return null;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }

      const rawObjects = Array.isArray(parsed.objects) ? parsed.objects : [];
      const rawRelations = Array.isArray(parsed.relation_events)
        ? parsed.relation_events
        : [];

      const nodeMeta = new Map();
      const edgeMap = new Map();
      const subjectTypeCatalogSet = new Set(
        Array.isArray(fallbackSubjectLayout?.typeCatalog)
          ? fallbackSubjectLayout.typeCatalog
          : [],
      );

      const inferSubjectType = (nodeId) => {
        const inferredType = inferEntityTypeFromId(nodeId);
        if (!inferredType) {
          return undefined;
        }
        if (
          subjectTypeCatalogSet.size > 0 &&
          !subjectTypeCatalogSet.has(inferredType)
        ) {
          return undefined;
        }
        return inferredType;
      };

      const ensureNode = (id, label, options = {}) => {
        const trimmedId = typeof id === "string" ? id.trim() : "";
        if (trimmedId.length === 0) {
          return;
        }
        const nextSubjectType =
          typeof options.subjectType === "string" &&
          options.subjectType.trim().length > 0
            ? options.subjectType.trim()
            : undefined;
        const existing = nodeMeta.get(trimmedId);
        if (existing) {
          existing.isObject = existing.isObject || options.asObject === true;
          existing.isSubject = existing.isSubject || options.asSubject === true;
          if (!existing.subjectType && nextSubjectType) {
            existing.subjectType = nextSubjectType;
          }
          if (
            typeof label === "string" &&
            label.trim().length > 0 &&
            existing.label === trimmedId &&
            label.trim() !== trimmedId
          ) {
            existing.label = label.trim();
          }
          return;
        }
        nodeMeta.set(trimmedId, {
          id: trimmedId,
          label:
            typeof label === "string" && label.trim().length > 0
              ? label.trim()
              : trimmedId,
          isObject: options.asObject === true,
          isSubject: options.asSubject === true,
          subjectType: nextSubjectType,
        });
      };

      const appendEdge = (edge) => {
        const from = typeof edge.from === "string" ? edge.from.trim() : "";
        const to = typeof edge.to === "string" ? edge.to.trim() : "";
        if (from.length === 0 || to.length === 0) {
          return;
        }
        const label =
          typeof edge.label === "string" ? edge.label : "related_to";
        const key = `${from}::${to}::${label}::${edge.dashed ? "d" : "s"}`;
        if (edgeMap.has(key)) {
          return;
        }
        edgeMap.set(key, {
          from,
          to,
          label,
          dashed: edge.dashed === true,
          color: typeof edge.color === "string" ? edge.color : "#2563eb",
        });
      };

      rawObjects.forEach((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return;
        }
        const objectId =
          typeof item.object_id === "string" ? item.object_id.trim() : "";
        if (objectId.length === 0) {
          return;
        }
        const objectType =
          typeof item.object_type === "string" ? item.object_type.trim() : "";
        const ownerRef =
          typeof item.owner_ref === "string" ? item.owner_ref.trim() : "";
        ensureNode(
          objectId,
          objectType.length > 0 ? `${objectId} (${objectType})` : objectId,
          { asObject: true },
        );
        if (ownerRef.length > 0) {
          ensureNode(ownerRef, ownerRef, {
            asSubject: true,
            subjectType: inferSubjectType(ownerRef),
          });
          appendEdge({
            from: ownerRef,
            to: objectId,
            label: "owner_ref",
            dashed: true,
            color: "#8b5cf6",
          });
        }
      });

      rawRelations.forEach((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return;
        }
        const from = typeof item.from === "string" ? item.from.trim() : "";
        const to = typeof item.to === "string" ? item.to.trim() : "";
        if (from.length === 0 || to.length === 0) {
          return;
        }
        const relationType =
          typeof item.relation_type === "string"
            ? item.relation_type.trim()
            : "";
        const scope = typeof item.scope === "string" ? item.scope.trim() : "";
        ensureNode(from, from, {
          asSubject: true,
          subjectType: inferSubjectType(from),
        });
        ensureNode(to, to, {
          asSubject: true,
          subjectType: inferSubjectType(to),
        });
        appendEdge({
          from,
          to,
          label:
            relationType.length > 0
              ? scope.length > 0
                ? `${relationType} [${scope}]`
                : relationType
              : "related_to",
          dashed: false,
          color: "#2563eb",
        });
      });

      return {
        nodes: Array.from(nodeMeta.values())
          .map((item) => ({
            id: item.id,
            label: item.label,
            category:
              item.isObject && item.isSubject
                ? "mixed"
                : item.isObject
                  ? "object"
                  : "subject",
            ...(item.subjectType ? { subject_type: item.subjectType } : {}),
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        edges: Array.from(edgeMap.values()),
        subjectLayout: fallbackSubjectLayout || {
          typeCatalog: [],
          typeEdges: [],
        },
      };
    };

    const readPayload = (editor) => {
      const payloadField = editor.querySelector(
        "[data-instance-graph-payload]",
      );
      if (!payloadField) {
        return null;
      }
      const raw =
        payloadField instanceof HTMLTextAreaElement
          ? payloadField.value
          : payloadField.textContent || "";
      if (!raw || raw.trim().length === 0) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
          return null;
        }
        const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
        const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
        const subjectLayoutRaw =
          parsed.subject_layout &&
          typeof parsed.subject_layout === "object" &&
          !Array.isArray(parsed.subject_layout)
            ? parsed.subject_layout
            : null;
        const subjectLayout = subjectLayoutRaw
          ? {
              typeCatalog: normalizeStringArray(subjectLayoutRaw.type_catalog),
              typeEdges: normalizeSubjectTypeEdges(subjectLayoutRaw.type_edges),
            }
          : {
              typeCatalog: [],
              typeEdges: [],
            };
        const normalized = {
          nodes,
          edges,
          subjectLayout,
        };
        if (nodes.length > 0) {
          return normalized;
        }
        return (
          buildPayloadFromInstanceJson(editor, subjectLayout) || normalized
        );
      } catch {
        return buildPayloadFromInstanceJson(editor, null);
      }
    };

    const readReplayFocus = (editor) => {
      const payloadField = editor.querySelector("[data-instance-graph-focus]");
      if (!payloadField) {
        return {
          nodeIds: new Set(),
          edgeKeys: new Set(),
        };
      }
      const raw =
        payloadField instanceof HTMLTextAreaElement
          ? payloadField.value
          : payloadField.textContent || "";
      if (!raw || raw.trim().length === 0) {
        return {
          nodeIds: new Set(),
          edgeKeys: new Set(),
        };
      }
      try {
        const parsed = JSON.parse(raw);
        const nodeIds = normalizeStringArray(parsed?.highlight_node_ids);
        const edgeKeys = normalizeStringArray(parsed?.highlight_edge_keys);
        return {
          nodeIds: new Set(nodeIds),
          edgeKeys: new Set(edgeKeys),
        };
      } catch {
        return {
          nodeIds: new Set(),
          edgeKeys: new Set(),
        };
      }
    };

    const updateSubjectDirectionButtons = (editor) => {
      const currentDirection = readSubjectTreeDirection(editor);
      const directionButtons = Array.from(
        editor.querySelectorAll("[data-instance-subject-direction-btn]"),
      );
      directionButtons.forEach((button) => {
        const direction = normalizeSubjectTreeDirection(
          button.getAttribute("data-instance-subject-direction-btn") || "",
        );
        const isActive = direction === currentDirection;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    };

    const renderGraph = (editor) => {
      const graphPanel = editor.querySelector("[data-instance-graph]");
      const container = graphPanel?.querySelector("[data-instance-echart]");
      if (!container) {
        return;
      }
      const chartWrap = container.closest(".model-graph-chart-wrap");
      if (graphPanel instanceof HTMLElement) {
        const panelDirection = normalizeSubjectTreeDirection(
          graphPanel.getAttribute("data-subject-tree-direction") || "",
        );
        writeSubjectTreeDirection(editor, panelDirection);
      }
      const subjectTreeDirection = readSubjectTreeDirection(editor);

      const payload = readPayload(editor);
      const replayFocus = readReplayFocus(editor);
      if (!payload || payload.nodes.length === 0) {
        clearManualNodePositions(editor);
        updateHideNodeButtonState(editor, new Set());
        disposeChart(container);
        container.innerHTML =
          '<p class="muted model-graph-empty">暂无 instance 关系可绘制。</p>';
        return;
      }

      const nodeIdSet = new Set(
        payload.nodes
          .map((node) => (typeof node.id === "string" ? node.id : ""))
          .filter((nodeId) => nodeId.length > 0),
      );
      const hiddenNodeIds = readHiddenNodeIds(editor);
      Array.from(hiddenNodeIds).forEach((nodeId) => {
        if (!nodeIdSet.has(nodeId)) {
          hiddenNodeIds.delete(nodeId);
        }
      });

      if (!nodeIdSet.has(readSelectedNodeId(editor))) {
        writeSelectedNodeId(editor, "");
      }
      const manualNodePositionMap = readManualNodePositionMap(editor);
      Array.from(manualNodePositionMap.keys()).forEach((nodeId) => {
        if (!nodeIdSet.has(nodeId)) {
          manualNodePositionMap.delete(nodeId);
        }
      });

      const visibleNodes = payload.nodes.filter((node) => {
        const id = typeof node.id === "string" ? node.id : "";
        if (id.length === 0) {
          return true;
        }
        return !hiddenNodeIds.has(id);
      });
      const visibleNodeIdSet = new Set(
        visibleNodes
          .map((node) => (typeof node.id === "string" ? node.id : ""))
          .filter((nodeId) => nodeId.length > 0),
      );
      if (!visibleNodeIdSet.has(readSelectedNodeId(editor))) {
        writeSelectedNodeId(editor, "");
      }
      const selectedNodeId = readSelectedNodeId(editor);
      updateHideNodeButtonState(editor, visibleNodeIdSet);
      const visibleEdges = payload.edges.filter((edge) => {
        const from = typeof edge.from === "string" ? edge.from : "";
        const to = typeof edge.to === "string" ? edge.to : "";
        return visibleNodeIdSet.has(from) && visibleNodeIdSet.has(to);
      });

      const echartsGlobal = window.echarts;
      if (!echartsGlobal || typeof echartsGlobal.init !== "function") {
        updateHideNodeButtonState(editor, new Set());
        disposeChart(container);
        container.innerHTML =
          '<p class="muted model-graph-empty">ECharts 未加载，暂无法渲染 Instance Graph。</p>';
        return;
      }

      bindResize();
      let chart = chartInstances.get(container);
      const globalChart =
        typeof echartsGlobal.getInstanceByDom === "function"
          ? echartsGlobal.getInstanceByDom(container)
          : null;
      if (!chart && globalChart) {
        chart = globalChart;
        chartInstances.set(container, chart);
      }
      if (
        chart &&
        typeof chart.isDisposed === "function" &&
        chart.isDisposed()
      ) {
        chartInstances.delete(container);
        chart = null;
      }
      const chartDomRoot =
        chart && typeof chart.getZr === "function"
          ? chart.getZr()?.painter?._domRoot
          : null;
      if (
        chart &&
        chartDomRoot instanceof HTMLElement &&
        !container.contains(chartDomRoot)
      ) {
        if (typeof chart.dispose === "function") {
          chart.dispose();
        }
        chartInstances.delete(container);
        chart = null;
      }
      if (!chart) {
        container.innerHTML = "";
        chart = echartsGlobal.init(container, undefined, {
          renderer: "canvas",
        });
        chartInstances.set(container, chart);
        skipChartSnapshotEditors.delete(editor);
      } else if (!shouldSkipChartSnapshot(editor)) {
        snapshotManualNodePositionsFromChart(editor, chart);
      }

      // 布局分组：始终基于全量节点计算坐标，隐藏仅影响渲染可见性
      // 这样“隐藏节点”不会触发剩余节点重新 layout
      const allNodes = payload.nodes;
      const layoutSubjectNodes = allNodes.filter(
        (n) => n.category === "subject",
      );
      const layoutObjectNodes = allNodes.filter((n) => n.category === "object");
      const layoutMixedNodes = allNodes.filter((n) => n.category === "mixed");
      const subjectNodeIdSet = new Set(
        layoutSubjectNodes
          .map((node) => (typeof node.id === "string" ? node.id : ""))
          .filter((nodeId) => nodeId.length > 0),
      );
      const subjectEdges = payload.edges.filter((edge) => {
        const from = typeof edge.from === "string" ? edge.from : "";
        const to = typeof edge.to === "string" ? edge.to : "";
        return subjectNodeIdSet.has(from) && subjectNodeIdSet.has(to);
      });

      // 根据原始坐标比例约束容器尺寸，避免横向拉伸
      if (chartWrap instanceof HTMLElement) {
        const maxColNodes = Math.max(
          layoutSubjectNodes.length,
          layoutObjectNodes.length,
          layoutMixedNodes.length,
          1,
        );
        const preferredHeight = Math.max(
          400,
          Math.min(maxColNodes * 80 + 100, 800),
        );
        fitInstanceChartWrapByAspect(chartWrap, preferredHeight);
      }

      // 使用固定的虚拟坐标系计算节点位置
      // 然后按容器等比映射，避免横向/纵向拉伸
      const padding = 80;
      const width = Math.max(
        chartWrap instanceof HTMLElement
          ? chartWrap.clientWidth
          : container.clientWidth,
        320,
      );
      const height = Math.max(
        chartWrap instanceof HTMLElement
          ? chartWrap.clientHeight
          : container.clientHeight,
        220,
      );
      const viewportWidth = Math.max(width - padding * 2, 1);
      const viewportHeight = Math.max(height - padding * 2, 1);
      const targetAspect = Math.max(viewportWidth / viewportHeight, 0.1);
      let renderWidth = viewportWidth;
      let renderHeight = viewportHeight;
      if (instanceSourceAspect > targetAspect) {
        renderHeight = renderWidth / instanceSourceAspect;
      } else {
        renderWidth = renderHeight * instanceSourceAspect;
      }
      const offsetX = (viewportWidth - renderWidth) / 2;
      const offsetY = (viewportHeight - renderHeight) / 2;
      const graphLeft = padding + offsetX;
      const graphTop = padding + offsetY;
      const graphBottom = graphTop + renderHeight;

      const positionLinearNodes = (nodes, xCenter, startY, endY) => {
        const count = nodes.length;
        if (count === 0) {
          return;
        }
        const step = count > 1 ? (endY - startY) / (count - 1) : 0;
        nodes.forEach((node, i) => {
          node._x = xCenter;
          node._y = count === 1 ? (startY + endY) / 2 : startY + step * i;
        });
      };

      const inferEntityTypeFromId = (entityId) => {
        if (typeof entityId !== "string") {
          return "";
        }
        const separatorIndex = entityId.indexOf(":");
        if (separatorIndex <= 0) {
          return "";
        }
        return entityId.slice(0, separatorIndex).trim();
      };

      const readNodeSubjectType = (node) =>
        typeof node.subject_type === "string" ? node.subject_type.trim() : "";

      const buildTypeSortFn = (typeCatalog) => {
        const typeOrderMap = new Map();
        typeCatalog.forEach((type, index) => {
          typeOrderMap.set(type, index);
        });
        return (left, right) => {
          const leftRank = typeOrderMap.has(left)
            ? typeOrderMap.get(left)
            : Number.MAX_SAFE_INTEGER;
          const rightRank = typeOrderMap.has(right)
            ? typeOrderMap.get(right)
            : Number.MAX_SAFE_INTEGER;
          if (leftRank !== rightRank) {
            return leftRank - rightRank;
          }
          return String(left).localeCompare(String(right));
        };
      };

      const buildSubjectTypeLevelMap = (nodes, typeCatalog, typeEdges) => {
        const sortTypes = buildTypeSortFn(typeCatalog);
        const usedTypes = new Set();
        nodes.forEach((node) => {
          const nodeType =
            readNodeSubjectType(node) || inferEntityTypeFromId(node.id);
          if (nodeType.length > 0) {
            usedTypes.add(nodeType);
          }
        });
        const allTypes = Array.from(new Set([...typeCatalog, ...usedTypes]));
        if (allTypes.length === 0) {
          return new Map();
        }

        if (typeEdges.length === 0) {
          const fallbackLevels = new Map();
          allTypes
            .slice()
            .sort(sortTypes)
            .forEach((type, index) => {
              fallbackLevels.set(type, index);
            });
          return fallbackLevels;
        }

        const adjacency = new Map();
        const indegree = new Map();
        allTypes.forEach((type) => {
          adjacency.set(type, new Set());
          indegree.set(type, 0);
        });

        typeEdges.forEach((edge) => {
          const fromType =
            typeof edge.fromType === "string" ? edge.fromType.trim() : "";
          const toType =
            typeof edge.toType === "string" ? edge.toType.trim() : "";
          if (fromType.length === 0 || toType.length === 0) {
            return;
          }
          if (!adjacency.has(fromType)) {
            adjacency.set(fromType, new Set());
            indegree.set(fromType, 0);
          }
          if (!adjacency.has(toType)) {
            adjacency.set(toType, new Set());
            indegree.set(toType, 0);
          }
          if (adjacency.get(fromType).has(toType)) {
            return;
          }
          adjacency.get(fromType).add(toType);
          indegree.set(toType, (indegree.get(toType) || 0) + 1);
        });

        const orderedTypes = Array.from(adjacency.keys()).sort(sortTypes);
        const typeLevels = new Map();
        orderedTypes.forEach((type) => {
          typeLevels.set(type, 0);
        });
        const pending = orderedTypes
          .filter((type) => (indegree.get(type) || 0) === 0)
          .sort(sortTypes);
        const visited = new Set();

        while (pending.length > 0) {
          const currentType = pending.shift();
          if (!currentType || visited.has(currentType)) {
            continue;
          }
          visited.add(currentType);
          const nextLevel = (typeLevels.get(currentType) || 0) + 1;
          Array.from(adjacency.get(currentType) || [])
            .sort(sortTypes)
            .forEach((targetType) => {
              typeLevels.set(
                targetType,
                Math.max(typeLevels.get(targetType) || 0, nextLevel),
              );
              indegree.set(targetType, (indegree.get(targetType) || 0) - 1);
              if ((indegree.get(targetType) || 0) === 0) {
                pending.push(targetType);
                pending.sort(sortTypes);
              }
            });
        }

        if (visited.size < orderedTypes.length) {
          let fallbackLevel = Math.max(0, ...Array.from(typeLevels.values()));
          orderedTypes
            .filter((type) => !visited.has(type))
            .sort(sortTypes)
            .forEach((type) => {
              fallbackLevel += 1;
              typeLevels.set(type, fallbackLevel);
            });
        }

        return typeLevels;
      };

      const buildLayerSlots = (count, areaLeft, areaRight) => {
        if (count <= 0) {
          return [];
        }
        if (count === 1) {
          return [(areaLeft + areaRight) / 2];
        }
        const areaWidth = Math.max(areaRight - areaLeft, 1);
        const horizontalPadding =
          count >= 14
            ? 4
            : count >= 10
              ? 8
              : count >= 7
                ? 12
                : Math.min(22, Math.max(Math.floor(areaWidth * 0.06), 12));
        const usableLeft = areaLeft + horizontalPadding;
        const usableRight = areaRight - horizontalPadding;
        const step = (usableRight - usableLeft) / (count - 1);
        return Array.from(
          { length: count },
          (_, index) => usableLeft + step * index,
        );
      };

      const positionSubjectNodesByTypeTree = ({
        nodes,
        edges,
        areaLeft,
        areaRight,
        startY,
        endY,
        typeCatalog,
        typeEdges,
        direction,
      }) => {
        if (nodes.length === 0) {
          return {
            maxLayerCount: 0,
            minSlotGap: Number.POSITIVE_INFINITY,
          };
        }

        const unknownTypeKey = "__unknown_subject_type__";
        const typeLevels = buildSubjectTypeLevelMap(
          nodes,
          typeCatalog,
          typeEdges,
        );
        const knownMaxLevel =
          typeLevels.size > 0
            ? Math.max(...Array.from(typeLevels.values()))
            : 0;
        const nodeLevelMap = new Map();
        const layerBuckets = new Map();

        nodes.forEach((node) => {
          const nodeType =
            readNodeSubjectType(node) || inferEntityTypeFromId(node.id);
          const normalizedType =
            nodeType.length > 0 ? nodeType : unknownTypeKey;
          const level = typeLevels.has(normalizedType)
            ? typeLevels.get(normalizedType)
            : knownMaxLevel + 1;
          nodeLevelMap.set(node.id, level);
          if (!layerBuckets.has(level)) {
            layerBuckets.set(level, []);
          }
          layerBuckets.get(level).push(node);
        });

        const orderedLayers = Array.from(layerBuckets.keys()).sort(
          (a, b) => a - b,
        );
        const layerYMap = new Map();
        if (orderedLayers.length === 1) {
          layerYMap.set(orderedLayers[0], (startY + endY) / 2);
        } else {
          const yStep = (endY - startY) / (orderedLayers.length - 1);
          const isBottomUp = direction !== "top-down";
          orderedLayers.forEach((layer, index) => {
            layerYMap.set(
              layer,
              isBottomUp ? endY - yStep * index : startY + yStep * index,
            );
          });
        }

        const parentMap = new Map();
        edges.forEach((edge) => {
          const source = typeof edge.from === "string" ? edge.from : "";
          const target = typeof edge.to === "string" ? edge.to : "";
          if (source.length === 0 || target.length === 0) {
            return;
          }
          if (!nodeLevelMap.has(source) || !nodeLevelMap.has(target)) {
            return;
          }
          const sourceLevel = nodeLevelMap.get(source);
          const targetLevel = nodeLevelMap.get(target);
          if (sourceLevel >= targetLevel) {
            return;
          }
          if (!parentMap.has(target)) {
            parentMap.set(target, []);
          }
          parentMap.get(target).push(source);
        });

        const positionedNodeX = new Map();
        let maxLayerCount = 0;
        let minSlotGap = Number.POSITIVE_INFINITY;
        orderedLayers.forEach((layer) => {
          const layerNodes = layerBuckets.get(layer) || [];
          if (layerNodes.length === 0) {
            return;
          }
          maxLayerCount = Math.max(maxLayerCount, layerNodes.length);
          const slots = buildLayerSlots(layerNodes.length, areaLeft, areaRight);
          if (slots.length > 1) {
            const layerGap =
              (slots[slots.length - 1] - slots[0]) / (slots.length - 1);
            if (Number.isFinite(layerGap) && layerGap > 0) {
              minSlotGap = Math.min(minSlotGap, layerGap);
            }
          }
          const arrangedNodes = layerNodes
            .map((node, index) => {
              const parentIds = parentMap.get(node.id) || [];
              const parentXs = parentIds
                .map((parentId) => positionedNodeX.get(parentId))
                .filter((value) => Number.isFinite(value));
              const expectedX =
                parentXs.length > 0
                  ? parentXs.reduce((sum, value) => sum + value, 0) /
                    parentXs.length
                  : slots[Math.min(index, slots.length - 1)];
              return {
                node,
                expectedX,
                id: typeof node.id === "string" ? node.id : "",
              };
            })
            .sort(
              (left, right) =>
                left.expectedX - right.expectedX ||
                left.id.localeCompare(right.id),
            );

          arrangedNodes.forEach((entry, index) => {
            const x = slots[Math.min(index, slots.length - 1)];
            entry.node._x = x;
            entry.node._y = layerYMap.get(layer);
            positionedNodeX.set(entry.node.id, x);
          });
        });

        return {
          maxLayerCount,
          minSlotGap,
        };
      };

      const calcSubjectSymbolSize = (layoutMetrics, areaWidth) => {
        if (!layoutMetrics || layoutMetrics.maxLayerCount <= 1) {
          return 56;
        }
        const fallbackGap =
          areaWidth / Math.max(layoutMetrics.maxLayerCount - 1, 1);
        const layerGap = Number.isFinite(layoutMetrics.minSlotGap)
          ? layoutMetrics.minSlotGap
          : fallbackGap;
        const preferredByGap = Math.floor(layerGap * 0.72);
        const preferredByDensity =
          layoutMetrics.maxLayerCount >= 16
            ? 22
            : layoutMetrics.maxLayerCount >= 12
              ? 26
              : layoutMetrics.maxLayerCount >= 9
                ? 32
                : 38;
        return Math.max(
          20,
          Math.min(56, Math.min(preferredByGap, preferredByDensity)),
        );
      };

      const subjectTypeCatalog = Array.isArray(
        payload.subjectLayout?.typeCatalog,
      )
        ? payload.subjectLayout.typeCatalog
        : [];
      const subjectTypeEdges = Array.isArray(payload.subjectLayout?.typeEdges)
        ? payload.subjectLayout.typeEdges
        : [];

      const subjectWidthRatio =
        layoutSubjectNodes.length >= 24
          ? 0.68
          : layoutSubjectNodes.length >= 16
            ? 0.63
            : layoutSubjectNodes.length >= 10
              ? 0.58
              : 0.54;
      const subjectAreaLeft = graphLeft + renderWidth * 0.03;
      const subjectAreaRight = graphLeft + renderWidth * subjectWidthRatio;
      const centerX =
        graphLeft + renderWidth * Math.min(subjectWidthRatio + 0.14, 0.82);
      const rightX = graphLeft + renderWidth * 0.92;

      const subjectLayoutMetrics = positionSubjectNodesByTypeTree({
        nodes: layoutSubjectNodes,
        edges: subjectEdges,
        areaLeft: subjectAreaLeft,
        areaRight: subjectAreaRight,
        startY: graphTop,
        endY: graphBottom,
        typeCatalog: subjectTypeCatalog,
        typeEdges: subjectTypeEdges,
        direction: subjectTreeDirection,
      });
      positionLinearNodes(layoutMixedNodes, centerX, graphTop, graphBottom);
      positionLinearNodes(layoutObjectNodes, rightX, graphTop, graphBottom);
      allNodes.forEach((node) => {
        const nodeId = typeof node.id === "string" ? node.id : "";
        if (nodeId.length === 0) {
          return;
        }
        const manualPosition = manualNodePositionMap.get(nodeId);
        if (!manualPosition) {
          return;
        }
        if (
          Number.isFinite(manualPosition.x) &&
          Number.isFinite(manualPosition.y)
        ) {
          node._x = manualPosition.x;
          node._y = manualPosition.y;
        }
      });
      const subjectSymbolSize = calcSubjectSymbolSize(
        subjectLayoutMetrics,
        Math.max(subjectAreaRight - subjectAreaLeft, 1),
      );

      // 节点配色：参考统一关系签名图的浅色背景
      const instanceNodeColor = (category) => {
        if (category === "subject") {
          return "#e8f1ff"; // 浅蓝色
        }
        if (category === "object") {
          return "#eefaf1"; // 浅绿色
        }
        if (category === "mixed") {
          return "#eaf0ff"; // 浅紫色
        }
        return "#f4f7fb";
      };

      // 边配色：subject边蓝色，object边橙色
      const nodeById = new Map();
      visibleNodes.forEach((node) => {
        const nodeId = typeof node.id === "string" ? node.id : "";
        if (nodeId.length > 0) {
          nodeById.set(nodeId, node);
        }
      });
      const buildEdgeKey = (edge) => {
        const from = typeof edge?.from === "string" ? edge.from.trim() : "";
        const to = typeof edge?.to === "string" ? edge.to.trim() : "";
        const label = typeof edge?.label === "string" ? edge.label.trim() : "";
        const dashed = edge?.dashed === true;
        return `${from}::${to}::${label}::${dashed ? "d" : "s"}`;
      };
      const instanceEdgeColor = (edge) => {
        if (replayFocus.edgeKeys.has(buildEdgeKey(edge))) {
          return "#f59e0b";
        }
        if (edge.dashed === true) {
          return "#ad4f8f"; // owner_fallback 紫色虚线
        }
        // 根据源节点类型决定颜色
        const sourceNode = nodeById.get(edge.from);
        if (sourceNode?.category === "subject") {
          return "#1f6bc6"; // 蓝色
        }
        if (sourceNode?.category === "object") {
          return "#cd6d1b"; // 橙色
        }
        return "#5c6882";
      };

      const nodeData = visibleNodes.map((node) => {
        const id = typeof node.id === "string" ? node.id : "";
        const label = typeof node.label === "string" ? node.label : id;
        const category =
          typeof node.category === "string" ? node.category : "subject";
        const isSelected = id.length > 0 && id === selectedNodeId;
        const isReplayFocus = id.length > 0 && replayFocus.nodeIds.has(id);
        return {
          id,
          name: label,
          node_id: id,
          node_category: category,
          x: node._x || centerX,
          y: node._y || graphTop + renderHeight / 2,
          symbolSize:
            category === "subject"
              ? subjectSymbolSize
              : category === "mixed"
                ? 66
                : 56,
          draggable: true,
          itemStyle: {
            color: instanceNodeColor(category),
            borderColor: isSelected
              ? "#2563eb"
              : isReplayFocus
                ? "#f59e0b"
                : "#c5d3ec",
            borderWidth: isSelected ? 2.5 : isReplayFocus ? 2.2 : 1,
            shadowBlur: isReplayFocus ? 14 : 0,
            shadowColor: isReplayFocus
              ? "rgba(245, 158, 11, 0.28)"
              : "transparent",
          },
          label: {
            show: true,
            color: isReplayFocus ? "#9a3412" : "#1f2937",
            fontSize:
              category === "subject"
                ? subjectSymbolSize <= 24
                  ? 8
                  : subjectSymbolSize <= 32
                    ? 9
                    : 10
                : 11,
            fontWeight: 700,
            formatter: (params) => String(params.data.node_id || ""),
            position: "inside",
          },
          tooltip: {
            formatter: () =>
              `${escapeHtml(category)}: ${escapeHtml(String(label || id))}`,
          },
        };
      });

      const linkData = visibleEdges.map((edge) => {
        const from = typeof edge.from === "string" ? edge.from : "";
        const to = typeof edge.to === "string" ? edge.to : "";
        const label =
          typeof edge.label === "string" ? edge.label : "related_to";
        const dashed = edge.dashed === true;
        const isSelfLoop = from === to;
        const isReplayFocus = replayFocus.edgeKeys.has(buildEdgeKey(edge));
        return {
          source: from,
          target: to,
          value: label,
          label: {
            color: isReplayFocus ? "#9a3412" : "#425978",
            fontWeight: isReplayFocus ? 700 : 500,
          },
          lineStyle: {
            color: instanceEdgeColor(edge),
            width: isReplayFocus ? 3.6 : dashed ? 2 : 2.4,
            type: dashed ? "dashed" : "solid",
            curveness: isSelfLoop ? 0.5 : 0.15,
            opacity: isReplayFocus ? 1 : 0.92,
          },
        };
      });

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
              preserveAspect: true,
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              roam: true,
              zoom: 0.9,
              draggable: true,
              data: nodeData,
              links: linkData,
              edgeSymbol: ["none", "arrow"],
              edgeSymbolSize: 8,
              autoCurveness: [0.12, 0.2, 0.28, 0.36],
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
              lineStyle: {
                opacity: 0.9,
              },
              emphasis: {
                focus: "adjacency",
              },
            },
          ],
        },
        true,
      );
      chart.resize();
      activeChartContainers.add(container);

      if (typeof chart.off === "function") {
        chart.off("click");
      }
      if (typeof chart.on === "function") {
        chart.on("click", (params) => {
          if (!params || params.dataType !== "node") {
            return;
          }
          const nextNodeId =
            params.data && typeof params.data.node_id === "string"
              ? params.data.node_id
              : "";
          if (nextNodeId.length === 0 || !visibleNodeIdSet.has(nextNodeId)) {
            return;
          }
          const currentSelectedNodeId = readSelectedNodeId(editor);
          writeSelectedNodeId(
            editor,
            currentSelectedNodeId === nextNodeId ? "" : nextNodeId,
          );
          snapshotManualNodePositionsFromChart(editor, chart);
          renderGraph(editor);
        });
      }

      const hideNodeBtn = chartWrap?.querySelector("[data-instance-hide-node]");
      if (
        hideNodeBtn instanceof HTMLButtonElement &&
        !hideNodeBtn.hasAttribute("data-instance-graph-hide-bound")
      ) {
        hideNodeBtn.setAttribute("data-instance-graph-hide-bound", "1");
        hideNodeBtn.addEventListener("click", () => {
          const targetNodeId = readSelectedNodeId(editor);
          if (targetNodeId.length === 0) {
            return;
          }
          const hiddenNodeIdsSet = readHiddenNodeIds(editor);
          hiddenNodeIdsSet.add(targetNodeId);
          writeSelectedNodeId(editor, "");
          snapshotManualNodePositionsFromChart(editor, chart);
          renderGraph(editor);
        });
      }

      // 绑定 zoom reset 按钮点击事件
      const resetBtn = chartWrap?.querySelector(".model-graph-zoom-reset");
      if (
        resetBtn &&
        !resetBtn.hasAttribute("data-instance-graph-reset-bound")
      ) {
        resetBtn.setAttribute("data-instance-graph-reset-bound", "1");
        resetBtn.addEventListener("click", () => {
          clearGraphVisibilityState(editor);
          clearManualNodePositions(editor);
          skipNextChartSnapshot(editor);
          const currentChart = chartInstances.get(container);
          if (
            currentChart &&
            typeof currentChart.dispatchAction === "function"
          ) {
            currentChart.dispatchAction({
              type: "restore",
            });
          }
          renderGraph(editor);
        });
      }

      // 使用 ResizeObserver 监听容器大小变化
      if (chartResizeObserver) {
        chartResizeObserver.observe(container);
        if (chartWrap instanceof HTMLElement) {
          chartResizeObserver.observe(chartWrap);
        }
      }
    };

    editors.forEach((editor) => {
      if (
        !(editor instanceof HTMLElement) ||
        editor.getAttribute("data-instance-editor-bound") === "true"
      ) {
        return;
      }
      editor.setAttribute("data-instance-editor-bound", "true");
      const graphPanel = editor.querySelector("[data-instance-graph]");
      const initialDirection = normalizeSubjectTreeDirection(
        graphPanel instanceof HTMLElement
          ? graphPanel.getAttribute("data-subject-tree-direction") || ""
          : editor.getAttribute("data-subject-tree-direction") || "",
      );
      writeSubjectTreeDirection(editor, initialDirection);
      if (graphPanel instanceof HTMLElement) {
        graphPanel.setAttribute(
          "data-subject-tree-direction",
          initialDirection,
        );
      }

      const directionButtons = Array.from(
        editor.querySelectorAll("[data-instance-subject-direction-btn]"),
      );
      if (directionButtons.length === 0) {
        return;
      }
      updateSubjectDirectionButtons(editor);
      directionButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const nextDirection = normalizeSubjectTreeDirection(
            button.getAttribute("data-instance-subject-direction-btn") || "",
          );
          writeSubjectTreeDirection(editor, nextDirection);
          clearManualNodePositions(editor);
          skipNextChartSnapshot(editor);
          if (graphPanel instanceof HTMLElement) {
            graphPanel.setAttribute(
              "data-subject-tree-direction",
              nextDirection,
            );
          }
          updateSubjectDirectionButtons(editor);
          const graphView = editor.querySelector('[data-json-view="graph"]');
          if (graphView && graphView.hidden) {
            return;
          }
          renderGraph(editor);
        });
      });
    });

    DASHBOARD_RUNTIME.renderVisibleInstanceGraphs = (targetSwitchableId) => {
      const currentEditors = Array.from(
        document.querySelectorAll("[data-instance-editor]"),
      );
      currentEditors.forEach((editor) => {
        if (!(editor instanceof HTMLElement)) {
          return;
        }
        const switchable = editor.querySelector("[data-json-switchable]");
        const graphView = switchable?.querySelector('[data-json-view="graph"]');
        if (!switchable || !graphView || graphView.hidden) {
          return;
        }
        const currentSwitchableId =
          switchable.getAttribute("data-json-switchable-id") || "";
        if (targetSwitchableId && currentSwitchableId !== targetSwitchableId) {
          return;
        }
        renderGraph(editor);
      });
    };

    DASHBOARD_RUNTIME.renderVisibleInstanceGraphs("");
  }

  function initInstanceTablePagination() {
    const sections = Array.from(
      document.querySelectorAll("[data-instance-table]"),
    );
    if (sections.length === 0) {
      return;
    }

    sections.forEach((section) => {
      if (!(section instanceof HTMLElement)) {
        return;
      }
      if (section.getAttribute("data-instance-table-bound") === "true") {
        return;
      }

      const tableType = section.getAttribute("data-instance-table-type");
      const tbody = section.querySelector("tbody");
      const pagination = section.querySelector("[data-instance-pagination]");
      if (!tableType || !tbody || !pagination) {
        return;
      }

      let pageSize = normalizePositiveInt(
        section.getAttribute("data-instance-table-page-size"),
        20,
      );
      const pageSizeOptions = [20, 50, 100];
      if (!pageSizeOptions.includes(pageSize)) {
        pageSize = 20;
      }

      const editor = section.closest("[data-instance-editor]");
      const sourceTextarea = editor?.querySelector(
        "textarea[data-instance-json-textarea]",
      );
      let items = null;
      if (sourceTextarea && typeof sourceTextarea.value === "string") {
        try {
          const snapshot = JSON.parse(sourceTextarea.value);
          if (snapshot && typeof snapshot === "object") {
            if (tableType === "objects" && Array.isArray(snapshot.objects)) {
              items = snapshot.objects;
            }
            if (
              tableType === "relations" &&
              Array.isArray(snapshot.relation_events)
            ) {
              items = snapshot.relation_events;
            }
          }
        } catch {
          items = null;
        }
      }

      const existingRows = Array.from(tbody.querySelectorAll("tr"));
      const useItems = Array.isArray(items);
      const total = useItems ? items.length : existingRows.length;
      const computeTotalPages = () =>
        Math.max(1, Math.ceil(total / pageSize));
      let totalPages = computeTotalPages();

      const info = document.createElement("span");
      info.className = "pagination-info";

      const sizeWrap = document.createElement("label");
      sizeWrap.className = "pagination-size";
      const sizePrefix = document.createElement("span");
      sizePrefix.textContent = "每页";
      const sizeSelect = document.createElement("select");
      pageSizeOptions.forEach((size) => {
        const option = document.createElement("option");
        option.value = String(size);
        option.textContent = String(size);
        sizeSelect.append(option);
      });
      sizeSelect.value = String(pageSize);
      const sizeSuffix = document.createElement("span");
      sizeSuffix.textContent = "条";
      sizeWrap.append(sizePrefix, sizeSelect, sizeSuffix);

      const controls = document.createElement("div");
      controls.className = "pagination";

      const prevButton = document.createElement("button");
      prevButton.type = "button";
      prevButton.className = "pagination-arrow";
      prevButton.setAttribute("aria-label", "上一页");
      prevButton.innerHTML = "&lsaquo;";

      const nextButton = document.createElement("button");
      nextButton.type = "button";
      nextButton.className = "pagination-arrow";
      nextButton.setAttribute("aria-label", "下一页");
      nextButton.innerHTML = "&rsaquo;";

      const pageBadge = document.createElement("span");
      pageBadge.className = "pagination-item active";
      pageBadge.setAttribute("aria-current", "page");

      controls.append(prevButton, pageBadge, nextButton);
      pagination.innerHTML = "";
      pagination.append(info, sizeWrap, controls);

      const readText = (value) =>
        value === undefined || value === null ? "" : String(value);

      const renderObjectRow = (item) => {
        const labels = Array.isArray(item.labels)
          ? item.labels.filter((entry) => typeof entry === "string").join(", ")
          : "";
        const updatedAt = item.updated_at
          ? formatTime(readText(item.updated_at))
          : "-";
        return (
          `<tr>` +
          `<td>${escapeHtml(readText(item.object_id))}</td>` +
          `<td>${escapeHtml(readText(item.object_type))}</td>` +
          `<td>${escapeHtml(readText(item.sensitivity))}</td>` +
          `<td>${escapeHtml(readText(item.owner_ref))}</td>` +
          `<td>${escapeHtml(labels)}</td>` +
          `<td>${escapeHtml(updatedAt)}</td>` +
          `</tr>`
        );
      };

      const renderRelationRow = (item) => {
        const updatedAt = item.updated_at
          ? formatTime(readText(item.updated_at))
          : "-";
        return (
          `<tr>` +
          `<td>${escapeHtml(readText(item.from))}</td>` +
          `<td>${escapeHtml(readText(item.relation_type))}</td>` +
          `<td>${escapeHtml(readText(item.to))}</td>` +
          `<td>${escapeHtml(readText(item.scope))}</td>` +
          `<td>${escapeHtml(updatedAt)}</td>` +
          `</tr>`
        );
      };

      let currentPage = 1;

      const updateButtonState = (button, disabled) => {
        if (disabled) {
          button.classList.add("disabled");
          button.setAttribute("disabled", "true");
        } else {
          button.classList.remove("disabled");
          button.removeAttribute("disabled");
        }
      };

      const renderPage = (page) => {
        totalPages = computeTotalPages();
        const nextPage = Math.min(Math.max(1, page), totalPages);
        currentPage = nextPage;
        const start = (currentPage - 1) * pageSize;
        const end = Math.min(start + pageSize, total);

        if (useItems) {
          const slice = items.slice(start, end);
          const rows =
            tableType === "objects"
              ? slice.map(renderObjectRow)
              : slice.map(renderRelationRow);
          tbody.innerHTML = rows.join("");
        } else {
          existingRows.forEach((row, index) => {
            row.hidden = index < start || index >= end;
          });
        }

        info.textContent = `第 ${currentPage} / ${totalPages} 页 · 共 ${total} 条`;
        pageBadge.textContent = String(currentPage);
        updateButtonState(prevButton, currentPage <= 1);
        updateButtonState(nextButton, currentPage >= totalPages);
        controls.hidden = totalPages <= 1;
      };

      prevButton.addEventListener("click", () => {
        renderPage(currentPage - 1);
      });
      nextButton.addEventListener("click", () => {
        renderPage(currentPage + 1);
      });
      sizeSelect.addEventListener("change", () => {
        pageSize = normalizePositiveInt(sizeSelect.value, 20);
        section.setAttribute("data-instance-table-page-size", String(pageSize));
        renderPage(1);
      });

      renderPage(1);
      section.setAttribute("data-instance-table-bound", "true");
    });
  }

  function init() {
    initControlIncrementalRefresh();
    initSystemNotices();
    initSetupFixturePreviewForm();
    initJsonFilePickers();
    initTabNav();
    initMatrixDrawer();
    initJsonViewToggles();
    initModelEditors();
    initInstanceJsonEditors();
    initInstanceEditors();
    initInstanceTablePagination();
    initPolicyRulesTable();
    document.addEventListener("acl:control-partial-updated", () => {
      initTabNav();
      initMatrixDrawer();
      initJsonViewToggles();
      initModelEditors();
      initInstanceJsonEditors();
      initInstanceEditors();
      initInstanceTablePagination();
    });
  }

  // Policy Rules 表格交互：列宽拖拽、hover tooltip、点击填充编辑器
  function initPolicyRulesTable() {
    const tables = document.querySelectorAll(".policy-rules-table");
    tables.forEach((table) => {
      // 1. 列宽拖拽调整
      initResizableColumns(table);

      // 2. Hover tooltip
      initCellTooltips(table);

      // 3. 点击行填充编辑器
      initRowClickToEditor(table);
    });
  }

  function initResizableColumns(table) {
    const ths = table.querySelectorAll("thead th");
    if (ths.length === 0) return;

    ths.forEach((th) => {
      // 创建拖拽手柄
      const resizer = document.createElement("div");
      resizer.className = "column-resizer";
      th.appendChild(resizer);

      let startX = 0;
      let startWidth = 0;

      const onMouseDown = (e) => {
        startX = e.pageX;
        startWidth = th.offsetWidth;
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        e.preventDefault();
      };

      const onMouseMove = (e) => {
        const diff = e.pageX - startX;
        const newWidth = Math.max(50, startWidth + diff);
        th.style.width = `${newWidth}px`;
        th.style.minWidth = `${newWidth}px`;
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      resizer.addEventListener("mousedown", onMouseDown);
    });
  }

  function initCellTooltips(table) {
    const cells = table.querySelectorAll("tbody td");
    cells.forEach((cell) => {
      cell.addEventListener("mouseenter", () => {
        // 检查内容是否溢出
        if (cell.scrollWidth > cell.clientWidth + 5) {
          cell.setAttribute("data-tooltip", cell.textContent);
          cell.setAttribute("title", cell.textContent);
        }
      });
    });
  }

  function initRowClickToEditor(table) {
    const rows = table.querySelectorAll("tbody tr");
    rows.forEach((row) => {
      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        const cells = row.querySelectorAll("td");
        if (cells.length < 6) return;

        const ruleId = cells[0]?.textContent || "";
        const effect = cells[1]?.textContent || "allow";
        const priority = cells[2]?.textContent || "100";
        const actions = cells[3]?.textContent || "";
        const subjectSelector = cells[4]?.textContent || "";
        const objectSelector = cells[5]?.textContent || "";

        // 填充到规则编辑器
        const editor = document.querySelector(".policy-rule-editor");
        if (!editor) return;

        // 展开编辑器
        editor.setAttribute("open", "");

        // 填充字段
        const ruleIdField = editor.querySelector(
          '[data-model-field="rule_id"]',
        );
        const ruleEffectField = editor.querySelector(
          '[data-model-field="rule_effect"]',
        );
        const rulePriorityField = editor.querySelector(
          '[data-model-field="rule_priority"]',
        );
        const ruleActionsField = editor.querySelector(
          '[data-model-field="rule_action_set"]',
        );
        const ruleSubjectSelectorField = editor.querySelector(
          '[data-model-field="rule_subject_selector"]',
        );
        const ruleObjectSelectorField = editor.querySelector(
          '[data-model-field="rule_object_selector"]',
        );

        if (ruleIdField) ruleIdField.value = ruleId;
        if (ruleEffectField) ruleEffectField.value = effect;
        if (rulePriorityField) rulePriorityField.value = priority;
        if (ruleActionsField) ruleActionsField.value = actions;
        if (ruleSubjectSelectorField)
          ruleSubjectSelectorField.value = subjectSelector;
        if (ruleObjectSelectorField)
          ruleObjectSelectorField.value = objectSelector;

        // 触发 input 事件以同步到 JSON
        [
          ruleIdField,
          ruleEffectField,
          rulePriorityField,
          ruleActionsField,
          ruleSubjectSelectorField,
          ruleObjectSelectorField,
        ].forEach((field) => {
          if (field) {
            const eventType = field.tagName === "SELECT" ? "change" : "input";
            field.dispatchEvent(new Event(eventType, { bubbles: true }));
          }
        });

        // 高亮选中的行
        rows.forEach((r) => r.classList.remove("selected"));
        row.classList.add("selected");

        // 滚动到编辑器
        editor.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
    return;
  }
  init();
})();
