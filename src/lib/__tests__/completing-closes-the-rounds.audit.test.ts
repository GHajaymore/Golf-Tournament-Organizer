import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * MARKING A TOURNAMENT COMPLETED CLOSES ITS ROUNDS — Ajay's call, 2026-09-26.
 *
 * A round is over when the organizer says so (#577), and on a stroke board a
 * player with no card for a CLOSED round holds no place. The seeded Club
 * Championship (36 holes, cut after 18) was marked Completed with round 2
 * still open, so the players cut after round 1 were still ranked among those
 * who finished: +14 over 18 holes above +16 and +21 over 36.
 *
 * Asserted against real rows through the real action, because the defect is a
 * RANK and a source guard would pass on an update that stamped the wrong rows.
 * The fixture reproduces the championship's shape at its smallest: one player
 * who played both rounds (+6 over 36) and one cut after round 1 (+4 over 18),
 * so the cut player LEADS until the rounds are closed — the precondition is
 * asserted first, so this cannot pass on a fixture that cannot show the bug.
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
import { setEventStatus } from "@/app/actions/tournament";
import { loadEventState } from "@/lib/services/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-COMPLETE-CLOSES";
const PARS = new Array(18).fill(4);

let eventId = "";
const stageIds: string[] = [];
let finisher = "";
let cut = "";
let earlierClose = new Date(0);

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} championship`,
      organizationId: org.id,
      status: "live",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-share`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  eventId = ev.id;
  for (const position of [0, 1]) {
    const st = await prisma.stage.create({
      data: {
        eventId,
        position,
        description: `Round ${position + 1}`,
        type: "Stroke Play Round",
        format: "Individual Stroke Play",
        holes: 18,
        scoringBasis: "gross",
      },
      select: { id: true },
    });
    stageIds.push(st.id);
  }
  for (const [i, who] of ["finisher", "cut"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG.toLowerCase()}-${who}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: 0,
      },
      select: { id: true },
    });
    if (who === "finisher") finisher = p.id;
    else cut = p.id;
  }
  // The finisher: 75 and 75 — +6 over 36. Three over par in each round.
  const plusThree = [...new Array(15).fill(4), 5, 5, 5];
  for (const stageId of stageIds) {
    await prisma.scorecard.create({
      data: { eventId, stageId, playerId: finisher, strokes: JSON.stringify(plusThree) },
    });
  }
  // The cut player: 76 in round 1 and nothing after — +4 over 18.
  await prisma.scorecard.create({
    data: {
      eventId,
      stageId: stageIds[0],
      playerId: cut,
      strokes: JSON.stringify([...new Array(14).fill(4), 5, 5, 5, 5]),
    },
  });

  const user = await prisma.user.create({
    data: { email: `${TAG.toLowerCase()}-admin@example.invalid`, name: `${TAG} Admin`, password: "x:unusable" },
    select: { id: true },
  });
  await prisma.account.create({
    data: { eventId, name: `${TAG} Admin`, email: `${TAG.toLowerCase()}-admin@example.invalid`, role: "admin" },
  });
  await createSession(user.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const standing = async (playerId: string) => {
  const state = await loadEventState(eventId);
  const row = state!.strokeStandings.find((s) => s.player.id === playerId)!;
  return { ranked: row.ranked, rank: row.rank };
};

describe("completing a tournament closes its rounds", () => {
  it("THE PRECONDITION: with round 2 open, the cut player leads the finished one", async () => {
    // One round at +4 above two at +6 — the defect, reproduced. If this did
    // not hold, everything below would pass on a fixture that shows nothing.
    expect(await standing(cut)).toEqual({ ranked: true, rank: 1 });
    expect(await standing(finisher)).toEqual({ ranked: true, rank: 2 });
  });

  it("closes every open round, and the cut player no longer holds a place", async () => {
    // Round 1 closed earlier by the committee: its own time must survive.
    earlierClose = new Date("2026-09-01T12:00:00Z");
    await prisma.stage.update({ where: { id: stageIds[0] }, data: { closedAt: earlierClose } });

    expect(await setEventStatus("completed")).toEqual({ ok: true });

    const stages = await prisma.stage.findMany({
      where: { id: { in: stageIds } },
      orderBy: { position: "asc" },
      select: { closedAt: true },
    });
    expect(stages[0].closedAt?.toISOString(), "an earlier close keeps its time").toBe(earlierClose.toISOString());
    expect(stages[1].closedAt, "the open round is now closed").not.toBeNull();

    expect(await standing(finisher)).toEqual({ ranked: true, rank: 1 });
    expect((await standing(cut)).ranked).toBe(false);

    // And the sheet says WHY — not "card incomplete", which their card is not.
    const state = await loadEventState(eventId);
    const cutRow = state!.strokeStandings.find((s) => s.player.id === cut)!;
    const finisherRow = state!.strokeStandings.find((s) => s.player.id === finisher)!;
    expect(cutRow.missedRound).toBe("Round 2");
    expect(finisherRow.missedRound, "somebody who played both rounds missed nothing").toBe("");

    const log = await prisma.auditLog.findFirst({
      where: { eventId, action: "round-closed" },
      orderBy: { createdAt: "desc" },
    });
    expect(log?.detail ?? "").toMatch(/Completing the tournament closed Round 2\./);
  });

  it("leaves the rounds closed when the tournament is reopened", async () => {
    // A closed round blocks no card, and each can be re-opened on Rounds &
    // formats; reopening the tournament is not a statement about any round.
    expect(await setEventStatus("live")).toEqual({ ok: true });
    const open = await prisma.stage.count({ where: { id: { in: stageIds }, closedAt: null } });
    expect(open).toBe(0);
  });
});
