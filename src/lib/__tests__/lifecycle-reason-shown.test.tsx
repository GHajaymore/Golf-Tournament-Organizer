import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({
  setEventStatus: async () => ({ ok: true }),
  launchTournament: async () => ({ ok: true }),
  setConfigUnlocked: async () => ({ ok: true }),
}));

const { LifecycleBar } = await import("@/components/LifecycleBar");
const { statusCardOf } = await import("@/lib/domain/tournament-status");
const { facts, round, launched } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");

/**
 * WHY THE NEXT PHASE ISN'T AVAILABLE — SAID WHERE THE PRESS WOULD BE.
 *
 * Since the state machine's PR 3 the refused button is drawn by
 * `RefusedAction`: the button refused in place (`aria-disabled`, so it stays
 * focusable and a screen reader reaches the reason through
 * `aria-describedby`), the machine's own sentence directly under it, ending in
 * the way out — a link to the screen that settles it. It was a disabled button
 * with its reason in a tooltip and a second card below ("Not yet — complete
 * tournament") saying the first sentence again.
 *
 * The facts: a medal, live, its round played, one result disputed. Under Rule
 * 20.1c(3) / 20.2b a dispute is a ruling the Committee owes, so the result is
 * not final and Complete is refused (`finishRefusal`).
 */

const summary = {
  name: "zz Cup", dates: "May 14–16", course: "zz Links", format: "Stroke Play", overall: "Stroke play",
  players: 4, flights: 0, rounds: 1,
};
const played = launched(facts({ rounds: [round({ id: "r1", position: 0, hasResult: true })] }));

const bar = (disputed: number) =>
  renderToStaticMarkup(
    <LifecycleBar
      status={statusCardOf({ ...played, review: { pendingConfirmations: 0, disputed } })}
      isAdmin
      configUnlocked={false}
      summary={summary}
    />,
  );

describe("the reason a phase is not available", () => {
  it("says the machine's reason, whole, under the button, with the way out", () => {
    const html = bar(1);
    expect(html).toMatch(/1 result is disputed/);
    // The way out: every refusal to complete is settled on Score entry.
    expect(html).toMatch(/<a[^>]*href="\/entry"[^>]*>Open Score entry<\/a>/);
  });

  it("refuses the button in place — focusable, and described by its reason", () => {
    const html = bar(1);
    const button = html.match(/<button[^>]*aria-disabled="true"[^>]*>[\s\S]*?Complete tournament/);
    expect(button, "the refused Complete button").not.toBeNull();
    const describedBy = button![0].match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy, "the button names no reason").toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    expect(button![0], "a disabled button leaves the tab order, and its reason with it").not.toMatch(/\sdisabled=""/);
  });

  it("says nothing when nothing is in the way — the control", () => {
    const html = bar(0);
    expect(html).not.toContain("Not yet");
    expect(html).not.toContain("disputed");
    expect(html).not.toContain('aria-disabled="true"');
    expect(html).toMatch(/<button[^>]*class="btn btn-primary"[^>]*>[\s\S]*?Complete tournament/);
  });
});
