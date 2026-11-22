import { describe, it, expect } from "vitest";
import { committeeKeepsEveryCard, keepingShown, playerEntryRefusal, roundScoring } from "../round-scoring";

/**
 * `keepingShown`: who keeps the card, as a screen says it (R4b-1). The event's "Can players enter
 * scores?" decides first; otherwise the round's own answer. Worked by hand from the two settings.
 */
describe("keepingShown", () => {
  const stage = (scoreKeeping: string | null) => ({ scoreKeeping, endCheck: "on" });
  const staff = { scoreEntryBy: "staff" };
  const players = { scoreEntryBy: "players" };

  it("is the organizer on every round when players may not enter, whatever the round stored", () => {
    for (const k of ["group", "each", "organizer"]) expect(keepingShown(staff, stage(k))).toBe("organizer");
  });

  it("is the round's own answer when players may enter", () => {
    expect(keepingShown(players, stage("group"))).toBe("group");
    expect(keepingShown(players, stage("each"))).toBe("each");
    expect(keepingShown(players, stage("organizer"))).toBe("organizer");
  });

  it("reads an unknown stored value as the column's default, as the gate does", () => {
    const dflt = roundScoring(stage(null)).scoreKeeping;
    expect(keepingShown(players, stage(null))).toBe(dflt);
    expect(keepingShown(players, stage("zz-unknown"))).toBe(dflt);
  });

  it("agrees with the gate: shown 'organizer' exactly when a player is refused", () => {
    for (const entry of ["staff", "players", "zz-unknown"]) {
      for (const k of ["group", "each", "organizer"]) {
        const s = { scoreEntryBy: entry };
        expect(keepingShown(s, stage(k)) === "organizer").toBe(playerEntryRefusal(s, stage(k)) !== null);
      }
    }
  });

  it("committeeKeepsEveryCard is true for anything but 'players'", () => {
    expect(committeeKeepsEveryCard({ scoreEntryBy: "players" })).toBe(false);
    expect(committeeKeepsEveryCard({ scoreEntryBy: "staff" })).toBe(true);
    expect(committeeKeepsEveryCard({ scoreEntryBy: String(null) })).toBe(true);
  });
});
