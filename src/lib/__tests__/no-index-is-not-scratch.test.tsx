import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RosterClient } from "@/components/RosterClient";
import { OrgProfileProvider } from "@/components/OrgProfileProvider";

/**
 * The router and the actions, stood down — the same two stand-ins
 * `render.test.tsx` uses and for the same reasons. A client component reaching
 * for `useRouter` outside a Next tree throws "invariant expected app router to
 * be mounted", and a `"use server"` import would drag Prisma into a render
 * test. Neither has anything to do with what is being measured here.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/roster",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

function actionModule() {
  return new Proxy(
    {},
    {
      // `then` must stay undefined, or `await import(...)` waits on a thenable
      // for ever — the note render.test.tsx leaves for the next person.
      get: (_t, key) =>
        typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined,
    },
  ) as Record<string, unknown>;
}
vi.mock("@/app/actions/roster", actionModule);
vi.mock("@/app/actions/organization", actionModule);
vi.mock("@/app/actions/event", actionModule);

/**
 * "NOBODY HAS CLAIMED AN INDEX" MUST NOT READ AS "PLAYS OFF SCRATCH".
 *
 * `handicap-policy.ts` opens by naming the outcome it exists to prevent, and
 * it is worth quoting because it is the whole reason this file exists:
 *
 *   "Zero. Catastrophic. A 24-handicapper playing off scratch does not look
 *    like an outage; it looks like a competition, and it is settled and paid
 *    out before anybody works out why the results are absurd."
 *
 * The roster printed the stored number. Under an association policy
 * `upsertMember` deliberately does NOT record a typed index — it writes
 * `handicapSource: "none"` and leaves the figure at 0, because "a member
 * without a GHIN number is an unfinished roster row rather than a player at
 * zero" — so the club's own list showed those members as a flat **0**,
 * indistinguishable from a scratch golfer.
 *
 * Measured against the database on 2026-09-18 before any of this was changed:
 * a GHIN club that has never synced has its members at 0, they are entered at
 * 0, and `handicapsForRound` hands that 0 to the scoring engine.
 */

const member = (over: Record<string, unknown> = {}) => ({
  id: "m1",
  name: "Síobhán O’Donnell",
  email: "s@example.invalid",
  phone: "",
  ghin: "1234567",
  homeClub: "",
  gender: "",
  preferredTee: "",
  handicap: 0,
  handicapType: "18",
  handicapSource: "none",
  status: "active",
  entryCount: 0,
  lastEvent: "",
  entered: false,
  entryStatus: "none",
  ...over,
});

const screen = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    <OrgProfileProvider kind="club">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RosterClient clubName="Heathland" eventName="" fieldLocked={false} fieldSize={0} unlinkedCount={0} {...(props as any)} />
    </OrgProfileProvider>,
  )
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<[^>]+>/g, " ");

describe("a member nobody has an index for", () => {
  it("says so instead of printing a number", () => {
    const body = screen({ members: [member()] });
    expect(body).toMatch(/no index yet/);
  });

  it("still shows a real index for everybody else", () => {
    const body = screen({ members: [member({ handicap: 12.4, handicapSource: "ghin" })] });
    expect(body).toMatch(/12\.4/);
    expect(body).not.toMatch(/no index yet/);
  });

  it("shows a genuine scratch player as scratch", () => {
    /**
     * The other direction, and the one a careless fix breaks: somebody whose
     * club HAS recorded them at 0 is a scratch golfer, and hiding their figure
     * would be a different lie.
     */
    const body = screen({ members: [member({ handicap: 0, handicapSource: "manual" })] });
    expect(body).not.toMatch(/no index yet/);
  });
});

describe("a club that cannot read indexes at all", () => {
  it("says why the column is empty", () => {
    const body = screen({
      members: [member()],
      handicapPolicy: "ghin",
      indexesReadable: false,
    });
    expect(body).toMatch(/No indexes have been fetched yet/);
    // And says what to do, because a warning nobody can act on is noise.
    expect(body).toMatch(/handicap connection|own handicaps/);
  });

  it("says nothing to a club keeping its own handicaps", () => {
    // Nothing to fetch, so nothing is wrong. A warning here would be a screen
    // complaining about a service the club has deliberately not used.
    const body = screen({
      members: [member({ handicap: 8.2, handicapSource: "manual" })],
      handicapPolicy: "club",
      indexesReadable: true,
    });
    expect(body).not.toMatch(/No indexes have been fetched/);
  });

  it("says nothing when the association is working", () => {
    const body = screen({
      members: [member({ handicap: 12.4, handicapSource: "ghin" })],
      handicapPolicy: "ghin",
      indexesReadable: true,
    });
    expect(body).not.toMatch(/No indexes have been fetched/);
  });
});
