import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { tournamentFactsFor } from "@/lib/services/tournament-facts";
import { tournamentStatus } from "@/lib/domain/tournament-status";

/**
 * A KNOCKOUT DATED ONLY BY ITS PLAY-BY DATES IS SCHEDULED (design 2.1, `roundDueDay`).
 *
 * A qualifier and a bracket, the bracket's `deadline` empty and its `knockoutPlayBy` set through the
 * Bracket's own form: the facts say it is scheduled and the status gives it no "has no date" need.
 * The control, in the same file, is the same event with an empty map: it has no date and says so.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-round-due-audit";
const TODAY = "2027-01-04";
let datedEvent = "";
let undatedEvent = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function build(label: string, knockoutPlayBy: string) {
  const org = await prisma.organization.create({ data: { name: `${TAG} ${label}`, kind: "club" } });
  const ev = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} ${label}`,
      format: "stroke",
      status: "draft",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${label}-${process.pid}`,
      shape: "knockout",
      qualifyMode: "overall",
      qualifyOverall: 4,
      bracketMode: "single",
    },
  });
  await prisma.stage.create({
    data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", playedOn: "2027-06-01" },
  });
  await prisma.stage.create({
    data: { eventId: ev.id, position: 1, type: "Bracket Stage", format: "Match Play", holes: 18, deadline: "", knockoutPlayBy },
  });
  return ev.id;
}

beforeAll(async () => {
  await cleanup();
  datedEvent = await build("dated", JSON.stringify({ "0": "2027-06-27" }));
  undatedEvent = await build("undated", "");
}, 60_000);

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

async function knockout(eventId: string) {
  const f = await tournamentFactsFor(eventId, TODAY);
  if (!f) throw new Error("the event did not load");
  const round = f.rounds.find((r) => r.type === "Bracket Stage");
  if (!round) throw new Error("no bracket round");
  const status = tournamentStatus(f);
  return { round, needs: status.rounds.find((r) => r.id === round.id)?.needs ?? [] };
}

describe("a knockout dated by its play-by dates", () => {
  it("is scheduled and has no date need", async () => {
    const k = await knockout(datedEvent);
    expect(k.round.scheduled).toBe(true);
    expect(k.needs.map((n) => n.key)).not.toContain("date");
  });

  it("control: with an empty map it is not scheduled and says it has no date", async () => {
    const k = await knockout(undatedEvent);
    expect(k.round.scheduled).toBe(false);
    expect(k.needs.map((n) => n.key)).toContain("date");
  });
});
