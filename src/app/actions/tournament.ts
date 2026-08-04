"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, setActiveEvent, createSession, destroySession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { regenerateGroupsAndSchedule } from "@/lib/services/regroup";
import { roundRobinStages, chainRoundStandings, scoringFrom } from "@/lib/services/tournament";
import { marginToHoles, resolveMatch, roundRobinSchedule, TIEBREAKER_KEYS } from "@/lib/domain";
import type { FormationRule, HoleResult } from "@/lib/domain";
import { FORMAT_NAMES } from "@/lib/formats";
import { findCourse } from "@/lib/courses";

async function requireEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  return session.eventId;
}

/** Primary Organizer only (admin) — critical config and access control. */
async function requireAdminEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin") throw new Error("Organizer access required");
  return session.eventId;
}

/** Organizer or Assistant Organizer — operational tasks. */
async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  return session.eventId;
}

/** Block structural changes once the tournament is live/completed, unless unlocked. */
async function assertUnlocked(eventId: string): Promise<void> {
  const e = await prisma.event.findUnique({
    where: { id: eventId },
    select: { status: true, configUnlocked: true },
  });
  if (e && (e.status === "live" || e.status === "completed") && !e.configUnlocked) {
    throw new Error("Configuration is locked. Unlock the tournament to make structural changes.");
  }
}

function refresh() {
  revalidatePath("/", "layout");
}

/* ── Registration ─────────────────────────────────────────────────────── */

export interface SignupInput {
  name: string;
  handicap: number;
  email?: string;
  phone?: string;
  ghin?: string;
  homeClub?: string;
  handicapSource?: string;
}

export async function addSignup(input: SignupInput) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const clean = input.name.trim();
  if (!clean) return;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  const confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const maxSeed = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  const unlimited = event.capacity <= 0; // 0 = open / unlimited field
  const status = unlimited || confirmedCount < event.capacity ? "confirmed" : "waitlisted";
  await prisma.player.create({
    data: {
      eventId,
      name: clean,
      handicap: Number.isFinite(input.handicap) ? input.handicap : 0,
      seed: (maxSeed._max.seed ?? 0) + 1,
      status,
      email: (input.email ?? "").trim(),
      phone: (input.phone ?? "").trim(),
      ghin: (input.ghin ?? "").trim(),
      homeClub: (input.homeClub ?? "").trim(),
      handicapSource: ["ghin", "manual", "none"].includes(input.handicapSource ?? "")
        ? input.handicapSource!
        : "manual",
    },
  });
  refresh();
}

export async function removeSignup(playerId: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.eventId !== eventId) return;
  await prisma.player.delete({ where: { id: playerId } });
  // Promote the earliest waitlisted signup if a confirmed spot opened.
  if (player.status === "confirmed") {
    const next = await prisma.player.findFirst({
      where: { eventId, status: "waitlisted" },
      orderBy: { seed: "asc" },
    });
    if (next) await prisma.player.update({ where: { id: next.id }, data: { status: "confirmed" } });
  }
  refresh();
}

export async function importCsvSignups(csv: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  const rows = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(","))
    .filter((cols) => cols.length >= 2);

  let confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const agg = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  let seed = (agg._max.seed ?? 0) + 1;

  for (const [rawName, rawHcp] of rows) {
    const name = rawName.trim();
    const handicap = parseFloat(rawHcp);
    // Skip a header row like "name,handicap".
    if (!name || /^name$/i.test(name)) continue;
    const status = confirmedCount < event.capacity ? "confirmed" : "waitlisted";
    if (status === "confirmed") confirmedCount += 1;
    await prisma.player.create({
      data: {
        eventId,
        name,
        handicap: Number.isFinite(handicap) ? handicap : 0,
        seed: seed++,
        status,
      },
    });
  }
  refresh();
}

export async function setInviteMessage(message: string) {
  const eventId = await requireStaffEvent();
  await prisma.event.update({ where: { id: eventId }, data: { inviteMessage: message } });
  refresh();
}

/* ── Event setup ──────────────────────────────────────────────────────── */

export async function saveEvent(data: {
  name: string;
  dates: string;
  format: string;
  course: string;
  city: string;
  address: string;
  regDeadline: string;
  capacity: number;
  playerCountMode: string;
}) {
  const eventId = await requireAdminEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: {
      name: data.name,
      dates: data.dates,
      format: data.format === "stroke" ? "stroke" : "match",
      course: data.course,
      city: data.city,
      address: data.address,
      regDeadline: data.regDeadline,
      capacity: Math.max(1, Math.round(data.capacity)),
      playerCountMode: data.playerCountMode === "manual" ? "manual" : "registration",
    },
  });
  refresh();
}

export async function applyManualCount(target: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const t = Math.max(0, Math.round(target));
  const confirmed = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    orderBy: { seed: "asc" },
  });

  if (confirmed.length > t) {
    // Trim excess to the waitlist (highest seeds first).
    const excess = confirmed.slice(t);
    await prisma.player.updateMany({
      where: { id: { in: excess.map((p) => p.id) } },
      data: { status: "waitlisted" },
    });
  } else if (confirmed.length < t) {
    let need = t - confirmed.length;
    // Promote waitlist first.
    const wait = await prisma.player.findMany({
      where: { eventId, status: "waitlisted" },
      orderBy: { seed: "asc" },
      take: need,
    });
    if (wait.length) {
      await prisma.player.updateMany({
        where: { id: { in: wait.map((p) => p.id) } },
        data: { status: "confirmed" },
      });
      need -= wait.length;
    }
    // Then pad with placeholders.
    const agg = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
    let seed = (agg._max.seed ?? 0) + 1;
    for (let i = 0; i < need; i += 1) {
      await prisma.player.create({
        data: { eventId, name: `Player ${seed}`, handicap: 12, seed: seed, status: "confirmed" },
      });
      seed += 1;
    }
  }
  await prisma.event.update({
    where: { id: eventId },
    data: { playerCountMode: "manual", manualPlayerCount: t },
  });
  await regenerateGroupsAndSchedule(eventId);
  refresh();
}

/* ── Grouping ─────────────────────────────────────────────────────────── */

const FORMATION_RULES = ["balanced", "handicap", "seeding", "random", "manual"];
const FLIGHT_MODES = ["auto", "count", "perFlight"];

export async function regenGroups(rule: FormationRule, mode = "auto", value = 0) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: {
      formationRule: FORMATION_RULES.includes(rule) ? rule : "balanced",
      flightMode: FLIGHT_MODES.includes(mode) ? mode : "auto",
      flightValue: Math.max(0, Math.round(value)),
    },
  });
  await regenerateGroupsAndSchedule(eventId);
  refresh();
}

/**
 * Build the schedule for a single Round Robin stage that has a cut line
 * entering it — separate from the global "Generate flights" reset because it
 * depends on the PREVIOUS round's real results, which only exist once that
 * round has been played. Only that stage's matches are touched; every other
 * round's data and scores are left alone.
 */
export async function generateNextRound(stageId: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  const stage = await prisma.stage.findUnique({ where: { id: stageId } });
  if (!stage || stage.eventId !== eventId || stage.type !== "Round Robin") return;

  const [event, allStages, confirmed, allMatches, groups] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.player.findMany({ where: { eventId, status: "confirmed" }, orderBy: { seed: "asc" } }),
    prisma.match.findMany({ where: { eventId } }),
    prisma.group.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
  ]);
  if (!event) return;

  const rrStages = roundRobinStages(allStages);
  const idx = rrStages.findIndex((s) => s.id === stageId);
  if (idx <= 0) return; // first Round Robin stage has no predecessor to cut from — use Generate flights instead

  const domainPlayers = confirmed.map((p) => ({ id: p.id, name: p.name, handicap: p.handicap, seed: p.seed }));
  const scoring = scoringFrom(event);
  const holeDifficulty = findCourse(event.course).strokeIndex;
  const chain = chainRoundStandings(rrStages.slice(0, idx + 1), allMatches, domainPlayers, scoring, holeDifficulty);
  const priorStanding = chain[idx - 1];

  let survivorIds: Set<string>;
  if (stage.cutEnabled) {
    const n =
      stage.cutMode === "percent"
        ? Math.max(1, Math.ceil((confirmed.length * stage.cutPercent) / 100))
        : Math.max(1, Math.min(stage.cutCount, confirmed.length));
    survivorIds = new Set(priorStanding.slice(0, n).map((rp) => rp.player.id));
  } else {
    survivorIds = new Set(confirmed.map((p) => p.id));
  }

  const emptyHoles = JSON.stringify(new Array(stage.holes === 9 ? 9 : 18).fill(null));

  await prisma.$transaction(async (tx) => {
    await tx.match.deleteMany({ where: { eventId, stageId: stage.id } });
    for (const g of groups) {
      const groupPlayerIds = confirmed
        .filter((p) => p.groupId === g.id && survivorIds.has(p.id))
        .map((p) => p.id);
      const schedule = roundRobinSchedule(groupPlayerIds);
      for (const pairing of schedule) {
        await tx.match.create({
          data: {
            eventId,
            stageId: stage.id,
            groupId: g.id,
            round: pairing.round,
            playerAId: pairing.aId,
            playerBId: pairing.bId,
            holes: emptyHoles,
          },
        });
      }
    }
  });

  refresh();
}

/* ── Scoring rules ────────────────────────────────────────────────────── */

export async function saveScoring(data: {
  winPts: number;
  tiePts: number;
  lossPts: number;
  holeRatioPts: number;
  bonusPts: number;
}) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: {
      winPts: data.winPts,
      tiePts: data.tiePts,
      lossPts: data.lossPts,
      holeRatioPts: data.holeRatioPts,
      bonusPts: data.bonusPts,
    },
  });
  refresh();
}

export async function setQualifyPerGroup(n: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: { qualifyPerGroup: Math.min(3, Math.max(1, Math.round(n))) },
  });
  refresh();
}

/* ── Stages ───────────────────────────────────────────────────────────── */

export async function setStageDeadline(stageId: string, deadline: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({ where: { id: stageId, eventId }, data: { deadline } });
  refresh();
}

export async function setStageCarry(stageId: string, enabled: boolean, pct: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: {
      carryForwardEnabled: enabled,
      carryForwardPct: Math.min(100, Math.max(0, Math.round(pct / 5) * 5)),
    },
  });
  refresh();
}

export async function setStageCut(stageId: string, enabled: boolean, mode: string, count: number, percent: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: {
      cutEnabled: enabled,
      cutMode: mode === "percent" ? "percent" : "count",
      cutCount: Math.max(1, Math.round(count)),
      cutPercent: Math.min(100, Math.max(1, Math.round(percent))),
    },
  });
  refresh();
}

export async function setStageScoringBasis(stageId: string, basis: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const value = ["gross", "net", "both", "stableford"].includes(basis) ? basis : "gross";
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { scoringBasis: value },
  });
  refresh();
}

export async function setStageFormat(stageId: string, format: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const value = FORMAT_NAMES.includes(format) ? format : "Match Play";
  await prisma.stage.updateMany({ where: { id: stageId, eventId }, data: { format: value } });
  refresh();
}

export async function setStageHoles(stageId: string, holes: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { holes: holes === 9 ? 9 : 18 },
  });
  refresh();
}

/* ── Tiebreakers & qualification ──────────────────────────────────────── */

export async function saveTiebreakers(order: string[]) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const valid = order.filter((k) => (TIEBREAKER_KEYS as string[]).includes(k));
  await prisma.event.update({
    where: { id: eventId },
    data: { tiebreakers: JSON.stringify(valid.length ? valid : TIEBREAKER_KEYS) },
  });
  refresh();
}

export async function setQualifyMode(mode: string, overall: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: {
      qualifyMode: mode === "overall" ? "overall" : "perFlight",
      qualifyOverall: Math.max(1, Math.round(overall)),
    },
  });
  refresh();
}

const STAGE_TYPES = [
  "Round Robin",
  "Single Match Stage",
  "Qualification Stage",
  "Bracket Stage",
] as const;

const STAGE_DESCRIPTIONS: Record<string, string> = {
  "Round Robin": "Every player meets every other in their group.",
  "Single Match Stage": "A single seeding or play-in match.",
  "Qualification Stage": "Cut the field — top players per flight advance.",
  "Bracket Stage": "Single-elimination bracket to a champion.",
};

/** Returns the new stage's id so callers can act on it immediately (e.g. set a cut line before the page revalidates). */
export async function addStage(type: string): Promise<string | undefined> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const stageType = (STAGE_TYPES as readonly string[]).includes(type) ? type : "Round Robin";
  const agg = await prisma.stage.aggregate({ where: { eventId }, _max: { position: true } });
  const position = (agg._max.position ?? -1) + 1;
  const created = await prisma.stage.create({
    data: {
      eventId,
      position,
      type: stageType,
      description: STAGE_DESCRIPTIONS[stageType] ?? "",
      deadline: "",
      scoringBasis: "gross",
    },
  });
  refresh();
  return created.id;
}

export async function removeStage(stageId: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.deleteMany({ where: { id: stageId, eventId } });
  refresh();
}

/* ── Match score entry ────────────────────────────────────────────────── */

async function logAudit(eventId: string, matchId: string | null, action: string, detail: string) {
  const session = await getSession();
  await prisma.auditLog.create({
    data: { eventId, matchId, actor: session?.name ?? "system", action, detail },
  });
}

export async function saveMatchHoles(matchId: string, holes: HoleResult[]) {
  const eventId = await requireEvent();
  const complete = resolveMatch(holes).complete;
  // Any score edit resets the two-player confirmation to pending.
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: {
      holes: JSON.stringify(holes),
      scoreStatus: "pending",
      scoredAt: complete ? new Date() : null,
      confirmedById: null,
    },
  });
  refresh();
}

/** Existing hole count for a match, from its stored holes array (18 or 9 depending on the round). */
function matchHoleCount(holesJson: string): number {
  try {
    const parsed = JSON.parse(holesJson) as unknown[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.length : 18;
  } catch {
    return 18;
  }
}

export async function applyMatchResult(
  matchId: string,
  winner: "A" | "B" | "H",
  margin: string,
) {
  const eventId = await requireEvent();
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return;
  const holes = marginToHoles(winner, margin, matchHoleCount(match.holes));
  await prisma.match.update({
    where: { id: matchId },
    data: { holes: JSON.stringify(holes), scoreStatus: "pending", scoredAt: new Date(), confirmedById: null },
  });
  refresh();
}

export async function clearMatch(matchId: string) {
  const eventId = await requireEvent();
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return;
  const empty = new Array(matchHoleCount(match.holes)).fill(null);
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { holes: JSON.stringify(empty), scoreStatus: "pending", scoredAt: null, confirmedById: null },
  });
  refresh();
}

/* ── Stroke play ──────────────────────────────────────────────────────── */

export async function saveScorecard(stageId: string, playerId: string, strokes: (number | null)[]) {
  const eventId = await requireEvent();
  await prisma.scorecard.upsert({
    where: { stageId_playerId: { stageId, playerId } },
    update: { strokes: JSON.stringify(strokes) },
    create: { eventId, stageId, playerId, strokes: JSON.stringify(strokes) },
  });
  refresh();
}

/* ── Score confirmation ───────────────────────────────────────────────── */

export async function confirmMatch(matchId: string) {
  const eventId = await requireEvent();
  const session = await getSession();
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { scoreStatus: "confirmed", confirmedById: session?.accountId ?? null },
  });
  refresh();
}

export async function disputeMatch(matchId: string) {
  const eventId = await requireEvent();
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { scoreStatus: "disputed" },
  });
  await logAudit(eventId, matchId, "dispute", "Result disputed");
  refresh();
}

/** Organizer override: reopen a match for re-scoring; logged to the audit trail. */
export async function reopenMatch(matchId: string) {
  const eventId = await requireStaffEvent();
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { scoreStatus: "pending", scoredAt: new Date(), confirmedById: null },
  });
  await logAudit(eventId, matchId, "reopen", "Organizer reopened the scorecard");
  refresh();
}

/* ── Bracket ──────────────────────────────────────────────────────────── */

export async function setBracketWinner(key: string, winnerId: string) {
  const eventId = await requireStaffEvent();
  const existing = await prisma.bracketWinner.findFirst({ where: { eventId, key } });
  if (existing?.winnerId === winnerId) {
    // Toggle off if the same slot is clicked again.
    await prisma.bracketWinner.delete({ where: { id: existing.id } });
  } else if (existing) {
    await prisma.bracketWinner.update({ where: { id: existing.id }, data: { winnerId } });
  } else {
    await prisma.bracketWinner.create({ data: { eventId, key, winnerId } });
  }
  refresh();
}

export async function setBracketResult(key: string, result: string) {
  const eventId = await requireStaffEvent();
  await prisma.bracketWinner.updateMany({
    where: { eventId, key },
    data: { result: result.slice(0, 12) },
  });
  refresh();
}

/* ── Access control ───────────────────────────────────────────────────── */

export async function addAccount(name: string, email: string, role: string) {
  const eventId = await requireAdminEvent();
  const clean = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!clean || !cleanEmail) return;
  await prisma.account.upsert({
    where: { eventId_email: { eventId, email: cleanEmail } },
    update: { name: clean, role: cleanRole(role) },
    create: { eventId, name: clean, email: cleanEmail, role: cleanRole(role) },
  });
  refresh();
}

const ACCOUNT_ROLES = ["admin", "assistant", "player"];
const cleanRole = (role: string) => (ACCOUNT_ROLES.includes(role) ? role : "player");

export async function setAccountRole(accountId: string, role: string) {
  const eventId = await requireAdminEvent();
  await prisma.account.updateMany({
    where: { id: accountId, eventId },
    data: { role: cleanRole(role) },
  });
  refresh();
}

export async function removeAccount(accountId: string) {
  const eventId = await requireAdminEvent();
  await prisma.account.deleteMany({ where: { id: accountId, eventId } });
  refresh();
}

/* ── Multiple tournaments ─────────────────────────────────────────────── */

/** Switch which tournament the organizer is managing (events they belong to). */
export async function switchEvent(eventId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const acct = await prisma.account.findFirst({ where: { eventId, email: session.email } });
  if (!acct) throw new Error("You don't have access to that tournament");
  await setActiveEvent(eventId);
  refresh();
}

/** Create a fresh tournament (owned by the current organizer) and switch to it. */
export async function createEvent(name: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const clean = name.trim() || "New Tournament";
  const event = await prisma.event.create({
    data: {
      name: clean,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0, // open field by default
      status: "draft",
    },
  });
  await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Round Robin",
      description: "",
      format: "Match Play",
      holes: 18,
      scoringBasis: "gross",
    },
  });
  await prisma.account.create({
    data: { eventId: event.id, name: session.name, email: session.email, role: "admin" },
  });
  await setActiveEvent(event.id);
  refresh();
}

/** Delete a tournament (primary Organizer only). Re-anchors the session so the
 *  organizer isn't stranded, then lands on a surviving tournament. */
export async function deleteEvent(eventId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const acct = await prisma.account.findFirst({
    where: { eventId, email: session.email, role: "admin" },
  });
  if (!acct) throw new Error("Only the organizer can delete a tournament");

  await prisma.event.delete({ where: { id: eventId } }); // cascades to all children

  // Anchor to the current event if it survived, else any remaining event of theirs.
  const current = await prisma.account.findFirst({
    where: { email: session.email, eventId: session.eventId },
  });
  const anchor =
    current ??
    (await prisma.account.findFirst({
      where: { email: session.email },
      orderBy: { event: { createdAt: "desc" } },
    }));

  if (!anchor) {
    await destroySession();
    redirect("/");
  }
  await createSession(anchor.id);
  await setActiveEvent(anchor.eventId);
  redirect("/dashboard");
}

/* ── Lifecycle ────────────────────────────────────────────────────────── */

const STATUS_FLOW = ["draft", "registration", "ready", "live", "completed"];

export async function setEventStatus(status: string) {
  const eventId = await requireAdminEvent();
  const s = STATUS_FLOW.includes(status) ? status : "draft";
  await prisma.event.update({ where: { id: eventId }, data: { status: s } });
  refresh();
}

export async function launchTournament() {
  const eventId = await requireAdminEvent();
  // On launch, every non-staff account receives the Player role. Once registration
  // collects player emails (Phase 4), this also provisions their logins.
  await prisma.account.updateMany({
    where: { eventId, role: { notIn: ["admin", "assistant"] } },
    data: { role: "player" },
  });
  await prisma.event.update({
    where: { id: eventId },
    data: { status: "live", launchedAt: new Date(), configUnlocked: false },
  });
  refresh();
}

export async function setConfigUnlocked(unlocked: boolean) {
  const eventId = await requireAdminEvent();
  await prisma.event.update({ where: { id: eventId }, data: { configUnlocked: unlocked } });
  refresh();
}

/* ── Prizes & payouts ─────────────────────────────────────────────────── */

export async function addPrize(category: string, amount: number, detail = "") {
  const eventId = await requireStaffEvent();
  const clean = category.trim();
  if (!clean) return;
  const agg = await prisma.prize.aggregate({ where: { eventId }, _max: { position: true } });
  await prisma.prize.create({
    data: {
      eventId,
      category: clean,
      detail: detail.trim(),
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
      position: (agg._max.position ?? 0) + 1,
    },
  });
  refresh();
}

export async function updatePrize(prizeId: string, data: { category?: string; detail?: string; amount?: number }) {
  const eventId = await requireStaffEvent();
  const patch: { category?: string; detail?: string; amount?: number } = {};
  if (data.category !== undefined) patch.category = data.category.trim();
  if (data.detail !== undefined) patch.detail = data.detail.trim();
  if (data.amount !== undefined) patch.amount = Number.isFinite(data.amount) && data.amount > 0 ? data.amount : 0;
  await prisma.prize.updateMany({ where: { id: prizeId, eventId }, data: patch });
  refresh();
}

export async function setPrizeWinner(prizeId: string, winnerId: string) {
  const eventId = await requireStaffEvent();
  await prisma.prize.updateMany({
    where: { id: prizeId, eventId },
    data: { winnerId: winnerId || null },
  });
  refresh();
}

export async function removePrize(prizeId: string) {
  const eventId = await requireStaffEvent();
  await prisma.prize.deleteMany({ where: { id: prizeId, eventId } });
  refresh();
}

/* ── Announcements (player communications) ────────────────────────────── */

export async function addAnnouncement(title: string, body: string, pinned = false) {
  const eventId = await requireStaffEvent();
  const clean = title.trim();
  if (!clean) return;
  await prisma.announcement.create({
    data: { eventId, title: clean, body: body.trim(), pinned },
  });
  refresh();
}

export async function toggleAnnouncementPin(announcementId: string, pinned: boolean) {
  const eventId = await requireStaffEvent();
  await prisma.announcement.updateMany({ where: { id: announcementId, eventId }, data: { pinned } });
  refresh();
}

export async function removeAnnouncement(announcementId: string) {
  const eventId = await requireStaffEvent();
  await prisma.announcement.deleteMany({ where: { id: announcementId, eventId } });
  refresh();
}
