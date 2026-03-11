(() => {
  const payloadNode = document.getElementById("acl-console-payload");
  if (!payloadNode) {
    return;
  }

  let payload = null;
  try {
    payload = JSON.parse(payloadNode.textContent || "{}");
  } catch {
    return;
  }

  const VueGlobal = window.Vue;
  if (!VueGlobal || typeof VueGlobal.createApp !== "function") {
    return;
  }

  const formatTime = (value) => {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
      return value;
    }
    return new Date(parsed).toLocaleString("zh-CN", { hour12: false });
  };

  const readValue = (source, key, fallback) => {
    if (!source) {
      return fallback;
    }
    const value = source[key];
    if (value === undefined || value === null || String(value).trim().length === 0) {
      return fallback;
    }
    return String(value);
  };

  const app = VueGlobal.createApp({
    data() {
      return {
        pageTitle: payload?.pageTitle || "ACL 控制台",
        isEmbed: Boolean(payload?.isEmbed),
        activeTab: payload?.activeTab || "workflow",
        tabItems: Array.isArray(payload?.tabItems) ? payload.tabItems : [],
        tabLinks: Array.isArray(payload?.tabLinks) ? payload.tabLinks : [],
        query: payload?.query || {},
        apiBaseUrl: payload?.apiBaseUrl || "",
        generatedAt: payload?.generatedAt || "",
        panels: payload?.panels || {},
        embedWidgetHtml: payload?.embedWidgetHtml || "",
        systemNoticeHtml: payload?.systemNoticeHtml || "",
      };
    },
    computed: {
      formattedGeneratedAt() {
        return formatTime(this.generatedAt);
      },
      activeTabLabel() {
        const matched = this.tabItems.find((item) => item.id === this.activeTab);
        return matched?.label || "发布流程";
      },
      heroBadges() {
        const badges = [
          {
            text: `tab: ${this.activeTabLabel}`,
            className: "badge badge-info",
            isTabLabel: true,
          },
        ];

        if (this.activeTab === "workflow") {
          badges.push(
            {
              text: `status: ${readValue(this.query, "status", "all")}`,
              className: "badge badge-info",
            },
            {
              text: `profile: ${readValue(this.query, "profile", "all")}`,
              className: "badge badge-neutral",
            },
            {
              text: `publish: ${readValue(this.query, "publish_id", "未选中")}`,
              className: "badge badge-primary",
            },
            {
              text: `namespace: ${readValue(
                this.query,
                "namespace",
                "tenant_a.crm",
              )}`,
              className: "badge badge-info",
            },
          );
        } else if (this.activeTab === "simulation") {
          badges.push(
            {
              text: `publish: ${readValue(this.query, "publish_id", "未选择")}`,
              className: "badge badge-primary",
            },
            {
              text: `simulation: ${readValue(
                this.query,
                "simulation_id",
                "latest",
              )}`,
              className: "badge badge-neutral",
            },
            {
              text: `profile: ${readValue(this.query, "profile", "all")}`,
              className: "badge badge-info",
            },
            {
              text: `namespace: ${readValue(
                this.query,
                "namespace",
                "tenant_a.crm",
              )}`,
              className: "badge badge-info",
            },
          );
        } else if (this.activeTab === "relations") {
          badges.push(
            {
              text: `decision: ${readValue(
                this.query,
                "decision_id",
                "未选择",
              )}`,
              className: "badge badge-primary",
            },
            {
              text: `namespace: ${readValue(
                this.query,
                "namespace",
                "tenant_a.crm",
              )}`,
              className: "badge badge-info",
            },
          );
        } else if (this.activeTab === "control") {
          badges.push(
            {
              text: `namespace: ${readValue(
                this.query,
                "namespace",
                "tenant_a.crm",
              )}`,
              className: "badge badge-primary",
            },
            {
              text: `fixture: ${readValue(
                this.query,
                "fixture_id",
                "未选择",
              )}`,
              className: "badge badge-neutral",
            },
            {
              text: `expectation: ${readValue(
                this.query,
                "expectation_run_id",
                "未运行",
              )}`,
              className: "badge badge-info",
            },
          );
        } else {
          badges.push({
            text: `namespace: ${readValue(
              this.query,
              "namespace",
              "tenant_a.crm",
            )}`,
            className: "badge badge-primary",
          });
        }

        return badges;
      },
    },
    methods: {
      panelId(tabId) {
        return `tab-panel-${tabId}`;
      },
      readValue(source, key, fallback) {
        return readValue(source, key, fallback);
      },
    },
    template: `
      <div>
        <main :class="['shell', isEmbed ? 'embed-shell' : 'console-shell']">
          <section v-if="isEmbed" class="embed-head card animate-enter">
            <div class="hero-top">
              <h1>{{ pageTitle }}</h1>
              <span class="hero-pill">Embeddable Widget</span>
            </div>
            <p>
              widget={{ readValue(query, 'widget', '') }}
              / API: {{ apiBaseUrl }}
              / 时间: {{ formattedGeneratedAt }}
            </p>
          </section>

          <section v-else class="hero animate-enter">
            <div class="hero-top">
              <h1>ACL 控制台</h1>
              <span class="hero-pill">Governance Console</span>
            </div>
            <p>
              发布流程治理 + 决策回放 + 控制面同步。API: {{ apiBaseUrl }}，生成时间: {{ formattedGeneratedAt }}
            </p>
            <div class="hero-meta">
              <span
                v-for="badge in heroBadges"
                :key="badge.text"
                :class="badge.className"
                :data-tab-label="badge.isTabLabel ? 'true' : null"
              >
                {{ badge.text }}
              </span>
            </div>
          </section>

          <nav
            v-if="!isEmbed"
            class="tab-nav animate-enter delay-100"
            role="tablist"
            aria-label="ACL 控制台一级标签"
          >
            <a
              v-for="tab in tabLinks"
              :key="tab.id"
              :href="tab.href"
              :class="['tab-link', { active: tab.id === activeTab }]"
              :data-tab="tab.id"
              role="tab"
              :aria-selected="tab.id === activeTab ? 'true' : 'false'"
              :aria-controls="panelId(tab.id)"
            >
              {{ tab.label }}
            </a>
          </nav>

          <section v-if="isEmbed" class="stack stack-main animate-enter delay-100" v-html="embedWidgetHtml"></section>

          <section v-else class="tab-panels">
            <section
              v-for="tab in tabItems"
              :key="tab.id"
              :class="['tab-panel', { active: tab.id === activeTab }]"
              :data-tab-panel="tab.id"
              :id="panelId(tab.id)"
              role="tabpanel"
              :aria-hidden="tab.id === activeTab ? 'false' : 'true'"
            >
              <section
                v-if="tab.id === 'workflow'"
                class="grid"
                v-html="panels.workflow"
              ></section>
              <section
                v-else-if="tab.id === 'simulation'"
                class="stack stack-main animate-enter delay-200"
                v-html="panels.simulation"
              ></section>
              <section
                v-else-if="tab.id === 'relations'"
                class="stack stack-main animate-enter delay-200"
                v-html="panels.relations"
              ></section>
              <section
                v-else-if="tab.id === 'control'"
                class="stack stack-main animate-enter delay-200"
                v-html="panels.control"
              ></section>
              <section
                v-else
                class="stack stack-main animate-enter delay-200"
                v-html="panels.components"
              ></section>
            </section>
          </section>
        </main>
        <div v-html="systemNoticeHtml"></div>
      </div>
    `,
  });
  app.mount("#app");
})();
