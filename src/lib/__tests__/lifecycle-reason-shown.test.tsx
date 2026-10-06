import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({
  setEventStatus: async () => ({ ok: true }),
  launchTournament: async () => ({ ok: true }),
  setConfigUnlocked: async () => ({ ok: true }),
}));

const { LifecycleBar } = await import("@/components/LifecycleBar");

/**
 * WHY THE NEXT PHASE ISN'T AVAILABLE — SAID, SHORT, AND WHOLE.
 *
 * The greyed "Complete tournament" button carries its reason in a card below
 * it. On 2026-10-05 the reason became its first sentence with the rest behind
 * an ⓘ, because the dashboard's "Needs you now" says the same dispute one card
 * above. This renders it: the short line is on screen, and every word of the
 * server's own refusal is still in the page.
 */

const summary = {
  name: "zz Cup", dates: "May 14–16", course: "zz Links", format: "Stroke Play", overall: "Stroke play",
  players: 4, flights: 0, rounds: 1,
};
const REASON =
  "1 result is disputed, so the tournament can't be finished yet. Open it on Score entry, settle the question, then finish.";

const bar = (blockedReason?: string) =>
  renderToStaticMarkup(
    <LifecycleBar status="live" isAdmin configUnlocked={false} summary={summary} resultsIn={4} blockedReason={blockedReason} />,
  );

describe("the reason a phase is not available", () => {
  it("shows its first sentence, with the whole of it an ⓘ away", () => {
    const html = bar(REASON);
    expect(html).toMatch(/<summary[\s\S]*1 result is disputed, so the tournament can(&#x27;|')t be finished yet\.[\s\S]*<\/summary>/);
    expect(html).toContain("settle the question, then finish");
  });

  it("disables the button it explains", () => {
    expect(bar(REASON)).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Complete tournament/);
  });

  it("says nothing when nothing is in the way — the control", () => {
    const html = bar(undefined);
    expect(html).not.toContain("Not yet");
    expect(html).not.toContain("disputed");
  });
});
