import { describe, it, expect } from "vitest";
import { landingEvent, watchOnly, type Reachable } from "@/lib/domain/landing-event";

const own = (eventId: string, role = "player"): Reachable => ({ eventId, role, source: "event" });
const watched = (eventId: string): Reachable => ({ eventId, role: "player", source: "organization" });
const runs = (eventId: string): Reachable => ({ eventId, role: "admin", source: "organization" });

describe("which tournament a session opens on with no choice made", () => {
  it("is the member's own tournament, not a newer club one they are only watching", () => {
    // The defect: the fixture player landed on a newer club tournament with no card in it.
    const reach = [own("medal"), watched("foursomes")];
    expect(landingEvent(reach, ["foursomes", "medal"])?.eventId).toBe("medal");
  });

  it("is the newest of their own when they have several", () => {
    const reach = [own("spring"), own("autumn"), watched("club-cup")];
    expect(landingEvent(reach, ["club-cup", "autumn", "spring"])?.eventId).toBe("autumn");
  });

  it("counts a tournament they run through the club as their own", () => {
    const reach = [runs("new"), own("old")];
    expect(landingEvent(reach, ["new", "old"])?.eventId).toBe("new");
  });

  it("falls back to the newest watched one when they are in nothing", () => {
    const reach = [watched("a"), watched("b")];
    expect(landingEvent(reach, ["b", "a"])?.eventId).toBe("b");
  });

  it("still returns something if the newest-first list is missing ids", () => {
    expect(landingEvent([watched("a")], [])?.eventId).toBe("a");
  });

  it("only a plain member reached through the club is watch-only", () => {
    expect(watchOnly(watched("x"))).toBe(true);
    expect(watchOnly(own("x"))).toBe(false);
    expect(watchOnly(runs("x"))).toBe(false);
  });
});
