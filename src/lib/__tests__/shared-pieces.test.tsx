import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SidePanel } from "@/components/SidePanel";

/**
 * THE REDESIGN'S SIDE PANEL KEEPS ITS PROMISES (2026-10-30).
 *
 * Rounds & formats is its first user (`?view=timeline`), and it holds that screen's controls, so
 * each promise is pinned here rather than left to whoever uses it next:
 *
 *   open        a modal dialog named by its own visible title, with a named way to close it
 *   closed      nothing at all, unless kept mounted
 *   kept        mounted while closed: the same one copy in the page, hidden — so a closed round's
 *               controls are where they always were, and never drawn twice
 *
 * Focus, Escape and the backdrop are the browser's to test (`e2e/rounds-panel.spec.ts`).
 */
const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("SidePanel", () => {
  it("draws nothing when closed", () => {
    expect(html(<SidePanel open={false} title="Round 2" onClose={() => {}}>x</SidePanel>)).toBe("");
  });

  it("when open is a modal dialog named by its own visible title", () => {
    const out = html(
      <SidePanel open title="Round 2: Stableford" kicker="Round 2 of 3" onClose={() => {}} footer={<span>Saved</span>}>
        body
      </SidePanel>,
    );
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    const named = /aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(out).toMatch(new RegExp(`id="${named}"[^>]*>Round 2: Stableford<`));
    expect(out).toContain('aria-label="Close Round 2: Stableford"');
    expect(out, "an open panel is drawn hidden").not.toMatch(/class="side-panel-backdrop" hidden=""/);
  });

  it("kept mounted while closed: in the page once, and hidden", () => {
    const out = html(
      <SidePanel keepMounted open={false} title="Round 3" onClose={() => {}}>
        <label>Format for Round 3</label>
      </SidePanel>,
    );
    expect(count(out, "Format for Round 3"), "the closed round's control is not in the page exactly once").toBe(1);
    expect(out).toMatch(/class="side-panel-backdrop" hidden=""/);
  });
});
