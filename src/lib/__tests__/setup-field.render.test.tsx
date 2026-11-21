import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import { MARK_WORDS, SetupField } from "@/components/setup/SetupField";
import type { Mark } from "@/lib/domain/setup-field";

const noop = () => {};
const draw = (mark: Mark | null, over: { isDefault?: boolean; onChange?: (() => void) | null } = {}) =>
  renderToStaticMarkup(
    <div style={{ width: 320 }}>
      <SetupField
        label="Allowance"
        mark={mark}
        dflt={{ value: "95%", source: "the Rules' usual allowance" }}
        isDefault={over.isDefault ?? false}
        onChange={over.onChange === undefined ? noop : over.onChange}
        onUseDefault={noop}
      >
        90%
      </SetupField>
    </div>,
  );

describe("SetupField draws what markOf says", () => {
  it("draws each mark in its words", () => {
    for (const mark of ["required-before-launch", "required", "default"] as const) {
      const html = draw(mark);
      expect(html).toContain(`data-mark="${mark}"`);
      expect(html).toContain(MARK_WORDS[mark]);
    }
    expect(MARK_WORDS["required-before-launch"]).toBe("Required before launch");
  });

  it("draws no mark for null", () => {
    expect(draw(null)).not.toContain("data-mark");
  });

  it("offers Change, then the way back to the default", () => {
    const html = draw(null);
    expect(html).toContain("Change");
    expect(html).toContain("Use the default (95%)");
    expect(html.indexOf("Change")).toBeLessThan(html.indexOf("Use the default"));
  });

  it("on the default, names its source and offers no way back", () => {
    const html = draw("default", { isDefault: true });
    expect(html).toContain("the Rules&#x27; usual allowance");
    expect(html).not.toContain("Use the default");
  });

  it("every flex child can shrink: min-width 0, and the label wraps above the value", () => {
    const html = draw("required");
    expect((html.match(/min-width:0/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("flex-wrap:wrap");
  });

  it("holds no colour of its own", () => {
    const src = readSource("src/components/setup/SetupField.tsx");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });
});
