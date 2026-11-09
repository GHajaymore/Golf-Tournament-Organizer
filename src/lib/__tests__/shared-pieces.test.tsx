import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SidePanel } from "@/components/SidePanel";
import { readSource } from "./source";

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

  it("asked to dock, it is marked for the dock and is still a dialog until the screen is measured", () => {
    // The server cannot know the width: the first render is the dialog, and the browser docks it
    // from 1280 (`SIDE_PANEL_DOCK_FROM`; not modal there — `e2e/rounds-panel.spec.ts` walks it).
    const out = html(<SidePanel dock open title="Round 1" onClose={() => {}}>body</SidePanel>);
    expect(out).toMatch(/class="side-panel-backdrop" data-dock=""/);
    expect(out).toContain('role="dialog"');
    expect(html(<SidePanel open title="Round 1" onClose={() => {}}>body</SidePanel>)).not.toContain("data-dock");
  });

  it("docking is decided ONCE, from the window's width, and the CSS follows it (a scrollbar feedback loop at 1280 in Safari's engine)", () => {
    // Docking narrows the list, which adds or removes the page's scrollbar; a media query judged against
    // the layout width then undocks it, and the panel flickered between docked and modal (four WebKit
    // desktop failures, 2026-11-08). `innerWidth` does not move with the scrollbar.
    const panel = readSource("src/components/SidePanel.tsx");
    expect(panel).toContain("window.innerWidth >= SIDE_PANEL_DOCK_FROM");
    expect(panel, "the dock reads a second evaluator").not.toMatch(/matchMedia/);
    expect(panel).toMatch(/data-docked=/);
    const css = readSource("src/app/(app)/stages/rounds-timeline.css");
    expect(css, "the dock's rules key off a media query again").not.toContain("min-width: 1280px");
    expect(css).toContain(".side-panel-backdrop[data-dock][data-docked] { background: transparent;");
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
