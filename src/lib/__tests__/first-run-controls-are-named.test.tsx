import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Server actions stand in as no-ops, exactly as in render.test.tsx: the
// components only hold references to them until something is clicked.
function actionModule() {
  return new Proxy(
    {},
    {
      get: (_t, key) =>
        typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined,
    },
  ) as Record<string, unknown>;
}
vi.mock("@/app/actions/series", actionModule);
vi.mock("@/app/actions/courses", actionModule);
vi.mock("@/app/actions/teams", actionModule);
vi.mock("@/app/actions/organization", actionModule);
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/event", actionModule);
vi.mock("@/app/actions/stages", actionModule);
vi.mock("@/app/actions/roster", actionModule);
vi.mock("@/app/actions/messaging", actionModule);

import { EventSwitcher } from "@/components/EventSwitcher";
import { CreateFirstTournament } from "@/components/CreateFirstTournament";
import { unnamedControls } from "./unnamed-controls";

/**
 * EVERY CONTROL A NEW ORGANIZER MEETS FIRST HAS A NAME.
 *
 * Walking the console as a novice organizer (2026-09-25), the create panel's
 * three controls — name, "Start from", "How is it played?" — had captions on
 * screen but none of them was attached to its control: the <label> sat beside
 * it with no `htmlFor`. Sighted, it reads fine; to a screen reader it is
 * "edit text, combo box, combo box" with no idea which is which.
 *
 * Measured in the browser, not grepped: 240 `<label>` openings in the source
 * said nothing about how many were broken, because a label that WRAPS its
 * control is correctly associated. The rendered count was the truth — the
 * create panel 4 of 4 unnamed, Tournament details 10 of 45.
 *
 * This pins the first-run path. The rest of the app is a measured follow-up
 * (see docs/deferred-register.md); this file is where to add a screen as it is
 * fixed.
 */

describe("a new organizer's first controls are named", () => {
  it("the returning organizer's create panel", () => {
    const html = renderToStaticMarkup(<EventSwitcher events={[]} />);
    expect(html, "the panel did not render").toContain("How is it played?");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("a brand-new organizer's first tournament form", () => {
    const html = renderToStaticMarkup(<CreateFirstTournament first plan="free" />);
    expect(html, "the form did not render").toContain("Tournament name");
    expect(unnamedControls(html)).toEqual([]);
  });

  it("names the group of 'How is it played?' choices, not a single control", () => {
    const html = renderToStaticMarkup(<CreateFirstTournament first plan="free" />);
    const id = /<label id="([^"]+)"[^>]*>How is it played\?<\/label>/.exec(html)?.[1];
    expect(id, "the caption carries no id").toBeTruthy();
    expect(html).toContain(`role="group" aria-labelledby="${id}"`);
  });

  it("the check itself catches an unnamed control (control)", () => {
    // Without this, a checker that returned [] for everything would pass the
    // three above perfectly.
    expect(unnamedControls(`<div><label>Name</label><input class="input"/></div>`)).toHaveLength(1);
    expect(unnamedControls(`<label for="x">Name</label><input id="x"/>`)).toEqual([]);
    expect(unnamedControls(`<label>Name <input/></label>`)).toEqual([]);
    expect(unnamedControls(`<select aria-label="Currency"></select>`)).toEqual([]);
  });
});
