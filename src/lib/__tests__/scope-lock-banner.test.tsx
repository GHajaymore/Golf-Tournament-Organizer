import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/tournament", () => ({ setConfigUnlocked: async () => undefined }));

const { ScopeLockBanner, ScopeLockMark, SCOPE_LOCK_BANNER_ID } = await import("@/components/ScopeLockBanner");
const { locksFor, scopeLockOf } = await import("@/lib/domain/tournament-status");
const { facts, launched, completed } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");

/**
 * THE ONE BANNER FOR A LOCKED SCOPE (state machine PR 5a; UI/UX 8.3 Q3): the
 * machine's reason, its way out, at most three lines, nothing when nothing is
 * locked — and today's Unlock for the Organizer on a lock by launch only, until
 * PR 5b's committee correction replaces it. Drawn from the machine's own locks,
 * so the words here are the words the action refuses with.
 */

const sides = (f: Parameters<typeof locksFor>[0]) => scopeLockOf(locksFor(f), "sides")!;
const draw = (locks: Parameters<typeof ScopeLockBanner>[0]["locks"], isAdmin: boolean) =>
  renderToStaticMarkup(<ScopeLockBanner locks={locks} isAdmin={isAdmin} />);

describe("ScopeLockBanner", () => {
  it("draws nothing when nothing is locked — never a banner on an open screen", () => {
    expect(draw([], true)).toBe("");
  });

  it("names the scope and the machine's reason; the Organizer gets Unlock setup in place", () => {
    const html = draw([sides(launched(facts()))], true);
    expect(html).toContain("<b>Sides</b> · Locked because the tournament is live.");
    expect(html).toMatch(/Unlock setup/);
    expect(html).toContain(`id="${SCOPE_LOCK_BANNER_ID}"`);
    expect(html).toContain('tabindex="-1"');
  });

  it("an assistant is told who can unlock it, and is offered no button that would refuse them", () => {
    const html = draw([sides(launched(facts()))], false);
    expect(html).toContain("Only the Organizer can unlock it.");
    expect(html).not.toMatch(/Unlock setup/);
  });

  it("a completed tournament's way out is Reopen, as a link — no Unlock (TD Q2: Reopen is the remedy)", () => {
    const html = draw([sides(completed(facts()))], true);
    expect(html).toContain("Locked because the tournament is completed.");
    expect(html).toMatch(/<a [^>]*href="\/dashboard"[^>]*>Reopen it on the dashboard<\/a>/);
    expect(html).not.toMatch(/Unlock setup/);
  });

  it("one line per scope, at most three", () => {
    const locks = locksFor(launched(facts()));
    const four = (["details", "rounds", "field", "sides"] as const).map((s) => scopeLockOf(locks, s)!);
    const html = draw(four, true);
    expect(html.match(/Locked because the tournament is live\./g)?.length).toBe(3);
  });
});

describe("ScopeLockMark", () => {
  it("is a padlock named for where the reason is", () => {
    const html = renderToStaticMarkup(<ScopeLockMark />);
    expect(html).toContain('aria-label="Locked — see above"');
    expect(html).toMatch(/^<button type="button"/);
  });
});
