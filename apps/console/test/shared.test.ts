import { describe, expect, it } from "vitest";

import { renderJsonToggleSwitch } from "../src/views/shared";

describe("shared view helpers", () => {
  it('renders card detail toggle as "表单 / JSON"', () => {
    const html = renderJsonToggleSwitch();

    expect(html).toContain(">表单</button>");
    expect(html).toContain(">JSON</button>");
    expect(html).not.toContain(">图</button>");
  });
});
