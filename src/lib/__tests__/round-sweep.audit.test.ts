import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The sweep deletes casual rounds and cannot reach anything else.
 *
 * This is the only scheduled DELETE in the product. It runs unattended against
 * production on a timer, and the thing it must never do — remove a tournament,
 * with its field, its cards, its money and its history — is silent, permanent,
 * and would be discovered by a club rather than by us.
 *
 * A unit test cannot establish this. The property is about a QUERY against
 * real rows: whether `expiresAt: { not: null, lte: now }` selects what it is
 * supposed to and nothing beside it. So the fixture deliberately puts a
 * tournament next to an expired round — same organization, same age, same
 * everything except the one column — and asserts the tournament survives.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROUND-SWEEP";

const { sweepExpiredRounds, dueRounds, deleteIfStillDue } = await import(
  "@/lib/services/round-sweep"
);

let organizationId = "";

/**
 * BY THE MARK, in both hooks.
 *
 * Everything below cascades from the organization, so removing it by tag
 * removes the whole fixture — and running it in `beforeAll` as well makes it
 * self-healing: a run killed between the create and the teardown is collected
 * by the next run rather than left beside it.
 */
async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** An event of any shape, aged and expiring however the case needs. */
async function makeEvent(name: string, expiresAt: Date | null, shape: string) {
  return prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `zz-sweep-${Math.random().toString(36).slice(2)}`,
      status: "live",
      shape,
      expiresAt,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club` },
    select: { id: true },
  });
  organizationId = org.id;
});

afterAll(async () => {
  await scrub();
  await prisma.$disconnect();
});

describe("sweeping expired casual rounds", () => {
  const LONG_AGO = new Date("2020-01-01T00:00:00.000Z");
  const FAR_OFF = new Date("2099-01-01T00:00:00.000Z");

  it("deletes an expired round and leaves a tournament of the same age alone", async () => {
    /**
     * The whole point of the file, in one fixture.
     *
     * The tournament and the expired round are identical rows apart from
     * `expiresAt` — same club, same status, created in the same second. If the
     * sweep is selecting on age, on shape, or on anything but that column,
     * this is where it takes the tournament with it.
     */
    const expired = await makeEvent("expired round", LONG_AGO, "match");
    const tournament = await makeEvent("real tournament", null, "series");
    // A casual round shaped exactly like the expired one but NOT yet due.
    const fresh = await makeEvent("fresh round", FAR_OFF, "match");

    const result = await sweepExpiredRounds();

    expect(result.ids).toContain(expired.id);
    expect(await prisma.event.findUnique({ where: { id: expired.id } })).toBeNull();

    // THE ASSERTIONS THAT MATTER. Both survivors, by id, read back from the
    // database rather than inferred from the count — a count is satisfied by
    // deleting the wrong one.
    expect(await prisma.event.findUnique({ where: { id: tournament.id } })).not.toBeNull();
    expect(await prisma.event.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(result.ids).not.toContain(tournament.id);
    expect(result.ids).not.toContain(fresh.id);
  });

  it("cannot be made to delete a tournament by ageing it", async () => {
    /**
     * A tournament older than every expired round in the table.
     *
     * `createdAt` is the field an age-based rule would key on, and this row is
     * the oldest thing here — so a sweep written that way takes it. The only
     * thing protecting it is the null in `expiresAt`.
     */
    const made = await makeEvent("ancient tournament", null, "series");
    const ancient = await prisma.event.update({
      where: { id: made.id },
      data: { createdAt: LONG_AGO },
      select: { id: true, createdAt: true },
    });
    // Asserted, not assumed. If the back-dating silently did not take, this
    // would be a test about an event created seconds ago, proving nothing
    // whatever about age.
    expect(ancient.createdAt.getTime()).toBe(LONG_AGO.getTime());

    const result = await sweepExpiredRounds();

    expect(result.ids).not.toContain(ancient.id);
    expect(await prisma.event.findUnique({ where: { id: ancient.id } })).not.toBeNull();
  });

  it("takes the round's children with it, so nothing is orphaned", async () => {
    // A casual round's players, stage and match all cascade from the event.
    // Left behind, they are rows pointing at a tournament that no longer
    // exists — which is how a leaderboard query starts returning nulls.
    const round = await makeEvent("round with rows", LONG_AGO, "match");
    const stage = await prisma.stage.create({
      data: {
        eventId: round.id,
        position: 0,
        type: "Round Robin",
        description: "",
        format: "Match Play",
        holes: 18,
      },
      select: { id: true },
    });
    const player = await prisma.player.create({
      data: { eventId: round.id, name: `${TAG} player`, status: "confirmed", seed: 1 },
      select: { id: true },
    });

    await sweepExpiredRounds();

    expect(await prisma.stage.findUnique({ where: { id: stage.id } })).toBeNull();
    expect(await prisma.player.findUnique({ where: { id: player.id } })).toBeNull();
  });

  it("spares a round whose expiry is cleared BETWEEN the select and the delete", async () => {
    /**
     * `keepRound` and the sweep race, and the person pressing Keep is exactly
     * the person whose data must not be destroyed.
     *
     * THIS TEST USED TO BE A LIE. It cleared `expiresAt` and then ran the
     * whole sweep, which never reproduces anything — the select simply does
     * not return the row, so the delete's re-check is never reached. It passed
     * with the re-check deleted, and passed again with the select widened to
     * every event in the database. It looked exactly like coverage of the
     * interleaving and could not observe it at all.
     *
     * So the sweep's two steps are separately callable now, and this sits in
     * the gap: select while the round is still due, clear the expiry as a
     * player would, then attempt the delete. That is the real ordering, and
     * the only thing that saves the round is the condition repeated inside the
     * DELETE.
     */
    const saved = await makeEvent("kept mid-sweep", LONG_AGO, "match");

    // 1. The sweep decides. The round IS due at this moment.
    const due = await dueRounds();
    expect(due).toContain(saved.id);

    // 2. The player presses Keep, in the gap.
    await prisma.event.update({ where: { id: saved.id }, data: { expiresAt: null } });

    // 3. The sweep, already holding the id, tries to delete it — and must not.
    expect(await deleteIfStillDue(saved.id)).toBe(false);
    expect(await prisma.event.findUnique({ where: { id: saved.id } })).not.toBeNull();
  });

  it("refuses to delete a tournament even when handed its id directly", async () => {
    /**
     * The last line of defence, asserted on its own.
     *
     * `deleteIfStillDue` is what actually removes rows, and the two tests
     * above pass whether or not it re-checks — the select protects them. This
     * one hands it a tournament's id, which is the state the system would be
     * in if the select were ever widened, mis-ordered, or fed from somewhere
     * else entirely. Nothing but the condition inside the DELETE stands
     * between that id and a deleted tournament.
     */
    const tournament = await makeEvent("handed to the delete", null, "series");

    expect(await deleteIfStillDue(tournament.id)).toBe(false);
    expect(await prisma.event.findUnique({ where: { id: tournament.id } })).not.toBeNull();

    // And a round that is not due YET, which is the other row a wrong select
    // would hand over.
    const fresh = await makeEvent("not due yet", FAR_OFF, "match");
    expect(await deleteIfStillDue(fresh.id)).toBe(false);
    expect(await prisma.event.findUnique({ where: { id: fresh.id } })).not.toBeNull();

    // A genuinely due round still goes, or the three refusals above are
    // satisfied by a function that deletes nothing at all.
    const due = await makeEvent("genuinely due", LONG_AGO, "match");
    expect(await deleteIfStillDue(due.id)).toBe(true);
    expect(await prisma.event.findUnique({ where: { id: due.id } })).toBeNull();
  });

  it("reports ids and never names", async () => {
    // This runs in production and its output reaches logs. A casual round is
    // named after the people playing it, so a name in the result is real
    // players' names written somewhere they were never meant to go.
    await makeEvent("nameless in the log", LONG_AGO, "match");
    const result = await sweepExpiredRounds();
    expect(result.deleted).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain(TAG);
  });
});
