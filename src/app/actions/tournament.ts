"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, setActiveEvent, createSession, destroySession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { regenerateGroupsAndSchedule, scoredMatchCount } from "@/lib/services/regroup";
import { roundRobinStages, chainRoundStandings, scoringFrom, settingsOf } from "@/lib/services/tournament";
import {
  canEnterScores,
  canPlayerSavePartial,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import type { Session } from "@/lib/auth";
import { organizationForNewEvent, settingsForNewEvent } from "@/lib/services/organization";
import { effectiveAccess } from "@/lib/services/access";
import { generateShareToken } from "@/lib/codes";
import { templateFor, DEFAULT_TEMPLATE_KEY } from "@/lib/tournament-templates";
import { syncPlayerAccount, revokePlayerAccount } from "@/lib/services/player-access";
import { upsertMember, organizationIdForEvent } from "@/lib/services/roster";
import { marginToHoles, resolveMatch, deriveNetHoles, roundRobinSchedule, TIEBREAKER_KEYS } from "@/lib/domain";
import type { FormationRule, HoleResult } from "@/lib/domain";
import { FORMAT_NAMES } from "@/lib/formats";
import { resolveCourse } from "@/lib/courses";
import { findFormat } from "@/lib/formats";
import { aggregateTeamCard, singleBallTeamCard, teamMatchHoles } from "@/lib/domain/team";
import { sidePlayingHandicap } from "@/lib/services/teams";

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

/**
 * Score entry, gated on the tournament's own rules.
 *
 * Staff always pass. A player passes only where the organizer has allowed
 * self-reporting — and this is the check that matters, because hiding the
 * entry screen in the sidebar stops nobody from calling the action directly.
 */
async function requireScoreEntry(): Promise<{ eventId: string; session: Session; settings: TournamentSettings }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event) throw new Error("Event not found");
  const settings = settingsOf(event);
  if (!canEnterScores(settings, session.role)) {
    throw new Error("Scores for this tournament are entered by the organizer.");
  }
  return { eventId: session.eventId, session, settings };
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
  handicapType?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupResult {
  ok: boolean;
  error?: string;
}

export async function addSignup(input: SignupInput): Promise<SignupResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const clean = input.name.trim();
  if (!clean) return { ok: false, error: "Enter a player name." };
  const cleanEmail = (input.email ?? "").trim().toLowerCase();
  if (!cleanEmail) return { ok: false, error: "Email is required — it's how this player signs in." };
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, error: "Event not found." };
  const confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const maxSeed = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  const unlimited = event.capacity <= 0; // 0 = open / unlimited field
  const status = unlimited || confirmedCount < event.capacity ? "confirmed" : "waitlisted";
  // Entering someone in a tournament is also how they join the club roster —
  // so the club list is never a separate chore an organizer has to remember.
  const memberId = await upsertMember(event.organizationId, { ...input, name: clean, email: cleanEmail });
  await prisma.player.create({
    data: {
      eventId,
      memberId,
      name: clean,
      handicap: Number.isFinite(input.handicap) ? input.handicap : 0,
      seed: (maxSeed._max.seed ?? 0) + 1,
      status,
      email: cleanEmail,
      phone: (input.phone ?? "").trim(),
      ghin: (input.ghin ?? "").trim(),
      homeClub: (input.homeClub ?? "").trim(),
      handicapSource: ["ghin", "manual", "none"].includes(input.handicapSource ?? "")
        ? input.handicapSource!
        : "manual",
      handicapType: input.handicapType === "9" ? "9" : "18",
    },
  });
  await syncPlayerAccount(eventId, clean, cleanEmail);
  refresh();
  return { ok: true };
}

export interface SignupPatch {
  name?: string;
  handicap?: number;
  handicapType?: string;
  email?: string;
  phone?: string;
}

/** Edit an existing player's details in place — e.g. correcting a handicap after import. */
export async function updateSignup(playerId: string, patch: SignupPatch): Promise<SignupResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.eventId !== eventId) return { ok: false, error: "Player not found." };
  const data: Record<string, string | number> = {};
  if (patch.name !== undefined && patch.name.trim()) data.name = patch.name.trim();
  if (patch.handicap !== undefined && Number.isFinite(patch.handicap)) data.handicap = patch.handicap;
  if (patch.handicapType !== undefined) data.handicapType = patch.handicapType === "9" ? "9" : "18";
  const oldEmail = player.email.trim().toLowerCase();
  let emailChanged = false;
  if (patch.email !== undefined) {
    const cleanEmail = patch.email.trim().toLowerCase();
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };
    data.email = cleanEmail;
    emailChanged = cleanEmail !== oldEmail;
  }
  if (patch.phone !== undefined) data.phone = patch.phone.trim();
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.player.update({ where: { id: playerId }, data });

  // Correcting a detail here corrects it on the roster too — that's the point
  // of having one record per person. Re-resolving rather than updating the
  // linked member directly, because a changed email may now identify someone
  // else on the roster (or nobody, in which case they're added).
  const organizationId = await organizationIdForEvent(eventId);
  if (organizationId) {
    const memberId = await upsertMember(organizationId, {
      name: (data.name as string) ?? player.name,
      email: (data.email as string) ?? player.email,
      phone: (data.phone as string) ?? player.phone,
      ghin: player.ghin,
      homeClub: player.homeClub,
      handicap: (data.handicap as number) ?? player.handicap,
      handicapType: (data.handicapType as string) ?? player.handicapType,
      handicapSource: player.handicapSource,
    });
    if (memberId && memberId !== player.memberId) {
      await prisma.player.update({ where: { id: playerId }, data: { memberId } });
    }
  }

  if (emailChanged) {
    const newEmail = data.email as string;
    // The player's old email, if any, no longer belongs to them — revoke the
    // access it granted before (re-)syncing whatever the new one grants.
    if (oldEmail) await revokePlayerAccount(eventId, oldEmail);
    if (newEmail) await syncPlayerAccount(eventId, (data.name as string) ?? player.name, newEmail);
  }
  refresh();
  return { ok: true };
}

export async function removeSignup(playerId: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.eventId !== eventId) return;
  await prisma.player.delete({ where: { id: playerId } });
  if (player.email.trim()) await revokePlayerAccount(eventId, player.email);
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

/** Bulk delete — e.g. clearing a list before re-uploading a corrected CSV. */
export async function removeSignups(playerIds: string[]) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  for (const id of playerIds) {
    await removeSignup(id);
  }
}

const CSV_COLUMN_ALIASES: Record<string, string[]> = {
  name: ["name", "player", "player name", "full name"],
  handicap: ["handicap", "hcp", "handicap index", "index"],
  email: ["email", "e-mail", "email address"],
  phone: ["phone", "phone number", "mobile", "cell"],
  handicapType: ["handicap type", "9/18", "hcp type"],
};

function matchColumn(header: string): string | null {
  const h = header.trim().toLowerCase();
  for (const [field, aliases] of Object.entries(CSV_COLUMN_ALIASES)) {
    if (aliases.includes(h)) return field;
  }
  return null;
}

/** Simple CSV line split — handles quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export interface CsvImportResult {
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  error?: string;
}

export async function importCsvSignups(csv: string): Promise<CsvImportResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { imported: 0, skippedDuplicates: 0, skippedInvalid: 0, error: "Event not found." };

  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { imported: 0, skippedDuplicates: 0, skippedInvalid: 0, error: "The file is empty." };
  }

  const headerCols = splitCsvLine(lines[0]).map(matchColumn);
  const nameIdx = headerCols.indexOf("name");
  if (nameIdx === -1) {
    return {
      imported: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      error: 'Couldn\'t find a "name" column in the header row. Expected a header like: name, handicap, email, phone.',
    };
  }
  const hcpIdx = headerCols.indexOf("handicap");
  const emailIdx = headerCols.indexOf("email");
  if (emailIdx === -1) {
    return {
      imported: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      error: 'Couldn\'t find an "email" column in the header row — email is required so each player can sign in.',
    };
  }
  const phoneIdx = headerCols.indexOf("phone");
  const hcpTypeIdx = headerCols.indexOf("handicapType");

  const existing = await prisma.player.findMany({ where: { eventId }, select: { name: true, email: true } });
  const seenNames = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  const seenEmails = new Set(existing.map((p) => p.email.trim().toLowerCase()).filter(Boolean));

  let confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const unlimited = event.capacity <= 0;
  const agg = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  let seed = (agg._max.seed ?? 0) + 1;

  let imported = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const name = (cols[nameIdx] ?? "").trim();
    if (!name) {
      skippedInvalid += 1;
      continue;
    }
    const email = (cols[emailIdx] ?? "").trim();
    const emailKey = email.toLowerCase();
    if (!emailKey || !EMAIL_RE.test(emailKey)) {
      skippedInvalid += 1;
      continue;
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey) || seenEmails.has(emailKey)) {
      skippedDuplicates += 1;
      continue;
    }
    const handicap = hcpIdx >= 0 ? parseFloat(cols[hcpIdx] ?? "") : 0;
    const status = unlimited || confirmedCount < event.capacity ? "confirmed" : "waitlisted";
    if (status === "confirmed") confirmedCount += 1;
    const handicapType = hcpTypeIdx >= 0 && (cols[hcpTypeIdx] ?? "").trim() === "9" ? "9" : "18";
    const phone = phoneIdx >= 0 ? (cols[phoneIdx] ?? "").trim() : "";
    // Importing a field also builds the roster: a club that uploads its
    // spring CSV has its member list from then on, without a second import.
    const memberId = await upsertMember(event.organizationId, {
      name,
      email: emailKey,
      phone,
      handicap: Number.isFinite(handicap) ? handicap : 0,
      handicapType,
    });
    await prisma.player.create({
      data: {
        eventId,
        memberId,
        name,
        handicap: Number.isFinite(handicap) ? handicap : 0,
        seed: seed++,
        status,
        email: emailKey,
        phone,
        handicapType,
      },
    });
    await syncPlayerAccount(eventId, name, emailKey);
    seenNames.add(nameKey);
    seenEmails.add(emailKey);
    imported += 1;
  }

  refresh();
  return { imported, skippedDuplicates, skippedInvalid };
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
      // 0 is the deliberate "open / unlimited field" sentinel (see the Fixed/Open
      // toggle in EventSetupClient) — only clamp upward when the organizer has
      // actually set a positive fixed capacity, otherwise every save was
      // silently converting "open" into "capacity 1" the moment anyone hit Save.
      capacity: data.capacity <= 0 ? 0 : Math.max(1, Math.round(data.capacity)),
      playerCountMode: data.playerCountMode === "manual" ? "manual" : "registration",
    },
  });
  refresh();
}

export async function applyManualCount(target: number, force = false): Promise<RegenResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  // Resizing the field rebuilds the schedule, which discards scored matches
  // exactly as regenGroups does — same guard, for the same reason.
  const scored = await scoredMatchCount(eventId);
  if (scored > 0 && !force) {
    return { ok: false, needsConfirm: true, scoredMatches: scored };
  }

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
  if (scored > 0) {
    await logAudit(eventId, null, "resize-field", `Resized field to ${t}, discarding ${scored} scored matches`);
  }
  await regenerateGroupsAndSchedule(eventId);
  refresh();
  return { ok: true };
}

/* ── Grouping ─────────────────────────────────────────────────────────── */

const FORMATION_RULES = ["balanced", "handicap", "seeding", "random", "manual"];
const FLIGHT_MODES = ["auto", "count", "perFlight"];

export interface RegenResult {
  ok: boolean;
  /** Set when the call was refused because it would destroy real results.
   *  Call again with `force` to go ahead anyway. */
  needsConfirm?: boolean;
  scoredMatches?: number;
  error?: string;
}

/**
 * Rebuild flights and the round-robin schedule.
 *
 * This deletes every Round Robin match and recreates them, so on a tournament
 * that is part-played it destroys results. `assertUnlocked` does not catch
 * that: it keys off `Event.status`, which stays "draft" until someone presses
 * Launch — a tournament can be most of the way played and still be unlocked.
 *
 * So the guard is on scored matches, and the organizer has to confirm.
 */
export async function regenGroups(
  rule: FormationRule,
  mode = "auto",
  value = 0,
  force = false,
): Promise<RegenResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  const scored = await scoredMatchCount(eventId);
  if (scored > 0 && !force) {
    return { ok: false, needsConfirm: true, scoredMatches: scored };
  }

  await prisma.event.update({
    where: { id: eventId },
    data: {
      formationRule: FORMATION_RULES.includes(rule) ? rule : "balanced",
      flightMode: FLIGHT_MODES.includes(mode) ? mode : "auto",
      flightValue: Math.max(0, Math.round(value)),
    },
  });
  if (scored > 0) {
    await logAudit(eventId, null, "regenerate-flights", `Rebuilt flights, discarding ${scored} scored matches`);
  }
  await regenerateGroupsAndSchedule(eventId);
  refresh();
  return { ok: true };
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
  const holeDifficulty = resolveCourse(event).strokeIndex;
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
  const { eventId, session, settings } = await requireScoreEntry();
  const complete = resolveMatch(holes).complete;
  // Where the organizer wants finished cards only, a player can't dribble
  // holes onto the leaderboard as they play. Staff are never restricted this
  // way — they enter scores as groups come in.
  if (session.role === "player" && !complete && !canPlayerSavePartial(settings)) {
    throw new Error("Enter the full round, then submit it.");
  }
  // Any score edit resets confirmation to pending — including an organizer's,
  // so a correction always goes back through approval.
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
  const { eventId } = await requireScoreEntry();
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
  const { eventId } = await requireScoreEntry();
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

/**
 * Save the organizer's own hole-by-hole course data when the event's course
 * doesn't match a built-in preset — prompted from Score entry so scoring
 * math (par, net, stroke index) never silently runs against fake data.
 */
export async function saveCustomCourse(
  courseName: string,
  city: string,
  pars: number[],
  yards: number[],
  strokeIndex: number[],
) {
  // Deliberately no assertUnlocked: this supplies missing reference data
  // (par/yardage/stroke index) for scoring math, not a structural change to
  // the field/schedule — and the gap is most likely to surface exactly when
  // the event is already live and staff are trying to enter scores.
  const eventId = await requireStaffEvent();
  await prisma.event.update({
    where: { id: eventId },
    data: {
      course: courseName,
      city,
      customPars: JSON.stringify(pars),
      customYards: JSON.stringify(yards),
      customStrokeIndex: JSON.stringify(strokeIndex),
    },
  });
  refresh();
}

export async function saveScorecard(stageId: string, playerId: string, strokes: (number | null)[]) {
  const { eventId, session, settings } = await requireScoreEntry();
  if (session.role === "player" && !canPlayerSavePartial(settings)) {
    const filled = strokes.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < strokes.length) throw new Error("Enter the full round, then submit it.");
  }
  await prisma.scorecard.upsert({
    where: { stageId_playerId: { stageId, playerId } },
    update: { strokes: JSON.stringify(strokes) },
    create: { eventId, stageId, playerId, strokes: JSON.stringify(strokes) },
  });
  refresh();
}

/**
 * Net (handicap) match play: record one player's gross strokes-per-hole card
 * for the match, then re-derive the match's `holes[]` result from both
 * players' cards net of their handicap allowance. Everything downstream
 * (standings, leaderboard, bracket) keeps reading Match.holes unchanged.
 */
export async function saveMatchScorecard(matchId: string, slot: "A" | "B", strokes: (number | null)[]) {
  const { eventId, session, settings } = await requireScoreEntry();
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return;
  if (session.role === "player" && !canPlayerSavePartial(settings)) {
    const filled = strokes.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < strokes.length) throw new Error("Enter the full round, then submit it.");
  }

  await prisma.matchScorecard.upsert({
    where: { matchId_slot: { matchId, slot } },
    update: { strokes: JSON.stringify(strokes) },
    create: { eventId, matchId, slot, strokes: JSON.stringify(strokes) },
  });

  const [cardA, cardB, playerA, playerB, event, stage] = await Promise.all([
    prisma.matchScorecard.findUnique({ where: { matchId_slot: { matchId, slot: "A" } } }),
    prisma.matchScorecard.findUnique({ where: { matchId_slot: { matchId, slot: "B" } } }),
    prisma.player.findUnique({ where: { id: match.playerAId } }),
    prisma.player.findUnique({ where: { id: match.playerBId } }),
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.stage.findUnique({ where: { id: match.stageId } }),
  ]);
  const course = resolveCourse({
    course: event?.course ?? "",
    city: event?.city ?? "",
    customPars: event?.customPars ?? "",
    customYards: event?.customYards ?? "",
    customStrokeIndex: event?.customStrokeIndex ?? "",
  });
  // Handicap strokes only apply when the round is scored Net — a Gross round
  // uses the same card, decided scratch (lower strokes wins the hole).
  const netMode = stage?.scoringBasis === "net";
  const strokesA = cardA ? (JSON.parse(cardA.strokes) as (number | null)[]) : [];
  const strokesB = cardB ? (JSON.parse(cardB.strokes) as (number | null)[]) : [];
  const holes = deriveNetHoles(
    strokesA,
    strokesB,
    netMode ? playerA?.handicap ?? 0 : 0,
    netMode ? playerB?.handicap ?? 0 : 0,
    course.strokeIndex,
  );
  const complete = resolveMatch(holes).complete;

  await prisma.match.update({
    where: { id: matchId },
    data: { holes: JSON.stringify(holes), scoreStatus: "pending", scoredAt: complete ? new Date() : null, confirmedById: null },
  });
  refresh();
}

/**
 * Save a card for a team round.
 *
 * `playerId` decides which of the two shapes of team golf this is, and it is
 * not a free choice — it must agree with the format:
 *
 *   Empty  — the side plays one ball, so there is one card for the team
 *            (foursomes, alternate shot, scramble, Chapman).
 *   Set    — each partner keeps their own card and the side's score is derived
 *            per hole (four-ball, best ball, shamble).
 *
 * Sending the wrong one would produce a card the scoring engine then reads
 * with the other shape's rules, so the mismatch is rejected rather than
 * quietly stored.
 */
export async function saveTeamScorecard(
  teamId: string,
  playerId: string,
  matchId: string,
  strokes: (number | null)[],
): Promise<{ ok: boolean; error?: string }> {
  const { eventId, session, settings } = await requireScoreEntry();

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { members: { select: { playerId: true } }, stage: { select: { id: true, format: true } } },
  });
  if (!team || team.eventId !== eventId) return { ok: false, error: "Team not found." };

  // A team may be event-wide (stageId null), in which case the round comes
  // from the match being scored.
  let stageId = team.stageId;
  let match: { id: string; stageId: string; eventId: string; teamAId: string; teamBId: string } | null = null;
  if (matchId) {
    const m = await prisma.match.findUnique({ where: { id: matchId } });
    if (!m || m.eventId !== eventId) return { ok: false, error: "Match not found." };
    if (m.teamAId !== teamId && m.teamBId !== teamId) {
      return { ok: false, error: "That team is not in this match." };
    }
    match = m;
    stageId = m.stageId;
  }
  if (!stageId) return { ok: false, error: "This card has no round to belong to." };

  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { format: true, holes: true } });
  if (!stage) return { ok: false, error: "Round not found." };
  const format = findFormat(stage.format);

  // A player may only enter cards for a side they are actually on. Staff are
  // exempt — entering everyone's scores is the job in a committee-run event.
  //
  // Identity comes from the session email resolved to this event's Player row,
  // the same way confirmMatch does it: the session carries an account, not an
  // entry, and the two are only linked by email.
  const isStaff = session.role === "admin" || session.role === "assistant";
  let callerPlayerId = "";
  if (!isStaff) {
    const own = await prisma.player.findFirst({
      where: { eventId, email: session.email },
      select: { id: true },
    });
    if (!own || !team.members.some((m) => m.playerId === own.id)) {
      return { ok: false, error: "You're not on this team." };
    }
    callerPlayerId = own.id;
  }

  // The card shape must match the format, not the caller's choice.
  if (format.ball === "single" && playerId !== "") {
    return { ok: false, error: `${format.name} is played with one ball per side — one card, not one each.` };
  }
  if (format.ball === "individual" && playerId === "") {
    return { ok: false, error: `${format.name} needs a card for each partner.` };
  }
  if (playerId && !team.members.some((m) => m.playerId === playerId)) {
    return { ok: false, error: "That player is not on this team." };
  }
  // A player entering a partner's card is the same hole confirmMatch had: on a
  // side, but not this person. Shared-ball formats are exempt by construction,
  // since that card belongs to nobody in particular.
  if (!isStaff && playerId && playerId !== callerPlayerId) {
    return { ok: false, error: "You can only enter your own card." };
  }

  if (session.role === "player" && !canPlayerSavePartial(settings)) {
    const filled = strokes.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < strokes.length) {
      return { ok: false, error: "Enter the full round, then submit it." };
    }
  }

  await prisma.teamScorecard.upsert({
    where: { stageId_matchId_teamId_playerId: { stageId, matchId, teamId, playerId } },
    update: { strokes: JSON.stringify(strokes) },
    create: { eventId, stageId, matchId, teamId, playerId, strokes: JSON.stringify(strokes) },
  });

  // Team match play: recompute the match from both sides' cards, so the same
  // resolveMatch that decides singles decides this too.
  if (match) {
    await recomputeTeamMatch(eventId, match, stage.format, stage.holes === 9 ? 9 : 18);
  }

  refresh();
  return { ok: true };
}

/** Rebuild a team match's hole results from the two sides' cards. */
async function recomputeTeamMatch(
  eventId: string,
  match: { id: string; stageId: string; teamAId: string; teamBId: string },
  formatName: string,
  holeCount: number,
): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return;
  const course = resolveCourse(event);
  const format = findFormat(formatName);

  const sideCard = async (teamId: string) => {
    const [cards, members] = await Promise.all([
      prisma.teamScorecard.findMany({ where: { stageId: match.stageId, matchId: match.id, teamId } }),
      prisma.teamMember.findMany({
        where: { teamId },
        include: { player: { select: { id: true, handicap: true } } },
      }),
    ]);
    const parse = (s: string): (number | null)[] => {
      try {
        return JSON.parse(s) as (number | null)[];
      } catch {
        return [];
      }
    };
    if (format.ball === "single") {
      const one = cards.find((c) => c.playerId === "");
      const hcp = sidePlayingHandicap(members.map((m) => m.player.handicap), formatName);
      return singleBallTeamCard(one ? parse(one.strokes) : [], course.pars, hcp, course.strokeIndex);
    }
    return aggregateTeamCard(
      members.map((m) => ({
        playerId: m.playerId,
        strokes: parse(cards.find((c) => c.playerId === m.playerId)?.strokes ?? "[]"),
        courseHandicap: m.player.handicap,
      })),
      course.pars.slice(0, holeCount),
      course.strokeIndex.slice(0, holeCount),
      format.allowance,
    );
  };

  const [a, b] = await Promise.all([sideCard(match.teamAId), sideCard(match.teamBId)]);
  const holes = teamMatchHoles(a, b);
  const complete = resolveMatch(holes).complete;

  await prisma.match.update({
    where: { id: match.id },
    data: {
      holes: JSON.stringify(holes),
      scoreStatus: "pending",
      scoredAt: complete ? new Date() : null,
      confirmedById: null,
    },
  });
}

/* ── Score confirmation ───────────────────────────────────────────────── */

/**
 * Sign off a result.
 *
 * Who may do this depends on the tournament's approval setting:
 *   - `staff`   — organizers and assistants only.
 *   - `players` — either player *in that match*, or staff.
 *
 * Previously this only required a session, so any signed-in participant could
 * confirm any match in the event, including their own. Both the role and the
 * caller's presence in the specific match are now checked.
 */
export async function confirmMatch(matchId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const eventId = session.eventId;

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match || match.eventId !== eventId) return;

  const settings = settingsOf(event);
  const isStaff = session.role === "admin" || session.role === "assistant";

  if (!isStaff) {
    if (settings.scoreApproval === "staff") {
      throw new Error("An organizer approves scores for this tournament.");
    }
    // Player confirmation is peer review, and only of a match they played.
    const own = await prisma.player.findFirst({
      where: {
        eventId,
        email: session.email,
        id: { in: [match.playerAId, match.playerBId] },
      },
      select: { id: true },
    });
    if (!own) throw new Error("You can only confirm a match you played in.");
  }

  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { scoreStatus: "confirmed", confirmedById: session.accountId || null },
  });
  await logAudit(eventId, matchId, "confirm", isStaff ? "Approved by organizer" : "Confirmed by player");
  refresh();
}

/** Flag a result as wrong. Open to anyone in the event — a disputed score
 *  blocks confirmation rather than changing anything, so the permissive side
 *  is the safe one here. */
export async function disputeMatch(matchId: string) {
  const eventId = await requireEvent();
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { scoreStatus: "disputed" },
  });
  await logAudit(eventId, matchId, "dispute", "Result disputed");
  refresh();
}

/**
 * Organizer override: reopen a match for re-scoring; logged to the audit trail.
 *
 * Organizer-only, unlike the rest of score entry. This is the one action that
 * undoes an approval, and under staff sign-off the whole point is that an
 * organizer stands behind the number — an assistant reversing that quietly
 * would hollow the guarantee out.
 */
export async function reopenMatch(matchId: string) {
  const eventId = await requireAdminEvent();
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

export async function addAccount(name: string, email: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const clean = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!clean || !cleanEmail) return { ok: false, error: "Enter a name and email." };
  const next = cleanRole(role);

  // This upserts by email, so re-adding an existing admin with a different
  // role is a silent downgrade — guard it the same as setAccountRole.
  const existing = await prisma.account.findUnique({ where: { eventId_email: { eventId, email: cleanEmail } } });
  if (existing && existing.role === "admin" && next !== "admin" && !(await hasOtherAdmin(eventId, existing.id))) {
    return { ok: false, error: "This is the only Organizer on this event — promote someone else first." };
  }

  await prisma.account.upsert({
    where: { eventId_email: { eventId, email: cleanEmail } },
    update: { name: clean, role: next },
    create: { eventId, name: clean, email: cleanEmail, role: next },
  });
  refresh();
  return { ok: true };
}

const ACCOUNT_ROLES = ["admin", "assistant", "player"];
const cleanRole = (role: string) => (ACCOUNT_ROLES.includes(role) ? role : "player");

/** True once this event has more than one admin — i.e. `accountId` is safe
 *  to demote/remove without leaving the event with nobody who can manage it. */
async function hasOtherAdmin(eventId: string, accountId: string): Promise<boolean> {
  const otherAdmins = await prisma.account.count({
    where: { eventId, role: "admin", id: { not: accountId } },
  });
  return otherAdmins > 0;
}

export async function setAccountRole(accountId: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const next = cleanRole(role);
  const account = await prisma.account.findFirst({ where: { id: accountId, eventId } });
  if (!account) return { ok: false, error: "Account not found." };
  if (account.role === "admin" && next !== "admin" && !(await hasOtherAdmin(eventId, accountId))) {
    return { ok: false, error: "This is the only Organizer on this event — promote someone else first." };
  }
  await prisma.account.update({ where: { id: accountId }, data: { role: next } });
  refresh();
  return { ok: true };
}

export async function removeAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const account = await prisma.account.findFirst({ where: { id: accountId, eventId } });
  if (!account) return { ok: false, error: "Account not found." };
  if (account.role === "admin" && !(await hasOtherAdmin(eventId, accountId))) {
    return { ok: false, error: "This is the only Organizer on this event — promote someone else before removing them." };
  }
  await prisma.account.deleteMany({ where: { id: accountId, eventId } });
  refresh();
  return { ok: true };
}

/* ── Multiple tournaments ─────────────────────────────────────────────── */

/** Switch which tournament the organizer is managing (events they belong to). */
export async function switchEvent(eventId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  // Access can come from a per-event Account *or* from being an owner/admin of
  // the organization that runs the event. Checking Account alone locked club
  // admins out of their own club's tournaments — the events showed up in their
  // list and then refused to open.
  const access = await effectiveAccess(session.email, eventId);
  if (!access) throw new Error("You don't have access to that tournament");
  await setActiveEvent(eventId);
  refresh();
}

/**
 * Create a tournament by copying an existing one.
 *
 * Most tournaments are not new — they're this year's version of last year's,
 * and the organizer's own proven setup beats any preset someone else authored.
 *
 * Configuration only. Deliberately *not* copied:
 *
 *   - Players, matches, scorecards, prizes, announcements. A clone carrying
 *     last year's results would be a disaster, and one carrying last year's
 *     field would quietly enter people who never entered.
 *   - The share token. It is unique, so copying would collide — and it would
 *     hand this year's tournament last year's public link.
 *   - Round Codes. They are credentials; a new tournament gets new ones, and
 *     only if it turns code access on.
 */
export async function cloneEvent(sourceEventId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  // Organizer-level, and on the *source* event specifically — because the copy
  // lands in the source's organization, not the caller's own. Merely having
  // access is the wrong bar: effectiveAccess also returns a role for players,
  // so `if (!access)` would let anyone entered in a club's tournament create an
  // event inside that club and make themselves its organizer. Same rule as
  // deleteEvent: creating and destroying tournaments in a club's name is an
  // organizer act, not an assistant's.
  const access = await effectiveAccess(session.email, sourceEventId);
  if (access?.role !== "admin") {
    return { ok: false, error: "Only an organizer of that tournament can make a copy of it." };
  }

  const source = await prisma.event.findUnique({
    where: { id: sourceEventId },
    include: { stages: { orderBy: { position: "asc" } }, courses: true },
  });
  if (!source) return { ok: false, error: "Tournament not found." };

  const clean = name.trim() || `${source.name} (copy)`;

  const created = await prisma.event.create({
    data: {
      organizationId: source.organizationId,
      name: clean,
      // Dates and the registration deadline are the two things that are always
      // wrong on a copy, so they start empty rather than pointing at last year.
      dates: "",
      regDeadline: "",
      format: source.format,
      course: source.course,
      city: source.city,
      address: source.address,
      customPars: source.customPars,
      customYards: source.customYards,
      customStrokeIndex: source.customStrokeIndex,
      capacity: source.capacity,
      playerCountMode: source.playerCountMode,
      manualPlayerCount: source.manualPlayerCount,
      formationRule: source.formationRule,
      flightMode: source.flightMode,
      flightValue: source.flightValue,
      qualifyPerGroup: source.qualifyPerGroup,
      qualifyMode: source.qualifyMode,
      qualifyOverall: source.qualifyOverall,
      winPts: source.winPts,
      tiePts: source.tiePts,
      lossPts: source.lossPts,
      holeRatioPts: source.holeRatioPts,
      bonusPts: source.bonusPts,
      tiebreakers: source.tiebreakers,
      inviteMessage: source.inviteMessage,
      leaderboardVisibility: source.leaderboardVisibility,
      scoreEntryBy: source.scoreEntryBy,
      scoreEntryWindow: source.scoreEntryWindow,
      voiceEntry: source.voiceEntry,
      playerAccess: source.playerAccess,
      scoreApproval: source.scoreApproval,
      status: "draft",
      // A fresh token: unique index aside, the copy must not inherit the
      // original's public link.
      shareToken: generateShareToken(),
    },
  });

  // Venues carry over — a club plays the same courses year on year.
  for (const link of source.courses) {
    await prisma.eventCourse.create({ data: { eventId: created.id, courseId: link.courseId } });
  }

  // Rounds carry their shape, but never their Round Codes.
  for (const s of source.stages) {
    await prisma.stage.create({
      data: {
        eventId: created.id,
        position: s.position,
        type: s.type,
        description: s.description,
        format: s.format,
        holes: s.holes,
        deadline: "",
        scoringBasis: s.scoringBasis,
        carryForwardEnabled: s.carryForwardEnabled,
        carryForwardPct: s.carryForwardPct,
        cutEnabled: s.cutEnabled,
        cutMode: s.cutMode,
        cutCount: s.cutCount,
        cutPercent: s.cutPercent,
        courseId: s.courseId,
        nine: s.nine,
      },
    });
  }

  // The creator is the organizer of the copy.
  await prisma.account.create({
    data: { eventId: created.id, name: session.name, email: session.email, role: "admin" },
  });

  await setActiveEvent(created.id);
  refresh();
  return { ok: true };
}

/**
 * Create a fresh tournament (owned by the current organizer) and switch to it.
 *
 * `templateKey` is a starting point, never a lock — every setting it seeds
 * stays editable on Event setup, and nothing reads the key again afterwards.
 * An explicit template beats the club's house defaults, since picking one is a
 * deliberate act; "custom" and an absent key both leave the house defaults in
 * place.
 */
export async function createEvent(name: string, templateKey?: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const clean = name.trim() || "New Tournament";
  const template = templateKey ? templateFor(templateKey) : null;
  const templated = template && template.key !== DEFAULT_TEMPLATE_KEY ? template : null;
  // Every tournament belongs to a billing tenant; this creates the organizer's
  // personal organization on their first event.
  const organizationId = await organizationForNewEvent(session.email, session.name);
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: clean,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0, // open field by default
      status: "draft",
      // Start from the club's house defaults, then own them outright.
      ...(await settingsForNewEvent(organizationId)),
      ...(templated ? templated.settings : {}),
    },
  });
  // A club plays at its own course, so a new tournament starts there and
  // nobody is asked to pick a venue they were never going to change. Societies
  // and community organizations have no home course; they choose per event.
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { defaultCourseId: true },
  });
  if (org?.defaultCourseId) {
    await prisma.eventCourse.create({
      data: { eventId: event.id, courseId: org.defaultCourseId },
    });
  }

  await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      description: "",
      type: templated?.round.type ?? "Round Robin",
      format: templated?.round.format ?? "Match Play",
      holes: templated?.round.holes ?? 18,
      scoringBasis: templated?.round.scoringBasis ?? "gross",
    },
  });
  await prisma.account.create({
    data: { eventId: event.id, name: session.name, email: session.email, role: "admin" },
  });
  await setActiveEvent(event.id);
  refresh();
  return { ok: true };
}

/** Delete a tournament (primary Organizer only). Re-anchors the session so the
 *  organizer isn't stranded, then lands on a surviving tournament. */
export async function deleteEvent(eventId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  // Same rule as switchEvent, but admin-level only: an organization owner or
  // admin holds the same authority over their club's events as an organizer
  // named on the event itself.
  const access = await effectiveAccess(session.email, eventId);
  if (access?.role !== "admin") throw new Error("Only the organizer can delete a tournament");

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
