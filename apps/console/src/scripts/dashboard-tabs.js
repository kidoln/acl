(() => {
  const TAB_LABEL_MAP = {
    workflow: '发布流程',
    simulation: '影响模拟',
    relations: '关系回放',
    control: '控制面维护',
  };

  const VALID_TABS = Object.keys(TAB_LABEL_MAP);

  function normalizeTab(value) {
    return VALID_TABS.includes(value) ? value : 'workflow';
  }

  function init() {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
    return;
  }
  init();
})();
