import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("@/app/actions/tournament", () => ({ setConfigUnlocked: async () => undefined, openCorrection: async () => ({ ok: true }), endCorrection: async () => ({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { ScopeLockBanner } = await import("@/components/ScopeLockBanner");
const { locksFor, scopeLockOf } = await import("@/lib/domain/tournament-status");
const bracketFlights = await import("@/lib/domain/bracket-flights");
const { launched, FAMILY_FIXTURES } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");

/**
 * THE BRACKET NAMES THE DRAW LOCK (J13 finding 2, UI/UX + UX Writer).
 *
 * The flights panel says "Results are in, so the flights are fixed" beside the
 * control it hides, but that sentence has no way out. A knockout in flights
 * keeps its draw open after launch and shuts it at the first result, so the
 * Bracket draws the draw scope's banner — the machine's own `locks.draw` — with
 * "Clear the results on the Bracket". Open until then: no banner at all.
 */

const fko = () => launched(FAMILY_FIXTURES.flightedKnockout());
const withResult = (f: ReturnType<typeof fko>) => ({
  ...f,
  knockout: f.knockout && { ...f.knockout, draws: f.knockout.draws.map((d, i) => (i === 0 ? { ...d, played: true, decided: true } : d)) },
  rounds: f.rounds.map((r) => ({ ...r, hasResult: true })),
});

describe("the Bracket's draw lock", () => {
  it("is drawn from the machine's answer: nothing while the draw is open, the reason and the way out once results are in", () => {
    const open = scopeLockOf(locksFor(fko()), "draw");
    expect(open).toBeNull();
    expect(renderToStaticMarkup(<ScopeLockBanner locks={open ? [open] : []} isAdmin />)).toBe("");

    const shut = scopeLockOf(locksFor(withResult(fko())), "draw");
    expect(shut, "results in: the draw is locked").not.toBeNull();
    const html = renderToStaticMarkup(<ScopeLockBanner locks={[shut!]} isAdmin />);
    expect(html).toContain("The draw");
    expect(html).toContain("Locked because this knockout has results.");
    expect(html).toContain("Clear the results on the Bracket");
    expect(html).toContain('aria-label="Locked"');
  });

  it("the flights panel's sentence and the banner come from one lock: they cannot disagree (open, results, completed with no results)", () => {
    const { flightsNote } = bracketFlights;
    const lockOf = (f: ReturnType<typeof fko>) => scopeLockOf(locksFor(f), "draw");
    const lockBy = (l: ReturnType<typeof lockOf>) => (l && (l.by === "results" || l.by === "completed") ? l.by : null);
    const done = (f: ReturnType<typeof fko>) => ({ ...f, status: "completed" as const, configUnlocked: false });
    const cases = [
      { name: "open", f: fko(), banner: null, panel: "Each is its own knockout. You can move players, reseed and rename until the first result is recorded." },
      { name: "results", f: withResult(fko()), banner: "Locked because this knockout has results.", panel: "Results are in, so the flights are fixed. Each is its own knockout." },
      { name: "completed, no results", f: done(fko()), banner: "Locked because the tournament is completed.", panel: "This tournament is completed, so the flights are fixed. Each is its own knockout." },
    ];
    for (const c of cases) {
      const l = lockOf(c.f);
      expect(l?.because ?? null, c.name).toBe(c.banner);
      expect(flightsNote(lockBy(l)), c.name).toBe(c.panel);
      expect(lockBy(l) !== null, `${c.name}: fixed iff the banner is drawn`).toBe(l !== null);
    }
  });

  it("the Bracket page reads the machine's draw lock and draws the one banner, and does not work the lock out itself", () => {
    const src = readSource("src/app/(app)/bracket/page.tsx");
    expect(src).toMatch(/scopeLockFor\(session\.eventId, "draw"\)/);
    expect(src).toMatch(/<ScopeLockBanner locks=\{drawLock \? \[drawLock\] : \[\]\}/);
    // The panel is told what the lock says, never `drawFrozen` (a second copy of "has a result").
    expect(src).toMatch(/lockBy=\{drawLock\?\.by/);
    expect(src).not.toMatch(/drawFrozen/);
  });
});
