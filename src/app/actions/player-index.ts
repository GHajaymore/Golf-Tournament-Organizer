"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertEventWritable } from "@/lib/services/club-archive";
import { boardChanged } from "@/lib/services/board-refresh";
import { roundLabel } from "@/lib/domain/round-label";
import { isPlayingRound } from "@/lib/stage-types";
import { indexRefusal } from "@/lib/domain/handicap-label";
import { handicapPolicyOf, mayEditHandicapByHand } from "@/lib/domain/handicap-policy";
import { roundHasReturnedCard } from "@/lib/services/round-handicap";
import { orgProfile } from "@/lib/domain/org-profile";
import {
  planIndexChange,
  indexDecimalRefusal,
  memberPushRefusal,
  indexChangeDone,
  type IndexChangePlan,
  type IndexChangeRound,
} from "@/lib/domain/index-change";

/**
 * ONE DOOR TO A PLAYER'S HANDICAP INDEX, FROM A TOURNAMENT (2026-10-16).
 *
 * Two screens offer it — a round's "Handicaps for this round" and the handicap
 * box on Entries — and both come here, so the rules below cannot
 * differ between them. Before this the field box wrote every edit through to
 * the member record without a word and without a history line; it now writes
 * the tournament's copy, and the member record only when somebody asks.
 *
 * NOT behind the setup lock: a committee cuts a handicap mid-championship,
 * which is after setup locked. A round with a card keeps what it was scored
 * off — the freeze is the lock that matters here, as for a round's own figure.
 */

async function requireStaffEvent(): Promise<{ eventId: string; admin: boolean; actor: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  await assertEventWritable(session.eventId);
  return { eventId: session.eventId, admin: session.role === "admin", actor: session.name || "organizer" };
}

interface Facts {
  name: string;
  from: number;
  rounds: IndexChangeRound[];
  fieldStarted: boolean;
  member: { id: string; organizationId: string; handicap: number } | null;
  /** Why the member record may not take the figure, or null when it may. */
  memberRefusal: string | null;
  otherEntries: { name: string; handicap: number }[];
}

async function factsFor(eventId: string, playerId: string, admin: boolean): Promise<Facts | null> {
  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId },
    select: { id: true, name: true, handicap: true, memberId: true },
  });
  if (!player) return null;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true, organization: { select: { handicapPolicy: true, kind: true, country: true, communityNoun: true } } },
  });
  const stages = await prisma.stage.findMany({
    where: { eventId },
    select: { id: true, type: true, position: true },
    orderBy: { position: "asc" },
  });
  const playing = stages.filter((s) => isPlayingRound(s.type));
  const rows = await prisma.roundHandicap.findMany({
    where: { eventId, playerId },
    select: { stageId: true, override: true, frozen: true },
  });
  const byStage = new Map(rows.map((r) => [r.stageId, r]));
  const rounds: IndexChangeRound[] = [];
  let fieldStarted = false;
  for (const s of playing) {
    const row = byStage.get(s.id);
    const returned = await roundHasReturnedCard(eventId, s.id);
    if (returned) fieldStarted = true;
    rounds.push({
      label: roundLabel(stages, s.id) || s.type,
      played: returned || row?.frozen != null,
      ownFigure: row?.override ?? null,
    });
  }

  // The member record this entry is linked to, IN THIS CLUB — never an id the
  // caller supplies, and never a row of another club's roster, which nothing in
  // the schema stops `Player.memberId` pointing at.
  const member =
    player.memberId && event?.organizationId
      ? await prisma.member.findFirst({
          where: { id: player.memberId, organizationId: event.organizationId },
          select: { id: true, organizationId: true, handicap: true, ghin: true, handicapType: true },
        })
      : null;
  const policy = handicapPolicyOf(event?.organization?.handicapPolicy);
  const org = event?.organization;
  const memberRefusal = memberPushRefusal({
    noun: org ? orgProfile(org.kind, org.country, org.communityNoun).noun : "club",
    guest: !member,
    name: player.name,
    admin,
    association: member ? !mayEditHandicapByHand(policy, { ghin: member.ghin }) : false,
    nineHole: member?.handicapType === "9",
  });
  const others = member
    ? await prisma.player.findMany({
        where: { memberId: member.id, eventId: { not: eventId }, event: { status: { not: "completed" } } },
        select: { handicap: true, event: { select: { name: true } } },
      })
    : [];
  return {
    name: player.name,
    from: player.handicap,
    rounds,
    fieldStarted,
    member: member ? { id: member.id, organizationId: member.organizationId, handicap: member.handicap } : null,
    memberRefusal,
    otherEntries: others.map((o) => ({ name: o.event.name, handicap: o.handicap })),
  };
}

export interface IndexChangeView {
  ok: boolean;
  error?: string;
  name?: string;
  from?: number;
  plan?: IndexChangePlan;
  fieldStarted?: boolean;
  /** What Members holds now, or null for a guest. */
  memberFrom?: number | null;
  memberRefusal?: string | null;
  otherEntries?: { name: string; handicap: number }[];
}

/** What changing this player's index would move — read when the editor opens. */
export async function indexChangeFacts(playerId: string): Promise<IndexChangeView> {
  const { eventId, admin } = await requireStaffEvent();
  // Narrowed here, where the id arrives, as well as inside `factsFor` — an action
  // that reads as if it trusts a caller's row id is one somebody later copies.
  const owned = await prisma.player.findFirst({ where: { id: playerId, eventId }, select: { id: true } });
  if (!owned) return { ok: false, error: "That player isn't in this tournament." };
  const f = await factsFor(eventId, playerId, admin);
  if (!f) return { ok: false, error: "That player isn't in this tournament." };
  return {
    ok: true,
    name: f.name,
    from: f.from,
    plan: planIndexChange(f.rounds),
    fieldStarted: f.fieldStarted,
    memberFrom: f.member?.handicap ?? null,
    memberRefusal: f.memberRefusal,
    otherEntries: f.otherEntries,
  };
}

export interface IndexChangeInput {
  index: number;
  /** The figure the screen showed — refused if somebody has changed it since. */
  expectedFrom: number;
  alsoMember: boolean;
  /** Why, for the history. Required for the member record (Rule 7.1: an adjustment is recorded). */
  reason: string;
}

export async function setPlayerIndex(
  playerId: string,
  input: IndexChangeInput,
): Promise<{ ok: boolean; error?: string; said?: string; plan?: IndexChangePlan }> {
  const { eventId, admin, actor } = await requireStaffEvent();
  const index = Number(input?.index);
  const refused = indexRefusal(index) ?? indexDecimalRefusal(index);
  if (refused) return { ok: false, error: refused };
  const reason = String(input?.reason ?? "").trim().slice(0, 200);

  const f = await factsFor(eventId, playerId, admin);
  if (!f) return { ok: false, error: "That player isn't in this tournament." };
  if (Number(input?.expectedFrom) !== f.from) {
    return { ok: false, error: `${f.name}'s index was changed to ${f.from} meanwhile. Look again before saving.` };
  }
  const alsoMember = !!input?.alsoMember;
  if (alsoMember) {
    if (f.memberRefusal) return { ok: false, error: f.memberRefusal };
    if (!reason) return { ok: false, error: "Say why, for the member's record — for example “Committee adjustment after the club championship”." };
  }
  const plan = planIndexChange(f.rounds);
  const memberFrom = f.member?.handicap ?? null;

  const stale = await prisma.$transaction(async (tx) => {
    const p = await tx.player.updateMany({
      where: { id: playerId, eventId, handicap: f.from },
      data: { handicap: index, handicapSource: "manual" },
    });
    if (p.count === 0) return true;
    if (alsoMember && f.member) {
      const m = await tx.member.updateMany({
        where: { id: f.member.id, organizationId: f.member.organizationId, handicap: f.member.handicap },
        data: { handicap: index, handicapSource: "manual" },
      });
      if (m.count === 0) throw new Error("STALE_MEMBER");
    }
    const what =
      `${f.name}: index ${f.from} → ${index} in this tournament` +
      (plan.moves.length ? ` (${plan.moves.join(", ")})` : "") +
      (alsoMember ? `, and on Members (was ${memberFrom})` : "") +
      (reason ? `. Reason: ${reason}` : "");
    await tx.auditLog.create({
      data: { eventId, actor, action: alsoMember ? "Committee adjustment (Rule 7.1)" : "Index changed", detail: what },
    });
    return false;
  }).catch((e: unknown) => {
    if (e instanceof Error && e.message === "STALE_MEMBER") return "member" as const;
    throw e;
  });
  if (stale === true) return { ok: false, error: `${f.name}'s index was changed meanwhile. Look again before saving.` };
  if (stale === "member") return { ok: false, error: `${f.name}'s index on Members was changed meanwhile. Look again before saving.` };

  revalidatePath("/", "layout");
  boardChanged(eventId);
  return { ok: true, plan, said: indexChangeDone({ name: f.name, to: index, plan, alsoMember }) };
}
