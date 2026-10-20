import { describe, expect, it } from "vitest";
import { sessionName, TEAM_SESSION } from "@/lib/services/cup";
import { STAGE_DESCRIPTIONS } from "@/lib/stage-types";

/**
 * A CUP SESSION IS CALLED BY A NAME, NEVER BY ITS TYPE'S BLURB (2026-10-20).
 *
 * A session added with "Add round" carries the type's own sentence as its
 * description, and the cup board — and the final report, which titles each
 * session with it — printed "A session of the team cup: the captains'
 * lineup, every match worth a point." as the session's name. The same rule as
 * every other label slot (`roundKicker`) decides now.
 */
describe("a cup session's name", () => {
  it("is never the type's own sentence", () => {
    const blurb = STAGE_DESCRIPTIONS[TEAM_SESSION];
    expect(blurb.length, "CONTROL: the type has a sentence to refuse").toBeGreaterThan(24);
    expect(sessionName({ description: blurb }, 1)).toBe("Session 2");
  });

  it("is the organizer's name when they gave one", () => {
    expect(sessionName({ description: "Saturday four-balls" }, 0)).toBe("Saturday four-balls");
    expect(sessionName({ description: "Sunday singles" }, 2)).toBe("Sunday singles");
  });

  it("falls back to its place in the cup when there is none", () => {
    expect(sessionName({ description: "" }, 0)).toBe("Session 1");
    expect(sessionName({ description: "   " }, 3)).toBe("Session 4");
  });
});
