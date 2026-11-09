import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({ setConfigUnlocked: async () => undefined, openCorrection: async () => ({ ok: true }), endCorrection: async () => ({ ok: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { ScopeLockBanner, ScopeLockMark, SCOPE_LOCK_BANNER_ID } = await import("@/components/ScopeLockBanner");
const { locksFor, scopeLockOf } = await import("@/lib/domain/tournament-status");
const { facts, launched, completed, FAMILY_FIXTURES } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");

/**
 * THE ONE BANNER FOR A LOCKED SCOPE (state machine PR 5a, 5b; UI/UX 8.3 Q3): the
 * machine's reason, its way out, at most three lines, nothing when nothing is
 * locked — and the committee correction for the Organizer on a correctable lock
 * (by launch or by the draw), in place of the blanket Unlock (TD Q2). Drawn from
 * the machine's own locks, so the words here are the words the action refuses with.
 */

const sides = (f: Parameters<typeof locksFor>[0]) => scopeLockOf(locksFor(f), "sides")!;
const draw = (props: Omit<Parameters<typeof ScopeLockBanner>[0], "isAdmin"> & { isAdmin: boolean }) => renderToStaticMarkup(<ScopeLockBanner {...props} />);

describe("ScopeLockBanner", () => {
  it("draws nothing when nothing is locked — never a banner on an open screen", () => {
    expect(draw({ locks: [], isAdmin: true })).toBe("");
  });

  it("names the scope and the machine's reason; the Organizer gets Make a committee correction in place", () => {
    const html = draw({ locks: [sides(launched(facts()))], isAdmin: true });
    expect(html).toContain("<b>Sides</b> · Locked because the tournament is live.");
    expect(html).toMatch(/Make a committee correction/);
    expect(html).not.toMatch(/Unlock/);
    expect(html).toContain(`id="${SCOPE_LOCK_BANNER_ID}"`);
    expect(html).toContain('tabindex="-1"');
  });

  it("an assistant is told who can make the correction, and is offered no button that would refuse them", () => {
    const html = draw({ locks: [sides(launched(facts()))], isAdmin: false });
    expect(html).toContain("Only the Organizer can make a committee correction.");
    expect(html).not.toMatch(/<button[^>]*>[^<]*(<[^>]+>)*[^<]*Make a committee correction/);
  });

  it("a completed tournament's way out is Reopen, as a link for the Organizer — no correction (TD Q2: Reopen is the remedy)", () => {
    const html = draw({ locks: [sides(completed(facts()))], isAdmin: true });
    expect(html).toContain("Locked because the tournament is completed.");
    expect(html).toMatch(/<a [^>]*href="\/dashboard"[^>]*>Reopen it on the dashboard<\/a>/);
    expect(html).not.toMatch(/Make a committee correction/);
    // …and an assistant is told it is the Organizer's.
    expect(draw({ locks: [sides(completed(facts()))], isAdmin: false })).toContain("Only the Organizer can reopen it on the dashboard.");
  });

  it("a lock by results keeps its own way out as a link, for anybody on the staff, and offers no correction", () => {
    const fk = launched(FAMILY_FIXTURES.flightedKnockout());
    const lock = scopeLockOf(locksFor({ ...fk, rounds: fk.rounds.map((r) => ({ ...r, hasResult: true })) }), "draw")!;
    const html = draw({ locks: [lock], isAdmin: false });
    expect(html).toMatch(/<a [^>]*href="\/bracket"[^>]*>Clear the results on the Bracket<\/a>/);
    expect(html).not.toMatch(/Make a committee correction|Only the Organizer/);
  });

  it("one line per scope, at most three", () => {
    const locks = locksFor(launched(facts()));
    const four = (["details", "rounds", "field", "sides"] as const).map((s) => scopeLockOf(locks, s)!);
    const html = draw({ locks: four, isAdmin: true });
    expect(html.match(/Locked because the tournament is live\./g)?.length).toBe(3);
  });

  it("an open correction is said where the scope was opened, with Done for the Organizer — even with nothing else locked", () => {
    const correction = { scope: "sides" as const, by: "A. Organizer", reason: "Wrong pair in side 3", until: "2026-11-08T05:00:00.000Z" };
    const html = draw({ locks: [], correction, isAdmin: true });
    expect(html).toContain("<b>Sides</b> · Open for a correction by A. Organizer: ‘Wrong pair in side 3’");
    expect(html, "named Locked while it says the scope is open").toContain('aria-label="Open for a correction"');
    expect(html).toMatch(/Done/);
    // With a lock line beside it, the banner is a lock banner again.
    const withLock = draw({ locks: [scopeLockOf(locksFor(launched(facts())), "details")!], correction, isAdmin: true });
    expect(withLock).toContain('aria-label="Locked"');
    expect(draw({ locks: [], correction, isAdmin: false })).not.toMatch(/Done/);
  });

  it("Entries under way: says what the day still allows, in the field rule's words, with no lock line", () => {
    const html = draw({ locks: [], open: ["Withdraw and Put back stay open.", "Late entries close at 10:40 AM."], isAdmin: false });
    expect(html).toContain('aria-label="Under way"');
    expect(html).toContain("Late entries close at 10:40 AM.");
    expect(html).not.toContain("Setup locked");
  });
});

describe("ScopeLockMark", () => {
  it("is a padlock named for where the reason is", () => {
    const html = renderToStaticMarkup(<ScopeLockMark />);
    expect(html).toContain('aria-label="Locked — see above"');
    expect(html).toMatch(/^<button type="button"/);
  });
});
