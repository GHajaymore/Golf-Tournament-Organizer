"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { regenerateGroupsAndSchedule } from "@/lib/services/regroup";
import { marginToHoles } from "@/lib/domain";
import type { FormationRule, HoleResult } from "@/lib/domain";

async function requireEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  return session.eventId;
}

async function requireAdminEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin") throw new Error("Organizer access required");
  return session.eventId;
}

function refresh() {
  revalidatePath("/", "layout");
}

/* ── Registration ─────────────────────────────────────────────────────── */

export async function addSignup(name: string, handicap: number) {
  const eventId = await requireAdminEvent();
  const clean = name.trim();
  if (!clean) return;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  const confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const maxSeed = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  const status = confirmedCount < event.capacity ? "confirmed" : "waitlisted";
  await prisma.player.create({
    data: {
      eventId,
      name: clean,
      handicap: Number.isFinite(handicap) ? handicap : 0,
      seed: (maxSeed._max.seed ?? 0) + 1,
      status,
    },
  });
  refresh();
}

export async function removeSignup(playerId: string) {
  const eventId = await requireAdminEvent();
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
  const eventId = await requireAdminEvent();
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
  const eventId = await requireAdminEvent();
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
  const eventId = await requireAdminEvent();
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
  const eventId = await requireAdminEvent();
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

/* ── Scoring rules ────────────────────────────────────────────────────── */

export async function saveScoring(data: {
  winPts: number;
  tiePts: number;
  lossPts: number;
  holeRatioPts: number;
  bonusPts: number;
}) {
  const eventId = await requireAdminEvent();
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
  const eventId = await requireAdminEvent();
  await prisma.event.update({
    where: { id: eventId },
    data: { qualifyPerGroup: Math.min(3, Math.max(1, Math.round(n))) },
  });
  refresh();
}

/* ── Stages ───────────────────────────────────────────────────────────── */

export async function setStageDeadline(stageId: string, deadline: string) {
  const eventId = await requireAdminEvent();
  await prisma.stage.updateMany({ where: { id: stageId, eventId }, data: { deadline } });
  refresh();
}

export async function setStageCarry(stageId: string, enabled: boolean, pct: number) {
  const eventId = await requireAdminEvent();
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: {
      carryForwardEnabled: enabled,
      carryForwardPct: Math.min(100, Math.max(0, Math.round(pct / 5) * 5)),
    },
  });
  refresh();
}

export async function setStageScoringBasis(stageId: string, basis: string) {
  const eventId = await requireAdminEvent();
  const value = ["gross", "net", "both"].includes(basis) ? basis : "gross";
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { scoringBasis: value },
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
  "Qualification Stage": "Cut the field — top players per group advance.",
  "Bracket Stage": "Single-elimination bracket to a champion.",
};

export async function addStage(type: string) {
  const eventId = await requireAdminEvent();
  const stageType = (STAGE_TYPES as readonly string[]).includes(type) ? type : "Round Robin";
  const agg = await prisma.stage.aggregate({ where: { eventId }, _max: { position: true } });
  const position = (agg._max.position ?? -1) + 1;
  await prisma.stage.create({
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
}

export async function removeStage(stageId: string) {
  const eventId = await requireAdminEvent();
  await prisma.stage.deleteMany({ where: { id: stageId, eventId } });
  refresh();
}

/* ── Match score entry ────────────────────────────────────────────────── */

export async function saveMatchHoles(matchId: string, holes: HoleResult[]) {
  const eventId = await requireEvent();
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { holes: JSON.stringify(holes) },
  });
  refresh();
}

export async function applyMatchResult(
  matchId: string,
  winner: "A" | "B" | "H",
  margin: string,
) {
  const eventId = await requireEvent();
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return;
  const holes = marginToHoles(winner, margin, 18);
  await prisma.match.update({ where: { id: matchId }, data: { holes: JSON.stringify(holes) } });
  refresh();
}

export async function clearMatch(matchId: string) {
  const eventId = await requireEvent();
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { holes: JSON.stringify(new Array(18).fill(null)) },
  });
  refresh();
}

/* ── Bracket ──────────────────────────────────────────────────────────── */

export async function setBracketWinner(key: string, winnerId: string) {
  const eventId = await requireAdminEvent();
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

/* ── Access control ───────────────────────────────────────────────────── */

export async function addAccount(name: string, email: string, role: string) {
  const eventId = await requireAdminEvent();
  const clean = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!clean || !cleanEmail) return;
  await prisma.account.upsert({
    where: { eventId_email: { eventId, email: cleanEmail } },
    update: { name: clean, role: role === "admin" ? "admin" : "player" },
    create: { eventId, name: clean, email: cleanEmail, role: role === "admin" ? "admin" : "player" },
  });
  refresh();
}

export async function setAccountRole(accountId: string, role: string) {
  const eventId = await requireAdminEvent();
  await prisma.account.updateMany({
    where: { id: accountId, eventId },
    data: { role: role === "admin" ? "admin" : "player" },
  });
  refresh();
}

export async function removeAccount(accountId: string) {
  const eventId = await requireAdminEvent();
  await prisma.account.deleteMany({ where: { id: accountId, eventId } });
  refresh();
}
