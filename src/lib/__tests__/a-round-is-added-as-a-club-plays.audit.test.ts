import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND IS ADDED AS A CLUB PLAYS IT, AND NEVER AS A PAIR THAT CANNOT BE SCORED
 * (2026-10-16, the Rounds & formats redesign). Driven through the real actions
 * against real rows — a `"use server"` export is a public endpoint, so what the
 * pickers no longer offer must be refused here too.
 *
 *   addStage("Stroke Play Round", Match Play)   refused, in words; no round made
 *   setStageFormat(stroke round, "Match Play")  refused; the round keeps its format
 *   a new round                                 net — a club competition is off handicap
 *   a Bracket after a stroke round              qualifies the top N overall
 *   CONTROL: a Bracket after a round robin      keeps per flight
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ROUNDS";
const EMAIL = "zz-audit-rounds@example.invalid";
const session = { email: EMAIL, name: `${TAG} organizer`, eventId: "", role: "admin", viewRole: "admin", userId: "", accountId: "" };

vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { createEvent, addStage, setStageFormat } = await import("@/app/actions/tournament");

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: EMAIL } });
}

async function make(name: string) {
  await createEvent(`${TAG} ${name}`, "custom", "series");
  const ev = await prisma.event.findFirst({ where: { name: `${TAG} ${name}` } });
  expect(ev, `${name} was created`).not.toBeNull();
  session.eventId = ev!.id;
  return ev!;
}
const rounds = (eventId: string) => prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } });

beforeAll(async () => {
  await scrub();
  // A club that predates the published terms, so the free plan's one-tournament
  // limit does not refuse this file's second tournament (see the defaults audit).
  const user = await prisma.user.create({ data: { email: EMAIL, name: session.name } });
  await prisma.organization.create({
    data: {
      name: `${TAG} organizer`,
      kind: "personal",
      subscription: { create: { plan: "free", planTermsApply: false } },
      members: { create: { userId: user.id, role: "owner" } },
    },
  });
});
afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("what the server accepts is what the pickers offer", () => {
  it("refuses a stroke round in Match Play, says why, and makes nothing", async () => {
    const ev = await make("refused");
    const res = await addStage("Stroke Play Round", { format: "Match Play" });
    expect(res.error).toMatch(/Match Play is decided hole by hole against an opponent/);
    expect(await rounds(ev.id)).toHaveLength(0);
    // CONTROL: the same call with a format the round can be scored in is made.
    expect((await addStage("Stroke Play Round", { format: "Stroke Play" })).error).toBeUndefined();
    expect(await rounds(ev.id)).toHaveLength(1);
  });

  it("refuses to turn an existing stroke round into match play, and leaves it as it was", async () => {
    const ev = await make("format");
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    const [r] = await rounds(ev.id);
    const res = await setStageFormat(r.id, "Match Play");
    expect(res.ok).toBe(false);
    expect((await rounds(ev.id))[0].format).toBe("Stroke Play");
    // CONTROL: a format it can be played in is accepted.
    expect((await setStageFormat(r.id, "Stableford")).ok).toBe(true);
    expect((await rounds(ev.id))[0].format).toBe("Stableford");
  });

  it("starts a new round off handicap, as a club competition is", async () => {
    const ev = await make("net");
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    await addStage("Round Robin", { format: "Match Play" });
    expect((await rounds(ev.id)).map((s) => s.scoringBasis)).toEqual(["net", "net"]);
  });

  it("qualifies a knockout after a medal on the top N overall", async () => {
    const ev = await make("ko-after-medal");
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    await addStage("Bracket Stage", { format: "Match Play" });
    const after = await prisma.event.findUnique({ where: { id: ev.id }, select: { qualifyMode: true } });
    expect(after!.qualifyMode).toBe("overall");
  });

  it("a round added after a scratch round is scratch too — a championship is gross every day", async () => {
    // The review panel (golf professional, tournament director), both ranking it
    // first: Round 2 of a 36-hole scratch championship was created NET.
    const ev = await make("scratch-36");
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    const [r1] = await rounds(ev.id);
    await prisma.stage.update({ where: { id: r1.id }, data: { scoringBasis: "gross" } });
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect((await rounds(ev.id)).map((s) => s.scoringBasis)).toEqual(["gross", "gross"]);
    // CONTROL: a medal series that is net stays net.
    const series = await make("net-series");
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    expect((await rounds(series.id)).map((s) => s.scoringBasis)).toEqual(["net", "net"]);
  });

  it("a flighted field keeps its per-flight qualification when a knockout follows the medal", async () => {
    // The review panel: "overall" every time merged a flighted championship's
    // Championship, First and Second flights into one draw.
    const ev = await make("ko-flighted");
    await prisma.group.createMany({ data: [{ eventId: ev.id, name: "A", position: 0 }, { eventId: ev.id, name: "B", position: 1 }] });
    await addStage("Stroke Play Round", { format: "Stroke Play" });
    await addStage("Bracket Stage", { format: "Match Play" });
    const after = await prisma.event.findUnique({ where: { id: ev.id }, select: { qualifyMode: true } });
    expect(after!.qualifyMode).toBe("perFlight");
  });

  it("CONTROL: a knockout after round-robin groups keeps the top players per flight", async () => {
    const ev = await make("ko-after-groups");
    await addStage("Round Robin", { format: "Match Play" });
    await addStage("Bracket Stage", { format: "Match Play" });
    const after = await prisma.event.findUnique({ where: { id: ev.id }, select: { qualifyMode: true } });
    expect(after!.qualifyMode).toBe("perFlight");
  });
});
