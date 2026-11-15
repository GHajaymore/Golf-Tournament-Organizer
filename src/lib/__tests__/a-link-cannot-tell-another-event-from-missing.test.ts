import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A LINK CANNOT TELL "ANOTHER EVENT" FROM "MISSING" (2026-11-14, the #1133
 * security review F-2).
 *
 * A browser holding only a guest's link asked the messaging doors about a
 * thread or scope in ANOTHER event: `messagingContextFor` returned no actor, and
 * the action threw "Not authenticated". An id that does not exist fell back to
 * the link's own event and got null / "You can't post there." One bit, but a
 * bit about whether an id is real, which `readThread` promises not to give.
 * Now both are answered in the link's own context, where neither is visible.
 */

type Viewer = { eventId: string; name: string; role: string; guest: { passId: string; version: number } | null };
const OWN = "zz-own-event";
const OTHER = "zz-other-event";
const linkViewer: Viewer = { eventId: OWN, name: "Zz Guest", role: "player", guest: { passId: "zz-pass", version: 1 } };
const state = vi.hoisted(() => ({ account: null as null | { eventId: string; role: string; name: string; email: string }, viewer: null as unknown }));

vi.mock("@/lib/auth", () => ({ getSession: async () => state.account }));
vi.mock("@/lib/player-viewer", () => ({
  getPlayerViewer: async () => state.viewer,
  // The link speaks for its own event only (PR 1's `linkSpeaksFor`), never beside an account here.
  guestActorFor: async (eventId: string, account: unknown) => {
    const v = state.viewer as Viewer | null;
    return v?.guest && v.eventId === eventId && !account ? v : null;
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    thread: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "zz-thread-other" ? { eventId: OTHER } : null) },
    stage: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === "zz-stage-other" ? { eventId: OTHER } : null) },
    group: { findUnique: async () => null },
    team: { findUnique: async () => null },
    match: { findUnique: async () => null },
    player: { findUnique: async () => null },
  },
}));
vi.mock("@/lib/services/messaging", () => ({
  membershipFor: async (_viewer: unknown, eventId: string) => ({ eventId, organizationId: "zz-org", role: "player" }),
}));

const { messagingContextFor } = await import("@/lib/messaging-viewer");
const eventOfActor = async (target: Parameters<typeof messagingContextFor>[0]) => (await messagingContextFor(target))?.eventId ?? "NO ACTOR";

describe("a browser holding only a guest's link", () => {
  beforeEach(() => {
    state.account = null;
    state.viewer = linkViewer;
  });

  it("gets the same answer for a thread in another event as for one that does not exist", async () => {
    const missing = await eventOfActor({ threadId: "zz-thread-missing" });
    const elsewhere = await eventOfActor({ threadId: "zz-thread-other" });
    expect(missing).toBe(OWN);
    expect(elsewhere, "another event's thread got 'Not authenticated', so the caller learned the id is real").toBe(missing);
  });

  it("and the same for a scope whose object is in another event", async () => {
    const missing = await eventOfActor({ scope: "round:zz-stage-missing" });
    const elsewhere = await eventOfActor({ scope: "round:zz-stage-other" });
    expect(missing).toBe(OWN);
    expect(elsewhere).toBe(missing);
  });

  it("the answer is the link's OWN context, where the other event's target is not visible: never the other event's", async () => {
    const actor = await messagingContextFor({ threadId: "zz-thread-other" });
    expect(actor?.guest?.passId).toBe("zz-pass");
    expect(actor?.ctx).toMatchObject({ eventId: OWN });
  });

  it("CONTROL: nobody at all is still nobody", async () => {
    state.viewer = null;
    expect(await messagingContextFor({ threadId: "zz-thread-other" })).toBeNull();
    expect(await messagingContextFor({ threadId: "zz-thread-missing" })).toBeNull();
  });
});
