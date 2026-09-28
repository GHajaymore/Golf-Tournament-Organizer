import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** One browser's cookie jar, so a console session round-trips for real. */
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
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { launchTournament } from "@/app/actions/tournament";
import { roundCardLines } from "@/lib/services/round-card-lines";

/**
 * LAUNCH STOPS ON A ROUND ITS FORMAT CANNOT SCORE (Ajay, 2026-09-28).
 *
 * Score entry already refused a round with no card — on the first tee. This
 * proves the same question is asked at launch, against real rows, and that
 * the one legitimate "no card" case still launches.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */
const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LAUNCH-CARD";
const PARS = JSON.stringify([4, 4, 4, 5, ...new Array(14).fill(4)]);
const SI = JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1));

let orgId = "";
let userId = "";
let eventId = "";

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

/** A draft tournament, dated and with a field, whose one round is `round`. */
async function tournament(round: { format: string; scoringBasis: string; courseId?: string }, card = false) {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId, name: `${TAG} ${Math.random()}`, status: "draft", shape: "single", format: "stroke",
      formationRule: "balanced", dates: "14 May 2026", course: card ? `${TAG} home` : "", city: "", address: "",
      regDeadline: "", capacity: 0, shareToken: `launch-card-${Date.now()}-${Math.random()}`,
      registrationToken: `r-launch-card-${Date.now()}-${Math.random()}`,
      ...(card ? { customPars: PARS, customYards: JSON.stringify(new Array(18).fill(400)), customStrokeIndex: SI } : {}),
    },
  });
  eventId = event.id;
  await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", holes: 18, format: round.format, scoringBasis: round.scoringBasis, courseId: round.courseId ?? null },
  });
  if (round.courseId) await prisma.eventCourse.create({ data: { eventId, courseId: round.courseId } });
  await prisma.player.create({
    data: { eventId, name: `${TAG} Pat`, email: `${TAG.toLowerCase()}-p-${Math.random()}@example.invalid`, handicap: 10, seed: 1, status: "confirmed" },
  });
  await prisma.account.create({ data: { eventId, email: `${TAG.toLowerCase()}-sec@example.invalid`, name: `${TAG} Sec`, role: "admin" } });
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

const statusNow = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status;

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", country: "GB" } })).id;
  userId = (await prisma.user.create({ data: { email: `${TAG.toLowerCase()}-sec@example.invalid`, name: `${TAG} Sec`, password: "x" } })).id;
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId, role: "owner" } });
});
beforeEach(() => jar.clear());
afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("launch and the course card", () => {
  it("refuses a net medal with no card, names the round, and stays in draft", async () => {
    await tournament({ format: "Stroke Play", scoringBasis: "net" });
    const res = await launchTournament();
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Round 1");
    expect(res.error).toContain("par and stroke index");
    expect(await statusNow()).toBe("draft");
  });

  it("refuses a round whose OWN venue has no card, even though the tournament has one", async () => {
    const bare = await prisma.course.create({ data: { organizationId: orgId, name: `${TAG} Ardmore`, city: "", pars: "", yards: "", strokeIndex: "" } });
    await tournament({ format: "Stroke Play", scoringBasis: "net", courseId: bare.id }, true);
    const lines = await roundCardLines(eventId);
    expect(lines.map((l) => [l.course, l.status])).toEqual([[`${TAG} Ardmore`, "missing"]]);
    expect((await launchTournament()).error).toContain(`Round 1 at ${TAG} Ardmore`);
  });

  it("launches once the card is there", async () => {
    await tournament({ format: "Stroke Play", scoringBasis: "net" }, true);
    expect((await roundCardLines(eventId))[0].status).toBe("ready");
    expect((await launchTournament()).ok).toBe(true);
    expect(await statusNow()).toBe("live");
  });

  it("CONTROL: gross match play needs no card and launches without one", async () => {
    await tournament({ format: "Match Play", scoringBasis: "gross" });
    expect((await roundCardLines(eventId))[0].status).toBe("not-needed");
    expect((await launchTournament()).ok).toBe(true);
  });
});
