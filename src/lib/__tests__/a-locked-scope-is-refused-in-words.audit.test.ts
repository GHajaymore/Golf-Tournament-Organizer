import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * EVERY LOCKED SCOPE IS REFUSED IN WORDS, NEVER THROWN (state machine PR 5b; J10).
 *
 * The 28 lock sites in `actions/tournament.ts` THREW "Configuration is locked"
 * (`assertUnlocked`, now deleted), and a throw inside a transition is "This
 * screen didn't load". Each is pressed here on a LAUNCHED tournament, as the
 * organizer would from a screen opened before the launch, and must come back
 * `{ ok: false }` with the machine's reason and way out, the lock it came from,
 * and nothing written. Pressed again as an ASSISTANT, the same refusal tells
 * them to ask the Organizer (panel on 5a: words).
 *
 * THE COMMITTEE CORRECTION (TD Q2) is then opened on ONE scope: the presses on
 * that scope go through, every other scope stays refused, the record holds the
 * line, Done closes it and logs that too. Launch, Complete and Reopen each
 * leave their line (panel 8.0 F1). And `lockFactsFor`, the narrow read every
 * action pays for, gives `locksFor` the same answer as the full facts for a
 * tournament of every lock shape it seeds itself, and for every other one in
 * this database (the panel's cost ruling).
 *
 * The control: the legacy blanket unlock still opens everything, so the
 * refusals are the lock, not something else refusing everything.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/a-locked-scope-is-refused-in-words.audit.test.ts
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));

import { createSession, setActiveEvent } from "@/lib/auth";
import {
  saveEvent,
  applyManualCount,
  regenGroups,
  generateNextRound,
  saveScoring,
  setQualifyPerGroup,
  setStageCarry,
  setStageCut,
  setStageScoreInput,
  setStageMatchKeptBy,
  saveTiebreakers,
  setQualifyMode,
  setBracketMode,
  renameGroup,
  setFlightsConfirmed,
  setMatchTiebreakers,
  saveEntryTerms,
  setRegistrationApproval,
  setStageCutScope,
  setStageCutTies,
  clearRoundScores,
  setRequirePhone,
  setSingleMatchRule,
  setThirdPlace,
  addStage,
  openCorrection,
  endCorrection,
  setConfigUnlocked,
  launchTournament,
  setEventStatus,
} from "@/app/actions/tournament";
import { lockFactsFor, setupSideFactsFor } from "@/lib/services/tournament-facts";
import { locksFor, lockFactsOf } from "@/lib/domain/tournament-status";
import { clubToday } from "@/lib/domain/club-clock";
import { formatDay } from "@/lib/domain/locale";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SM5B";

let eventId = "";
let round1 = "";
let round2 = "";
let flightA = "";
let playerId = "";
let organizerId = "";
let assistantId = "";

async function as(userId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

beforeAll(async () => {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });

  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: "America/New_York" }, select: { id: true } });
  const ev = await prisma.event.create({
    data: {
      name: `${TAG} medal`,
      organizationId: org.id,
      // DRAFT first: Launch is pressed below, and must leave its line.
      status: "draft",
      configUnlocked: false,
      dates: "14 Nov 2026",
      startOn: "2026-11-14",
      endOn: "2026-11-14",
      course: `${TAG} links`,
      city: "",
      address: "",
      regDeadline: "",
      formationRule: "manual",
      shareToken: `${TAG}-share`,
    },
    select: { id: true },
  });
  eventId = ev.id;
  // A course with its card, so Launch is not refused for want of par and stroke index.
  const course = await prisma.course.create({
    data: {
      organizationId: org.id,
      name: `${TAG} links`,
      city: "",
      pars: JSON.stringify(new Array(18).fill(4)),
      yards: JSON.stringify(new Array(18).fill(400)),
      strokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
    },
    select: { id: true },
  });
  await prisma.eventCourse.create({ data: { eventId, courseId: course.id } });
  await prisma.tee.create({ data: { courseId: course.id, name: `${TAG} White`, courseRating: 71.2, slopeRating: 128, par: 72, position: 0 } });
  round1 = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: "2026-11-14" }, select: { id: true } })).id;
  round2 = (await prisma.stage.create({ data: { eventId, position: 1, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: "2026-11-15" }, select: { id: true } })).id;
  flightA = (await prisma.group.create({ data: { eventId, name: "Flight A", position: 0 }, select: { id: true } })).id;
  playerId = (
    await prisma.player.create({
      data: { eventId, name: `${TAG} player`, email: `${TAG.toLowerCase()}-player@example.invalid`, seed: 1, status: "confirmed", handicap: 10, groupId: flightA },
      select: { id: true },
    })
  ).id;

  const user = async (role: "admin" | "assistant") => {
    const u = await prisma.user.create({
      data: { email: `${TAG.toLowerCase()}-${role}@example.invalid`, name: `${TAG} ${role}`, password: "x:unusable", emailVerifiedAt: new Date() },
      select: { id: true },
    });
    await prisma.account.create({ data: { eventId, name: `${TAG} ${role}`, email: `${TAG.toLowerCase()}-${role}@example.invalid`, role } });
    return u.id;
  };
  organizerId = await user("admin");
  assistantId = await user("assistant");
  await as(organizerId);
});

afterAll(async () => {
  try {
    await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  } finally {
    await prisma.$disconnect();
  }
});

/** Everything a refused press could have written. */
async function snapshot() {
  const [event, stages, groups, players] = await Promise.all([
    prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: {
        name: true, course: true, winPts: true, tiebreakers: true, qualifyMode: true, qualifyPerGroup: true, qualifyOverall: true, bracketMode: true,
        flightsConfirmed: true, matchTiebreakers: true, regOpens: true, regDeadline: true, capacity: true, registrationApproval: true, requirePhone: true,
      },
    }),
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.group.findMany({ where: { eventId }, orderBy: { id: "asc" }, select: { id: true, name: true } }),
    prisma.player.findMany({ where: { eventId }, orderBy: { id: "asc" }, select: { id: true, groupId: true, status: true } }),
  ]);
  return { event, stages, groups, players };
}

const LIVE = (what: string) => `Locked because the tournament is live. Make a committee correction to ${what}.`;
const ASK = (what: string) => `Locked because the tournament is live. Ask the Organizer to make a committee correction to ${what}.`;

type Res = { ok: boolean; error?: string; lock?: { scope: string; by: string; correctable: boolean } };
const PRESSES: { name: string; scope: string; what: string; press: () => Promise<Res> }[] = [
  {
    name: "saveEvent", scope: "details", what: "change the tournament’s details",
    press: () => saveEvent({ name: `${TAG} renamed`, playKind: "tournament", dates: "", datesTentative: false, startOn: "", endOn: "", format: "", course: "", courseId: null, city: "", address: "", playerCountMode: "individual", courseMode: "club" } as never),
  },
  { name: "applyManualCount", scope: "field", what: "change the field limit", press: () => applyManualCount(8, true) },
  { name: "regenGroups", scope: "flights", what: "make the flights again", press: () => regenGroups("handicap", "auto", 0, true) },
  { name: "saveScoring", scope: "rounds", what: "change the points", press: () => saveScoring({ winPts: 3, tiePts: 1, lossPts: 0, holeRatioPts: 0, bonusPts: 0, maxPerMatch: 3 }) },
  { name: "setQualifyPerGroup", scope: "rounds", what: "change who qualifies", press: () => setQualifyPerGroup(2) },
  { name: "setStageCarry", scope: "rounds", what: "change the points carried forward", press: () => setStageCarry(round2, true, 50) },
  { name: "setStageCut", scope: "rounds", what: "change the cut", press: () => setStageCut(round1, true, "count", 4, 50) },
  // The basis, the format and deleting a round left this list in J12 PR 7b: launch invalidates no round
  // setting, so they ask the rounds rule (`round-changes-after-play.audit.test.ts` walks them launched).
  { name: "setStageScoreInput", scope: "rounds", what: "change how scores are entered", press: () => setStageScoreInput(round1, "total") },
  { name: "setStageMatchKeptBy", scope: "rounds", what: "change who keeps the match card", press: () => setStageMatchKeptBy(round1, "player") },
  { name: "saveTiebreakers", scope: "rounds", what: "change the tie-breakers", press: () => saveTiebreakers([]) },
  { name: "setQualifyMode", scope: "rounds", what: "change who qualifies", press: () => setQualifyMode("overall", 4) },
  { name: "setBracketMode", scope: "rounds", what: "change the bracket’s arrangement", press: () => setBracketMode("split") },
  { name: "renameGroup", scope: "flights", what: "rename a flight", press: () => renameGroup(flightA, "Renamed") },
  { name: "setFlightsConfirmed", scope: "flights", what: "confirm or reopen the draw", press: () => setFlightsConfirmed(true) },
  { name: "setMatchTiebreakers", scope: "rounds", what: "change the match tie-breakers", press: () => setMatchTiebreakers([]) },
  { name: "saveEntryTerms", scope: "field", what: "change the entry terms", press: () => saveEntryTerms({ regOpens: "", regDeadline: "", capacity: 0 }) },
  { name: "setRegistrationApproval", scope: "field", what: "change how entries are approved", press: () => setRegistrationApproval("approve") },
  { name: "setStageCutScope", scope: "rounds", what: "change the cut", press: () => setStageCutScope(round1, "perFlight") },
  { name: "setStageCutTies", scope: "rounds", what: "change the cut", press: () => setStageCutTies(round1, "playoff") },
  { name: "clearRoundScores", scope: "rounds", what: "clear scores", press: () => clearRoundScores(round1) },
  { name: "setRequirePhone", scope: "field", what: "change the entry terms", press: () => setRequirePhone(true) },
  { name: "setSingleMatchRule", scope: "rounds", what: "change the match’s rule", press: () => setSingleMatchRule(round1, { kind: "seeds", a: 1, b: 2 }) },
  { name: "setThirdPlace", scope: "rounds", what: "change the play-off for third", press: () => setThirdPlace(round1, true) },
];
// generateNextRound is pressed on its own below: its lock turns on once the round has a card.

describe("launching leaves its line (panel 8.0 F1), and the scopes lock", () => {
  it("Launch writes tournament-launched", async () => {
    const launched = await launchTournament();
    expect(launched, launched.error).toEqual({ ok: true });
    const lines = await prisma.auditLog.findMany({ where: { eventId, action: "tournament-launched" } });
    expect(lines).toHaveLength(1);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe("live");
  });
});

describe("on a launched tournament, every structural press is refused in words — the Organizer's, then the assistant's", () => {
  for (const p of PRESSES) {
    it(`${p.name}: returned, not thrown — the machine's reason and way out, its lock, nothing written`, async () => {
      const before = await snapshot();
      const res = await p.press();
      expect(res).toMatchObject({ ok: false, error: LIVE(p.what), lock: { scope: p.scope, by: "launch", correctable: true } });
      expect(await snapshot(), `${p.name} wrote while refused`).toEqual(before);
    });
  }

  it("an assistant pressing the same controls is told to ask the Organizer", async () => {
    await as(assistantId);
    try {
      expect(await setQualifyPerGroup(2)).toMatchObject({ ok: false, error: ASK("change who qualifies") });
      expect(await renameGroup(flightA, "Renamed")).toMatchObject({ ok: false, error: ASK("rename a flight") });
    } finally {
      await as(organizerId);
    }
  });

  it("generateNextRound: open on a round with no cards (running the event), refused in words once it has one", async () => {
    // Drawing a round nobody has played is running the event, not setup: it may fail for its own reasons, but never on the lock.
    const open = await generateNextRound(round2);
    expect(open).not.toHaveProperty("lock");
    // A card WITH SCORES on it — giving out blank cards is not playing (`enteredCardCount`).
    await prisma.scorecard.upsert({
      where: { stageId_playerId: { stageId: round2, playerId } },
      create: { eventId, stageId: round2, playerId, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" },
      update: { strokes: JSON.stringify(Array(18).fill(5)), status: "entered" },
    });
    try {
      // The round's own refusal (`redrawRefusal`), never a lock's — a lock offered a correction as a way to wipe scores (panel review of 5b, must-fix 2).
      expect(await generateNextRound(round2)).toEqual({ ok: false, error: "Round 2 has scores — clear them on Score entry first." });
    } finally {
      await prisma.scorecard.deleteMany({ where: { stageId: round2 } });
    }
  });

  it("adding a round stays open while live — one rule with the described tournament (TD ruling on 5a)", async () => {
    const added = await addStage("Stroke Play Round", 1);
    expect(added.id, added.error).toBeTruthy();
    await prisma.stage.deleteMany({ where: { id: added.id } });
  });
});

describe("the committee correction opens ONE scope, for a reason, on the record (TD Q2)", () => {
  it("refuses a short reason, a scope that is not locked, and anybody but the Organizer", async () => {
    expect(await openCorrection("rounds", "typo")).toMatchObject({ ok: false, error: expect.stringMatching(/at least 10 characters/) });
    expect(await openCorrection("money", "The money answer was wrong")).toMatchObject({ ok: false, error: "That part of setup is not locked, so there is nothing to correct." });
    await as(assistantId);
    try {
      await expect(openCorrection("rounds", "Wrong format on Round 1")).rejects.toThrow(/Organizer access required/);
    } finally {
      await as(organizerId);
    }
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).correctionScope).toBeNull();
  });

  it("opened on the rounds: a round setting goes through, the field and the details stay refused, the record says who and why", async () => {
    expect(await openCorrection("rounds", "Round 1 was set to 18 holes by mistake")).toEqual({ ok: true });
    const row = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.correctionScope).toBe("rounds");
    expect(row.correctionBy).toBe(`${TAG} admin`);
    // Until the end of the CLUB's day: an instant ahead of now, and not more than a day ahead.
    expect(row.correctionUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(row.correctionUntil!.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    // A round setting the launch lock still holds (holes ask the rounds rule since 8 Nov): who qualifies.
    const qualifyWas = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).qualifyPerGroup;
    const other = qualifyWas === 3 ? 2 : 3;
    expect(await setQualifyPerGroup(other)).toEqual({ ok: true });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).qualifyPerGroup).toBe(other);
    expect(await setQualifyPerGroup(qualifyWas)).toEqual({ ok: true });

    expect(await setRequirePhone(true)).toMatchObject({ ok: false, lock: { scope: "field" } });
    expect(await renameGroup(flightA, "Renamed")).toMatchObject({ ok: false, lock: { scope: "flights" } });

    const lines = await prisma.auditLog.findMany({ where: { eventId, action: "committee-correction" }, orderBy: { createdAt: "asc" } });
    // The line says when it ends (panel review of 5b, must-fix 3): midnight at the club, on the club's own day — asked of the club's clock by another route.
    const clubsDay = formatDay(clubToday("America/New_York"));
    expect(lines.map((l) => l.detail)).toEqual([`${TAG} admin opened rounds for a correction: Round 1 was set to 18 holes by mistake — until midnight on ${clubsDay}, club time`]);
    expect(lines[0].actor).toBe(`${TAG} admin`);
  });

  it("Done closes it, logs the close, and the rounds are refused again", async () => {
    expect(await endCorrection()).toEqual({ ok: true });
    const row = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect([row.correctionScope, row.correctionReason, row.correctionBy, row.correctionUntil]).toEqual([null, null, null, null]);
    expect(await setQualifyPerGroup(3)).toMatchObject({ ok: false, lock: { scope: "rounds" } });
    const lines = await prisma.auditLog.findMany({ where: { eventId, action: "committee-correction" }, orderBy: { createdAt: "asc" } });
    expect(lines).toHaveLength(2);
    expect(lines[1].detail).toBe(`${TAG} admin closed the correction ${TAG} admin opened on rounds`);
  });

  it("opening another scope while one stands closes the first, and the record says so", async () => {
    await prisma.auditLog.deleteMany({ where: { eventId, action: "committee-correction" } });
    expect(await openCorrection("rounds", "Round 1 was set to 18 holes by mistake")).toEqual({ ok: true });
    expect(await openCorrection("details", "The course was named wrongly")).toEqual({ ok: true });
    const row = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(row.correctionScope).toBe("details");
    expect(await setQualifyPerGroup(3)).toMatchObject({ ok: false, lock: { scope: "rounds" } });
    expect(await endCorrection()).toEqual({ ok: true });
    const lines = (await prisma.auditLog.findMany({ where: { eventId, action: "committee-correction" }, orderBy: { createdAt: "asc" } })).map((l) => l.detail);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^.+ admin opened rounds for a correction: Round 1 was set to 18 holes by mistake — until midnight on .+, club time$/);
    expect(lines[1]).toBe(`${TAG} admin closed the correction ${TAG} admin opened on rounds to open another`);
    expect(lines[2]).toMatch(/^.+ admin opened details for a correction: The course was named wrongly — until midnight on .+, club time$/);
    expect(lines[3]).toBe(`${TAG} admin closed the correction ${TAG} admin opened on details`);
  });

  it("a lapsed correction opens nothing: the row says a scope, the clock says it ended — and Done on it writes no line", async () => {
    await prisma.event.update({
      where: { id: eventId },
      data: { correctionScope: "rounds", correctionReason: "Yesterday's correction", correctionBy: `${TAG} admin`, correctionUntil: new Date(Date.now() - 60_000) },
    });
    try {
      expect(await setQualifyPerGroup(3)).toMatchObject({ ok: false, lock: { scope: "rounds" } });
      // Done after the lapse clears the row and says nothing: the opening line said when it ended (panel review of 5b, must-fix 3).
      await prisma.auditLog.deleteMany({ where: { eventId, action: "committee-correction" } });
      expect(await endCorrection()).toEqual({ ok: true });
      expect(await prisma.auditLog.count({ where: { eventId, action: "committee-correction" } })).toBe(0);
      expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).correctionScope).toBeNull();
    } finally {
      await prisma.event.update({ where: { id: eventId }, data: { correctionScope: null, correctionReason: null, correctionBy: null, correctionUntil: null } });
    }
  });

  it("the blanket unlock can no longer be opened — only locked again (the legacy rows, Ops 8.5)", async () => {
    expect(await setConfigUnlocked(true)).toMatchObject({ ok: false, error: expect.stringMatching(/committee correction/) });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).configUnlocked).toBe(false);
    // THE CONTROL: a row the old unlock still holds open opens everything, as it did; locking it again closes it and logs that.
    await prisma.event.update({ where: { id: eventId }, data: { configUnlocked: true } });
    expect(await setRequirePhone(true)).toEqual({ ok: true });
    expect(await setRequirePhone(false)).toEqual({ ok: true });
    expect(await setConfigUnlocked(false)).toEqual({ ok: true });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).configUnlocked).toBe(false);
    expect(await setRequirePhone(true)).toMatchObject({ ok: false, lock: { scope: "field" } });
  });
});

describe("Complete and Reopen leave their lines (panel 8.0 F1)", () => {
  it("completing writes tournament-completed; reopening writes tournament-reopened; a completed tournament refuses a round", async () => {
    await prisma.scorecard.create({ data: { eventId, stageId: round1, playerId, strokes: JSON.stringify(Array(18).fill(5)), status: "approved" } });
    const completed = await setEventStatus("completed", false, true);
    expect(completed, JSON.stringify(completed)).toMatchObject({ ok: true });
    expect(await prisma.auditLog.count({ where: { eventId, action: "tournament-completed" } })).toBe(1);
    expect(await addStage("Stroke Play Round", 1)).toMatchObject({ error: "Locked because the tournament is completed. Reopen it on the dashboard to add a round.", lock: { scope: "rounds", by: "completed" } });
    expect(await openCorrection("rounds", "Correcting after the prize-giving")).toMatchObject({ ok: false, error: expect.stringMatching(/Reopen it on the dashboard/) });
    expect(await setEventStatus("live")).toMatchObject({ ok: true });
    expect(await prisma.auditLog.count({ where: { eventId, action: "tournament-reopened" } })).toBe(1);
  });
});

describe("the narrow lock read gives the full facts' locks, for every tournament here (the panel's cost ruling)", () => {
  /**
   * ITS OWN TOURNAMENTS, ONE PER WAY A LOCK IS DECIDED — not whatever other
   * files left behind. A round's fresh database holds one tournament when this
   * runs (this file's own), so a sweep of "every tournament here" compared one
   * and its control failed; on a developer's database it compared hundreds,
   * mostly alike. Each fixture below turns on a different fact `locksFor` reads
   * (the status, the legacy unlock, a correction open or lapsed, a confirmed
   * draw, the family, and a flighted knockout with and without a result — the
   * one place the narrow read counts results itself), so a narrow read that
   * dropped or misread any of them disagrees here, on any database. Whatever
   * else the database holds is swept too.
   */
  const SHAPES: { label: string; event: Record<string, unknown>; rounds: { type: string; format: string }[]; result?: boolean }[] = [
    { label: "draft", event: { status: "draft" }, rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }] },
    { label: "live", event: { status: "live" }, rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }] },
    { label: "completed", event: { status: "completed" }, rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }] },
    { label: "live, legacy unlock", event: { status: "live", configUnlocked: true }, rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }] },
    {
      label: "live, correction open on the rounds",
      event: { status: "live", correctionScope: "rounds", correctionReason: "Round 1 set wrongly", correctionBy: `${TAG} admin`, correctionUntil: new Date(Date.now() + 60 * 60 * 1000) },
      rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
    },
    {
      label: "live, correction lapsed",
      event: { status: "live", correctionScope: "rounds", correctionReason: "Yesterday's correction", correctionBy: `${TAG} admin`, correctionUntil: new Date(Date.now() - 60 * 1000) },
      rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }],
    },
    { label: "draft, draw confirmed", event: { status: "draft", flightsConfirmed: true }, rounds: [{ type: "Stroke Play Round", format: "Stroke Play" }] },
    { label: "live Stableford", event: { status: "live" }, rounds: [{ type: "Stroke Play Round", format: "Stableford" }] },
    { label: "live knockout, one bracket", event: { status: "live", bracketMode: "single" }, rounds: [{ type: "Bracket Stage", format: "Match Play" }], result: true },
    { label: "live knockout in flights, no result", event: { status: "live", bracketMode: "flights" }, rounds: [{ type: "Bracket Stage", format: "Match Play" }] },
    { label: "live knockout in flights, a result", event: { status: "live", bracketMode: "flights" }, rounds: [{ type: "Bracket Stage", format: "Match Play" }], result: true },
    { label: "completed knockout in flights", event: { status: "completed", bracketMode: "flights" }, rounds: [{ type: "Bracket Stage", format: "Match Play" }], result: true },
  ];

  it("lockFactsFor + locksFor equals locksFor(lockFactsOf(setupSideFacts)), on its own tournaments of every lock shape and on every other one here", async () => {
    const { organizationId } = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { organizationId: true } });
    const seeded: { label: string; id: string }[] = [];
    for (const [i, s] of SHAPES.entries()) {
      const ev = await prisma.event.create({
        data: { name: `${TAG} sweep ${s.label}`, organizationId, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${TAG}-sweep-${i}`.toLowerCase(), ...s.event },
        select: { id: true },
      });
      for (const [position, r] of s.rounds.entries()) {
        await prisma.stage.create({ data: { eventId: ev.id, position, type: r.type, format: r.format, holes: 18 } });
      }
      if (s.result) {
        const p = await prisma.player.create({
          data: { eventId: ev.id, name: `${TAG} sweep player ${i}`, email: `${TAG.toLowerCase()}-sweep-${i}@example.invalid`, seed: 1, status: "confirmed", handicap: 5 },
          select: { id: true },
        });
        await prisma.bracketWinner.create({ data: { eventId: ev.id, key: "winners-0-0", winnerId: p.id } });
      }
      seeded.push({ label: s.label, id: ev.id });
    }

    const answer = async (id: string) => {
      const [narrow, full] = await Promise.all([lockFactsFor(id), setupSideFactsFor(id)]);
      return narrow && full ? { narrow: locksFor(narrow), full: locksFor(lockFactsOf(full)) } : null;
    };

    const seen = new Map<string, string>();
    for (const { label, id } of seeded) {
      const a = await answer(id);
      expect(a, `${label}: not read at all`).not.toBeNull();
      expect(a!.narrow, `${label}: the narrow read locks differently`).toEqual(a!.full);
      seen.set(label, JSON.stringify(a!.full));
    }

    // THE CONTROL: the fixtures are not alike, so an equality over them is not an equality over one answer.
    // Seven answers, worked from `locksOf` by hand: nothing locked (draft, the legacy unlock); the live blanket
    // (live, the lapsed correction, Stableford, the one-bracket knockout); completed (both completed shapes);
    // the blanket with the rounds open (the correction); the confirmed draw; and the flighted knockout's draw
    // open, then shut by its result.
    expect(new Set(seen.values()).size, "the fixtures all lock alike — the sweep cannot tell a wrong read").toBe(7);
    expect(seen.get("live knockout in flights, a result"), "a result must shut a flighted knockout's draw").not.toBe(seen.get("live knockout in flights, no result"));
    expect(seen.get("live, correction open on the rounds"), "an open correction must open its scope").not.toBe(seen.get("live, correction lapsed"));

    // And every other tournament in this database, as far as the newest 150.
    const ours = new Set([eventId, ...seeded.map((s) => s.id)]);
    const others = await prisma.event.findMany({ where: { id: { notIn: [...ours] } }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 150 });
    for (const { id } of others) {
      const a = await answer(id);
      if (a) expect(a.narrow, `tournament ${id}: the narrow read locks differently`).toEqual(a.full);
    }
  });
});
