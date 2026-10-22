import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { readSource } from "./source";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

// Server actions stand in as no-ops, as in render.test.tsx.
function actionModule() {
  return new Proxy({}, { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) }) as Record<string, unknown>;
}
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/courses", actionModule);
vi.mock("@/app/actions/player-index", actionModule);
vi.mock("@/app/actions/contests", actionModule);
vi.mock("@/app/actions/side-games", actionModule);
vi.mock("@/app/actions/money-setup", actionModule);
vi.mock("@/app/actions/stages", actionModule);
vi.mock("@/app/actions/event", actionModule);

/**
 * WHAT THE TEXT-BOX CRAWL FOUND IN THE APP, held without the crawl (2026-10-21).
 *
 * The first three rounds of `e2e/every-text-box.spec.ts` on GitHub reported eleven findings, the same
 * eleven each time. Ten were the crawl reading a correct screen wrong (`text-box-reading.test.ts`).
 * One was the app's: the home club below. And one more was seen while proving the stake boxes'
 * findings the crawl's: every one was named "Stake", so nothing — a screen reader, or the crawl after
 * a save had moved the row — could tell which game a box was the stake of. Each is the screen as a
 * person meets it, held here so a test that needs no browser fails the day it comes back. The doors
 * a home club comes in by are `a-home-club-reaches-the-entry.audit.test.ts`.
 */
const render = (el: ReactElement) => renderToStaticMarkup(el);

describe("Entries shows the home club its Add form took", () => {
  const event = {
    name: "zz-Captains Day", capacity: 40, status: "registration", regDeadline: "", regOpens: "", today: "2026-06-01",
    registrationOverride: null, inviteMessage: "", organizationName: "zz-Club",
    dates: "", course: "", city: "", registrationOpen: false, registrationApproval: "auto",
    requirePhone: false, phoneLocked: false, registrationToken: "",
  };
  const row = (id: string, name: string, homeClub: string) => ({
    id, name, handicap: 10, handicapType: "18", handicapSource: "manual", seed: 1, email: `${id}@example.invalid`, phone: "", homeClub,
  });

  it("on the row of the player it was typed for, and on no other", async () => {
    const { RegistrationClient } = await import("@/components/RegistrationClient");
    const html = render(
      <RegistrationClient
        confirmed={[row("p1", "zz-Ann Visitor", "zz-Braeside Golf Club"), row("p2", "zz-Rob Member", "")]}
        waitlist={[row("p3", "zz-Cleo Waiting", "zz-Lochend Links")]}
        pendingEntries={[]} locked={false} isAdmin roster={[]} event={event} />,
    );
    // The field and the waiting list are drawn by one table, so both lists show it.
    expect(html).toContain("zz-Braeside Golf Club");
    expect(html).toContain("zz-Lochend Links");
    // Beside the name it belongs to — the same cell.
    expect(html).toMatch(/zz-Ann Visitor(?:(?!<\/td>).)*zz-Braeside Golf Club/s);
    // CONTROL: the player with no home club has no empty line drawn under the name.
    expect(html).not.toMatch(/zz-Rob Member(?:(?!<\/td>).)*class="text-muted"/s);
    // The first import of the screen is a few seconds on a busy machine.
  }, 30_000);

  it("the screen hands the home club to every list it draws", () => {
    const page = readSource("src/app/(app)/registration/page.tsx");
    const asRow = page.slice(page.indexOf("const asRow"), page.indexOf("return (", page.indexOf("const asRow")));
    expect(asRow).toContain("homeClub: p.homeClub");
  });
});

describe("every side game's stake box says which game it is the stake of", () => {
  it("named for its game, not six boxes called 'Stake'", async () => {
    const { ContestsClient } = await import("@/components/ContestsClient");
    const html = render(
      <ContestsClient roundLabel="Round 1" stageId="s1" headToHead
        field={[{ id: "p1", name: "zz-Ann Reyes", playing: true }, { id: "p2", name: "zz-Bo Kite", playing: true }]}
        contests={[]} sideGames={[]} />,
    );
    const names = [...html.matchAll(/<input[^>]*aria-label="(Stake for [^"]+)"/g)].map((m) => m[1]);
    for (const game of ["Low gross", "Low net", "Birdie pot", "Eagle pot", "The match"]) expect(names, game).toContain(`Stake for ${game}`);
    expect(new Set(names).size, "two stake boxes share a name").toBe(names.length);
    // CONTROL: there is no stake box left with no name of its own.
    const boxes = (html.match(/<input[^>]*placeholder="0.00"/g) ?? []).length;
    expect(boxes).toBeGreaterThanOrEqual(5);
    expect(names.length).toBe(boxes);
  }, 30_000);
});
