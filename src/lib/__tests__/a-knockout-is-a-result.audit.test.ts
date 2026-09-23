import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A KNOCKOUT UNDER WAY IS A TOURNAMENT UNDER WAY.
 *
 * There are FOUR tables a round can file its result in, and two checks knew
 * three of them. CLAUDE.md sets the four out and measures the shape that
 * catches this: the seeded club's knockout holds **0 Match rows against 5
 * BracketWinner rows**, because a Bracket Stage files no Scorecard, no
 * TeamScorecard and no Match at all — its results are rows keyed by slot.
 *
 * And `setBracketWinner` is gated on STAFF ROLE, not on the event being
 * launched, so a knockout can hold real results while its status is still
 * `ready`. Both readers then answered a true question of three empty tables:
 *
 *   playRefusalFor      returned "This tournament hasn't been launched yet,
 *                       so play hasn't started" — to people five ties into
 *                       it. That sentence is the exact symptom CLAUDE.md
 *                       names for this class, and the function's whole job is
 *                       to recognise a tournament that is under way and get
 *                       out of its path.
 *
 *   hasPlayingHistory   reported no history for a player who had won their
 *                       way to a semi-final, so `removeSignup` would hard
 *                       DELETE them rather than withdraw them. `winnerId` is
 *                       a plain column with no relation, so the bracket row
 *                       survives and is left naming an id that resolves to
 *                       nobody — the "an opponent who does not exist" shape
 *                       of #525, reached from the other direction.
 *
 * ASSERTED AGAINST REAL ROWS rather than against the source, because what is
 * wrong here is a VALUE and not a spelling: a source guard naming the fourth
 * model would pass on a function that queried it and ignored the answer.
 *
 * The fixture is the other half. Every row below is a knockout with a
 * BracketWinner and NOTHING ELSE — no card, no team card, no match — because
 * a fixture that also has a scorecard cannot express this defect at all, and
 * would pass whichever tables the readers consulted.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { playRefusalFor } from "@/lib/services/action-shared";
import { removeSignup } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-KNOCKOUT";

let eventId = "";
const players: string[] = [];

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
    select: { id: true },
  });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} knockout`,
      organizationId: org.id,
      // PRE-LAUNCH on purpose. A launched event returns early from
      // `playRefusalFor` and the four-table question is never asked.
      status: "ready",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
    },
    select: { id: true },
  });
  eventId = ev.id;
  await prisma.stage.create({
    data: { eventId, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 },
  });

  for (let i = 0; i < 2; i += 1) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} P${i + 1}`,
        email: `${TAG.toLowerCase()}-p${i + 1}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
      select: { id: true },
    });
    players.push(p.id);
  }

  const user = await prisma.user.create({
    data: {
      email: `${TAG.toLowerCase()}-admin@example.invalid`,
      name: `${TAG} Admin`,
      password: "x:unusable",
    },
    select: { id: true },
  });
  await prisma.account.create({
    data: {
      eventId,
      name: `${TAG} Admin`,
      email: `${TAG.toLowerCase()}-admin@example.invalid`,
      role: "admin",
    },
  });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.$disconnect();
});

describe("a knockout with results is a tournament under way", () => {
  it("THE CONTROL: with nothing played at all, it does say so", async () => {
    // Without this, every assertion below passes on a function that always
    // returns null — which is the one way "no refusal" means nothing.
    const before = await prisma.bracketWinner.count({ where: { eventId } });
    expect(before).toBe(0);
    expect(await playRefusalFor(eventId)).toMatch(/hasn’t been launched yet/);
  });

  it("does not tell people on the course that play hasn't started", async () => {
    await prisma.bracketWinner.create({
      data: { eventId, key: "w-0-0", winnerId: players[0], result: "3&2" },
    });
    // The only result in the whole event is that slot. No Scorecard, no
    // TeamScorecard, no Match.
    expect(await prisma.scorecard.count({ where: { eventId } })).toBe(0);
    expect(await prisma.teamScorecard.count({ where: { eventId } })).toBe(0);
    expect(await prisma.match.count({ where: { eventId } })).toBe(0);

    expect(await playRefusalFor(eventId)).toBeNull();
  });

  it("withdraws a player who has won a tie rather than deleting them", async () => {
    // players[0] holds the slot above; players[1] holds nothing.
    expect(await removeSignup(players[1])).toBe("deleted");
    expect(await removeSignup(players[0])).toBe("withdrawn");

    // And the bracket still names somebody who exists. `winnerId` is a plain
    // column, so a delete would have left it pointing at nothing rather than
    // failing loudly.
    const row = await prisma.bracketWinner.findFirst({ where: { eventId, key: "w-0-0" } });
    expect(row?.winnerId).toBe(players[0]);
    expect(await prisma.player.count({ where: { id: players[0] } })).toBe(1);
  });
});
