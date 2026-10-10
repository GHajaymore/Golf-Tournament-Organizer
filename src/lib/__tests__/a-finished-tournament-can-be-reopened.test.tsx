import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({
  setEventStatus: async () => ({ ok: true }),
  launchTournament: async () => ({ ok: true }),
  setConfigUnlocked: async () => ({ ok: true }),
}));

const { LifecycleBar } = await import("@/components/LifecycleBar");

/**
 * A FINISHED TOURNAMENT CAN BE REOPENED (2026-10-10). Completing finalizes the
 * result; it took one click and nothing on screen undid it. Every club system
 * lets the committee reopen to correct a card — so a completed tournament
 * offers it, as a secondary button: on a finished event the result leads.
 * (Both Complete and Reopen ask first, in a dialog only a click opens.)
 */
const summary = {
  name: "zz Cup", dates: "May 14–16", course: "zz Links", format: "Stroke Play", overall: "Stroke play",
  players: 4, flights: 0, rounds: 1,
};
const bar = (status: string) =>
  renderToStaticMarkup(<LifecycleBar status={status} isAdmin configUnlocked={false} summary={summary} resultsIn={4} />);

describe("the lifecycle bar of a finished tournament", () => {
  it("offers Reopen, as a secondary button", () => {
    expect(bar("completed")).toMatch(/<button[^>]*class="btn btn-secondary"[^>]*>[\s\S]*?Reopen tournament/);
  });

  it("CONTROL: a live tournament offers Complete, as the primary button", () => {
    const html = bar("live");
    expect(html).toMatch(/<button[^>]*class="btn btn-primary"[^>]*>[\s\S]*?Complete tournament/);
    expect(html).not.toContain("Reopen tournament");
  });
});
