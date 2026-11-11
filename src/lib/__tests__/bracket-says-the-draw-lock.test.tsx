import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("@/app/actions/tournament", () => ({ setConfigUnlocked: async () => undefined, openCorrection: async () => ({ ok: true }), endCorrection: async () => ({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { ScopeLockBanner } = await import("@/components/ScopeLockBanner");
const { locksFor, scopeLockOf } = await import("@/lib/domain/tournament-status");
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

  it("the Bracket page reads the machine's draw lock and draws the one banner, and does not work the lock out itself", () => {
    const src = readSource("src/app/(app)/bracket/page.tsx");
    expect(src).toMatch(/scopeLockFor\(session\.eventId, "draw"\)/);
    expect(src).toMatch(/<ScopeLockBanner locks=\{drawLock \? \[drawLock\] : \[\]\}/);
  });
});
