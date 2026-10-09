import { describe, it, expect } from "vitest";
import { potsOfGroup } from "@/lib/domain/skins-pot";
import { readSource } from "./source";

/**
 * A GROUP'S POTS ARE THE ONES STORED, NOT THE ONE EXPECTED (2026-10-09, grid
 * cell T69).
 *
 * A skins pot is keyed on (round, net, scope, group). Group games asked every
 * fourball for its NET, FULL-ROUND pot and nothing else, so a pot set to the
 * front nine — one press of the Holes picker on that same card — was saved as
 * a second row the settle-up counts and this screen never showed: Ann's Money
 * read +$15.00 while the organizer's Group games said "In the pot — 0 players,
 * nobody yet" for her group. Prizes was fixed for the field's pots the same
 * way; this is the group half.
 */
const rows = [
  { groupKey: "Group 1", net: true, scope: "front" },
  { groupKey: "Group 1", net: false, scope: "full" },
  { groupKey: "Group 2", net: true, scope: "full" },
  { groupKey: "Saturday crew", net: true, scope: "back" },
];

describe("the pots a group has", () => {
  it("are every stored pot for that group, whatever its scoring and holes", () => {
    expect(potsOfGroup(rows, "Group 1", true)).toEqual([
      { net: true, scope: "front" },
      { net: false, scope: "full" },
    ]);
  });

  it("include an ad-hoc bet's nine rather than assuming eighteen", () => {
    expect(potsOfGroup(rows, "Saturday crew", false)).toEqual([{ net: true, scope: "back" }]);
  });

  it("offer the net full-round game to a group with none yet — and only then", () => {
    expect(potsOfGroup(rows, "Group 3", true)).toEqual([{ net: true, scope: "full" }]);
    expect(potsOfGroup(rows, "Group 3", false)).toEqual([]);
  });
});

describe("Group games", () => {
  it("reads each group's pots off the stored rows, not one fixed pair", () => {
    const src = readSource("src/app/(app)/group-games/page.tsx");
    expect(src).toMatch(/potsOfGroup\(groupPotRows, g\.name, true\)/);
    expect(src).toMatch(/potsOfGroup\(groupPotRows, name, false\)/);
    // The old shape: the group's name handed to a hard-coded net full pot.
    expect(src).not.toMatch(/skinsPotFor\([^)]*true, "full", (g\.name|r\.groupKey)\)/);
  });
});
