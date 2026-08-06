"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { sideSizeRange, needsTeams } from "@/lib/formats";
import { snakeDraw } from "@/lib/services/teams";

export interface TeamResult {
  ok: boolean;
  error?: string;
}

/**
 * Organizer or assistant, on the active tournament.
 *
 * Every export in a "use server" file is a public HTTP endpoint, so each
 * action below calls this first. Hiding the Teams screen in the sidebar stops
 * nobody from posting to these directly.
 */
async function requireStaff(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  return session.eventId;
}

/** Structural changes are blocked once a tournament is under way, unless the
 *  organizer has explicitly unlocked it — redrawing sides mid-round would
 *  orphan every card already returned. */
async function assertUnlocked(eventId: string): Promise<void> {
  const e = await prisma.event.findUnique({
    where: { id: eventId },
    select: { status: true, configUnlocked: true },
  });
  if (e && (e.status === "live" || e.status === "completed") && !e.configUnlocked) {
    throw new Error("Configuration is locked. Unlock the tournament to change teams.");
  }
}

/** Confirms a stage belongs to this tournament — without it, a stage id from
 *  another club's event would attach teams across the tenant boundary. */
async function stageInEvent(eventId: string, stageId: string | null): Promise<string | null> {
  if (!stageId) return null;
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { eventId: true } });
  if (!stage || stage.eventId !== eventId) throw new Error("Round not found");
  return stageId;
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function createTeam(name: string, stageId: string | null): Promise<TeamResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  const scoped = await stageInEvent(eventId, stageId);
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Give the team a name." };

  const maxSeed = await prisma.team.aggregate({ where: { eventId }, _max: { seed: true } });
  await prisma.team.create({
    data: { eventId, stageId: scoped, name: clean, seed: (maxSeed._max.seed ?? 0) + 1 },
  });
  refresh();
  return { ok: true };
}

export async function renameTeam(teamId: string, name: string): Promise<TeamResult> {
  const eventId = await requireStaff();
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { eventId: true } });
  if (!team || team.eventId !== eventId) return { ok: false, error: "Team not found." };
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Give the team a name." };
  await prisma.team.update({ where: { id: teamId }, data: { name: clean } });
  refresh();
  return { ok: true };
}

export async function deleteTeam(teamId: string): Promise<TeamResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { eventId: true } });
  if (!team || team.eventId !== eventId) return { ok: false, error: "Team not found." };
  // Cascades to membership and cards. Deliberately refuses once the side has
  // returned a score, rather than quietly deleting a played round.
  const cards = await prisma.teamScorecard.count({ where: { teamId, NOT: { strokes: "[]" } } });
  if (cards > 0) {
    return { ok: false, error: "This team has scores recorded. Clear them before removing the team." };
  }
  await prisma.team.delete({ where: { id: teamId } });
  refresh();
  return { ok: true };
}

export async function addTeamMember(teamId: string, playerId: string): Promise<TeamResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  const [team, player] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, select: { eventId: true, stageId: true } }),
    prisma.player.findUnique({ where: { id: playerId }, select: { eventId: true } }),
  ]);
  if (!team || team.eventId !== eventId) return { ok: false, error: "Team not found." };
  if (!player || player.eventId !== eventId) return { ok: false, error: "Player is not in this tournament." };

  // Nobody plays for two sides in the same round. The unique index stops the
  // same side twice; this stops the same *round* twice, which is the mistake
  // an organizer actually makes when dragging names around.
  const clash = await prisma.teamMember.findFirst({
    where: { playerId, team: { eventId, stageId: team.stageId } },
    include: { team: { select: { name: true } } },
  });
  if (clash) {
    if (clash.teamId === teamId) return { ok: true }; // already there; nothing to do
    return { ok: false, error: `Already playing for ${clash.team.name}.` };
  }

  const maxPos = await prisma.teamMember.aggregate({ where: { teamId }, _max: { position: true } });
  await prisma.teamMember.create({
    data: { teamId, playerId, position: (maxPos._max.position ?? -1) + 1 },
  });
  refresh();
  return { ok: true };
}

export async function removeTeamMember(teamId: string, playerId: string): Promise<TeamResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { eventId: true } });
  if (!team || team.eventId !== eventId) return { ok: false, error: "Team not found." };
  await prisma.teamMember.deleteMany({ where: { teamId, playerId } });
  refresh();
  return { ok: true };
}

export interface DrawResult extends TeamResult {
  /** Set when the draw would replace sides that already exist. */
  needsConfirm?: boolean;
  existing?: number;
}

/**
 * Draw sides automatically for a round, balancing them by handicap.
 *
 * Refuses to silently replace existing sides — an organizer who has spent
 * twenty minutes arranging a member-guest draw should not lose it to a
 * misplaced click. Pass `replace` to go ahead.
 */
export async function autoDrawTeams(
  stageId: string,
  replace = false,
): Promise<DrawResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  await stageInEvent(eventId, stageId);

  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { format: true } });
  if (!stage) return { ok: false, error: "Round not found." };
  if (!needsTeams(stage.format)) {
    return { ok: false, error: `${stage.format} is played by individuals, not teams.` };
  }

  const existing = await prisma.team.findMany({ where: { eventId, stageId }, select: { id: true } });
  if (existing.length > 0 && !replace) {
    return { ok: false, needsConfirm: true, existing: existing.length };
  }
  if (existing.length > 0) {
    const scored = await prisma.teamScorecard.count({
      where: { teamId: { in: existing.map((t) => t.id) }, NOT: { strokes: "[]" } },
    });
    if (scored > 0) {
      return { ok: false, error: "Scores have already been recorded for this round's teams." };
    }
    await prisma.team.deleteMany({ where: { id: { in: existing.map((t) => t.id) } } });
  }

  const players = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    select: { id: true, handicap: true },
    orderBy: { seed: "asc" },
  });
  if (players.length === 0) return { ok: false, error: "No confirmed players to draw." };

  const { min } = sideSizeRange(stage.format);
  const sides = snakeDraw(players, min);

  for (let i = 0; i < sides.length; i += 1) {
    const team = await prisma.team.create({
      data: { eventId, stageId, name: `Team ${i + 1}`, seed: i + 1 },
    });
    await prisma.teamMember.createMany({
      data: sides[i].map((p, pos) => ({ teamId: team.id, playerId: p.id, position: pos })),
    });
  }

  refresh();
  return { ok: true };
}
