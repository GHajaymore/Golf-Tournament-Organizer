"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession, setActiveEvent, createSession, destroySession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { regenerateGroupsAndSchedule, generateCutRound, repairPlayerPairings, scoredMatchCount } from "@/lib/services/regroup";
import { settingsOf, effectiveScoreStatus } from "@/lib/services/tournament";
import {
  canEnterScores,
  canPlayerSavePartial,
  allowsAutoConfirm,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import type { Session } from "@/lib/auth";
import { organizationForNewEvent, settingsForNewEvent } from "@/lib/services/organization";
import { effectiveAccess } from "@/lib/services/access";
import { refusalFor } from "@/lib/services/limits";
import { generateShareToken } from "@/lib/codes";
import { templateFor, DEFAULT_TEMPLATE_KEY } from "@/lib/tournament-templates";
import { cleanSideStyle, defaultFormatFor } from "@/lib/side-style";
import { cleanIsoDate, roundDates } from "@/lib/domain/round-dates";
import { reviewCards, isCardLocked, statusAfterEdit, LOCKED_CARD_REFUSAL } from "@/lib/domain/card-approval";
import { cleanStrokes } from "@/lib/domain/score-payload";
import { shapeOf, shapeOption } from "@/lib/tournament-shape";
import { syncPlayerAccount, revokePlayerAccount } from "@/lib/services/player-access";
import { splitCsvLine, matchColumn } from "@/lib/csv";
import { STAGE_DESCRIPTIONS, isStageType, generatesPairings, MAX_ROUNDS_AT_ONCE } from "@/lib/stage-types";
import { cleanMatchTiebreakers, OFFERED_MATCH_TIEBREAKS } from "@/lib/domain/match-tiebreak";
import { isCutScope } from "@/lib/domain/cut";
import { isStrokeShape, type ScoreImportShape } from "@/lib/domain/score-import";
import { upsertMember, organizationIdForEvent } from "@/lib/services/roster";
import { placementOnApproval } from "@/lib/domain/registration-intake";
import {
  marginToHoles,
  resolveMatch,
  deriveNetHoles,
  TIEBREAKER_KEYS,
  isBracketMode,
  courseHandicapMap,
  playingHandicapFrom,
  holeStrokesReceived,
  allocationHoles,
} from "@/lib/domain";
import type { FormationRule, HoleResult } from "@/lib/domain";
import { effectiveAllowance } from "@/lib/services/teams";
import { FORMAT_NAMES } from "@/lib/formats";
import { resolveCourse } from "@/lib/courses";
import { applyNine, cleanNine } from "@/lib/services/course-resolution";
import { findFormat, isPlayable } from "@/lib/formats";
import { aggregateTeamCard, singleBallTeamCard, teamMatchHoles } from "@/lib/domain/team";
import { sidePlayingHandicap, effectiveCountBest } from "@/lib/services/teams";

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

/**
 * The Player rows this signed-in person is, in this event.
 *
 * A console session knows an email, not a Player id — the link is the email
 * on the registration. Case-insensitive because sign-in lowercases and CSV
 * imports arrive however the spreadsheet had them.
 */
async function ownPlayerIds(eventId: string, email: string): Promise<Set<string>> {
  const rows = await prisma.player.findMany({
    where: { eventId, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * A player may write scores for their own match and nobody else's.
 *
 * requireScoreEntry answers "may this role enter scores at all"; it never
 * asked "for whom". With the answer missing, any signed-in player could
 * overwrite any match or any card in the event — the round-code path had
 * this check from day one, and the console path did not. Staff pass through
 * untouched: entering the whole field's cards is their job.
 *
 * Membership means being on one of the match's sides — the player columns in
 * an individual format, team membership in a team format. Same scoring-group
 * rule as domain/attest.ts and savePlayMatchHoles.
 */
async function assertOwnMatch(session: Session, eventId: string, matchId: string): Promise<void> {
  if (session.role !== "player") return;
  const match = await prisma.match.findFirst({ where: { id: matchId, eventId } });
  if (!match) throw new Error("Match not found.");
  const own = await ownPlayerIds(eventId, session.email);
  if (own.has(match.playerAId) || own.has(match.playerBId)) return;
  const teamIds = [match.teamAId, match.teamBId].filter((id) => id !== "");
  if (teamIds.length) {
    const member = await prisma.teamMember.findFirst({
      where: { teamId: { in: teamIds }, playerId: { in: [...own] } },
      select: { id: true },
    });
    if (member) return;
  }
  throw new Error("You can only enter scores for your own match.");
}

/** Same rule for a stroke card: your own, or you are staff. */
async function assertOwnCard(session: Session, eventId: string, playerId: string): Promise<void> {
  if (session.role !== "player") return;
  const own = await ownPlayerIds(eventId, session.email);
  if (!own.has(playerId)) throw new Error("You can only enter your own scorecard.");
}

/**
 * The row this id names must belong to the tournament the caller is in.
 *
 * `assertOwnMatch`/`assertOwnCard` answer "whose score is this" and only bind
 * players. They say nothing about which *tournament* an id came from, so on
 * their own they leave a write keyed on a caller-supplied id pointing wherever
 * the caller likes. These two close that half: an id is an attacker-chosen row
 * until something narrows it to this event.
 */
async function assertEventStage(eventId: string, stageId: string): Promise<void> {
  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { id: true } });
  if (!stage) throw new Error("That round isn't in this tournament.");
}

async function assertEventPlayer(eventId: string, playerId: string): Promise<void> {
  const player = await prisma.player.findFirst({ where: { id: playerId, eventId }, select: { id: true } });
  if (!player) throw new Error("That player isn't in this tournament.");
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

/* CSV parsing lives in src/lib/csv.ts, shared with the roster importer. The
   two have different rules about what a row must contain, but they must
   agree on what a column is — a club whose spreadsheet says "Hcp Index"
   should not be understood by one screen and rejected by the other. */

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
  courseMode: string;
  sideStyle: string;
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
      // Only ever the two known values — an unrecognised mode would decide
      // whether every match asks where it was played.
      courseMode: data.courseMode === "open" ? "open" : "fixed",
      regDeadline: data.regDeadline,
      // 0 is the deliberate "open / unlimited field" sentinel (see the Fixed/Open
      // toggle in EventSetupClient) — only clamp upward when the organizer has
      // actually set a positive fixed capacity, otherwise every save was
      // silently converting "open" into "capacity 1" the moment anyone hit Save.
      capacity: data.capacity <= 0 ? 0 : Math.max(1, Math.round(data.capacity)),
      playerCountMode: data.playerCountMode === "manual" ? "manual" : "registration",
      // Narrowed to the known set rather than trusted: this comes off a public
      // server action, and an unrecognised value would sit in the database
      // deciding which format new rounds start on.
      sideStyle: cleanSideStyle(data.sideStyle),
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
export interface MovePlayerResult {
  ok: boolean;
  error?: string;
  /** Set when matches already exist for the flights involved. */
  needsConfirm?: boolean;
  scoredMatches?: number;
}

/**
 * Move one player into a different flight.
 *
 * The manual formation rule chunks the roster into flights and, until now,
 * that was the end of it — an organizer who wanted Ferris in Flight 2 had to
 * reorder the roster and regenerate, which reshuffles everyone else too. This
 * is the missing half: manual has to mean manual.
 *
 * Refuses once scores exist unless forced. Flights decide who plays whom, so
 * moving someone after a match has been returned changes what that result was
 * a result *of* — recoverable, but never silently.
 */
export async function movePlayerToGroup(
  playerId: string,
  groupId: string,
  force = false,
): Promise<MovePlayerResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  // Both ends scoped to the caller's tournament. Either one unscoped would let
  // an organizer of any event move a stranger's player into a stranger's
  // flight by posting two ids.
  const [player, group] = await Promise.all([
    prisma.player.findFirst({ where: { id: playerId, eventId }, select: { id: true, groupId: true } }),
    prisma.group.findFirst({ where: { id: groupId, eventId }, select: { id: true } }),
  ]);
  if (!player) return { ok: false, error: "Player not found in this tournament." };
  if (!group) return { ok: false, error: "Flight not found in this tournament." };
  if (player.groupId === groupId) return { ok: true };

  const scored = await scoredMatchCount(eventId);
  if (scored > 0 && !force) {
    return { ok: false, needsConfirm: true, scoredMatches: scored };
  }

  await prisma.player.update({ where: { id: playerId }, data: { groupId } });
  // The flight decides who they play. Without this the move changed a foreign
  // key and nothing else: the player kept a full card of matches against their
  // old flight and had none against their new one, and the standings showed
  // them under a flight they had never played anybody in.
  await repairPlayerPairings(eventId, playerId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function regenGroups(
  rule: FormationRule,
  mode = "auto",
  value = 0,
  force = false,
): Promise<RegenResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  // Refused, not quietly rewritten.
  //
  // These used to fall back to "balanced" and "auto" for anything they didn't
  // recognise. The organizer pressed Generate flights with Manual selected,
  // the screen came back saying Balanced, and nothing anywhere said why — the
  // exact shape of the standing "manual flights reset to Auto" report. A
  // silent coercion here can only ever turn a caller's mistake into a
  // tournament drawn under a rule nobody chose, so it says so instead.
  if (!FORMATION_RULES.includes(rule)) {
    return { ok: false, error: `"${rule}" isn't a formation rule this tournament can use.` };
  }
  if (!FLIGHT_MODES.includes(mode)) {
    return { ok: false, error: `"${mode}" isn't a flight-size setting this tournament can use.` };
  }

  const scored = await scoredMatchCount(eventId);
  if (scored > 0 && !force) {
    return { ok: false, needsConfirm: true, scoredMatches: scored };
  }

  await prisma.event.update({
    where: { id: eventId },
    data: {
      formationRule: rule,
      flightMode: mode,
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
  await generateCutRound(eventId, stageId);
  refresh();
}

/* ── Scoring rules ────────────────────────────────────────────────────── */

export async function saveScoring(data: {
  winPts: number;
  tiePts: number;
  lossPts: number;
  holeRatioPts: number;
  bonusPts: number;
  maxPerMatch: number;
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
      maxPerMatch: data.maxPerMatch,
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

/**
 * Move one round to a different day.
 *
 * The rain-out. A league night gets called off and the committee replays it a
 * fortnight later; nothing about the other weeks changes, and nothing about
 * the scores already entered changes either — this is a date, not a reset.
 *
 * Empty clears the date back to "no fixed day". Anything unparseable is
 * treated as empty rather than stored, so a bad value can never render as a
 * confidently wrong date on every player's phone.
 */
export async function setStagePlayedOn(stageId: string, date: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { playedOn: cleanIsoDate(date) },
  });
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
      // Touching the control at all counts as answering, including turning it
      // off — "no, rounds start fresh" is a decision, and the prompt should
      // not keep asking someone who has made it.
      carryForwardAsked: true,
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

/* Stage types live in src/lib/stage-types.ts, shared with the picker. Two
   lists describing the same thing drift: a type offered in the UI but absent
   from the validator here silently becomes a Round Robin on save. */

/** Returns the new stage's id so callers can act on it immediately (e.g. set a cut line before the page revalidates). */
/**
 * The most weeks one click may create.
 *
 * A season, generously. High enough that no real league is refused, low enough
 * that a mistyped number cannot fill a tournament with hundreds of rounds
 * somebody then has to delete one at a time.
 */
/**
 * Add one round, or a run of them.
 *
 * `count` exists because a weekly league is not built one round at a time. A
 * ten-week season meant ten clicks and then ten format changes, each of which
 * is a chance to set one week differently from the rest by accident.
 *
 * Every round is created identically. Changing any one of them afterwards is
 * the ordinary per-round edit, which is the point: same format by default,
 * overridable individually.
 */
export interface AddStageOptions {
  count?: number;
  /** Applies to every round created. Ignored if the app cannot run it. */
  format?: string;
  holes?: number;
  /** ISO date for the first round; the rest follow at `intervalDays`. */
  startDate?: string;
  intervalDays?: number;
}

export async function addStage(
  type: string,
  countOrOpts: number | AddStageOptions = 1,
): Promise<string | undefined> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const stageType = isStageType(type) ? type : "Round Robin";
  const opts: AddStageOptions =
    typeof countOrOpts === "number" ? { count: countOrOpts } : countOrOpts;
  // Clamped, not trusted: this is a public server action and the numbers come
  // off a form.
  const howMany = Math.min(MAX_ROUNDS_AT_ONCE, Math.max(1, Math.round(Number(opts.count) || 1)));
  const agg = await prisma.stage.aggregate({ where: { eventId }, _max: { position: true } });
  const position = (agg._max.position ?? -1) + 1;
  // What the organizer said at setup about how people play. A starting point
  // they can see and change on the round card — not a decision taken behind
  // them, which is why defaultFormatFor returns the most ordinary format for
  // the shape rather than anything clever.
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { sideStyle: true, format: true },
  });
  const style = cleanSideStyle(ev?.sideStyle);
  const scoring = ev?.format === "stroke" ? "stroke" : "match";
  const common = {
      eventId,
      type: stageType,
      description: STAGE_DESCRIPTIONS[stageType] ?? "",
      deadline: "",
      scoringBasis: "gross",
      // The schema's default is Match Play, which is a contradiction on a
      // round the scheduler draws no opponents for: "Add stroke play round"
      // produced a medal round labelled Match Play, and score entry opened it
      // in match mode with nothing to enter. The format is still the
      // organizer's to change — this is only a default that isn't nonsense.
      //
      // A round that draws pairings keeps the scoring the event chose; one
      // that does not takes whatever "how do people play" implies, which is
      // how a society day now opens on Scramble instead of on a medal the
      // organizer would have had to notice and change.
      format: generatesPairings(stageType)
        ? scoring === "stroke"
          ? "Stroke Play"
          : "Match Play"
        : defaultFormatFor(style, scoring),
  };

  // A format chosen in the create step applies to every round in the run —
  // that is the point of choosing it there rather than on N cards afterwards.
  // Only honoured when the app can actually run it, so a stale or hand-crafted
  // value cannot create rounds with nowhere to enter a card.
  if (opts.format && isPlayable(opts.format)) common.format = opts.format;
  const holes = Number(opts.holes);
  if (holes === 9 || holes === 18) (common as { holes?: number }).holes = holes;

  // Dates for the run. An unparseable start date yields no dates rather than a
  // wrong one — see cleanIsoDate.
  const start = cleanIsoDate(opts.startDate);
  const dates = start
    ? roundDates(start, howMany, Number(opts.intervalDays) || 0)
    : [];

  // Created one at a time rather than with createMany so the first round's id
  // can be returned — the screen scrolls to and opens the round it just made,
  // and losing that would make adding a round feel like nothing happened.
  let firstId: string | undefined;
  for (let i = 0; i < howMany; i += 1) {
    const created = await prisma.stage.create({
      data: { ...common, position: position + i, playedOn: dates[i] ?? "" },
    });
    if (i === 0) firstId = created.id;
  }

  refresh();
  return firstId;
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
  await assertOwnMatch(session, eventId, matchId);
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
      // A real result supersedes a forfeit. Without this, an organizer who
      // forfeited against the wrong name and then entered the true card would
      // see the card on screen and the forfeit in the standings — the entered
      // result silently discarded.
      forfeitedBy: "",
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
  const { eventId, session } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, matchId);
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return;
  // A margin has to describe a result that can happen. "2&3" — up two with
  // three to play — is not a closed-out match; typed in as-is it reconstructs
  // a card the standings read as still in progress, forever. The importer has
  // refused these since it existed; the console path took them silently.
  const total = matchHoleCount(match.holes);
  const amp = /^(\d+)\s*&\s*(\d+)$/.exec(margin.trim().toUpperCase());
  if (amp) {
    const lead = parseInt(amp[1], 10);
    const toPlay = parseInt(amp[2], 10);
    if (lead <= toPlay) {
      throw new Error(`"${margin}" isn't a possible result — ${lead} up with ${toPlay} to play isn't a closed-out match. Did you mean "${toPlay}&${lead}"?`);
    }
    if (lead > total) throw new Error(`"${margin}" can't happen over ${total} holes.`);
  }
  const holes = marginToHoles(winner, margin, total);
  await prisma.match.update({
    where: { id: matchId },
    data: { holes: JSON.stringify(holes), forfeitedBy: "", scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "", enteredBy: session.name },
  });
  refresh();
}

/**
 * Record a match as forfeited, or take a forfeit back.
 *
 * Covers the three ways a match ends without being played out: a player
 * concedes it (Rule 3.2b(1)), a player does not appear, or a player withdraws.
 * None of these could be recorded at all — the organizer's only options were to
 * invent a scoreline, which then decided the flight on fictional holes, or to
 * leave the match Live forever, which kept it out of the standings entirely.
 *
 * Pass an empty `forfeitedBy` to undo. The holes are left exactly as they were
 * in both directions: a player who walked in after nine holes has those nine
 * on the card, and if the organizer entered the forfeit against the wrong name
 * the correction restores the real position rather than a blank.
 *
 * Staff only. A player conceding a match tells the organizer, who records it —
 * the same rule the rest of the app follows for anything that decides a
 * result, and the reason there is no self-service path here.
 */
export async function forfeitMatch(matchId: string, forfeitedBy: string) {
  /**
   * Admin only, and audited — because UNDOING a forfeit is a reopen.
   *
   * The first cut of this took staff and wrote `scoreStatus: "pending"`,
   * `confirmedById: null` and `confirmedBy: ""` on BOTH paths. That made
   * `forfeitMatch(id, "")` an unaudited assistant-accessible `reopenMatch`:
   * it stripped a player's sign-off from a confirmed match and left no trace
   * of who did it. `reopenMatch` is deliberately admin-only and logged, with
   * the note that "an assistant reversing that quietly would hollow the
   * guarantee out" — and this handed the same power to a lower role through a
   * different door.
   */
  const eventId = await requireAdminEvent();
  const session = await getSession();
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return { ok: false, error: "That match isn't in this tournament." };

  // Only one of the two sides can forfeit, and only a side actually in this
  // match. An unchecked id here would decide a match in favour of somebody who
  // never played in it. Checked on the undo path too: an empty string is the
  // only value that may name nobody.
  const sides = [match.playerAId, match.playerBId, match.teamAId, match.teamBId].filter(Boolean);
  if (forfeitedBy && !sides.includes(forfeitedBy)) {
    return { ok: false, error: "That player isn't in this match." };
  }
  if (forfeitedBy && match.forfeitedBy === forfeitedBy) return { ok: true };

  await prisma.match.update({
    where: { id: matchId },
    data: {
      forfeitedBy,
      // Recording a forfeit settles the match, so it is scored and dated like
      // any other result. UNDOING one restores the card's own state rather
      // than wiping it: the confirmation columns are left exactly as they
      // were, because a forfeit entered against the wrong name and corrected a
      // minute later must not cost a player the sign-off they gave.
      ...(forfeitedBy
        ? { scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "", enteredBy: session?.name ?? "" }
        : {}),
    },
  });
  await logAudit(
    eventId,
    matchId,
    forfeitedBy ? "match.forfeit" : "match.forfeit.undo",
    forfeitedBy ? `Forfeited by ${forfeitedBy}` : `Forfeit removed (was ${match.forfeitedBy || "none"})`,
  );
  refresh();
  return { ok: true };
}

/**
 * Blank a match back to no result.
 *
 * A CONFIRMED result has to be reopened first, by someone who may reopen it.
 * This wrote the confirmation columns with no check that there was a
 * confirmation to write over, which made it the quiet way around `reopenMatch`
 * — organizer-only and logged precisely because undoing a sign-off is the one
 * thing an assistant reversing quietly would hollow out. Clearing does
 * strictly more than reopening: a player who lost 5&2 could erase the result
 * AND their opponent's sign-off together, leaving nothing on any screen to say
 * the match had ever been played. Same door, one step further in, no lock.
 *
 * The status is the EFFECTIVE one. A match left pending for a day in a
 * player-approval event is auto-confirmed — the column still reads "pending",
 * and reading the column is how the guard would have been true and useless.
 */
export async function clearMatch(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const { eventId, session, settings } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, matchId);
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return { ok: false, error: "That match isn't in this tournament." };

  const status = effectiveScoreStatus(match, allowsAutoConfirm(settings));
  if (status === "confirmed" || status === "auto-confirmed") {
    return {
      ok: false,
      error: "That result has been confirmed. An organizer has to reopen it before it can be cleared.",
    };
  }

  const empty = new Array(matchHoleCount(match.holes)).fill(null);
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    // Clearing a match clears the forfeit too: "no result" has to mean no
    // result, or a cleared match would keep paying out a win nobody can see.
    data: { holes: JSON.stringify(empty), forfeitedBy: "", scoreStatus: "pending", scoredAt: null, confirmedById: null },
  });
  // Erasing a card is not a smaller act than entering one, and every other
  // path that ends a result — forfeit, reopen, confirm, dispute — has left a
  // row since it was written.
  await logAudit(eventId, matchId, "match.clear", "Score cleared");
  refresh();
  return { ok: true };
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
  // Both ids, not just the player's. The upsert below is keyed on
  // (stageId, playerId) — the `eventId` in its `create` branch decorates a new
  // row and constrains nothing — so an unscoped pair let a staff member of any
  // tournament overwrite another club's card outright. assertOwnCard doesn't
  // catch it: it returns immediately for staff, and for a player it only
  // checks the playerId, leaving the round free to point anywhere.
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);
  await assertOwnCard(session, eventId, playerId);

  // The card itself. The guards above answer "may this person write here";
  // this answers "is this a scorecard at all". The (number | null)[] on the
  // signature is erased at runtime, and these strokes are summed straight into
  // gross, net and Stableford totals — so an out-of-range value does not sit
  // in a column, it lands on the leaderboard.
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { holes: true } });
  const clean = cleanStrokes(strokes, stage?.holes === 9 ? 9 : 18);
  if (!clean) throw new Error("Those scores aren't valid. Reload the round and try again.");

  if (session.role === "player" && !canPlayerSavePartial(settings)) {
    const filled = clean.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < clean.length) throw new Error("Enter the full round, then submit it.");
  }

  // The card as already stored, which decides whether this write is allowed at
  // all. Scoped on eventId as well as the pair for the same reason the upsert
  // below needed assertEventStage/assertEventPlayer: the (stageId, playerId)
  // key is caller-supplied.
  //
  // Without this an approved card could be rewritten by the very person it
  // belongs to — a player in a self-scoring event overwriting an approved 82
  // with a 76, the row still reading `approvedBy: committee@club`, so the
  // approval vouched for numbers the committee never saw. Staff could do it
  // for anyone, `assertOwnCard` being a no-op for them. Correcting an approved
  // card goes back through `reopenScorecard`, which is organizer-only.
  const existing = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true, status: true },
  });
  if (existing && isCardLocked(existing.status)) throw new Error(LOCKED_CARD_REFUSAL);
  const reset = existing ? statusAfterEdit(existing.status) : null;

  await prisma.scorecard.upsert({
    where: { stageId_playerId: { stageId, playerId } },
    // New strokes retract a certification given for the old ones — the same
    // rule the match path applies, where any score edit drops the result back
    // to pending. certifyScorecard re-signs it a moment later on the one
    // screen that saves and certifies together, so the marker's own flow is
    // unaffected.
    update: {
      strokes: JSON.stringify(clean),
      ...(reset ? { status: reset, certifiedBy: "", certifiedAt: null } : {}),
    },
    create: { eventId, stageId, playerId, strokes: JSON.stringify(clean) },
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
  await assertOwnMatch(session, eventId, matchId);
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return;

  // `slot` is half the unique key this upserts on, and its "A" | "B" type is
  // erased at runtime — an unrecognised value would not overwrite a card, it
  // would create a third one that nothing reads and nothing cleans up.
  if (slot !== "A" && slot !== "B") throw new Error("Unknown side.");

  // The card, checked the same way the stroke path is: these numbers are
  // re-derived into the match result below, so a bad one does not sit in a
  // row — it decides who won the hole.
  const cardStage = await prisma.stage.findUnique({
    where: { id: match.stageId },
    select: { holes: true },
  });
  const clean = cleanStrokes(strokes, cardStage?.holes === 9 ? 9 : 18);
  if (!clean) throw new Error("Those scores aren't valid. Reload the round and try again.");

  if (session.role === "player" && !canPlayerSavePartial(settings)) {
    const filled = clean.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < clean.length) throw new Error("Enter the full round, then submit it.");
  }

  await prisma.matchScorecard.upsert({
    where: { matchId_slot: { matchId, slot } },
    update: { strokes: JSON.stringify(clean) },
    create: { eventId, matchId, slot, strokes: JSON.stringify(clean) },
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
  // Net match play allocates off Course Handicaps, not roster Indexes. Two
  // players on the same index but different tees are owed different strokes,
  // and deriveNetHoles works from the difference between them.
  const holeCount = stage?.holes === 9 ? 9 : 18;
  const netTees = await prisma.tee.findMany({
    where: { course: { events: { some: { eventId } } } },
    orderBy: [{ position: "asc" }],
  });
  const netRatings = new Map(
    netTees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  const netHcp = courseHandicapMap(
    [playerA, playerB].filter((x): x is NonNullable<typeof x> => !!x),
    netRatings,
    netTees[0]?.id ?? null,
    holeCount,
  );
  // The card the round is actually played on: the round's nine, with its
  // stroke indexes re-ranked 1..9. Passing the full eighteen allocated strokes
  // off the wrong holes AND sized the match at eighteen holes, so a nine-hole
  // match could never be closed out.
  const roundCard = applyNine(course, cleanNine(stage?.nine), holeCount);
  const holes = deriveNetHoles(
    strokesA,
    strokesB,
    netMode && playerA ? netHcp.get(playerA.id) ?? playerA.handicap : 0,
    netMode && playerB ? netHcp.get(playerB.id) ?? playerB.handicap : 0,
    roundCard.strokeIndex,
    holeCount,
  );
  const complete = resolveMatch(holes).complete;

  await prisma.match.update({
    where: { id: matchId },
    data: { holes: JSON.stringify(holes), forfeitedBy: "", scoreStatus: "pending", scoredAt: complete ? new Date() : null, confirmedById: null, confirmedBy: "", enteredBy: session.name },
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
  await assertOwnMatch(session, eventId, matchId);

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

  // Same boundary as the individual paths. A side's card is aggregated into
  // the team's score — best ball, combined, best N of four — so an
  // out-of-range stroke does not affect one player, it decides the side's
  // result and the match with it. `stage.holes` is already loaded above.
  const cleanCard = cleanStrokes(strokes, stage.holes === 9 ? 9 : 18);
  if (!cleanCard) {
    return { ok: false, error: "Those scores aren't valid. Reload the round and try again." };
  }

  if (session.role === "player" && !canPlayerSavePartial(settings)) {
    const filled = cleanCard.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < cleanCard.length) {
      return { ok: false, error: "Enter the full round, then submit it." };
    }
  }

  await prisma.teamScorecard.upsert({
    where: { stageId_matchId_teamId_playerId: { stageId, matchId, teamId, playerId } },
    update: { strokes: JSON.stringify(cleanCard) },
    create: { eventId, stageId, matchId, teamId, playerId, strokes: JSON.stringify(cleanCard) },
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
  // The round's own handicap settings, not just the format's defaults. This
  // used to score off `format.allowance` and an unoverridden side handicap,
  // which meant a committee that set its own allowance saw it honoured on the
  // leaderboard and ignored here — the same round settled two ways.
  const stage = await prisma.stage.findUnique({
    where: { id: match.stageId },
    select: { handicapAllowance: true, allowanceWeights: true, countBest: true },
  });
  const allowance = effectiveAllowance(formatName, stage?.handicapAllowance ?? 0);

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
      const hcp = sidePlayingHandicap(
        members.map((m) => m.player.handicap),
        formatName,
        stage?.handicapAllowance ?? 0,
        stage?.allowanceWeights,
      );
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
      allowance,
      effectiveCountBest(formatName, stage?.countBest ?? 0),
    );
  };

  const [a, b] = await Promise.all([sideCard(match.teamAId), sideCard(match.teamBId)]);
  const holes = teamMatchHoles(a, b);
  const complete = resolveMatch(holes).complete;

  await prisma.match.update({
    where: { id: match.id },
    data: {
      holes: JSON.stringify(holes),
      // A real result supersedes a forfeit. Without this, an organizer who
      // forfeited against the wrong name and then entered the true card would
      // see the card on screen and the forfeit in the standings — the entered
      // result silently discarded.
      forfeitedBy: "",
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
    data: { scoreStatus: "confirmed", confirmedById: session.accountId || null, confirmedBy: session.name },
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
    data: { scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "" },
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

const ACCOUNT_ROLES = ["admin", "assistant", "player"];
const cleanRole = (role: string) => (ACCOUNT_ROLES.includes(role) ? role : "player");

export async function addAccount(name: string, email: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const clean = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!clean || !cleanEmail) return { ok: false, error: "Enter a name and email." };
  const next = cleanRole(role);

  // Per-event organizer and assistant roles consume a staff seat too. Without
  // this the seat limit would be trivially bypassed by granting rights on each
  // event instead of at the club.
  if (next !== "player") {
    const orgId = await organizationIdForEvent(eventId);
    const refusal = orgId ? await refusalFor(orgId, "staffSeats") : null;
    if (refusal) return { ok: false, error: refusal };
  }

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

  // A copy is a new tournament and counts like one.
  const refusal = await refusalFor(source.organizationId, "activeEvents");
  if (refusal) return { ok: false, error: refusal };

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
export async function createEvent(
  name: string,
  templateKey?: string,
  shapeKey?: string,
  orgName?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const clean = name.trim() || "New Tournament";
  // The shape decides what the rest of setup is even about, so it is asked
  // alongside the name rather than buried in a settings screen later.
  const shape = shapeOf(shapeKey);
  const shapeStart = shapeOption(shape).openingRound;
  const template = templateKey ? templateFor(templateKey) : null;
  const templated = template && template.key !== DEFAULT_TEMPLATE_KEY ? template : null;
  // Every tournament belongs to a billing tenant; this creates the organizer's
  // organization on their first event, named after their club/society/company
  // when they said who runs it (else after them). An organizer who already owns
  // one keeps it — orgName never renames an existing organization.
  const organizationId = await organizationForNewEvent(session.email, session.name, orgName);
  // Plan limits bite only once billing is connected — see services/limits.ts.
  const refusal = await refusalFor(organizationId, "activeEvents");
  if (refusal) return { ok: false, error: refusal };
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
      shape,
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

  // A template can describe a whole sequence, not just an opening round —
  // a member-guest IS five nine-hole matches, and leaving four of them to be
  // built by hand is the assembly work that keeps clubs on what they know.
  // Without a template, the shape still decides the single opening round.
  const plannedRounds = templated?.rounds.length
    ? templated.rounds
    : [
        {
          type: shapeStart.type,
          format: shapeStart.format,
          holes: shapeStart.holes,
          scoringBasis: shapeStart.scoringBasis,
          description: "",
        },
      ];
  await prisma.stage.createMany({
    data: plannedRounds.map((r, position) => ({
      eventId: event.id,
      position,
      description: r.description ?? "",
      type: r.type,
      format: r.format,
      holes: r.holes,
      scoringBasis: r.scoringBasis,
    })),
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
  // Stamp the completion time, because on a free plan it starts the clock the
  // retention window runs on. Reopening a tournament clears it: a club that
  // un-completes an event has said the result isn't final, and the countdown
  // to deleting it should not keep running underneath them.
  await prisma.event.update({
    where: { id: eventId },
    data: { status: s, completedAt: s === "completed" ? new Date() : null },
  });
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

/**
 * Choose how the knockout is arranged.
 *
 * Organizer-only and blocked once the tournament is locked: changing the shape
 * of a bracket mid-event would redraw who plays whom, which is a rule change
 * rather than a setting.
 */
export async function setBracketMode(mode: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  await assertUnlocked(eventId);
  if (!isBracketMode(mode)) return { ok: false, error: "Unknown bracket arrangement." };
  await prisma.event.update({ where: { id: eventId }, data: { bracketMode: mode } });
  refresh();
  return { ok: true };
}

/* ── Manual flights: naming and sign-off ──────────────────────────────── */

/**
 * Rename a flight.
 *
 * `Group.name` has existed since the beginning and the screen ignored it,
 * rendering "Flight 1", "Flight 2" from the index. Clubs don't call them that:
 * they run an A Flight and a B Flight, or Championship and Handicap, or name
 * them after the four courses a society is playing.
 */
export async function renameGroup(groupId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const clean = name.trim().slice(0, 40);
  if (!clean) return { ok: false, error: "Give the flight a name." };

  const group = await prisma.group.findFirst({ where: { id: groupId, eventId }, select: { id: true } });
  if (!group) return { ok: false, error: "Flight not found in this tournament." };

  await prisma.group.update({ where: { id: groupId }, data: { name: clean } });
  refresh();
  return { ok: true };
}

/**
 * Sign off — or reopen — a hand-built draw.
 *
 * Only meaningful for the manual rule. The computed rules derive the whole
 * allocation from a policy and are regenerated on demand, so there is nothing
 * to confirm; a manual draw is finished work, and this is the point where it
 * stops being one stray drag away from changing.
 *
 * Reopening is deliberately just as easy. A lock an organizer cannot undo is a
 * lock they will route around by regenerating, which loses the draw entirely.
 */
export async function setFlightsConfirmed(confirmed: boolean): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { formationRule: true } });
  if (event?.formationRule !== "manual") {
    return { ok: false, error: "Only a manual draw is confirmed by hand — the other rules regenerate." };
  }
  await prisma.event.update({ where: { id: eventId }, data: { flightsConfirmed: confirmed } });
  refresh();
  return { ok: true };
}


/**
 * How an all-square match is decided.
 *
 * Stored as an ordered list rather than a single choice, because the countback
 * IS a sequence — last nine, then last six, then last three, then the last
 * hole — and a committee that has to justify a result will be quoting the
 * whole ladder, not one rung of it.
 */
export async function setMatchTiebreakers(keys: string[]): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  // Cleaned rather than trusted: this is a public endpoint, and an unknown key
  // reaching the engine would silently skip instead of failing loudly.
  const clean = cleanMatchTiebreakers(keys).filter((k) => OFFERED_MATCH_TIEBREAKS.includes(k));
  await prisma.event.update({
    where: { id: eventId },
    data: { matchTiebreakers: JSON.stringify(clean) },
  });
  refresh();
  return { ok: true };
}

/**
 * Close registration early, or keep it open past the deadline.
 *
 * `null` hands control back to the deadline. `true` closes now. `false` keeps
 * entries open after the date has passed — the common case, because a deadline
 * gets extended by a word at the bar long before anyone edits it in software.
 *
 * Note what this deliberately does NOT do: stop an organizer adding a player.
 * `addSignup` is staff-only and stays available whatever this says. Closing
 * registration is a statement about what members may do, and the organizer
 * adding a late entry by hand is the normal way a closed event still takes one.
 * When a self-service signup flow exists, it is this flag it should read.
 */
export async function setRegistrationOverride(
  override: boolean | null,
): Promise<{ ok: boolean; error?: string }> {
  // Deliberately no assertUnlocked, and the same reasoning as saveCustomCourse:
  // the lock exists to stop a live tournament being RESHAPED, and this changes
  // nothing about the field, the draw or the schedule — it decides whether the
  // door is open. Requiring it locked the organizer out of the one control that
  // stops entries at exactly the moment they need it: assertUnlocked throws for
  // status live|completed, so a running tournament kept taking public entries
  // and the only escape was unlocking the whole configuration of a live event.
  const eventId = await requireStaffEvent();
  await prisma.event.update({
    where: { id: eventId },
    data: { registrationOverride: override },
  });
  refresh();
  return { ok: true };
}

/* ── Open (self-service) registration ─────────────────────────────────────
 *
 * The switch, the mode, and the two actions that clear a pending queue. The
 * public sign-up flow (src/app/actions/register.ts) reads the state these set;
 * these are the organizer's side of the same feature and are staff-only.
 */

/**
 * Turn the public registration link on or off.
 *
 * Minting the token lazily — on first open, never before — is deliberate. Every
 * event that predates this feature has an empty token and no public page; only
 * an organizer choosing to open registration brings one into existence. The
 * token is then kept forever, so a link already shared keeps working across an
 * off/on cycle: closing registration must not silently invalidate a URL that's
 * already in fifty inboxes.
 */
export async function setRegistrationOpen(open: boolean): Promise<{ ok: boolean; error?: string }> {
  // No assertUnlocked, for the reason given on setRegistrationOverride: turning
  // the public link off is how an organizer stops entries, and a lock that
  // fires on `live` made that impossible precisely when it was needed.
  const eventId = await requireStaffEvent();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { registrationToken: true },
  });
  if (!event) return { ok: false, error: "Event not found." };
  const data: { registrationOpen: boolean; registrationToken?: string } = { registrationOpen: open };
  if (open && !event.registrationToken) data.registrationToken = generateShareToken();
  await prisma.event.update({ where: { id: eventId }, data });
  refresh();
  return { ok: true };
}

/** auto — fill to capacity, overflow to the waitlist. approve — every entry
 *  lands pending for the organizer. Anything else is coerced to auto rather
 *  than stored, since an unknown mode would decide where every entry goes. */
export async function setRegistrationApproval(mode: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: { registrationApproval: mode === "approve" ? "approve" : "auto" },
  });
  refresh();
  return { ok: true };
}

/**
 * Accept a pending self-service entry into the field.
 *
 * Placement is decided here, at accept time — confirmed if there's room, else
 * the waitlist — which is the whole reason approve mode holds entries as pending
 * rather than placing them on arrival. Scoped to the caller's event, and a no-op
 * on anything that isn't actually pending, so this can only ever move an entry
 * forward.
 */
export async function approveSignup(playerId: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const player = await prisma.player.findFirst({ where: { id: playerId, eventId } });
  if (!player) return { ok: false, error: "Entry not found." };
  if (player.status !== "pending") return { ok: true };
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { capacity: true } });
  const confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const status = placementOnApproval(event?.capacity ?? 0, confirmedCount);
  await prisma.player.update({ where: { id: playerId }, data: { status } });
  refresh();
  return { ok: true };
}

/** Whether a round's cut is taken across the field or within each flight. */
export async function setStageCutScope(stageId: string, scope: string): Promise<void> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { cutScope: isCutScope(scope) ? scope : "overall" },
  });
  refresh();
}

/**
 * Close a round early, or extend it past its deadline.
 *
 * The same rule as registration, and for the same reason: the completion
 * deadline was a label that enforced nothing, so a round could be "due
 * Saturday" and still accept a card on Wednesday with nothing to say so.
 */
export async function setStageDeadlineOverride(
  stageId: string,
  override: boolean | null,
): Promise<void> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { deadlineOverride: override },
  });
  refresh();
}

export interface ScoreImportOutcome {
  ok: boolean;
  written: number;
  error?: string;
  /** Rows the server itself refused, on top of anything the parser caught. */
  problems?: string[];
}

/**
 * Apply a parsed bulk import.
 *
 * The file was parsed and checked in the browser, but this is a `"use server"`
 * export — whatever arrives here is arbitrary caller input, so every row is
 * re-resolved against this event's own field and this round's own matches.
 * A row naming a player from another tournament, or a match from another
 * round, is dropped and reported rather than written.
 *
 * Staff only. Bulk-writing a field's scores is not something a player does,
 * whatever the tournament's score-entry setting says.
 */
export async function importScores(
  stageId: string,
  shape: string,
  rows: Array<{
    playerId?: string;
    strokes?: (number | null)[];
    aId?: string;
    bId?: string;
    holes?: HoleResult[];
    winner?: "A" | "B" | "H";
    margin?: string;
  }>,
): Promise<ScoreImportOutcome> {
  const eventId = await requireStaffEvent();
  // Whoever ran the import is who the field will ask about these scores.
  const importedBy = (await getSession())?.name ?? "";

  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId } });
  if (!stage) return { ok: false, written: 0, error: "That round isn't in this tournament." };

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, written: 0, error: "Nothing to import." };
  }
  // A field is hundreds at most; anything beyond this is not a tee sheet.
  if (rows.length > 1000) {
    return { ok: false, written: 0, error: "That file has too many rows to be a single round." };
  }

  const field = new Set(
    (await prisma.player.findMany({ where: { eventId, status: "confirmed" }, select: { id: true } })).map(
      (p) => p.id,
    ),
  );

  // Net cards are converted back to gross HERE, not in the browser: the
  // authoritative Playing Handicap depends on the round's allowance, the
  // player's tees and the holes being played, and the client knows none of
  // those. gross = net + shots received on that hole, so nothing is lost and
  // the card re-scores if the round's basis or allowance later changes.
  //
  // Refused rather than guessed when there is no stroke index: without one
  // there is nowhere to put the shots, and spreading them evenly would invent
  // a card nobody played.
  const isNet = shape === "net-strokes";
  let netHcp = new Map<string, number>();
  let netSi: number[] = [];
  if (isNet) {
    const [event, players, tees] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId } }),
      prisma.player.findMany({
        where: { eventId, status: "confirmed" },
        select: { id: true, handicap: true, handicapType: true, teeId: true },
      }),
      prisma.tee.findMany({
        // Scoped to this tournament's courses. Unscoped, this returned every
        // organization's tees, so a stray teeId resolved to another club's
        // rating — and the course handicap it produced was simply wrong.
        where: { course: { events: { some: { eventId } } } },
        orderBy: [{ position: "asc" }],
      }),
    ]);
    if (!event) return { ok: false, written: 0, error: "Tournament not found." };
    const holes = stage.holes === 9 ? 9 : 18;
    const teeRatings = new Map(
      tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
    );
    const ch = courseHandicapMap(players, teeRatings, tees[0]?.id ?? null, holes);
    const allowance = effectiveAllowance(stage.format, stage.handicapAllowance);
    netHcp = new Map([...ch].map(([id, v]) => [id, playingHandicapFrom(v, allowance)]));
    netSi = resolveCourse(event).strokeIndex.slice(0, holes);
    if (netSi.length === 0) {
      return {
        ok: false,
        written: 0,
        error:
          "This round has no stroke index, so net scores can't be converted back to gross. Add the course card first, or import gross scores.",
      };
    }
  }
  const matches = await prisma.match.findMany({
    where: { eventId, stageId },
    select: { id: true, playerAId: true, playerBId: true, holes: true },
  });

  const problems: string[] = [];
  let written = 0;

  for (const row of rows) {
    // Both stroke shapes, gross and net: they arrive as the same per-player
    // card and differ only in whether the shots get added back below. Testing
    // for the literal "strokes" here sent every net row down the match branch,
    // where it had no pairing to match and was rejected as "a match this round
    // doesn't have" — with the conversion above it built and never used.
    if (isStrokeShape(shape as ScoreImportShape)) {
      if (!row.playerId || !field.has(row.playerId)) {
        problems.push("A row named someone who isn't in this tournament's field.");
        continue;
      }
      // Coerced hole by hole, never stored as-given: this is a public endpoint
      // and the parser's checks ran in the caller's browser, which proves
      // nothing here. A stroke is an integer a golf hole can produce or null;
      // the card is capped at the sizes a card can be.
      const raw = (Array.isArray(row.strokes) ? row.strokes : [])
        .slice(0, 18)
        .map((v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 30 ? v : null));
      const strokes = isNet
        ? raw.map((v, i) =>
            v === null
              ? null
              : v + holeStrokesReceived(netHcp.get(row.playerId!) ?? 0, netSi[i] ?? 18, allocationHoles(netSi.length)),
          )
        : raw;
      await prisma.scorecard.upsert({
        where: { stageId_playerId: { stageId, playerId: row.playerId } },
        update: { strokes: JSON.stringify(strokes) },
        create: { eventId, stageId, playerId: row.playerId, strokes: JSON.stringify(strokes) },
      });
      written += 1;
      continue;
    }

    // Match shapes: the pairing has to be one this round actually has, in
    // either direction — a file listing B before A is still the same match.
    const found = matches.find(
      (m) =>
        (m.playerAId === row.aId && m.playerBId === row.bId) ||
        (m.playerAId === row.bId && m.playerBId === row.aId),
    );
    if (!found) {
      problems.push("A row described a match this round doesn't have.");
      continue;
    }
    // Flipped rows have their result flipped with them, or the winner lands
    // on the wrong player.
    const flipped = found.playerAId === row.bId;
    const flip = (r: HoleResult): HoleResult => (r === "A" ? "B" : r === "B" ? "A" : r);

    if (shape === "hole-results") {
      // Same rule as the strokes shape: a hole result is A, B, H or null, and
      // a card has at most eighteen of them — anything else from the caller is
      // dropped rather than stored.
      const holes = (Array.isArray(row.holes) ? row.holes : [])
        .slice(0, 18)
        .map((h) => (h === "A" || h === "B" || h === "H" ? (flipped ? flip(h) : h) : null));
      await prisma.match.updateMany({
        where: { id: found.id, eventId },
        data: { holes: JSON.stringify(holes), forfeitedBy: "", scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "", enteredBy: importedBy },
      });
      written += 1;
      continue;
    }

    if (shape === "match-results") {
      const w: "A" | "B" | "H" =
        row.winner === "A" || row.winner === "B"
          ? flipped
            ? row.winner === "A"
              ? "B"
              : "A"
            : row.winner
          : "H";
      // A match has no winner column — the result lives in holes[], and
      // marginToHoles is what the single-match screen already uses to turn
      // "3&2" into a card. Reusing it keeps an imported result and a typed one
      // identical downstream, rather than creating a second kind of result the
      // leaderboard has to know about.
      const synth = marginToHoles(w, row.margin ?? "", matchHoleCount(found.holes));
      await prisma.match.updateMany({
        where: { id: found.id, eventId },
        data: { holes: JSON.stringify(synth), scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "", enteredBy: importedBy },
      });
      written += 1;
      continue;
    }

    problems.push("Unknown import shape.");
  }

  refresh();
  return { ok: written > 0, written, problems: problems.length ? problems : undefined };
}

export interface ClearScoresOutcome {
  ok: boolean;
  cleared: number;
  error?: string;
}

/**
 * Clear scores for a round — one card, a selection, or the whole round.
 *
 * Deleting a score is not the same as deleting a player, and this only ever
 * touches the former: the scorecard rows and the match cards for one round.
 * Registrations, flights, pairings and tee times all survive, so a round can
 * be re-scored from scratch without rebuilding the draw.
 *
 * Match cards are blanked rather than deleted. The pairing is part of the
 * draw, not part of the score — removing the row would take the fixture with
 * it and leave the tee sheet pointing at a match that no longer exists.
 *
 * Staff only, and never on a locked event.
 */
export async function clearRoundScores(
  stageId: string,
  /** Empty = the whole round. Otherwise only these players' cards and any
   *  match they appear in. */
  playerIds: string[] = [],
): Promise<ClearScoresOutcome> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId } });
  if (!stage) return { ok: false, cleared: 0, error: "That round isn't in this tournament." };

  const scoped = playerIds.filter((id) => typeof id === "string" && id.length > 0);
  let cleared = 0;

  // ── Stroke cards ────────────────────────────────────────────────────────
  const cards = await prisma.scorecard.deleteMany({
    where: { eventId, stageId, ...(scoped.length ? { playerId: { in: scoped } } : {}) },
  });
  cleared += cards.count;

  // ── Match cards ─────────────────────────────────────────────────────────
  const matches = await prisma.match.findMany({
    where: {
      eventId,
      stageId,
      ...(scoped.length
        ? { OR: [{ playerAId: { in: scoped } }, { playerBId: { in: scoped } }] }
        : {}),
    },
    select: { id: true, holes: true },
  });

  for (const m of matches) {
    // Same hole count back, so the card keeps its shape — a nine-hole match
    // must not silently become eighteen empty holes.
    const empty = new Array(matchHoleCount(m.holes)).fill(null);
    await prisma.match.updateMany({
      where: { id: m.id, eventId },
      data: {
        holes: JSON.stringify(empty),
        scoreStatus: "pending",
        scoredAt: null,
        confirmedById: null,
      },
    });
    cleared += 1;
  }

  // Per-player gross cards behind a net match, which would otherwise re-derive
  // the result the moment anything recalculated.
  await prisma.matchScorecard.deleteMany({
    where: {
      match: { eventId, stageId },
      ...(scoped.length ? { playerId: { in: scoped } } : {}),
    },
  });

  refresh();
  return { ok: true, cleared };
}

/* ── Scorecard certification and approval ──────────────────────────────────
   Rule 3.3b in two steps: the marker and player certify the hole scores, then
   the committee accepts the card. Stroke play had neither until now — a card
   went from a text box to the leaderboard with nothing in between, which
   mattered far more once one person in a fourball could enter three other
   people's rounds. See lib/domain/card-approval.ts for what a blanket
   approval may and may not take. */

/**
 * The marker's step: these hole scores are right.
 *
 * Allowed to anyone who may enter this card — including the player, who under
 * the Rules certifies their own — so it follows requireScoreEntry and
 * assertOwnCard rather than staff-only. Certifying is not accepting; it makes
 * no result.
 */
export async function certifyScorecard(stageId: string, playerId: string) {
  const { eventId, session } = await requireScoreEntry();
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);
  await assertOwnCard(session, eventId, playerId);

  // Scoped on eventId as well as the pair: the (stageId, playerId) unique key
  // is caller-supplied, and without the event in the filter it would name a
  // row in any tournament. Same hole that saveScorecard had.
  const card = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true, status: true },
  });
  if (!card) throw new Error("There's no card to certify yet.");
  // An approved card is the committee's, not the marker's, to change. Shared
  // with saveScorecard and disputeScorecard so the three doors into this row
  // cannot drift apart again.
  if (isCardLocked(card.status)) throw new Error(LOCKED_CARD_REFUSAL);

  await prisma.scorecard.update({
    where: { id: card.id },
    data: { status: "certified", certifiedBy: session.email, certifiedAt: new Date() },
  });
  refresh();
  return { ok: true };
}

/**
 * Someone says this card is wrong. Never silently approved afterwards.
 *
 * Open to whoever may enter the card, like certification — flagging a card is
 * how a marker or a player raises a problem, and a flag blocks approval rather
 * than deciding anything. What it may NOT do is reach past an approval: this
 * had the same guards as `certifyScorecard` three lines above, minus the
 * approved-card check, so it was an unaudited `reopenScorecard` open to
 * anyone in the field — an assistant could take a whole round's accepted cards
 * back out of the results, and nothing recorded that they had.
 */
export async function disputeScorecard(stageId: string, playerId: string) {
  const { eventId, session } = await requireScoreEntry();
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);
  await assertOwnCard(session, eventId, playerId);

  const card = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true, status: true },
  });
  if (!card) throw new Error("There's no card to dispute yet.");
  if (isCardLocked(card.status)) throw new Error(LOCKED_CARD_REFUSAL);
  if (card.status === "disputed") return { ok: true };

  await prisma.scorecard.update({ where: { id: card.id }, data: { status: "disputed" } });
  // `logAudit` records who; the detail has to record which, because a card has
  // no matchId to hang the row on. The match-play counterpart has logged its
  // disputes since it existed and stroke play logged nothing at all — the
  // format where one person enters three other people's rounds.
  await logAudit(eventId, null, "card.dispute", `Card disputed — round ${stageId}, player ${playerId}`);
  refresh();
  return { ok: true };
}

/**
 * The committee's step, on one card. Staff only — this is the act that turns
 * strokes into a result.
 */
export async function approveScorecard(stageId: string, playerId: string) {
  const eventId = await requireStaffEvent();
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);

  const card = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true },
  });
  if (!card) throw new Error("There's no card to approve yet.");

  await prisma.scorecard.update({
    where: { id: card.id },
    data: { status: "approved", approvedBy: session.email, approvedAt: new Date() },
  });
  refresh();
  return { ok: true };
}

/**
 * Accept a whole round — but only the cards that are clean.
 *
 * The exception list is computed here rather than trusted from the caller.
 * A client that sent its own list of ids would be the rubber stamp this was
 * written to prevent: the one control that is supposed to be unable to sweep
 * a disputed or half-finished card would sweep whatever it was handed.
 *
 * Returns what it did and what it left, so the screen can say so.
 */
export async function approveRound(stageId: string) {
  const eventId = await requireStaffEvent();
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  await assertEventStage(eventId, stageId);

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { holes: true },
  });
  const holes = stage?.holes === 9 ? 9 : 18;

  const rows = await prisma.scorecard.findMany({
    where: { eventId, stageId },
    select: { id: true, playerId: true, strokes: true, status: true },
  });
  const names = new Map(
    (
      await prisma.player.findMany({
        where: { eventId, id: { in: rows.map((r) => r.playerId) } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p.name]),
  );

  const review = reviewCards(
    rows.map((r) => {
      let strokes: (number | null)[] = [];
      try {
        strokes = JSON.parse(r.strokes) as (number | null)[];
      } catch {
        // Unparseable strokes cannot be complete, so this card lands in the
        // exception list rather than being approved on a technicality.
        strokes = [];
      }
      return {
        id: r.id,
        playerId: r.playerId,
        playerName: names.get(r.playerId) ?? "Unknown player",
        status: r.status,
        strokes,
        holes,
      };
    }),
  );

  if (review.ready.length) {
    await prisma.scorecard.updateMany({
      where: { id: { in: review.ready.map((c) => c.id) } },
      data: { status: "approved", approvedBy: session.email, approvedAt: new Date() },
    });
  }

  refresh();
  return {
    ok: true,
    approved: review.ready.length,
    exceptions: review.exceptions,
  };
}

/**
 * Put an approved card back for correction.
 *
 * Organizer only, and deliberately keeps approvedBy/approvedAt: "who signed
 * this off" has to survive the card changing, or the audit trail is only ever
 * as good as the last edit.
 */
export async function reopenScorecard(stageId: string, playerId: string) {
  const eventId = await requireAdminEvent();
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);

  const card = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true },
  });
  if (!card) throw new Error("There's no card to reopen.");

  await prisma.scorecard.update({ where: { id: card.id }, data: { status: "entered" } });
  refresh();
  return { ok: true };
}
