import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { myPlayerIds } from "@/lib/services/me";

/**
 * WHAT AN EMAIL-LESS FIELD DOES TO THE QUERIES THAT ASSUME ONE.
 *
 * Entries may now be made without an address on a tournament that signs
 * players in by Round Code — see `entryNeedsEmail`. Every `where: { email }`
 * in the app was written when that set was empty, and an empty string is not a
 * value those queries refuse: it is a value they MATCH, on every row that has
 * it.
 *
 * `myPlayerIds` is the one that matters, because it decides which cards,
 * scores and money a signed-in person owns. Asserted against real rows rather
 * than in a unit test, because what is being proved is what POSTGRES does with
 * `equals: ""` — which is exactly the thing a mocked query cannot tell you.
 */

const MARK = "zz-nomail";
const made: { orgs: string[]; events: string[] } = { orgs: [], events: [] };

async function makeEvent(name: string) {
  const user = await prisma.user.create({
    data: { email: `${MARK}-${Math.random().toString(36).slice(2, 8)}@example.invalid`, name: `${MARK} Owner` },
  });
  const org = await prisma.organization.create({
    data: { name: `${MARK} Society`, kind: "community", members: { create: { userId: user.id, role: "owner" } } },
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
      playerAccess: "code",
    },
  });
  made.events.push(ev.id);
  return ev;
}

const enter = (eventId: string, name: string, email: string, seed: number) =>
  prisma.player.create({ data: { eventId, name, email, seed, status: "confirmed" } });

afterAll(async () => {
  // By the mark, per audit-guards: no row may depend on another to be found.
  const marked = await prisma.organization.findMany({
    where: { name: { startsWith: MARK } },
    select: { id: true },
  });
  const ids = [...new Set([...marked.map((o) => o.id), ...made.orgs])];
  await prisma.player.deleteMany({ where: { eventId: { in: made.events } } });
  await prisma.event.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.event.deleteMany({ where: { id: { in: made.events } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
});

describe("resolving a signed-in player against an email-less field", () => {
  it("hands a blank address nobody, rather than everybody", async () => {
    /**
     * THE WHOLE REASON THE GUARD EXISTS, measured.
     *
     * Three entries with no address and one with. Without the guard the blank
     * lookup returns the three — every email-less player in the event — and
     * whoever triggered it owns their cards, their score entry and their
     * money. With it, none.
     *
     * The fourth row is not decoration: it proves the event really does hold
     * players, so an empty result cannot be an empty event.
     */
    const ev = await makeEvent(`${MARK} Blank`);
    await enter(ev.id, `${MARK} No Address One`, "", 1);
    await enter(ev.id, `${MARK} No Address Two`, "", 2);
    await enter(ev.id, `${MARK} No Address Three`, "", 3);
    await enter(ev.id, `${MARK} Has Address`, `${MARK}-has@example.invalid`, 4);

    expect(await prisma.player.count({ where: { eventId: ev.id } })).toBe(4);
    expect([...(await myPlayerIds(ev.id, ""))]).toEqual([]);
    // Whitespace is the same question asked less obviously — a cookie or a
    // roster cell carrying " " must not resolve to the same three players.
    expect([...(await myPlayerIds(ev.id, "   "))]).toEqual([]);
  });

  it("still resolves the player who does have one", async () => {
    /**
     * The control, and it has to be here: a `myPlayerIds` that returned an
     * empty set for EVERYTHING would satisfy the test above perfectly, and
     * would sign every player in this product out of their own card.
     */
    const ev = await makeEvent(`${MARK} Mixed`);
    await enter(ev.id, `${MARK} Ghost`, "", 1);
    const mine = await enter(ev.id, `${MARK} Real`, `${MARK}-real@example.invalid`, 2);

    const ids = await myPlayerIds(ev.id, `${MARK}-real@example.invalid`);
    expect([...ids]).toEqual([mine.id]);
  });

  it("does not let one tournament's blank entries leak into another's", async () => {
    // `equals: ""` is unconstrained on its own; the eventId is what stops it
    // reaching across tournaments. Worth pinning while the blank set is no
    // longer empty.
    const mine = await makeEvent(`${MARK} Mine`);
    const theirs = await makeEvent(`${MARK} Theirs`);
    await enter(theirs.id, `${MARK} Theirs One`, "", 1);

    expect([...(await myPlayerIds(mine.id, ""))]).toEqual([]);
    expect([...(await myPlayerIds(mine.id, `${MARK}-nobody@example.invalid`))]).toEqual([]);
  });

  it("keeps two email-less players distinct rows", async () => {
    /**
     * The schema half. `Player` has no unique constraint on email, so two
     * blanks are two entries — which is what makes an email-less field
     * possible at all, and is why de-duplication had to move to the name for
     * those rows rather than relying on the database to refuse them.
     */
    const ev = await makeEvent(`${MARK} Two`);
    const a = await enter(ev.id, `${MARK} Alike A`, "", 1);
    const b = await enter(ev.id, `${MARK} Alike B`, "", 2);
    expect(a.id).not.toBe(b.id);
    expect(await prisma.player.count({ where: { eventId: ev.id, email: "" } })).toBe(2);
  });
});
