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

  const TAB_PRESENTATION = {
    workflow: {
      sectionLabel: "治理流程",
      description:
        "围绕发布请求串起门禁、复核与激活，保持策略治理闭环。",
      navHint: "门禁、复核、激活",
    },
    system: {
      sectionLabel: "模型总览",
      description:
        "查看模型快照、目录结构与运行态摘要，校准主体、客体、动作和关系的边界。",
      navHint: "快照、目录、规则",
    },
    simulation: {
      sectionLabel: "影响评估",
      description:
        "先模拟变更影响，再决定是否发布，减少高敏对象和关键主体的意外波动。",
      navHint: "差异、排行、矩阵",
    },
    relations: {
      sectionLabel: "证据回放",
      description:
        "基于 decision trace 回放主体、客体与关系链路，定位判权依据。",
      navHint: "trace、路径、运行态",
    },
    control: {
      sectionLabel: "控制面",
      description:
        "维护命名空间、对象、关系与 expectation 演练，让控制面与运行态保持一致。",
      navHint: "实例、模板、审计",
    },
    components: {
      sectionLabel: "组件索引",
      description:
        "汇总嵌入组件与可复用能力，方便控制台和外部系统复用。",
      navHint: "widgets、overview",
    },
  };

  const TAB_ICON_SVGS = {
    workflow: `
      <svg viewBox="0 0 20 20" class="tab-link-icon-svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5" cy="5" r="2.2"></circle>
        <circle cx="15" cy="10" r="2.2"></circle>
        <circle cx="5" cy="15" r="2.2"></circle>
        <path d="M7.2 6.2 12.8 8.8"></path>
        <path d="M7.2 13.8 12.8 11.2"></path>
      </svg>
    `,
    system: `
      <svg viewBox="0 0 20 20" class="tab-link-icon-svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3.5" y="4" width="13" height="4.2" rx="1.4"></rect>
        <rect x="3.5" y="11.8" width="13" height="4.2" rx="1.4"></rect>
        <path d="M6.2 6.1h.01"></path>
        <path d="M6.2 13.9h.01"></path>
        <path d="M9 6.1h4.8"></path>
        <path d="M9 13.9h4.8"></path>
      </svg>
    `,
    simulation: `
      <svg viewBox="0 0 20 20" class="tab-link-icon-svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 4.5h8"></path>
        <path d="M8 4.5v3.2l-3.2 4.9A2.1 2.1 0 0 0 6.6 16h6.8a2.1 2.1 0 0 0 1.8-3.4L12 7.7V4.5"></path>
        <path d="M7.6 11h4.8"></path>
        <path d="M8.6 13.2h2.8"></path>
      </svg>
    `,
    relations: `
      <svg viewBox="0 0 20 20" class="tab-link-icon-svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="5" cy="10" r="2.2"></circle>
        <circle cx="14.8" cy="5.2" r="2.2"></circle>
        <circle cx="14.8" cy="14.8" r="2.2"></circle>
        <path d="M7.2 9 12.6 6.1"></path>
        <path d="M7.2 11 12.6 13.9"></path>
      </svg>
    `,
    control: `
      <svg viewBox="0 0 20 20" class="tab-link-icon-svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 4v12"></path>
        <path d="M10 4v12"></path>
        <path d="M15 4v12"></path>
        <circle cx="5" cy="7" r="2"></circle>
        <circle cx="10" cy="12.5" r="2"></circle>
        <circle cx="15" cy="8.5" r="2"></circle>
      </svg>
    `,
    components: `
      <svg viewBox="0 0 20 20" class="tab-link-icon-svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3.5" y="3.5" width="5.2" height="5.2" rx="1.2"></rect>
        <rect x="11.3" y="3.5" width="5.2" height="5.2" rx="1.2"></rect>
        <rect x="3.5" y="11.3" width="5.2" height="5.2" rx="1.2"></rect>
        <rect x="11.3" y="11.3" width="5.2" height="5.2" rx="1.2"></rect>
      </svg>
    `,
    fallback: `
      <svg viewBox="0 0 20 20" class="tab-link-icon-svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="4" width="12" height="12" rx="2"></rect>
      </svg>
    `,
  };

  const TAB_SECTIONS = [
    {
      label: "治理工作区",
      tabs: ["workflow", "simulation", "relations"],
    },
    {
      label: "运行与配置",
      tabs: ["system", "control", "components"],
    },
  ];

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
      activeTabMeta() {
        const fallback = {
          sectionLabel: "控制台",
          description:
            "围绕主体、客体、动作、关系、上下文、生命周期组织 ACL 治理工作。",
          navHint: "overview",
        };
        const matched = TAB_PRESENTATION[this.activeTab];
        return {
          label: this.activeTabLabel,
          ...(matched || fallback),
        };
      },
      sidebarSections() {
        return TAB_SECTIONS.map((section) => ({
          label: section.label,
          items: section.tabs
            .map((tabId) => {
              const link = this.tabLinks.find((item) => item.id === tabId);
              const tabItem = this.tabItems.find((item) => item.id === tabId);
              const meta = TAB_PRESENTATION[tabId] || {
                navHint: "overview",
              };
              if (!link || !tabItem) {
                return null;
              }
              return {
                id: tabId,
                href: link.href,
                label: tabItem.label,
                icon: tabItem.icon,
                iconLabel: tabItem.iconLabel,
                description: meta.navHint,
              };
            })
            .filter(Boolean),
        }));
      },
      workspaceFacts() {
        const namespace = readValue(this.query, "namespace", "tenant_a.crm");
        const focusValue =
          this.activeTab === "workflow"
            ? readValue(this.query, "publish_id", "未选择发布单")
            : this.activeTab === "simulation"
              ? readValue(this.query, "publish_id", "未选择发布单")
              : this.activeTab === "relations"
                ? readValue(this.query, "decision_id", "未选择决策")
                : this.activeTab === "control"
                  ? readValue(this.query, "fixture_id", "控制面维护")
                  : this.activeTab === "system"
                    ? readValue(this.query, "publish_id", "模型快照总览")
                    : readValue(this.query, "widget", "组件目录");

        return [
          {
            label: "Workspace",
            value: namespace,
          },
          {
            label: "Current Focus",
            value: focusValue,
          },
          {
            label: "API Endpoint",
            value: this.apiBaseUrl || "-",
          },
          {
            label: "Generated At",
            value: this.formattedGeneratedAt,
          },
        ];
      },
      breadcrumbItems() {
        return [
          "ACL Console",
          readValue(this.query, "namespace", "tenant_a.crm"),
          this.activeTabLabel,
        ];
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
      renderTabIcon(icon) {
        return TAB_ICON_SVGS[icon] || TAB_ICON_SVGS.fallback;
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

          <nav
            v-if="!isEmbed"
            class="tab-nav animate-enter delay-100"
            role="tablist"
            aria-label="ACL 控制台一级标签"
          >
            <section class="sidebar-brand">
              <div class="sidebar-brand-mark" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div class="sidebar-brand-copy">
                <p class="sidebar-eyebrow">Enterprise ACL</p>
                <h2>ACL 控制台</h2>
                <p>Governance Console</p>
              </div>
            </section>

            <section class="sidebar-context">
              <span class="sidebar-context-label">当前工作区</span>
              <strong class="sidebar-context-value">
                {{ readValue(query, 'namespace', 'tenant_a.crm') }}
              </strong>
              <p class="sidebar-context-note">
                以主体、客体、动作、关系、上下文、生命周期的统一视角组织治理工作。
              </p>
            </section>

            <section
              v-for="section in sidebarSections"
              :key="section.label"
              class="tab-nav-section"
            >
              <p class="tab-nav-heading">{{ section.label }}</p>
              <div class="tab-nav-links">
                <a
                  v-for="tab in section.items"
                  :key="tab.id"
                  :href="tab.href"
                  :class="['tab-link', { active: tab.id === activeTab }]"
                  :data-tab="tab.id"
                  role="tab"
                  :aria-selected="tab.id === activeTab ? 'true' : 'false'"
                  :aria-controls="panelId(tab.id)"
                >
                  <span
                    class="tab-link-mark"
                    :data-icon="tab.icon"
                    :title="tab.iconLabel"
                    aria-hidden="true"
                    v-html="renderTabIcon(tab.icon)"
                  ></span>
                  <span class="tab-link-copy">
                    <span class="tab-link-title">{{ tab.label }}</span>
                    <small>{{ tab.description }}</small>
                  </span>
                </a>
              </div>
            </section>

            <footer class="sidebar-footer">
              <div class="sidebar-footer-chip">
                <span>API</span>
                <strong>{{ apiBaseUrl || '-' }}</strong>
              </div>
              <p class="sidebar-footnote">生成时间 {{ formattedGeneratedAt }}</p>
            </footer>
          </nav>

          <section v-else class="hero animate-enter">
            <div class="hero-breadcrumbs" aria-label="当前页面路径">
              <template v-for="(item, index) in breadcrumbItems" :key="item">
                <span
                  :class="['hero-crumb', { current: index === breadcrumbItems.length - 1 }]"
                >
                  {{ item }}
                </span>
                <span
                  v-if="index !== breadcrumbItems.length - 1"
                  class="hero-sep"
                  aria-hidden="true"
                >
                  /
                </span>
              </template>
            </div>

            <div class="hero-layout">
              <div class="hero-identity">
                <span class="hero-mark" aria-hidden="true">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
                <div>
                  <p class="hero-kicker">{{ activeTabMeta.sectionLabel }}</p>
                  <h1>{{ activeTabMeta.label }}</h1>
                  <p>{{ activeTabMeta.description }}</p>
                </div>
              </div>

              <div class="hero-actions">
                <span class="hero-pill">Governance Console</span>
                <span class="hero-context">
                  当前焦点: {{ workspaceFacts[1] ? workspaceFacts[1].value : '-' }}
                </span>
              </div>
            </div>

            <div class="hero-facts">
              <article
                v-for="fact in workspaceFacts"
                :key="fact.label"
                class="hero-fact-card"
              >
                <span class="hero-fact-label">{{ fact.label }}</span>
                <strong class="hero-fact-value">{{ fact.value }}</strong>
              </article>
            </div>

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
                v-else-if="tab.id === 'system'"
                class="stack stack-main animate-enter delay-200"
                v-html="panels.system"
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
  const appVm = app.mount("#app");

  document.addEventListener("acl:console-payload-updated", (event) => {
    const nextPayload = event?.detail?.payload;
    if (!nextPayload || typeof nextPayload !== "object") {
      return;
    }

    if (typeof nextPayload.pageTitle === "string" && nextPayload.pageTitle.length > 0) {
      appVm.pageTitle = nextPayload.pageTitle;
      document.title = nextPayload.pageTitle;
    }
    if (typeof nextPayload.isEmbed === "boolean") {
      appVm.isEmbed = nextPayload.isEmbed;
    }
    if (typeof nextPayload.activeTab === "string" && nextPayload.activeTab.length > 0) {
      appVm.activeTab = nextPayload.activeTab;
    }
    if (Array.isArray(nextPayload.tabItems)) {
      appVm.tabItems = nextPayload.tabItems;
    }
    if (Array.isArray(nextPayload.tabLinks)) {
      appVm.tabLinks = nextPayload.tabLinks;
    }
    if (nextPayload.query && typeof nextPayload.query === "object") {
      appVm.query = nextPayload.query;
    }
    if (typeof nextPayload.apiBaseUrl === "string") {
      appVm.apiBaseUrl = nextPayload.apiBaseUrl;
    }
    if (typeof nextPayload.generatedAt === "string") {
      appVm.generatedAt = nextPayload.generatedAt;
    }
    if (typeof nextPayload.systemNoticeHtml === "string") {
      appVm.systemNoticeHtml = nextPayload.systemNoticeHtml;
    }
  });
})();
