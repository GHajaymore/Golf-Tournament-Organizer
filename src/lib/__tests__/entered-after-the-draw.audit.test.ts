import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadEventState } from "../services/tournament";
import { meFor } from "../services/me";

/**
 * ENTERED AFTER THE DRAW: TODAY SAYS SO, instead of saying nothing.
 *
 * A published tee sheet that leaves somebody off — a late entry, or the
 * organizer adding themselves to their own field (walked 2026-09-26) — gave
 * `group: null`, the same answer as "no sheet yet", and Today was silent. The
 * member saw no tee time and no reason. `offSheet` separates the two.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-OFFSHEET";
let eventId = "";
let stageId = "";
const ids: Record<string, string> = {};
const email = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  eventId = (
    await prisma.event.create({
      data: {
        organizationId: org.id,
        name: `${TAG} medal`,
        dates: "",
        course: "Home",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${process.pid}`,
        format: "stroke",
      },
    })
  ).id;
  stageId = (
    await prisma.stage.create({
      data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
    })
  ).id;
  for (const [i, who] of ["drawn", "late"].entries()) {
    ids[who] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${who}`, email: email(who), seed: i + 1, status: "confirmed", handicap: 10 },
      })
    ).id;
  }
  // The sheet holds the drawn player only: "late" was entered after it.
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheet: JSON.stringify({ groups: [{ name: "Group 1", time: "08:10", startHole: 1, playerIds: [ids.drawn] }] }),
      teeSheetPublished: true,
    },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a published tee sheet, and who is on it", () => {
  it("tells the late entrant they are not on it", async () => {
    const me = await meFor((await loadEventState(eventId))!, email("late"));
    expect(me.round?.group).toBeNull();
    expect(me.round?.offSheet, "a late entrant was told nothing").toBe(true);
  });

  it("does not say it to somebody who is on it (the control)", async () => {
    const me = await meFor((await loadEventState(eventId))!, email("drawn"));
    expect(me.round?.group?.time).toBe("08:10");
    expect(me.round?.offSheet).toBe(false);
  });

  it("says nothing before the sheet is published — that is 'not drawn yet', not 'left off'", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { teeSheetPublished: false } });
    const me = await meFor((await loadEventState(eventId))!, email("late"));
    expect(me.round?.offSheet).toBe(false);
  });
});
