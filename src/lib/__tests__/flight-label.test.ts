import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { flightLabel } from "@/lib/domain/flight-label";
import { readSource } from "./source";

/**
 * A FLIGHT IS CALLED WHAT THE CLUB CALLED IT (2026-10-08).
 *
 * Walked as the tournament grid's first cell: two flights the organizer named
 * "A" and "B" read "A" on the Flights screen and "Flight 1" / "Flight 2" on
 * the leaderboard, the public board, the player's board, the dashboard,
 * Registration and Score entry, while messaging said "Flight A". A club that
 * renamed its flights "Seniors" and "Ladies" saw neither word anywhere a
 * member looks.
 */
describe("flightLabel", () => {
  it("uses the club's own name as typed", () => {
    expect(flightLabel("Seniors", 1)).toBe("Seniors");
    expect(flightLabel("Championship Flight", 0)).toBe("Championship Flight");
    expect(flightLabel("  Ladies  ", 2)).toBe("Ladies");
  });

  it("calls a bare letter or number a flight", () => {
    expect(flightLabel("A", 0)).toBe("Flight A");
    expect(flightLabel("B", 0)).toBe("Flight B");
    expect(flightLabel("2", 0)).toBe("Flight 2");
    expect(flightLabel("AB", 27)).toBe("Flight AB");
  });

  it("falls back to the position only when nothing is set", () => {
    expect(flightLabel("", 0)).toBe("Flight 1");
    expect(flightLabel(null, 2)).toBe("Flight 3");
    expect(flightLabel("   ", 1)).toBe("Flight 2");
  });

  it("never reads the position when there is a name — the control", () => {
    // A label that ignored the name would pass the fallback case above.
    expect(flightLabel("B", 0)).not.toBe("Flight 1");
    expect(flightLabel("Seniors", 0)).not.toBe("Flight 1");
  });
});

/** Every screen and service under src, found rather than named. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") sources(full, found);
    } else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe("a flight's prize", () => {
  it("is named as the boards name the flight, so the picker can find it", () => {
    // "A — Winner" from the bare stored name; the Prizes picker matches a
    // prize to its flight by the label, and members read "Flight A".
    const src = readSource("src/app/actions/tournament.ts");
    const at = src.indexOf("export async function applyPrizeStructure");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 1500)).toMatch(/prizeStructureLines\(key, \{ flights: flights\.map\(\(f, i\) => flightLabel\(f\.name, i\)\) \}\)/);
  });
});

describe("no screen names a flight by its position on its own", () => {
  /**
   * The defect was seven readers each writing `Flight ${i + 1}`. The rule is
   * `flightLabel`, and a screen that spells "Flight" + a number again is the
   * same defect back.
   *
   * Exempt: `flight-label.ts` itself, and `regroup.ts`, which STORES a name for
   * a flight created without one — data, not a label, and read back through
   * `flightLabel` like any other.
   */
  const FILES = sources(join(process.cwd(), "src")).map((f) =>
    f.slice(process.cwd().length + 1).split("\\").join("/"),
  );
  const EXEMPT = ["src/lib/domain/flight-label.ts", "src/lib/services/regroup.ts"];
  const POSITIONAL = /`Flight \$\{|>\s*Flight \{|"Flight " \+/;

  it("finds the rule's own spelling — the control", () => {
    expect(FILES).toContain("src/lib/domain/flight-label.ts");
    expect(POSITIONAL.test(readSource("src/lib/domain/flight-label.ts"))).toBe(true);
  });

  it("finds it nowhere else", () => {
    const offenders = FILES.filter((f) => !EXEMPT.includes(f) && POSITIONAL.test(readSource(f)));
    expect(offenders, `a flight labelled by position in: ${offenders.join(", ")}`).toEqual([]);
  });
});
