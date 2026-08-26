"use server";
import { revalidatePath } from "next/cache";
import { boardChanged } from "@/lib/services/board-refresh";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { sideSizeRange, needsTeams, findFormat } from "@/lib/formats";
import { snakeDraw } from "@/lib/services/teams";
import { roundRobinSchedule } from "@/lib/domain";

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
  await refresh();
  return { ok: true };
}

export async function renameTeam(teamId: string, name: string): Promise<TeamResult> {
  const eventId = await requireStaff();
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { eventId: true } });
  if (!team || team.eventId !== eventId) return { ok: false, error: "Team not found." };
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Give the team a name." };
  await prisma.team.update({ where: { id: teamId }, data: { name: clean } });
  await refresh();
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
  await refresh();
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
  await refresh();
  return { ok: true };
}

export async function removeTeamMember(teamId: string, playerId: string): Promise<TeamResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { eventId: true } });
  if (!team || team.eventId !== eventId) return { ok: false, error: "Team not found." };
  await prisma.teamMember.deleteMany({ where: { teamId, playerId } });
  await refresh();
  return { ok: true };
}

/**
 * Build the match schedule for a team round: every side against every other.
 *
 * Separate from the flight-based generator, which pairs individual players and
 * is skipped entirely for team rounds — running it there would fill the round
 * with matches nobody plays, and they would count toward the standings.
 *
 * Match.groupId is required, so the sides need a group to belong to. Rather
 * than borrow a flight built for individuals, this round gets its own, named
 * after it.
 */
export async function generateTeamMatches(stageId: string, replace = false): Promise<DrawResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  await stageInEvent(eventId, stageId);

  const stage = await prisma.stage.findUnique({ where: { id: stageId } });
  if (!stage) return { ok: false, error: "Round not found." };
  if (!needsTeams(stage.format)) {
    return { ok: false, error: `${stage.format} is played by individuals — use the flight generator.` };
  }

  const teams = await prisma.team.findMany({
    where: { eventId, OR: [{ stageId }, { stageId: null }] },
    orderBy: [{ seed: "asc" }, { createdAt: "asc" }],
    select: { id: true, stageId: true },
  });
  // Round-specific sides win over event-wide ones, matching teamsForStage —
  // otherwise a redrawn round would field every pairing twice.
  const scoped = teams.filter((t) => t.stageId === stageId);
  const use = scoped.length > 0 ? scoped : teams.filter((t) => t.stageId === null);
  if (use.length < 2) {
    return { ok: false, error: "Draw at least two sides before generating matches." };
  }

  const existing = await prisma.match.findMany({ where: { eventId, stageId }, select: { id: true } });
  if (existing.length > 0 && !replace) {
    return { ok: false, needsConfirm: true, existing: existing.length };
  }
  if (existing.length > 0) {
    const scored = await prisma.teamScorecard.count({
      where: { stageId, NOT: { strokes: "[]" } },
    });
    if (scored > 0) {
      return { ok: false, error: "Scores have already been recorded for this round." };
    }
    await prisma.match.deleteMany({ where: { id: { in: existing.map((m) => m.id) } } });
  }

  const groupName = `${stage.format} — Round ${stage.position + 1}`;
  let group = await prisma.group.findFirst({ where: { eventId, name: groupName } });
  if (!group) {
    const maxPos = await prisma.group.aggregate({ where: { eventId }, _max: { position: true } });
    group = await prisma.group.create({
      data: { eventId, name: groupName, position: (maxPos._max.position ?? -1) + 1 },
    });
  }

  const emptyHoles = JSON.stringify(new Array(stage.holes === 9 ? 9 : 18).fill(null));
  const schedule = roundRobinSchedule(use.map((t) => t.id));
  for (const pairing of schedule) {
    await prisma.match.create({
      data: {
        eventId,
        stageId,
        groupId: group.id,
        round: pairing.round,
        // The sides are teams, so the player columns stay empty rather than
        // being repurposed — a column whose meaning depends on the format is
        // exactly what silently mis-joins later.
        playerAId: "",
        playerBId: "",
        teamAId: pairing.aId,
        teamBId: pairing.bId,
        holes: emptyHoles,
      },
    });
  }

  await refresh();
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

  await refresh();
  return { ok: true };
}

/**
 * Set the committee's handicap allowance for a team round.
 *
 * Zero clears it and returns the round to the allowance its format
 * recommends — a stored 0 is an absence of opinion, not a 0% allowance.
 *
 * Capped at 100 because an allowance above full handicap isn't a committee
 * decision, it's a typo, and it would hand out strokes nobody has.
 */
export async function setStageAllowance(stageId: string, percent: number): Promise<TeamResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  await stageInEvent(eventId, stageId);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return { ok: false, error: "Enter an allowance between 0 and 100 percent." };
  }
  await prisma.stage.update({
    where: { id: stageId },
    data: { handicapAllowance: Math.round(percent) },
  });
  await refresh();
  return { ok: true };
}

/**
 * Set how many partners' scores count on each hole.
 *
 * Four-ball and best ball count one. Counting the best two or three of four
 * is a common club and society variation, and it is the same engine with a
 * different count — not a different format.
 *
 * Zero clears the setting and returns the round to counting one.
 */
export async function setStageCountBest(stageId: string, count: number): Promise<TeamResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  await stageInEvent(eventId, stageId);

  if (!Number.isFinite(count) || count < 0) {
    return { ok: false, error: "Enter how many scores count, or 0 to use the format's default." };
  }

  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { format: true } });
  const max = sideSizeRange(stage?.format ?? "").max;
  if (count > max) {
    return {
      ok: false,
      error: `${stage?.format} plays at most ${max} a side, so no more than ${max} scores can count.`,
    };
  }

  await prisma.stage.update({
    where: { id: stageId },
    data: { countBest: Math.round(count) },
  });
  await refresh();
  return { ok: true };
}

/**
 * Set the committee's per-player allowance shares for a team round.
 *
 * Greensomes is 60% of the lower handicap plus 40% of the higher — the
 * published WHS recommendation — but clubs play 50/50 and 55/45 too, and
 * `handicapAllowance` is a single number that cannot say any of them.
 *
 * An empty list clears the setting and returns the round to the split its
 * format recommends, the same way zero does for the flat allowance.
 *
 * The length is checked against the format's own side size rather than
 * accepted loosely: `sideHandicap` gives a position with no weight a share of
 * zero, so a list one short would quietly drop a player's handicap out of the
 * calculation instead of failing. Better to refuse it here and say why.
 */
export async function setStageAllowanceWeights(
  stageId: string,
  weights: number[],
): Promise<TeamResult> {
  const eventId = await requireStaff();
  await assertUnlocked(eventId);
  await stageInEvent(eventId, stageId);

  if (weights.length === 0) {
    await prisma.stage.update({ where: { id: stageId }, data: { allowanceWeights: [] } });
    await refresh();
    return { ok: true };
  }

  if (weights.some((w) => !Number.isFinite(w) || w < 0 || w > 100)) {
    return { ok: false, error: "Each share must be between 0 and 100 percent." };
  }
  if (weights.every((w) => w === 0)) {
    return { ok: false, error: "At least one share has to be above zero." };
  }

  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { format: true } });
  const expected = findFormat(stage?.format ?? "").sideSize;
  if (weights.length !== expected) {
    return {
      ok: false,
      error: `${stage?.format} plays ${expected} to a side, so it needs ${expected} shares.`,
    };
  }

  await prisma.stage.update({
    where: { id: stageId },
    data: { allowanceWeights: weights.map((w) => Math.round(w)) },
  });
  await refresh();
  return { ok: true };
}
