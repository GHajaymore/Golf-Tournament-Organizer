import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE RAIL AND THE LAUNCH GATE, READ THROUGH THE STATE MACHINE'S ONE READER
 * (proposal 3 Nov, PR 2: "`setupFactsFor` / `launchCheckFor` / `setupFlowFor`
 * become thin wrappers").
 *
 * Before PR 2 the setup flow had its own read of the tournament
 * (`setupFactsFor`, eight counts and a list) and the state machine had another
 * (`tournamentFactsFor`), each spelling "how many are confirmed", "is it dated",
 * "is the tee sheet saved" for itself. PR 2 leaves ONE: the flow is
 * `setupFactsOf(the facts)`. A refactor that must change nothing on screen, so
 * this file was written and run against the OLD reader first, then left
 * unchanged across the switch — every answer below held on both sides of it.
 *
 * EACH EXPECTATION IS WORKED BY HAND from the step rules in
 * `domain/setup-flow.ts` and the gate in `domain/phase-gate.ts`, not read off
 * the code's output: a medal with no flights holds on Flights and launches; a
 * round robin with an undrawn round is refused; a venue with no dates is
 * refused (D4a); a casual round has no rail at all.
 *
 * Throwaway club `zz-setup-wrap`, invented names, `@example.invalid`, removed
 * before and after. Development database only.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/the-setup-flow-reads-the-facts.audit.test.ts
 */

vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

/**
 * THE RAIL IS THE STATE MACHINE'S SINCE PR 3 (`setupRailFor`, which replaced
 * `setupFlowFor`). The expectations below held across PR 2's switch unchanged;
 * PR 3 changes exactly the lines marked with the D-shape that changed them:
 *
 *   D1  flights are optional for a medal and a Stableford (Golf Pro 8.2), and
 *       a step nothing waits for — the money answer too — never holds the
 *       guide open: the rail is "complete" when nothing holds launch.
 *   D4  the details step needs the dates the launch gate needs.
 *
 * THE GATE IS THE MACHINE'S SINCE PR 4, AND ITS OLD READER IS GONE (PR 9a). The
 * launch action asks `refusals.launch`; the dashboard's dialog reads the same
 * refusal through the rail (`setupRailFor(id).launch`, `launchDialogOf`). This
 * file asked `launchCheckFor`, the setup flow's own verdict, until it was
 * deleted; it now asks the dialog. Three expectations moved, each marked
 * "PR 9a": the dialog's open-step count is the rail's own (so a knockout with
 * no dates counts its details step, and a league no longer counts the old
 * Rounds step), a casual round has no setup steps and no next action (the
 * machine's table, 2e), and a tournament that does not exist has no status.
 */
const { setupRailFor, tournamentStatusNow } = await import("@/lib/services/tournament-status");

/** The dashboard's launch dialog: the machine's refusal and the rail's count of open steps. */
async function launchDialog(id: string) {
  const flow = await setupRailFor(id);
  if (!flow) throw new Error(`no rail for ${id}`);
  return flow.launch;
}

const prisma = new PrismaClient();
const TAG = "zz-setup-wrap";
const ids: Record<string, string> = {};

async function clean() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function event(orgId: string, name: string, data: Record<string, unknown> = {}) {
  ids[name] = (
    await prisma.event.create({
      data: {
        name: `${TAG} ${name}`,
        organizationId: orgId,
        status: "draft",
        dates: "14 Nov 2026",
        startOn: "2026-11-14",
        course: "Invented Links",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${name}-${process.pid}`,
        customPars: JSON.stringify(Array(18).fill(4)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
        ...data,
      },
      select: { id: true },
    })
  ).id;
  return ids[name];
}

async function field(eventId: string, n: number, extra: (i: number) => Record<string, unknown> = () => ({})): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `Invented Entrant ${i + 1}`,
        email: `${TAG}-${eventId.slice(-6)}-${i + 1}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: 12,
        ...extra(i),
      },
      select: { id: true },
    });
    out.push(p.id);
  }
  return out;
}

beforeAll(async () => {
  await clean();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });

  // A: a one-round medal, three in and one waiting, no flights, money not answered.
  const medal = await event(org.id, "medal");
  await prisma.stage.create({ data: { eventId: medal, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  await field(medal, 4, (i) => ({ status: i === 3 ? "pending" : "confirmed" }));

  // B: a round robin in one flight, Round 1 drawn, Round 2 not; money answered "none".
  const rr = await event(org.id, "round-robin", { moneyMode: "none" });
  const r1 = await prisma.stage.create({
    data: { eventId: rr, position: 0, type: "Round Robin", format: "Match Play", holes: 18, playedOn: "2026-11-14" },
    select: { id: true },
  });
  await prisma.stage.create({ data: { eventId: rr, position: 1, type: "Round Robin", format: "Match Play", holes: 18, playedOn: "2026-11-21" } });
  const flight = await prisma.group.create({ data: { eventId: rr, name: "Flight A", position: 0 }, select: { id: true } });
  const [a, b] = await field(rr, 2, () => ({ groupId: flight.id }));
  await prisma.match.create({ data: { eventId: rr, stageId: r1.id, groupId: flight.id, round: 1, playerAId: a, playerBId: b, holes: "[]" } });

  // B2 (PR 5c review): the same round robin with NO flights and nothing drawn — the control.
  const rrBare = await event(org.id, "round-robin-no-flights", { moneyMode: "none" });
  await prisma.stage.create({ data: { eventId: rrBare, position: 0, type: "Round Robin", format: "Match Play", holes: 18, playedOn: "2026-11-14" } });
  await field(rrBare, 2);

  // C: a four-ball round, one side of two made, two players on no side; money "split".
  const fb = await event(org.id, "four-ball", { moneyMode: "split" });
  await prisma.stage.create({ data: { eventId: fb, position: 0, type: "Stroke Play Round", format: "Four-Ball", holes: 18 } });
  const fbField = await field(fb, 4);
  const side = await prisma.team.create({ data: { eventId: fb, name: "Invented Side", seed: 1 }, select: { id: true } });
  for (const [i, id] of fbField.slice(0, 2).entries()) await prisma.teamMember.create({ data: { teamId: side.id, playerId: id, position: i } });

  // D: a cup, its two teams named, one of three players on neither.
  const cup = await event(org.id, "cup");
  await prisma.stage.create({ data: { eventId: cup, position: 0, type: "Team Session", format: "Match Play", holes: 18, description: "Singles" } });
  const oak = await prisma.group.create({ data: { eventId: cup, name: "Invented Oaks", position: 0 }, select: { id: true } });
  const elm = await prisma.group.create({ data: { eventId: cup, name: "Invented Elms", position: 1 }, select: { id: true } });
  await field(cup, 3, (i) => ({ groupId: i === 0 ? oak.id : i === 1 ? elm.id : null }));

  // E: a straight knockout with a venue and NO dates (D4a); money "none".
  const ko = await event(org.id, "knockout", { dates: "", startOn: "", moneyMode: "none", bracketMode: "single" });
  await prisma.stage.create({ data: { eventId: ko, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  await field(ko, 4);

  // F: the medal of A, launched.
  const live = await event(org.id, "live-medal", { status: "live" });
  await prisma.stage.create({ data: { eventId: live, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } });
  await field(live, 3);

  // H and I (PR 3): three weekly-type rounds, only the first dated; money "none".
  // H is a LEAGUE by its kind — a weekly sign-up (attendance "opt-out"). I is the
  // same rounds with everyone playing every round: a three-round medal, not a league.
  for (const [name, attendanceMode] of [["league", "opt-out"], ["three-round-medal", "everyone"]] as const) {
    const id = await event(org.id, name, { moneyMode: "none", attendanceMode, startOn: "2026-11-14", endOn: "2026-11-28" });
    for (const [i, playedOn] of ["2026-11-14", "", ""].entries()) {
      await prisma.stage.create({ data: { eventId: id, position: i, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn } });
    }
    await field(id, 4);
  }

  // G: a casual round — two people on the first tee.
  const casual = await event(org.id, "casual", { shape: "match", status: "live" });
  await prisma.stage.create({ data: { eventId: casual, position: 0, type: "Single Match Stage", format: "Match Play", holes: 18 } });
  await field(casual, 2);
}, 120_000);

afterAll(async () => {
  try {
    await clean();
  } finally {
    await prisma.$disconnect();
  }
});

/** The flow, as the facts a person sees: each step ticked or open, where the rail stands, and the gate. */
async function read(name: string) {
  const flow = await setupRailFor(ids[name]);
  const launch = await launchDialog(ids[name]);
  return {
    steps: flow ? flow.steps.map((s) => `${s.key}${s.done ? "+" : "-"}`).join(" ") : null,
    current: flow?.current?.key ?? null,
    complete: flow?.complete ?? null,
    readyToLaunch: flow?.readyToLaunch ?? null,
    refused: launch.refusal !== null,
    stepsOpen: launch.stepsOpen,
  };
}

describe("the setup flow and the launch gate, worked by hand", () => {
  it("a one-round medal with no flights: Flights and Money open and optional, and nothing refuses launch (D1, ruled)", async () => {
    expect(await read("medal")).toEqual({
      steps: "event+ stages+ registration+ grouping- money-",
      current: null, // D1: was "grouping" — the rail held a one-field medal at Flights while Launch worked.
      complete: true, // D1: was false.
      readyToLaunch: true, // D1: was false.
      refused: false,
      stepsOpen: 2,
    });
    const flow = await setupRailFor(ids.medal);
    const flights = flow!.steps.find((s) => s.key === "grouping")!;
    // D1: it never says "No flights yet." as a thing undone (Golf Pro, 8.2).
    expect(flights.missing).toBe("Optional — one field.");
    expect(flights.optional).toBe(true);
  });

  /**
   * THE GUARANTEE: the step that holds is the screen the launch refusal sends the organizer to,
   * and launch is refused. With the flights made, the gate says "Generate them on Rounds & formats"
   * — the round's Generate button is there — so Rounds & formats holds (PR 5c review; it held
   * Flights, a screen with no Generate button). With no flights the gate says "Make flights on
   * Flights", and Flights holds.
   */
  it("a round robin, flights made, Round 2 undrawn: Rounds & formats holds, and launch is refused", async () => {
    const r = await read("round-robin");
    expect(r).toEqual({
      steps: "event+ stages- registration+ grouping+ money+", // PR 5c: was "stages+ … grouping-".
      current: "stages", // PR 5c: was "grouping".
      complete: false,
      readyToLaunch: false,
      refused: true,
      stepsOpen: 1, // the rail's one open step (Rounds & formats).
    });
    const flow = await setupRailFor(ids["round-robin"]);
    expect(flow!.current!.missing).toContain("Round 2");
    expect(flow!.current!.missing).toMatch(/no pairings/);
    expect((await launchDialog(ids["round-robin"])).refusal).toMatch(/Generate them on Rounds & formats/);
  });

  it("CONTROL: a round robin with no flights and nothing drawn: Flights holds, as the refusal says to make them first", async () => {
    const r = await read("round-robin-no-flights");
    expect(r.current).toBe("grouping");
    expect(r.refused).toBe(true);
    expect(r.steps).toMatch(/grouping-/);
    expect((await launchDialog(ids["round-robin-no-flights"])).refusal).toMatch(/Make flights on Flights/);
  });

  it("a four-ball with two players on no side: Sides opens before Flights, and launch is refused until they are on one (P1)", async () => {
    expect(await read("four-ball")).toEqual({
      steps: "event+ stages+ registration+ teams- grouping- money+",
      current: "teams",
      complete: false,
      readyToLaunch: false,
      // PR 9a: was false — the old flow refused only "no sides at all". The machine's gate (the
      // one the action and the dialog both ask) refuses a team round with a player on no side:
      // that player cannot be scored (Golf Pro, 8.2; P1, pinned in tournament-status.test.ts).
      refused: true,
      stepsOpen: 2,
    });
    expect((await launchDialog(ids["four-ball"])).refusal).toBe(
      "2 players are not on a side, so their team rounds cannot be scored. Put them on one on Teams & pairs, then launch.",
    );
  });

  it("a cup with one player on neither team: the Teams step, no Flights step", async () => {
    const r = await read("cup");
    expect(r.steps).toBe("event+ stages+ registration+ cup- money-");
    expect(r.current).toBe("cup");
  });

  it("a knockout with a venue and no dates: the details step holds, and launch is refused (D4a)", async () => {
    expect(await read("knockout")).toEqual({
      steps: "event- stages+ registration+ money+", // D4: was "event+" — ticked with a venue while launch refused "no dates".
      current: "event", // D4: was null.
      complete: false, // D4: was true.
      readyToLaunch: false, // D4: was true.
      refused: true,
      stepsOpen: 1, // PR 9a: the dialog counts the rail's open details step; the old flow ticked it (D4) and said 0.
    });
    expect((await launchDialog(ids.knockout)).refusal).toMatch(/no dates/i);
    expect((await setupRailFor(ids.knockout))!.current!.missing).toMatch(/needs its dates/);
  });

  it("a league whose next week is dated: Rounds & formats is done, and its later weeks only warn (J08, PR 3)", async () => {
    // Golf Pro Q4: only the next unplayed week needs a day or a deadline.
    expect(await read("league")).toEqual({
      steps: "event+ stages+ registration+ grouping- money+",
      current: null,
      complete: true,
      readyToLaunch: true,
      refused: false,
      stepsOpen: 1, // PR 9a: the rail's one open step (Flights); the old flow still counted its Rounds step open (J08).
    });
    const warned = (await setupRailFor(ids.league))!.launch.warnings.map((w) => w.says).join(" ");
    expect(warned).toMatch(/Round 2 and Round 3 have no day or deadline yet\. Only the next week needs one now/);
  });

  it("the same rounds without a league's kind are a three-round medal: every round still needs its day (league by kind, PR 3)", async () => {
    // A 36- or 54-hole championship is one stroke-play competition (Rule 3.3;
    // its Terms set the rounds, Committee Procedures 5A) — not a league, so the
    // league's relaxation never reaches it. Its undated rounds are open on the
    // rail, and only warn (D1b, ruled 8.2).
    expect(await read("three-round-medal")).toEqual({
      steps: "event+ stages- registration+ grouping- money+",
      current: null,
      complete: true,
      readyToLaunch: true,
      refused: false,
      stepsOpen: 2,
    });
  });

  it("launched, the rail no longer offers launching", async () => {
    const r = await read("live-medal");
    expect(r.steps).toBe("event+ stages+ registration+ grouping- money-");
    expect(r.readyToLaunch).toBe(false);
  });

  it("a casual round has no rail, nothing to set up, and nothing to launch (PR 9a: the machine's table, 2e)", async () => {
    expect(await setupRailFor(ids.casual)).toBeNull();
    // A casual round is created live with no setup at all; it is never offered Launch, so
    // there is no gate for it to go through (the old flow counted steps it never shows).
    const told = await tournamentStatusNow(ids.casual);
    expect(told?.status.family).toBe("casual");
    expect(told?.status.setup.of).toBe(0);
    expect(told?.status.nextAction).toBeNull();
  });

  it("a tournament that does not exist: no rail and no status (PR 9a: the action says it could not be found)", async () => {
    expect(await setupRailFor(`${TAG}-no-such-event`)).toBeNull();
    expect(await tournamentStatusNow(`${TAG}-no-such-event`)).toBeNull();
  });
});
