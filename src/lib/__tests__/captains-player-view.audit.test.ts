import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { availabilityFor } from "@/lib/services/availability";
import { loadEventState } from "@/lib/services/tournament";

/**
 * A player in a captains league was shown nothing about their own week.
 *
 * `availabilityFor` gated on `playersAnswer`, which is false under `captains`,
 * so the whole view came back empty and the availability card never rendered.
 * The captain had sent the side to the club, the club had written it down, and
 * the one person it was about was the only one who could not read it.
 *
 * The fix moves the gate to `tracksPerRound` and carries the difference in
 * `asksPlayer`, so the card renders READ-ONLY rather than not at all. Both
 * halves of that matter and both are asserted here, against real rows:
 *
 *   - the view arrives, with the status the club recorded;
 *   - `asksPlayer` is false, which is the flag the screen renders read-only
 *     from and the reason a player cannot contradict their captain's list.
 *
 * Real rows rather than source, because the status a player is shown comes
 * from an Event column, a RoundAttendance row and the absence of one, resolved
 * together — and the interesting case is the ABSENCE, which no fixture of
 * stored rows alone can express.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CAPTVIEW";

let eventId = "";
let stageId = "";
let playerId = "";
const EMAIL = `${TAG}.ann@example.invalid`.toLowerCase();

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function setMode(mode: string) {
  await prisma.event.update({ where: { id: eventId }, data: { attendanceMode: mode } });
}

const viewFor = async () => {
  const state = await loadEventState(eventId);
  if (!state) throw new Error("no state");
  return availabilityFor(state, EMAIL);
};

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} society`, kind: "community" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} winter league`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
      attendanceMode: "captains",
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: {
      eventId,
      position: 0,
      type: "Stroke Play Round",
      format: "Stroke Play",
      holes: 18,
      // Ahead of today, whenever the suite runs, or `splitBySchedule` files it
      // under `past` and `next` is null for a reason that is not the feature.
      playedOn: "2099-06-01",
    },
  });
  stageId = stage.id;
  const p = await prisma.player.create({
    data: { eventId, name: `${TAG} ann`, email: EMAIL, seed: 1, status: "confirmed" },
  });
  playerId = p.id;
});

beforeEach(async () => {
  await prisma.roundAttendance.deleteMany({ where: { eventId } });
  await setMode("captains");
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a player whose captain answers for them", () => {
  it("is shown the round at all", async () => {
    const view = await viewFor();
    expect(view.playerId).toBe(playerId);
    expect(view.next?.stageId).toBe(stageId);
  });

  it("reads the answer the club recorded", async () => {
    await prisma.roundAttendance.create({
      data: { eventId, stageId, playerId, status: "in", decidedBy: "Club office" },
    });
    const view = await viewFor();
    expect(view.next?.status).toBe("in");
    expect(view.next?.explicit).toBe(true);
  });

  it("is out until a captain names them, and is told so as a fact not a default", async () => {
    // No row at all. `defaultStatus("captains")` is out, and `explicit` false
    // is what the screen reads to say "your captain hasn't sent the side in"
    // rather than "out by default", which would describe a setting.
    const view = await viewFor();
    expect(view.next?.status).toBe("out");
    expect(view.next?.explicit).toBe(false);
  });

  it("is never asked the question", async () => {
    const view = await viewFor();
    expect(view.asksPlayer).toBe(false);
  });
});

describe("a league that does ask its players", () => {
  it("is unchanged, and says so", async () => {
    // The control. Without it every assertion above is satisfied by a service
    // that simply returns the same view for every mode.
    await setMode("opt-out");
    const view = await viewFor();
    expect(view.asksPlayer).toBe(true);
    expect(view.next?.status).toBe("in");
    expect(view.next?.explicit).toBe(false);
  });
});

describe("a tournament with no weekly question at all", () => {
  it("gets no card, exactly as before", async () => {
    await setMode("everyone");
    const view = await viewFor();
    expect(view.playerId).toBe("");
    expect(view.next).toBeNull();
    expect(view.asksPlayer).toBe(false);
  });
});
