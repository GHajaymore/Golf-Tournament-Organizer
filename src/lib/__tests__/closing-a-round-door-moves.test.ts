import { describe, it, expect } from "vitest";
import { relocate, type ScreenKey } from "../domain/console-merges";
import { jobHref } from "../domain/needs-you-now";

/**
 * "CLOSE ROUND n" FOLLOWS THE ROOM (R12). While Score entry is shown a round is closed THERE, so the door that used to open the
 * round on Rounds & formats (What's next's "Close Round n", the status card's press) is re-pointed to Score entry, at the same
 * round; with Score entry not shown it is today's address exactly. Only staff: a player has no such door.
 */
const link = (role: "admin" | "assistant" | "player") => ({ href: jobHref({ href: "/stages", roundId: "r-1", hash: undefined }), job: "close", role, roundId: "r-1" });
const shown = (...k: ScreenKey[]) => new Set<ScreenKey>(k);

describe("the close-a-round door", () => {
  it("with Score entry shown, leads to Score entry at the same round, for the Organizer and the assistant", () => {
    for (const role of ["admin", "assistant"] as const) {
      expect(relocate(link(role), shown("scoreEntry")), role).toBe("/entry?round=r-1");
    }
  });

  it("CONTROL: with Score entry not shown, or nothing shown, it is the old address exactly", () => {
    expect(relocate(link("admin"), shown())).toBe("/stages?round=r-1");
    expect(relocate(link("admin"), shown("teeTimes", "rounds"))).toBe("/stages?round=r-1");
  });

  it("another job at the same door is not taken (a draw goes to Tee times, never to Score entry)", () => {
    const draw = { ...link("admin"), job: "draw" };
    expect(relocate(draw, shown("scoreEntry"))).toBe("/stages?round=r-1");
    expect(relocate(draw, shown("scoreEntry", "teeTimes"))).toBe("/foursomes?round=r-1");
  });
});
