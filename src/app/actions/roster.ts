"use server";
import { teeMatcherFor } from "@/lib/services/handicaps";
import { revalidatePath } from "next/cache";
import { boardChanged } from "@/lib/services/board-refresh";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { syncPlayerAccount } from "@/lib/services/player-access";
import { upsertMember } from "@/lib/services/roster";
import { unlinkedPlayers } from "@/lib/domain/roster-link";
import { memberHandicapRecord, type MemberRecord } from "@/lib/services/handicap-record";
import { handicapPolicyOf, refuseHandByHand } from "@/lib/domain/handicap-policy";
import { championFor } from "@/lib/services/honours";
import { CHAMPION_REFUSAL } from "@/lib/domain/honours";
import { parseCsv, hasNameColumn, nameFrom, cell, splitCsvLine, splitCsvRecords } from "@/lib/csv";
import { parseHandicapInput, looksLikePhone } from "@/lib/domain/registration-intake";
import { planForEvent } from "@/lib/services/entitlements";
import { phoneRequiredFor } from "@/lib/plans";

/**
 * Club roster management.
 *
 * The roster belongs to the organization, not to any one tournament — but it's
 * reached through whichever event is currently open, so authorization follows
 * the same rule as registration: organizers and assistants of an event may
 * manage the roster of the club that owns it.
 */

export interface RosterResult {
  ok: boolean;
  error?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The club whose roster the current tournament draws from, for staff only. */
async function requireRosterOrg(): Promise<{ organizationId: string; eventId: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { organizationId: true },
  });
  if (!event) throw new Error("No organization found");
  return { organizationId: event.organizationId, eventId: session.eventId };
}

/**
 * Everything on this screen changed — and so did the public board.
 *
 * `revalidatePath` clears the router cache; it does NOT touch the per-event
 * board entry, which is an `unstable_cache` keyed and tagged separately.
 * Without this, a change here waits out the board's sixty-second backstop
 * before a spectator sees it.
 *
 * The event comes from the SESSION, because every action in this file
 * already operates on the caller's own tournament.
 */
async function refresh() {
  revalidatePath("/", "layout");
  const session = await getSession();
  if (session?.eventId) boardChanged(session.eventId);
}

export interface MemberInput {
  name: string;
  email?: string;
  phone?: string;
  ghin?: string;
  homeClub?: string;
  gender?: string;
  preferredTee?: string;
  memberNumber?: string;
  handicap?: number;
  handicapType?: string;
  handicapSource?: string;
  notes?: string;
}

/** Shared field cleaning, so add and edit can't drift apart. */
function cleanMemberData(input: MemberInput) {
  return {
    name: input.name.trim(),
    email: (input.email ?? "").trim().toLowerCase(),
    phone: (input.phone ?? "").trim(),
    ghin: (input.ghin ?? "").trim(),
    homeClub: (input.homeClub ?? "").trim(),
    gender: (input.gender ?? "").trim(),
    preferredTee: (input.preferredTee ?? "").trim(),
    memberNumber: (input.memberNumber ?? "").trim(),
    handicap: Number.isFinite(input.handicap) ? (input.handicap as number) : 0,
    handicapType: input.handicapType === "9" ? "9" : "18",
    handicapSource: ["ghin", "manual", "none"].includes(input.handicapSource ?? "")
      ? input.handicapSource!
      : "manual",
    notes: (input.notes ?? "").trim(),
  };
}

export async function addMember(input: MemberInput): Promise<RosterResult> {
  const { organizationId } = await requireRosterOrg();
  /**
   * A club that plays off GHIN does not type indexes.
   *
   * Enforced here rather than by disabling the input: the action is a public
   * HTTP endpoint and a greyed-out box stops nobody. Changing the GHIN NUMBER
   * stays allowed under this policy — that is how a member gets connected.
   */
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { handicapPolicy: true },
  });
  // NaN as the current figure, because a member being created has none: under
  // a GHIN policy any typed index at all is refused, rather than only one that
  // differs from something already on file.
  const refusal = refuseHandByHand(handicapPolicyOf(org?.handicapPolicy), input, {
    handicap: Number.NaN,
  });
  if (refusal) return { ok: false, error: refusal };

  const data = cleanMemberData(input);
  if (!data.name) return { ok: false, error: "Enter a name." };
  if (data.email && !EMAIL_RE.test(data.email)) return { ok: false, error: "Enter a valid email address." };

  if (data.email) {
    const clash = await prisma.member.findFirst({ where: { organizationId, email: data.email } });
    if (clash) return { ok: false, error: `${clash.name} is already on the roster with that email.` };
  }

  await prisma.member.create({ data: { ...data, organizationId } });
  await refresh();
  return { ok: true };
}

export interface MemberImportResult {
  imported: number;
  updated: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  /** Header cells we didn't recognise, so the organizer can see what was ignored. */
  unknownColumns: string[];
  error?: string;
}

/**
 * Build the roster from a club's own export.
 *
 * Deliberately more forgiving than the tournament entry import, because the
 * two answer different questions. An entry list needs an email — that is how
 * the player signs in. A roster is the club's record of its members, and
 * plenty of them have no email on file; refusing those rows would mean the
 * roster could never match the membership list it was copied from.
 *
 * Rows already on the roster are updated rather than skipped, so re-uploading
 * a corrected export is the natural way to bulk-edit handicaps — which is how
 * a club actually keeps this current, once a month when the new indexes land.
 * A row is "already on the roster" by email when it has one, and by name when
 * it doesn't; matching a nameless row on nothing would create a duplicate on
 * every upload.
 */
export async function importCsvMembers(csv: string): Promise<MemberImportResult> {
  const { organizationId } = await requireRosterOrg();
  const empty = { imported: 0, updated: 0, skippedDuplicates: 0, skippedInvalid: 0, unknownColumns: [] };

  const table = parseCsv(csv);
  if (!table) return { ...empty, error: "The file is empty." };
  if (!hasNameColumn(table)) {
    return {
      ...empty,
      error:
        'Couldn\'t find a name column in the header row. Expected a header like: name, email, handicap, phone — or first name and last name in separate columns.',
    };
  }

  // Through the same record splitter as parseCsv, or a quoted newline in the
  // HEADER would make this read a different first row than the table did.
  const unknownColumns = splitCsvLine(splitCsvRecords(csv).filter((l) => l.trim() !== "")[0])
    .filter((_, i) => table.columns[i] === null)
    .map((h) => h.replace(/^﻿/, "").trim())
    .filter(Boolean);

  const existing = await prisma.member.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true },
  });
  const byEmail = new Map(existing.filter((m) => m.email).map((m) => [m.email.toLowerCase(), m.id]));
  const byName = new Map(existing.map((m) => [m.name.trim().toLowerCase(), m.id]));

  let imported = 0;
  let updated = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const row of table.rows) {
    const name = nameFrom(table, row);
    if (!name) {
      skippedInvalid += 1;
      continue;
    }
    const email = cell(table, row, "email").toLowerCase();
    if (email && !EMAIL_RE.test(email)) {
      skippedInvalid += 1;
      continue;
    }

    // Not parseFloat: it reads "+2.4" as 2.4, and a plus handicap is 2.4
    // BETTER than scratch. Every scratch-and-better member imported with the
    // wrong sign and was then given the strokes they should have been giving.
    // A row whose handicap is unreadable keeps the member and drops the
    // number — a roster import is a list of people, and refusing the whole row
    // over one bad cell loses the person.
    const hcp = parseHandicapInput(cell(table, row, "handicap"));
    const handicapText = cell(table, row, "handicapType");
    const data = cleanMemberData({
      name,
      email,
      phone: cell(table, row, "phone"),
      ghin: cell(table, row, "ghin"),
      homeClub: cell(table, row, "homeClub"),
      gender: cell(table, row, "gender"),
      preferredTee: cell(table, row, "preferredTee"),
      memberNumber: cell(table, row, "memberNumber"),
      notes: cell(table, row, "notes"),
      handicap: hcp.ok ? hcp.value : 0,
      // "9" or a column that literally says 9 holes; anything else is 18.
      handicapType: handicapText.trim() === "9" || /\b9\b/.test(handicapText) ? "9" : "18",
      // "none" where the cell was blank or unreadable, so the roster shows an
      // unknown index as unknown rather than as a scratch golfer.
      handicapSource: hcp.ok && hcp.source === "manual" ? "manual" : "none",
    });

    const existingId = email ? byEmail.get(email) : byName.get(name.trim().toLowerCase());

    if (existingId) {
      // Don't overwrite a stored value with a blank cell — a narrower export
      // would otherwise wipe phone numbers and GHIN numbers off the roster.
      const patch = Object.fromEntries(
        Object.entries(data).filter(([k, v]) => {
          // Only when the cell actually held a readable handicap: a blank one
          // must not write a 0 over a stored index, and neither must "n/a".
          if (k === "handicap") return hcp.ok && hcp.source === "manual";
          if (k === "handicapType") return handicapText.trim() !== "";
          if (k === "handicapSource") return false;
          return v !== "";
        }),
      );
      if (Object.keys(patch).length === 0) {
        skippedDuplicates += 1;
        continue;
      }
      await prisma.member.update({ where: { id: existingId }, data: patch });
      updated += 1;
      continue;
    }

    const created = await prisma.member.create({ data: { ...data, organizationId } });
    // Keep the in-memory index current so two rows for the same person in one
    // file update each other rather than creating a duplicate.
    if (data.email) byEmail.set(data.email, created.id);
    byName.set(data.name.trim().toLowerCase(), created.id);
    imported += 1;
  }

  await refresh();
  return { imported, updated, skippedDuplicates, skippedInvalid, unknownColumns };
}

export async function updateMember(memberId: string, input: MemberInput): Promise<RosterResult> {
  const { organizationId } = await requireRosterOrg();
  const member = await prisma.member.findFirst({ where: { id: memberId, organizationId } });
  if (!member) return { ok: false, error: "Member not found." };

  const data = cleanMemberData(input);
  if (!data.name) return { ok: false, error: "Enter a name." };
  if (data.email && !EMAIL_RE.test(data.email)) return { ok: false, error: "Enter a valid email address." };

  if (data.email && data.email !== member.email) {
    const clash = await prisma.member.findFirst({
      where: { organizationId, email: data.email, id: { not: memberId } },
    });
    if (clash) return { ok: false, error: `${clash.name} is already on the roster with that email.` };
  }

  await prisma.member.update({ where: { id: memberId }, data });
  await refresh();
  return { ok: true };
}

/**
 * Set a member active or inactive.
 *
 * Deliberately not a delete: a member who leaves the club still played the
 * events they played, and those results have to keep their name. Inactive
 * members drop out of "add to tournament" but stay in history.
 */
export async function setMemberStatus(memberId: string, status: string): Promise<RosterResult> {
  const { organizationId } = await requireRosterOrg();
  const member = await prisma.member.findFirst({ where: { id: memberId, organizationId } });
  if (!member) return { ok: false, error: "Member not found." };

  await prisma.member.update({
    where: { id: memberId },
    data: { status: status === "inactive" ? "inactive" : "active" },
  });
  await refresh();
  return { ok: true };
}

/**
 * Permanently remove someone from the roster.
 *
 * Only offered for members who have never entered a tournament — a mistyped
 * duplicate, say. Once there's history, archiving is the only option, because
 * deleting would leave finished events with unattributable results.
 */
export async function deleteMember(memberId: string): Promise<RosterResult> {
  const { organizationId } = await requireRosterOrg();
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
    include: { _count: { select: { entries: true } } },
  });
  if (!member) return { ok: false, error: "Member not found." };
  if (member._count.entries > 0) {
    return {
      ok: false,
      error: "This member has tournament history. Set them inactive instead so past results stay intact.",
    };
  }

  await prisma.member.delete({ where: { id: memberId } });
  await refresh();
  return { ok: true };
}

/**
 * Put the current field on the club roster.
 *
 * The remedy for a Members screen reporting "none of the 32 in the field are
 * on the roster yet" — a club whose field predates its roster, which is every
 * club that imported entries before it thought about a member list.
 *
 * Every other path into the roster already goes through upsertMember, and so
 * does this: a player whose address already matches a member links to that
 * member rather than creating a second copy of them, which is the whole reason
 * not to write Member rows directly here.
 *
 * The player is then pointed at the member. Without that the link would rest
 * on the email alone, and a player with no address — placeholders from a field
 * resize, entries typed before the roster existed — would still read as
 * unlinked the moment after being added.
 */
export async function addFieldToRoster(): Promise<{
  ok: boolean;
  added: number;
  linked: number;
  error?: string;
}> {
  const { organizationId, eventId } = await requireRosterOrg();

  const [players, members] = await Promise.all([
    prisma.player.findMany({
      where: { eventId },
      select: {
        id: true, name: true, email: true, phone: true, memberId: true,
        ghin: true, homeClub: true, gender: true, preferredTee: true,
        handicap: true, handicapType: true, handicapSource: true,
      },
    }),
    prisma.member.findMany({ where: { organizationId }, select: { id: true, email: true } }),
  ]);

  const todo = unlinkedPlayers(players, members);
  let added = 0;
  let linked = 0;

  for (const p of todo) {
    const memberId = await upsertMember(organizationId, p, "staff");
    // A player with no name has nothing to become a member of; upsertMember
    // says so by returning null rather than creating an anonymous row.
    if (!memberId) continue;
    if (!members.some((m) => m.id === memberId)) added += 1;
    // Scoped to the event: a player id from this query cannot belong to
    // another tournament, and the where clause says so anyway.
    await prisma.player.updateMany({ where: { id: p.id, eventId }, data: { memberId } });
    linked += 1;
  }

  if (linked > 0) refresh();
  return { ok: true, added, linked };
}

export interface AddToEventResult extends RosterResult {
  added: number;
  waitlisted: number;
  /** Already in the field — skipped rather than duplicated. */
  skipped: number;
  /**
   * Members left out because the roster has no email for them, by name.
   *
   * Names rather than a count, because the organizer's next action is to go and
   * fill those addresses in and a number tells them nothing about whom.
   */
  needContact: string[];
  /**
   * Split by what is actually missing, so the notice can say which detail to go
   * and fill in. One merged list would send an organizer looking for a missing
   * email on a member whose address was fine and whose mobile was blank.
   */
  needEmail: string[];
  needPhone: string[];
}

/**
 * Enter roster members in the current tournament.
 *
 * This is the payoff of having a roster: filling a field is picking names off
 * the club list rather than retyping contact details for the fourth time this
 * season. Each entry snapshots the member's handicap as it stands today.
 */
export async function addMembersToEvent(memberIds: string[]): Promise<AddToEventResult> {
  const { organizationId, eventId } = await requireRosterOrg();
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return { ok: false, error: "Event not found.", added: 0, waitlisted: 0, skipped: 0, needContact: [], needEmail: [], needPhone: [] };
  if ((event.status === "live" || event.status === "completed") && !event.configUnlocked) {
    return {
      ok: false,
      error: "Configuration is locked. Unlock the tournament to change the field.",
      added: 0,
      waitlisted: 0,
      skipped: 0,
      needContact: [],
      needEmail: [],
      needPhone: [],
    };
  }

  const members = await prisma.member.findMany({
    where: { id: { in: memberIds }, organizationId },
    orderBy: { name: "asc" },
  });

  const existing = await prisma.player.findMany({
    where: { eventId },
    select: { memberId: true, email: true },
  });
  const takenIds = new Set(existing.map((p) => p.memberId).filter(Boolean) as string[]);
  const takenEmails = new Set(existing.map((p) => p.email.trim().toLowerCase()).filter(Boolean));

  let confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const agg = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  let seed = (agg._max.seed ?? 0) + 1;
  const unlimited = event.capacity <= 0;

  let added = 0;
  let waitlisted = 0;
  let skipped = 0;
  const needContact: string[] = [];
  const needEmail: string[] = [];
  const needPhone: string[] = [];
  const needsPhone = phoneRequiredFor(await planForEvent(eventId), event.requirePhone);

  // Read once, outside the loop: adding forty members should not read the
  // tee table forty times.
  const teeFor = await teeMatcherFor(eventId);

  for (const m of members) {
    if (takenIds.has(m.id) || (m.email && takenEmails.has(m.email))) {
      skipped += 1;
      continue;
    }
    /**
     * An entry needs an email, and this was the one way in that did not ask.
     *
     * The roster deliberately keeps members with no address — plenty of clubs
     * have them, and refusing those rows would stop the roster ever matching
     * the membership list it was copied from. Entering a tournament is a
     * different question, and every other route already enforces it: open
     * registration, addSignup, and the entry CSV import all reject a missing
     * address. This one carried the blank straight through, and the player it
     * created never even got a sign-in account (syncPlayerAccount below is
     * guarded on the same field). They could not sign in, could not be
     * messaged, could not be sent a thing — a second-class entrant nobody had
     * decided to create.
     *
     * The phone half follows the plan, not this screen: free clubs collect a
     * mobile from every entrant, paid clubs decide per tournament. See
     * phoneRequiredFor.
     *
     * Skipped and named rather than failing the batch: an organizer picking
     * forty members off the club list should not have the whole action refused
     * because two of them have no address on file.
     */
    const missingEmail = !m.email.trim();
    const missingPhone = needsPhone && !looksLikePhone(m.phone);
    if (missingEmail || missingPhone) {
      needContact.push(m.name);
      if (missingEmail) needEmail.push(m.name);
      else needPhone.push(m.name);
      continue;
    }
    const status = unlimited || confirmedCount < event.capacity ? "confirmed" : "waitlisted";
    if (status === "confirmed") confirmedCount += 1;
    else waitlisted += 1;

    await prisma.player.create({
      data: {
        eventId,
        memberId: m.id,
        name: m.name,
        // The set on the member's record, turned into this tournament's tee.
        // Unmatched or ambiguous stays null — the round's tees, visible and
        // correctable on the field screen rather than guessed at here.
        teeId: teeFor(m.preferredTee),
        // Snapshot, not a reference: correcting this member's index next month
        // must not change the result of the tournament they're entering now.
        handicap: m.handicap,
        handicapType: m.handicapType,
        handicapSource: m.handicapSource,
        seed: seed++,
        status,
        email: m.email,
        phone: m.phone,
        ghin: m.ghin,
        homeClub: m.homeClub,
        gender: m.gender,
        preferredTee: m.preferredTee,
      },
    });
    // Unconditional now: an entrant without an address never reaches here.
    await syncPlayerAccount(eventId, m.name, m.email);
    takenIds.add(m.id);
    takenEmails.add(m.email);
    added += 1;
  }

  await refresh();
  return { ok: true, added, waitlisted, skipped, needContact, needEmail, needPhone };
}

/* ── The club handicap a member's own cards support ───────────────────────── */

/**
 * A member's handicap record, for the panel on the roster.
 *
 * Read-only, and computed on demand for ONE member rather than for the whole
 * roster. `memberHandicapRecord` runs several queries per member; doing it for
 * a club of two hundred on every page load would be six hundred queries to
 * render a list nobody has asked a question about yet. A committee reviews one
 * member at a time, which is the shape this matches.
 */
export async function memberHandicapSuggestion(
  memberId: string,
): Promise<{ ok: boolean; error?: string; record?: MemberRecord }> {
  const { organizationId } = await requireRosterOrg();
  // Narrowed here, where the id arrives, and not only inside the service. The
  // service scopes too, but an action that reads as if it trusts a caller's
  // row id is one somebody will later copy — which is what audit-idor.test.ts
  // is checking for, and it was right to stop this.
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true },
  });
  if (!member) return { ok: false, error: "Member not found." };

  const record = await memberHandicapRecord(organizationId, memberId);
  if (!record) return { ok: false, error: "Member not found." };
  return { ok: true, record };
}

/**
 * Take the handicap this member's cards support.
 *
 * **Takes no handicap value.** The number is recomputed here and applied from
 * this side, so a caller cannot post whatever figure they like — a `"use
 * server"` export is a public HTTP endpoint and a handicap posted off the wire
 * would be a free hand into every net score the club plays.
 *
 * Refuses where an association holds the member's handicap. GHIN is the
 * authority and this is the fallback, per
 * `docs/requirement-per-round-handicap.md`; replacing a licensed figure with
 * one worked out from a club's own cards is the single thing this feature must
 * never do, and the screen hiding the button is not enough on its own.
 *
 * Existing rounds are untouched. `Player.handicap` is each event's own snapshot
 * and a played round keeps what it was played off — the freeze already
 * guarantees that, and it is why this can move the roster figure safely.
 */
export async function acceptClubHandicap(
  memberId: string,
): Promise<{ ok: boolean; error?: string; handicap?: number }> {
  const { organizationId } = await requireRosterOrg();
  // The same narrowing as above, and it matters more here: this one writes.
  const member = await prisma.member.findFirst({
    where: { id: memberId, organizationId },
    select: { id: true },
  });
  if (!member) return { ok: false, error: "Member not found." };

  const record = await memberHandicapRecord(organizationId, memberId);
  if (!record) return { ok: false, error: "Member not found." };
  if (!record.maySuggest) {
    return {
      ok: false,
      error: "This member's handicap comes from their association. TourneyHQ won't overwrite it.",
    };
  }
  if (!record.suggestion) {
    return { ok: false, error: "Not enough approved cards yet — three rounds are the minimum." };
  }

  await prisma.member.update({
    where: { id: memberId },
    // `manual` rather than a new source: a committee accepting a suggestion is
    // the club setting the handicap, which is exactly what manual means. A
    // third value would need every reader of handicapSource to learn it.
    data: { handicap: record.suggestion.handicap, handicapSource: "manual" },
  });
  revalidatePath("/", "layout");
  return { ok: true, handicap: record.suggestion.handicap };
}

/* ── The club's board ─────────────────────────────────────────────────────── */

/**
 * Put a name on the board.
 *
 * **Takes no champion.** The name is recomputed here from the tournament's own
 * standings, so a caller cannot post whoever they like onto a permanent record
 * — a `"use server"` export is a public HTTP endpoint. `playerName` is accepted
 * ONLY to break a tie the app refuses to break itself, and even then it must be
 * one of the tied players.
 *
 * Everything is written denormalised. Once confirmed, this entry never changes
 * again: not when a member leaves the roster, not when the tournament is
 * renamed, and not when a scoring correction would otherwise re-decide it.
 */
export async function confirmChampion(
  eventId: string,
  /** Only for a tie. Must be one of the players who finished level. */
  playerId?: string,
  note = "",
): Promise<RosterResult & { championName?: string }> {
  const { organizationId } = await requireRosterOrg();

  const found = await championFor(organizationId, eventId);
  if (!found) return { ok: false, error: "Tournament not found." };

  const { suggestion } = found;

  // A clean winner: the app's own answer, never the caller's.
  if (suggestion.ok) {
    const entry = await writeHonours({
      organizationId,
      eventId,
      event: found.event,
      playerId: suggestion.playerId,
      championName: suggestion.name,
      note,
    });
    return { ok: true, championName: entry.championName };
  }

  // A tie is the ONE case a committee's choice is needed, and the choice is
  // still constrained to the players who actually finished level. Anything
  // else — an unfinished tournament, an empty board — is refused outright with
  // the reason, rather than accepting a name for a result that does not exist.
  if (suggestion.reason !== "tied") {
    return { ok: false, error: CHAMPION_REFUSAL[suggestion.reason] };
  }
  const chosen = suggestion.tied.find((p) => p.playerId === playerId);
  if (!chosen) {
    return {
      ok: false,
      error: `Pick which of the tied players won: ${suggestion.tied.map((p) => p.name).join(", ")}.`,
    };
  }
  const entry = await writeHonours({
    organizationId,
    eventId,
    event: found.event,
    playerId: chosen.playerId,
    championName: chosen.name,
    note,
  });
  return { ok: true, championName: entry.championName };
}

/** The one place a board entry is written. */
async function writeHonours(input: {
  organizationId: string;
  eventId: string;
  event: { name: string; dates: string; year: number };
  playerId: string;
  championName: string;
  note: string;
}) {
  const session = await getSession();
  return prisma.honoursEntry.upsert({
    where: { eventId_playerId: { eventId: input.eventId, playerId: input.playerId } },
    // Re-confirming the same player is not an error — it re-stamps who said so,
    // which is the field a board is asked about years later.
    update: {
      note: input.note.trim().slice(0, 300),
      confirmedBy: session?.name ?? "",
      confirmedAt: new Date(),
    },
    create: {
      organizationId: input.organizationId,
      eventId: input.eventId,
      eventName: input.event.name,
      dates: input.event.dates,
      year: input.event.year,
      playerId: input.playerId,
      championName: input.championName,
      note: input.note.trim().slice(0, 300),
      confirmedBy: session?.name ?? "",
    },
  });
}

/**
 * Take a name back off the board.
 *
 * A club that confirmed the wrong player has to be able to fix it, and the
 * alternative — editing the row — would let a name be changed without anyone
 * re-confirming it. Removing and confirming again leaves `confirmedBy` honest.
 */
export async function removeFromHonours(entryId: string): Promise<RosterResult> {
  const { organizationId } = await requireRosterOrg();
  const entry = await prisma.honoursEntry.findFirst({
    where: { id: entryId, organizationId },
    select: { id: true },
  });
  if (!entry) return { ok: false, error: "That board entry isn't this club's." };
  await prisma.honoursEntry.delete({ where: { id: entryId } });
  revalidatePath("/", "layout");
  return { ok: true };
}
