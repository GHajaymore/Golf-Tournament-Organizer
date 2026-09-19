import { describe, it, expect } from "vitest";
import { landingEvent, watchOnly, type Reachable } from "@/lib/domain/landing-event";

const own = (eventId: string, role = "player"): Reachable => ({ eventId, role, source: "event" });
const watched = (eventId: string): Reachable => ({ eventId, role: "player", source: "organization" });
const runs = (eventId: string): Reachable => ({ eventId, role: "admin", source: "organization" });
/** Newest first, each with a status (draft unless said). */
const ev = (...list: (string | [string, string])[]) =>
  list.map((x) => (typeof x === "string" ? { id: x, status: "draft" } : { id: x[0], status: x[1] }));

describe("which tournament a session opens on with no choice made", () => {
  it("is the member's own tournament, not a newer club one they are only watching", () => {
    // The defect: the fixture player landed on a newer club tournament with no card in it.
    const reach = [own("medal"), watched("foursomes")];
    expect(landingEvent(reach, ev("foursomes", "medal"))?.eventId).toBe("medal");
  });

  it("is the newest of their own when nothing separates them", () => {
    const reach = [own("spring"), own("autumn"), watched("club-cup")];
    expect(landingEvent(reach, ev("club-cup", "autumn", "spring"))?.eventId).toBe("autumn");
  });

  it("is the one being PLAYED NOW, not a league set up last night for next month", () => {
    // The club's ask: a player in several tournaments lands on the one they are playing.
    const reach = [own("medal"), own("league")];
    expect(landingEvent(reach, ev("league", ["medal", "live"]))?.eventId).toBe("medal");
  });

  it("puts a finished tournament behind one still to be played", () => {
    const reach = [own("done"), own("next")];
    expect(landingEvent(reach, ev(["done", "completed"], "next"))?.eventId).toBe("next");
  });

  it("still prefers the player's own over a live one they are only watching", () => {
    const reach = [own("mine"), watched("club-live")];
    expect(landingEvent(reach, ev(["club-live", "live"], "mine"))?.eventId).toBe("mine");
  });

  it("counts a tournament they run through the club as their own", () => {
    const reach = [runs("new"), own("old")];
    expect(landingEvent(reach, ev("new", "old"))?.eventId).toBe("new");
  });

  it("falls back to watched ones, live first, when they are in nothing", () => {
    const reach = [watched("a"), watched("b")];
    expect(landingEvent(reach, ev("b", ["a", "live"]))?.eventId).toBe("a");
    expect(landingEvent(reach, ev("b", "a"))?.eventId).toBe("b");
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
