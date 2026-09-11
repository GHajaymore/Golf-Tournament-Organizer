/**
 * NO `server-only` HERE, deliberately, and it is the one service that should
 * not have it.
 *
 * That marker exists to make a client component importing database code fail
 * at build time. This module is imported by two things and neither is a
 * component: the audit suite, and `scripts/repair-player-identity.ts` — and
 * the script runs under `tsx`, which cannot resolve `server-only` at all. With
 * it, the repair is unrunnable; without it, the protection is unchanged,
 * because nothing here is reachable from the client bundle in the first place
 * and Prisma would fail loudly there anyway.
 */
import { prisma } from "../db";
import { planRepair, type RepairMember, type RepairPlan, type RepairPlayer } from "../domain/identity-repair";

/**
 * Reading the rows the repair decides over, and writing back what it decided.
 *
 * The decision itself is pure and lives in `domain/identity-repair.ts`. This is
 * the IO half, in a service rather than in the script, for one reason: a repair
 * that only exists inside a CLI can only be proved by running the CLI, and what
 * needs proving is what it does to REAL ROWS — that a created member carries
 * the entry's handicap, that an ambiguous entry is genuinely left alone, that a
 * second pass changes nothing. Those are audit-suite questions.
 */

export interface RepairSummary {
  players: number;
  members: number;
  ok: number;
  linked: number;
  created: number;
  ambiguous: number;
}

const PLAYER_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  memberId: true,
  handicap: true,
  handicapType: true,
  handicapSource: true,
  ghin: true,
  homeClub: true,
  gender: true,
  preferredTee: true,
  event: { select: { name: true, organizationId: true } },
} as const;

type LoadedPlayer = Awaited<ReturnType<typeof loadPlayers>>[number];

function loadPlayers(organizationId?: string) {
  return prisma.player.findMany({
    where: organizationId ? { event: { organizationId } } : {},
    select: PLAYER_FIELDS,
    orderBy: { seed: "asc" },
  });
}

export interface LoadedRepair {
  plan: RepairPlan;
  byId: Map<string, LoadedPlayer>;
  players: number;
  members: number;
}

/** Everything needed to report or apply, read once. */
export async function loadRepair(organizationId?: string): Promise<LoadedRepair> {
  const players = await loadPlayers(organizationId);
  const members = await prisma.member.findMany({
    where: organizationId ? { organizationId } : {},
    select: { id: true, name: true, email: true, organizationId: true },
  });

  const asPlayers: RepairPlayer[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    memberId: p.memberId,
    organizationId: p.event.organizationId,
  }));
  const asMembers: RepairMember[] = members satisfies RepairMember[];

  return {
    plan: planRepair(asPlayers, asMembers),
    byId: new Map(players.map((p) => [p.id, p])),
    players: players.length,
    members: members.length,
  };
}

/**
 * Apply a plan.
 *
 * Links first, then creations. Nothing is deleted, no two existing members are
 * ever merged, no scorecard is touched, and an entry is never edited beyond its
 * `memberId` — so the worst case is a roster row too many, which an organizer
 * can see and remove, rather than a result that moved.
 */
export async function applyRepair(loaded: LoadedRepair): Promise<RepairSummary> {
  let linked = 0;
  let created = 0;

  for (const o of loaded.plan.link) {
    if (o.kind !== "link") continue;
    await prisma.player.update({ where: { id: o.player.id }, data: { memberId: o.memberId } });
    linked += 1;
  }

  for (const o of loaded.plan.create) {
    const p = loaded.byId.get(o.player.id);
    if (!p) continue;
    /**
     * The member this entry would have created had the roster existed,
     * carrying what the organizer actually typed and inventing nothing else.
     *
     * The handicap comes across because `Player.handicap` is the figure they
     * entered, and for somebody with no roster row at all it is the only
     * evidence of their index that exists. It is a snapshot moving to become
     * a current value, which is the right direction — the reverse, writing a
     * roster index back over a played entry, is what `upsertMember` refuses.
     */
    const member = await prisma.member.create({
      data: {
        organizationId: p.event.organizationId,
        name: p.name,
        email: p.email,
        phone: p.phone,
        ghin: p.ghin,
        homeClub: p.homeClub,
        gender: p.gender,
        preferredTee: p.preferredTee,
        handicap: p.handicap,
        handicapType: p.handicapType,
        handicapSource: p.handicapSource,
      },
    });
    await prisma.player.update({ where: { id: p.id }, data: { memberId: member.id } });
    created += 1;
  }

  return {
    players: loaded.players,
    members: loaded.members,
    ok: loaded.plan.ok.length,
    linked,
    created,
    ambiguous: loaded.plan.ambiguous.length,
  };
}
