import type { ConsolePageViewModel } from "../../types";
import {
  buildScopedQueryHref,
  escapeHtml,
  getScopedFieldNamesForWidget,
  renderHiddenContextFields,
  WIDGET_ITEMS,
} from "../shared";

export function renderWidgetRows(viewModel: ConsolePageViewModel): string {
  return WIDGET_ITEMS.map((item) => {
    const embedHref = buildScopedQueryHref(
      viewModel,
      getScopedFieldNamesForWidget(item.id),
      {
        widget: item.id,
        tab: undefined,
      },
    );
    return (
      `<tr>` +
      `<td>${escapeHtml(item.id)}</td>` +
      `<td>${escapeHtml(item.label)}</td>` +
      `<td>${escapeHtml(item.description)}</td>` +
      `<td><a href="${embedHref}" target="_blank" rel="noreferrer">打开嵌入视图</a></td>` +
      `</tr>`
    );
  }).join("");
}

export function renderComponentsIndexView(viewModel: ConsolePageViewModel): string {
  const widgetRows = renderWidgetRows(viewModel);
  const hiddenContext = renderHiddenContextFields(viewModel, ["tab"]);

  return (
    `<article class="card card-hover story-entry-card">` +
    `<h3>组件索引</h3>` +
    `<p class="muted">该页面用于查看可嵌入组件与对应链接，不属于控制面运行态数据。</p>` +
    `<form class="filters toolbar" method="GET" action="/" data-control-incremental="true">` +
    hiddenContext +
    `<input type="hidden" name="tab" value="components" />` +
    `<button type="submit" class="btn btn-secondary">刷新组件索引</button>` +
    `</form>` +
    `<div class="table-container management-table"><table class="data-table"><thead><tr><th>Widget ID</th><th>组件</th><th>用途</th><th>Embed</th></tr></thead><tbody>${widgetRows}</tbody></table></div>` +
    `</article>`
  );
}
