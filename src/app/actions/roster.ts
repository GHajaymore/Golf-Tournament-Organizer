"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { syncPlayerAccount } from "@/lib/services/player-access";

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

function refresh() {
  revalidatePath("/", "layout");
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
  const data = cleanMemberData(input);
  if (!data.name) return { ok: false, error: "Enter a name." };
  if (data.email && !EMAIL_RE.test(data.email)) return { ok: false, error: "Enter a valid email address." };

  if (data.email) {
    const clash = await prisma.member.findFirst({ where: { organizationId, email: data.email } });
    if (clash) return { ok: false, error: `${clash.name} is already on the roster with that email.` };
  }

  await prisma.member.create({ data: { ...data, organizationId } });
  refresh();
  return { ok: true };
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
  refresh();
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
  refresh();
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
  refresh();
  return { ok: true };
}

export interface AddToEventResult extends RosterResult {
  added: number;
  waitlisted: number;
  /** Already in the field — skipped rather than duplicated. */
  skipped: number;
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
  if (!event) return { ok: false, error: "Event not found.", added: 0, waitlisted: 0, skipped: 0 };
  if ((event.status === "live" || event.status === "completed") && !event.configUnlocked) {
    return {
      ok: false,
      error: "Configuration is locked. Unlock the tournament to change the field.",
      added: 0,
      waitlisted: 0,
      skipped: 0,
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

  for (const m of members) {
    if (takenIds.has(m.id) || (m.email && takenEmails.has(m.email))) {
      skipped += 1;
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
    if (m.email) await syncPlayerAccount(eventId, m.name, m.email);
    takenIds.add(m.id);
    if (m.email) takenEmails.add(m.email);
    added += 1;
  }

  refresh();
  return { ok: true, added, waitlisted, skipped };
}
