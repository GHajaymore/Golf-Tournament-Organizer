import { describe, it, expect } from "vitest";
import { dueBeforePlayed } from "@/lib/domain/round-dates";
import { readSource } from "./source";

/**
 * A ROUND IS NOT DUE BEFORE IT IS PLAYED (2026-10-30).
 *
 * Ajay's Round 2, played Fri 6 Nov, read "Due Fri, Oct 23" on Rounds &
 * formats. The action saved any deadline with no look at the round's day.
 */
describe("dueBeforePlayed", () => {
  it("is true only for a real deadline earlier than a real round day", () => {
    expect(dueBeforePlayed("2026-10-23", "2026-11-06")).toBe(true);
    expect(dueBeforePlayed("2026-11-05", "2026-11-06")).toBe(true);
  });

  it("the round's own day and later are fine, across a month and a year", () => {
    expect(dueBeforePlayed("2026-11-06", "2026-11-06")).toBe(false);
    expect(dueBeforePlayed("2026-12-01", "2026-11-30")).toBe(false);
    expect(dueBeforePlayed("2027-01-02", "2026-12-31")).toBe(false);
  });

  it("an undated round, no deadline, or an older free-text deadline is not judged", () => {
    expect(dueBeforePlayed("2026-10-23", "")).toBe(false);
    expect(dueBeforePlayed("", "2026-11-06")).toBe(false);
    expect(dueBeforePlayed("Sat 14 Jun", "2026-11-06")).toBe(false);
  });
});

describe("the rule is asked where a deadline is saved and where it is shown", () => {
  it("setStageDeadline refuses it before writing, and the round screen says it beside the box", () => {
    const action = readSource("src/app/actions/tournament.ts");
    const body = action.slice(action.indexOf("export async function setStageDeadline("), action.indexOf("export async function setTournamentDates("));
    expect(body.indexOf("dueBeforePlayed(")).toBeGreaterThan(-1);
    expect(body.indexOf("dueBeforePlayed(")).toBeLessThan(body.indexOf("prisma.stage.updateMany("));
    expect(readSource("src/components/StagesClient.tsx")).toMatch(/dueBeforePlayed\(deadline, playedOn\)/);
  });
});
