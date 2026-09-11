import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { announcementsFor } from "@/lib/services/announcements";
import { readSource } from "./source";

/**
 * THE ORGANIZER'S BROADCAST CHANNEL REACHED NOBODY.
 *
 * `/announcements` says, twice: "Pinned posts sit at the top of every player's
 * dashboard", and "Posts appear on every player's dashboard."
 *
 * Players do not go to the dashboard. `landingScreenFor("player")` returns
 * `/me`; the player tab bar offers Today, Board, My card, Rules and Money; and
 * nothing under `(player)` mentioned an announcement at all. The query and the
 * markup lived inline on `/dashboard` and only there.
 *
 * So "frost delay, tee times back an hour" — posted from the one screen built
 * for reaching the field — reached nobody. A player could open `/dashboard` by
 * typing it, and had no reason to know it existed.
 *
 * Walked on 2026-09-11, and confirmed after the fix: the player's own screen
 * now leads with "Pinned / Frost delay / Tee times back one hour."
 *
 * THE PREVIOUS INSTANCE OF THIS BUG IS COMMENTED ONE LINE ABOVE THE QUERY THAT
 * HAD IT NEXT. The dashboard says of the availability card: "It used to be
 * built inline here — and only here, which is why the one screen players
 * actually land on never showed it." Announcements were the next statement
 * down. That is why this is a service and a component rather than a second
 * copy of a block.
 */

const MARK = "zz-announce";
const made: { orgs: string[]; events: string[] } = { orgs: [], events: [] };

async function makeEvent(name: string) {
  const user = await prisma.user.create({
    data: { email: `${MARK}-${Math.random().toString(36).slice(2, 8)}@example.invalid`, name: `${MARK} Owner` },
  });
  const org = await prisma.organization.create({
    data: { name: `${MARK} Club`, kind: "club", members: { create: { userId: user.id, role: "owner" } } },
  });
  made.orgs.push(org.id);
  const ev = await prisma.event.create({
    data: {
      name,
      organizationId: org.id,
      dates: "2026-07-01",
      course: `${MARK} course`,
      city: "Nowhere",
      address: "1 Nowhere Lane",
      regDeadline: "2026-06-01",
      shareToken: `${MARK}-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  made.events.push(ev.id);
  return ev;
}

afterAll(async () => {
  // By the mark, per audit-guards: no row may depend on another to be found.
  const marked = await prisma.organization.findMany({
    where: { name: { startsWith: MARK } },
    select: { id: true },
  });
  const ids = [...new Set([...marked.map((o) => o.id), ...made.orgs])];
  await prisma.announcement.deleteMany({ where: { eventId: { in: made.events } } });
  await prisma.event.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.event.deleteMany({ where: { id: { in: made.events } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
});

describe("what the notices service returns", () => {
  it("puts pinned first, then newest, which is what makes pinning mean anything", async () => {
    /**
     * THE PINNED ONE IS THE OLDEST, on purpose.
     *
     * Written the obvious way first — pinned created last — where it is also
     * the newest, so dropping the `pinned` sort entirely left this GREEN and
     * the test proved nothing about pinning. Caught by mutating.
     *
     * Created oldest-first so the two orderings genuinely disagree: by date
     * alone this comes back "new, old, pinned"; by the real rule it comes back
     * "pinned, new, old".
     */
    /**
     * TIMESTAMPS SET EXPLICITLY, because insertion order is not a clock.
     *
     * Written relying on three creates in sequence, which passed alone and
     * FAILED in the full run: the rows land inside the same millisecond, the
     * `createdAt` values tie, and the order between them is then undefined.
     * A test that depends on how busy the machine is proves nothing on the
     * run that matters.
     */
    const ev = await makeEvent(`${MARK} Order`);
    const at = (iso: string) => new Date(iso);
    await prisma.announcement.create({
      data: { eventId: ev.id, title: "pinned notice", body: "", pinned: true, createdAt: at("2026-07-01T09:00:00Z") },
    });
    await prisma.announcement.create({
      data: { eventId: ev.id, title: "old notice", body: "", pinned: false, createdAt: at("2026-07-01T10:00:00Z") },
    });
    await prisma.announcement.create({
      data: { eventId: ev.id, title: "new notice", body: "", pinned: false, createdAt: at("2026-07-01T11:00:00Z") },
    });

    const got = await announcementsFor(ev.id);

    expect(got[0].title).toBe("pinned notice");
    // And the unpinned pair in newest-first order behind it.
    expect(got.slice(1).map((a) => a.title)).toEqual(["new notice", "old notice"]);
  });

  it("stays inside its own tournament", async () => {
    const mine = await makeEvent(`${MARK} Mine`);
    const theirs = await makeEvent(`${MARK} Theirs`);
    await prisma.announcement.create({ data: { eventId: theirs.id, title: "not yours", body: "", pinned: true } });

    expect(await announcementsFor(mine.id)).toEqual([]);
  });

  it("answers for a session with no tournament", async () => {
    /**
     * `session.eventId` is "" for somebody who has signed up and has no event
     * — `getSession` returns exactly that.
     *
     * WHAT THIS DOES NOT PROVE, stated because the first version of it claimed
     * otherwise. The early return is a saved round-trip, not a safety guard:
     * without it the query is still `where: { eventId: "" }`, which matches no
     * row, so both paths return []. Deleting the guard leaves this test green
     * and should — there is no behaviour to catch, only a query that need not
     * be made. Asserting the empty result is still worth it; claiming it stops
     * a leak would have been a lie in a comment.
     */
    expect(await announcementsFor("")).toEqual([]);
  });

  it("caps what it returns, because a phone screen is not a noticeboard", async () => {
    const ev = await makeEvent(`${MARK} Many`);
    for (let i = 0; i < 5; i += 1) {
      await prisma.announcement.create({ data: { eventId: ev.id, title: `notice ${i}`, body: "", pinned: false } });
    }
    expect((await announcementsFor(ev.id)).length).toBe(3);
  });
});

/**
 * And both screens have to READ it.
 *
 * The service tests above cannot see a page that never calls it, which is
 * precisely the shape the bug had — the query existed and exactly one screen
 * ran it.
 */
describe("who shows the notices", () => {
  it("shows them on the screen players actually land on", () => {
    const me = readSource("src", "app", "(player)", "me", "page.tsx");
    expect(me).toMatch(/announcementsFor\(session\.eventId\)/);
    expect(me).toMatch(/<AnnouncementList items=\{announcements\} \/>/);
  });

  it("still shows them to staff on the dashboard", () => {
    // The control. An organizer needs to see what they posted.
    const dash = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    expect(dash).toMatch(/announcementsFor\(session\.eventId\)/);
    expect(dash).toMatch(/<AnnouncementList items=\{announcements\} \/>/);
  });

  it("keeps no second copy of the query", () => {
    /**
     * Absence, which is the safe direction and comment-proof under
     * `readSource`. Two screens each running their own `findMany` is how they
     * come to disagree about the order — and the order is the whole of what
     * "pinned" buys.
     */
    for (const p of [
      ["src", "app", "(player)", "me", "page.tsx"],
      ["src", "app", "(app)", "dashboard", "page.tsx"],
    ] as const) {
      expect(readSource(...p)).not.toMatch(/prisma\.announcement\.findMany/);
    }
  });
});
