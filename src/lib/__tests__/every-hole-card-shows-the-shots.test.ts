import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";

/**
 * EVERY HOLE-BY-HOLE CARD SAYS WHERE EACH PLAYER'S SHOTS FALL (2026-10-04).
 *
 * Walked at 393px: the host's card showed the partner two shots on the 1st
 * (••), and the partner's own card — joined by its Round Code — showed none,
 * though its net total was computed off exactly those shots. `HoleByHoleCard`
 * draws the dots from `shotsOn`, and a caller that leaves it out does not
 * break: it just stops telling a player where they get a stroke, on a net
 * round, which is the one thing a net card is for. The group card had the same
 * gap for every partner but the holder.
 *
 * Swept from the filesystem, so a new caller is held to it the day it lands.
 */
const ROOT = join(process.cwd(), "src");
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : filesUnder(full);
    return /\.tsx$/.test(name) ? [full] : [];
  });
}

describe("a hole-by-hole card is handed each player's shots", () => {
  const callers = filesUnder(ROOT)
    .map((f) => relative(process.cwd(), f).split("\\").join("/"))
    .filter((f) => !f.endsWith("HoleByHoleCard.tsx") && readSource(f).includes("<HoleByHoleCard"));

  it("finds the callers (the control — an empty sweep proves nothing)", () => {
    expect(callers).toContain("src/components/PlayClient.tsx");
    expect(callers.length).toBeGreaterThanOrEqual(5);
  });

  for (const f of ["PlayClient", "GroupScoring", "PlayerCard", "StrokePlayEntry", "ScoreEntryClient"]) {
    it(`${f} passes shotsOn`, () => {
      expect(readSource("src", "components", `${f}.tsx`)).toContain("shotsOn:");
    });
  }

  it("every caller found passes shotsOn", () => {
    expect(callers.filter((f) => !readSource(f).includes("shotsOn"))).toEqual([]);
  });

  it("the round-code card uses the shots its totals already use, and the group card each partner's own", () => {
    expect(readSource("src", "components", "PlayClient.tsx")).toContain("shotsOn: (h: number) => props.shots?.[h] ?? 0");
    expect(readSource("src", "components", "GroupScoring.tsx")).toContain("shotsOn: (h: number) => p.shots?.[h] ?? 0");
    expect(readSource("src", "app", "(player)", "me", "card", "page.tsx")).toContain(
      "partners.map((p) => ({ ...p, shots: shotsFor(p.id) }))",
    );
  });
});
