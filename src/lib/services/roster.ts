import "server-only";
import { prisma } from "../db";
import { handicapPolicyOf, refuseHandByHand } from "../domain/handicap-policy";

/**
 * The club roster — the primary record of who plays here.
 *
 * Tournaments draw from this list rather than each event holding its own
 * island of names, which is what makes "add the Tuesday league" one click and
 * lets a member's history span seasons.
 */

export interface RosterMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  ghin: string;
  homeClub: string;
  gender: string;
  preferredTee: string;
  memberNumber: string;
  handicap: number;
  handicapType: string;
  handicapSource: string;
  status: string;
  notes: string;
  /** How many tournaments this member has entered. */
  entryCount: number;
  /** Most recent event they entered, for the "last played" column. */
  lastEvent: string;
}

/** The organization whose roster an event draws from. */
export async function organizationIdForEvent(eventId: string): Promise<string | null> {
  if (!eventId) return null;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  return event?.organizationId ?? null;
}

/**
 * Every member of a club, active first.
 *
 * Inactive members are included rather than filtered here: they still need to
 * be visible on the roster screen (that's where you'd reactivate one), and the
 * places that must exclude them — "add to tournament" — filter explicitly.
 */
export async function loadRoster(organizationId: string): Promise<RosterMember[]> {
  const members = await prisma.member.findMany({
    where: { organizationId },
    include: {
      entries: {
        select: { event: { select: { name: true, createdAt: true } } },
        orderBy: { event: { createdAt: "desc" } },
      },
    },
    orderBy: { name: "asc" },
  });

  return members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    ghin: m.ghin,
    homeClub: m.homeClub,
    gender: m.gender,
    preferredTee: m.preferredTee,
    memberNumber: m.memberNumber,
    handicap: m.handicap,
    handicapType: m.handicapType,
    handicapSource: m.handicapSource,
    status: m.status,
    notes: m.notes,
    entryCount: m.entries.length,
    lastEvent: m.entries[0]?.event.name ?? "",
  }));
}

export interface RosterCandidate {
  id: string;
  name: string;
  email: string;
  handicap: number;
  handicapType: string;
  memberNumber: string;
  /** True when this member is already entered in the event being filled. */
  entered: boolean;
}

/**
 * The roster as a picker for one event: active members, flagged with whether
 * they're already in the field so the UI can disable rather than hide them
 * (hiding makes an organizer think the member is missing from the club).
 */
export async function rosterForEvent(eventId: string): Promise<RosterCandidate[]> {
  const organizationId = await organizationIdForEvent(eventId);
  if (!organizationId) return [];

  const [members, entered] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId, status: "active" },
      orderBy: { name: "asc" },
    }),
    prisma.player.findMany({ where: { eventId }, select: { memberId: true, email: true } }),
  ]);

  const enteredIds = new Set(entered.map((p) => p.memberId).filter(Boolean) as string[]);
  // Also match on email, so an entry added before the roster existed (or
  // imported without a link) still reads as "already in" rather than inviting
  // the organizer to add a duplicate.
  const enteredEmails = new Set(entered.map((p) => p.email.trim().toLowerCase()).filter(Boolean));

  return members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    handicap: m.handicap,
    handicapType: m.handicapType,
    memberNumber: m.memberNumber,
    entered: enteredIds.has(m.id) || (!!m.email && enteredEmails.has(m.email.trim().toLowerCase())),
  }));
}

export interface MemberIdentity {
  name: string;
  email?: string;
  phone?: string;
  ghin?: string;
  homeClub?: string;
  gender?: string;
  preferredTee?: string;
  handicap?: number;
  handicapType?: string;
  handicapSource?: string;
}

/**
 * Who is writing this roster row, and therefore whose word the index is.
 *
 * Required rather than defaulted, on purpose. A default would be the wrong
 * answer for whichever kind of caller forgot to pass it, and the caller that
 * forgets is exactly the one that matters — see the note on `upsertMember`.
 */
export type MemberWriter =
  /** An organizer, acting inside the club with a session. Their typed index is
   *  the club's answer, subject to the club's handicap policy. */
  | "staff"
  /** Public self-registration. No session, no identity beyond a form: an
   *  entrant may complete their own roster row but never restate somebody
   *  else's index. */
  | "public";

/**
 * Find this person on the club roster, or add them.
 *
 * Every path that puts someone in a tournament goes through here, so entering
 * a player is also how they join the roster — an organizer never has to
 * maintain the club list as a separate chore.
 *
 * Matching is by email where there is one (stable across name changes and
 * spelling variants), falling back to an exact case-insensitive name match.
 * Details on an existing member are filled in but not overwritten: a blank
 * phone in a CSV should not wipe the number the club already had.
 *
 * THE HANDICAP IS THE EXCEPTION, and it was the wrong kind of exception.
 *
 * It was overwritten on every upsert, reasoned as "the one field the latest
 * entry is authoritative for — it's what the organizer just typed". True of an
 * organizer; six callers reach this and one of them is PUBLIC SELF-
 * REGISTRATION, which has no session at all. Anyone who knew a member's email
 * address could enter a tournament as them and restate their Handicap Index,
 * and `Member.handicap` is what every future event snapshots.
 *
 * It also walked straight past the club's handicap policy. `refuseHandByHand`
 * exists for that and its own docstring says why — "the action behind it is a
 * public HTTP endpoint and will be called with whatever the caller likes" —
 * but it was called from exactly ONE of the seven places that can set an
 * index. So under `handicapPolicy: "ghin"` an unauthenticated stranger could
 * do what the club's own organizer is refused.
 *
 * Both checks now live here, where every path has to pass through them,
 * rather than in a guard six callers must remember. That is CLAUDE.md's rule
 * about guards, and this is the case it was written about.
 */
export async function upsertMember(
  organizationId: string,
  input: MemberIdentity,
  writer: MemberWriter,
): Promise<string | null> {
  const name = input.name.trim();
  if (!organizationId || !name) return null;
  const email = (input.email ?? "").trim().toLowerCase();

  const [existing, org] = await Promise.all([
    email
      ? prisma.member.findFirst({ where: { organizationId, email } })
      : prisma.member.findFirst({
          where: { organizationId, name: { equals: name, mode: "insensitive" } },
        }),
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { handicapPolicy: true },
    }),
  ]);
  const policy = handicapPolicyOf(org?.handicapPolicy);

  if (existing) {
    const fill: Record<string, string | number> = {};
    // Only fill gaps — except the handicap, which is the one field the latest
    // entry is authoritative for (it's what the organizer just typed).
    if (!existing.email && email) fill.email = email;
    if (!existing.phone && input.phone?.trim()) fill.phone = input.phone.trim();
    if (!existing.ghin && input.ghin?.trim()) fill.ghin = input.ghin.trim();
    if (!existing.homeClub && input.homeClub?.trim()) fill.homeClub = input.homeClub.trim();
    if (!existing.gender && input.gender?.trim()) fill.gender = input.gender.trim();
    if (!existing.preferredTee && input.preferredTee?.trim()) fill.preferredTee = input.preferredTee.trim();
    // A blank handicap box arrives here as 0 with source "none" — the absence
    // of a claim, not a scratch handicap. Writing it would overwrite a member
    // stored at 12.4 with 0 every time they register for something without
    // retyping their index. Only a handicap somebody actually entered is
    // authoritative; anything else leaves the roster's value alone.
    const claimed = (input.handicapSource ?? "manual") !== "none";
    /**
     * Two more things have to be true before that index is written.
     *
     * A PUBLIC entrant is not authoritative for a roster row that already
     * exists. They may complete their own — the gap-filling above still runs —
     * but restating the club's stored index for somebody is a thing only the
     * club does. Knowing an email address is not knowing a handicap.
     *
     * And the club's policy decides whether a typed figure is allowed at all,
     * for this member. Under `ghin` it never is; under `hybrid` it is not for
     * anybody who has an association number.
     */
    const mayWriteIndex =
      writer === "staff" &&
      refuseHandByHand(policy, input, { handicap: existing.handicap, ghin: existing.ghin }) === null;
    if (mayWriteIndex && claimed && Number.isFinite(input.handicap) && input.handicap !== existing.handicap) {
      fill.handicap = input.handicap as number;
      fill.handicapType = input.handicapType === "9" ? "9" : "18";
    }
    if (Object.keys(fill).length > 0) {
      await prisma.member.update({ where: { id: existing.id }, data: fill });
    }
    return existing.id;
  }

  /**
   * A NEW member under a policy that forbids typed indexes.
   *
   * "A member without a GHIN number is an unfinished roster row rather than a
   * player at zero" — the policy's own words. So the row is created and the
   * typed figure is not kept: recording it would put a hand-typed index beside
   * association ones looking equally official, which is the outcome the policy
   * exists to prevent. `handicapSource: "none"` is how the rest of the app
   * already says "nobody has claimed a figure for this person".
   *
   * A brand-new member has no association number of their own to consult yet,
   * so the question is asked with the one they supplied.
   */
  const newGhin = (input.ghin ?? "").trim();
  const mayRecordIndex =
    refuseHandByHand(policy, input, { handicap: 0, ghin: newGhin }) === null;
  const created = await prisma.member.create({
    data: {
      organizationId,
      name,
      email,
      phone: (input.phone ?? "").trim(),
      ghin: newGhin,
      homeClub: (input.homeClub ?? "").trim(),
      gender: (input.gender ?? "").trim(),
      preferredTee: (input.preferredTee ?? "").trim(),
      handicap: mayRecordIndex && Number.isFinite(input.handicap) ? (input.handicap as number) : 0,
      handicapType: input.handicapType === "9" ? "9" : "18",
      handicapSource: !mayRecordIndex
        ? "none"
        : ["ghin", "manual", "none"].includes(input.handicapSource ?? "")
          ? input.handicapSource!
          : "manual",
    },
  });
  return created.id;
}

export interface MemberHistoryEntry {
  eventName: string;
  eventDates: string;
  status: string;
  /** Handicap as it stood for that tournament, not the member's current index. */
  handicap: number;
  handicapType: string;
}

/** What one member has played — the answer the old per-event lists couldn't give. */
export async function memberHistory(memberId: string): Promise<MemberHistoryEntry[]> {
  const entries = await prisma.player.findMany({
    where: { memberId },
    include: { event: { select: { name: true, dates: true, createdAt: true } } },
    orderBy: { event: { createdAt: "desc" } },
  });
  return entries.map((e) => ({
    eventName: e.event.name,
    eventDates: e.event.dates,
    status: e.status,
    handicap: e.handicap,
    handicapType: e.handicapType,
  }));
}
