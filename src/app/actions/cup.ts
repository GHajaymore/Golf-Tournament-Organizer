"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { matchCarrierGroup } from "@/lib/services/match-carrier";
import { lookupFormat } from "@/lib/formats";
import { holesPlayed } from "@/lib/domain/handicap";
import { TEAM_SESSION, cupBoard, sessionKind } from "@/lib/services/cup";
import { notifyLineupPublished } from "@/lib/services/cup-notify";

/**
 * THE TEAM CUP'S CONTROLS (2026-09-28): the target, the holder, and the
 * lineup of each session.
 *
 * Staff only. A lineup is set DURING the event — the afternoon foursomes are
 * named at lunch — so these are not behind the setup lock. A match is only
 * removed before a shot has been recorded in it.
 *
 * Every id a caller sends is narrowed to this event: the session, both teams'
 * flights, and every player, who must be confirmed and on the right team.
 */

type Result = { ok: boolean; error?: string };

async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  return session.eventId;
}

async function refresh(eventId: string) {
  revalidatePath("/", "layout");
  boardChanged(eventId);
}

/**
 * Whether any card on these sides holds a SCORE or a pick-up — not merely a
 * row. A card saved with every hole blank is stored as eighteen nulls, which
 * is not "[]" and is not a shot either; counting rows called a session under
 * way that nobody had played.
 */
async function sidesHaveScores(sideIds: string[]): Promise<boolean> {
  if (sideIds.length === 0) return false;
  const cards = await prisma.teamScorecard.findMany({
    where: { teamId: { in: sideIds } },
    select: { strokes: true, pickedUp: true },
  });
  const any = (json: string, test: (v: unknown) => boolean) => {
    try {
      const v = JSON.parse(json) as unknown;
      return Array.isArray(v) && v.some(test);
    } catch {
      return true; // unreadable: assume something is there, and keep it
    }
  };
  return cards.some((c) => any(c.strokes, (s) => s !== null) || any(c.pickedUp, (x) => x === true));
}

/** The event's two teams, or null when it does not have exactly two flights. */
async function teamsOf(eventId: string) {
  const flights = await prisma.group.findMany({
    where: { eventId, stageId: null, isCarrier: false },
    orderBy: { position: "asc" },
    select: { id: true, name: true },
  });
  return flights.length === 2 ? (flights as [(typeof flights)[0], (typeof flights)[0]]) : null;
}

/**
 * THE TWO TEAMS, MADE WHERE THE CUP IS RUN (2026-10-06).
 *
 * A cup's teams are the tournament's two flights, and making them meant going
 * to Flights, choosing the "Manual" formation rule and renaming the result —
 * a screen about flight sizes and balanced handicaps, asked of somebody who
 * wanted to type "Blues" and "Whites". Found walking a cup from nothing as a
 * new organizer. These write the same rows, so everything that reads a cup
 * (the board, the lineups, the score) is unchanged.
 *
 * Only while the tournament has no flights at all: two teams added beside an
 * existing division of the field would make a cup of four.
 */
export async function createCupTeams(nameA: string, nameB: string): Promise<Result> {
  const eventId = await requireStaffEvent();
  const a = String(nameA ?? "").trim().slice(0, 40);
  const b = String(nameB ?? "").trim().slice(0, 40);
  if (!a || !b) return { ok: false, error: "Name both teams." };
  if (a.toLowerCase() === b.toLowerCase()) return { ok: false, error: "Give the two teams different names." };
  const cup = await prisma.stage.count({ where: { eventId, type: TEAM_SESSION } });
  if (cup === 0) return { ok: false, error: "This tournament has no team cup sessions." };
  const flights = await prisma.group.count({ where: { eventId, stageId: null, isCarrier: false } });
  if (flights > 0) {
    return { ok: false, error: "This tournament already has flights. A cup's two teams are its flights — set them on Flights." };
  }
  await prisma.group.create({ data: { eventId, name: a, position: 0 } });
  await prisma.group.create({ data: { eventId, name: b, position: 1 } });
  await logAudit(eventId, "cup.teams", `Teams made: ${a} v ${b}`);
  await refresh(eventId);
  return { ok: true };
}

/** A team's name. One of the cup's two flights, and nothing else. */
export async function renameCupTeam(groupId: string, name: string): Promise<Result> {
  const eventId = await requireStaffEvent();
  const clean = String(name ?? "").trim().slice(0, 40);
  if (!clean) return { ok: false, error: "Give the team a name." };
  // Narrowed to this event's flights in the query itself.
  const team = await prisma.group.findFirst({
    where: { id: String(groupId), eventId, stageId: null, isCarrier: false },
    select: { id: true, name: true },
  });
  const teams = await teamsOf(eventId);
  if (!team || !teams?.some((t) => t.id === team.id)) return { ok: false, error: "That isn't one of this cup's two teams." };
  const other = teams.find((t) => t.id !== team.id)!;
  if (other.name.trim().toLowerCase() === clean.toLowerCase()) return { ok: false, error: "The other team already has that name." };
  await prisma.group.update({ where: { id: team.id }, data: { name: clean } });
  await logAudit(eventId, "cup.teams", `Team renamed: ${team.name} → ${clean}`);
  await refresh(eventId);
  return { ok: true };
}

/**
 * Put a player on a team, or take them off ("" for neither).
 *
 * Refused while they are in a lineup: a match is made of a player FROM a
 * team, and moving them would leave a match whose side is on the wrong team —
 * which the board quietly drops (`cupBoard` leaves off a match it cannot
 * place). Remove the match first, which is only allowed before it is played.
 * A captain who leaves a team stops captaining it.
 */
export async function setCupPlayerTeam(playerId: string, groupId: string): Promise<Result> {
  const eventId = await requireStaffEvent();
  const teams = await teamsOf(eventId);
  if (!teams) return { ok: false, error: "A cup needs exactly two teams. Make them first." };
  const target = String(groupId ?? "");
  if (target && !teams.some((t) => t.id === target)) return { ok: false, error: "That isn't one of this cup's two teams." };
  const player = await prisma.player.findFirst({
    where: { id: String(playerId), eventId, status: "confirmed" },
    select: { id: true, name: true, groupId: true },
  });
  if (!player) return { ok: false, error: "That player isn't confirmed in this tournament." };
  if ((player.groupId ?? "") === target) return { ok: true };

  const cupStages = (await prisma.stage.findMany({ where: { eventId, type: TEAM_SESSION }, select: { id: true } })).map((s) => s.id);
  const inLineup =
    (await prisma.match.count({
      where: { eventId, stageId: { in: cupStages }, OR: [{ playerAId: player.id }, { playerBId: player.id }] },
    })) +
    (await prisma.teamMember.count({ where: { playerId: player.id, team: { stageId: { in: cupStages } } } }));
  if (inLineup > 0) {
    return { ok: false, error: `${player.name} is in a lineup. Remove that match first, then move them.` };
  }

  if (player.groupId) {
    await prisma.group.updateMany({ where: { id: player.groupId, eventId, captainId: player.id }, data: { captainId: null } });
    await prisma.group.updateMany({ where: { id: player.groupId, eventId, viceCaptainId: player.id }, data: { viceCaptainId: null } });
  }
  await prisma.player.update({ where: { id: player.id }, data: { groupId: target || null } });
  const to = teams.find((t) => t.id === target);
  await logAudit(eventId, "cup.teams", to ? `${player.name} put on ${to.name}` : `${player.name} taken off their team`);
  await refresh(eventId);
  return { ok: true };
}

export async function setCupSettings(pointsToWin: number, holderGroupId: string): Promise<Result> {
  const eventId = await requireStaffEvent();
  const target = Number(pointsToWin);
  // Whole or half points, within reason; 0 means "more than half on offer".
  if (!Number.isFinite(target) || target < 0 || target > 200 || Math.round(target * 2) !== target * 2) {
    return { ok: false, error: "Points to win is a whole or half number, like 14½ — or 0 for more than half." };
  }
  holderGroupId = String(holderGroupId ?? "").trim();
  // Narrowed to one of THIS event's team flights, in the query itself.
  const holder = holderGroupId
    ? await prisma.group.findFirst({
        where: { id: holderGroupId, eventId, stageId: null, isCarrier: false },
        select: { id: true, name: true },
      })
    : null;
  if (holderGroupId && !holder) return { ok: false, error: "The holder has to be one of the two teams." };
  await prisma.event.update({ where: { id: eventId }, data: { cupPointsToWin: target, cupHolderGroupId: holder?.id ?? "" } });
  await logAudit(eventId, "cup.settings", `Cup: ${target > 0 ? `${target} points to win` : "more than half the points to win"}${holder ? `, ${holder.name} hold it` : ""}`);
  await refresh(eventId);
  return { ok: true };
}

export async function addCupMatch(stageId: string, teamAPlayers: string[], teamBPlayers: string[]): Promise<Result> {
  const eventId = await requireStaffEvent();
  const stage = await prisma.stage.findFirst({
    where: { id: String(stageId), eventId, type: TEAM_SESSION },
    select: { id: true, format: true, holes: true, position: true, description: true, lineupPublished: true },
  });
  if (!stage) return { ok: false, error: "That session isn't in this tournament." };
  const teams = await teamsOf(eventId);
  if (!teams) return { ok: false, error: "A cup needs exactly two teams. Set them up as two flights first." };

  const format = lookupFormat(stage.format.trim());
  const size = format && format.sideSize > 1 ? format.sideSize : 1;
  const a = [...new Set((Array.isArray(teamAPlayers) ? teamAPlayers : []).map(String))];
  const b = [...new Set((Array.isArray(teamBPlayers) ? teamBPlayers : []).map(String))];
  if (a.length !== size || b.length !== size) {
    return { ok: false, error: size === 1 ? "Pick one player from each team." : `Pick ${size} players from each team.` };
  }

  const players = await prisma.player.findMany({
    where: { id: { in: [...a, ...b] }, eventId, status: "confirmed" },
    select: { id: true, name: true, groupId: true },
  });
  const byId = new Map(players.map((p) => [p.id, p]));
  if (a.some((id) => byId.get(id)?.groupId !== teams[0].id) || b.some((id) => byId.get(id)?.groupId !== teams[1].id)) {
    return { ok: false, error: `Each side has to come from its own team: ${teams[0].name} v ${teams[1].name}.` };
  }

  // Nobody plays twice in one session.
  const existing = await prisma.match.findMany({
    where: { eventId, stageId: stage.id },
    select: { round: true, playerAId: true, playerBId: true, teamAId: true, teamBId: true },
  });
  const sideIds = existing.flatMap((m) => [m.teamAId, m.teamBId]).filter((id): id is string => !!id);
  const members = sideIds.length
    ? await prisma.teamMember.findMany({ where: { teamId: { in: sideIds } }, select: { playerId: true } })
    : [];
  const busy = new Set([...existing.flatMap((m) => [m.playerAId, m.playerBId]), ...members.map((m) => m.playerId)].filter(Boolean));
  const clash = [...a, ...b].find((id) => busy.has(id));
  if (clash) return { ok: false, error: `${byId.get(clash)!.name} already has a match in this session.` };

  // The carrier's name is a label only (`matchCarrierGroup` finds it by round).
  const groupId = await matchCarrierGroup(eventId, stage.id, `${stage.format} — cup session`);
  // After the last match in the lineup, however many were removed before — a
  // count would reuse a number and slot the new match above older ones.
  const round = existing.reduce((max, m) => Math.max(max, m.round), 0) + 1;
  const holes = JSON.stringify(new Array(holesPlayed(stage.holes)).fill(null));
  const nameOf = (ids: string[]) => ids.map((id) => byId.get(id)!.name).join(" & ");

  if (size === 1) {
    await prisma.match.create({
      data: { eventId, stageId: stage.id, groupId, round, playerAId: a[0], playerBId: b[0], holes },
    });
  } else {
    // A pair is a side for this session only, belonging to its team's flight —
    // the same shape the league gives a nominated pair.
    const pair = async (ids: string[], flight: string) =>
      prisma.team.create({
        data: {
          eventId,
          stageId: stage.id,
          name: nameOf(ids),
          clubGroupId: flight,
          members: { create: ids.map((playerId, position) => ({ playerId, position })) },
        },
        select: { id: true },
      });
    const [sa, sb] = [await pair(a, teams[0].id), await pair(b, teams[1].id)];
    await prisma.match.create({
      data: { eventId, stageId: stage.id, groupId, round, playerAId: "", playerBId: "", teamAId: sa.id, teamBId: sb.id, holes },
    });
  }
  await logAudit(eventId, "cup.lineup", `Match added: ${nameOf(a)} v ${nameOf(b)}`);
  // Into a lineup already announced — a substitute, a late pairing — the
  // match is public the moment it exists, so its four are told now.
  if (stage.lineupPublished) {
    const names = (ids: string[]) => ids.map((id) => byId.get(id)!.name);
    await notifyLineupPublished(eventId, {
      id: stage.id,
      name: stage.description.trim() || "Your session",
      kind: sessionKind(stage.format),
      matches: [{ a: names(a), aIds: a, b: names(b), bIds: b }],
    });
  }
  await refresh(eventId);
  return { ok: true };
}

/**
 * ANNOUNCE A SESSION'S LINEUP (Ajay, 2026-10-06: hidden until the organizer
 * publishes it). Both teams' pairings at once — never one side first — and
 * every player in it is told their match. Needs a lineup to announce.
 */
export async function publishCupLineup(stageId: string): Promise<Result> {
  const eventId = await requireStaffEvent();
  const stage = await prisma.stage.findFirst({
    where: { id: String(stageId), eventId, type: TEAM_SESSION },
    select: { id: true, description: true, lineupPublished: true },
  });
  if (!stage) return { ok: false, error: "That session isn't in this tournament." };
  if (stage.lineupPublished) return { ok: true };
  const matches = await prisma.match.count({ where: { eventId, stageId: stage.id } });
  if (matches === 0) return { ok: false, error: "Add this session's matches before announcing the lineup." };

  await prisma.stage.update({ where: { id: stage.id }, data: { lineupPublished: true } });
  await logAudit(eventId, "cup.lineup.publish", `Lineup announced: ${stage.description.trim() || "a session"}`);
  const board = await cupBoard(eventId, { staff: true });
  const session = board.ok ? board.board.sessions.find((s) => s.id === stage.id) : undefined;
  if (session) await notifyLineupPublished(eventId, session);
  await refresh(eventId);
  return { ok: true };
}

/**
 * Take an announcement back — a lineup published by mistake, before anybody
 * has played. Refused once a match in it has a score or a concession: by then
 * the players have the lineup and the cup has the result.
 */
export async function hideCupLineup(stageId: string): Promise<Result> {
  const eventId = await requireStaffEvent();
  const stage = await prisma.stage.findFirst({
    where: { id: String(stageId), eventId, type: TEAM_SESSION },
    select: { id: true, description: true },
  });
  if (!stage) return { ok: false, error: "That session isn't in this tournament." };
  const matches = await prisma.match.findMany({
    where: { eventId, stageId: stage.id },
    select: { holes: true, forfeitedBy: true, teamAId: true, teamBId: true },
  });
  const started = matches.some((m) => {
    if ((m.forfeitedBy ?? "").trim()) return true;
    try {
      return (JSON.parse(m.holes) as unknown[]).some((h) => h !== null);
    } catch {
      return true;
    }
  });
  const sides = matches.flatMap((m) => [m.teamAId, m.teamBId]).filter((id): id is string => !!id);
  if (started || (await sidesHaveScores(sides))) {
    return { ok: false, error: "That session is under way, so its lineup stays announced." };
  }
  await prisma.stage.update({ where: { id: stage.id }, data: { lineupPublished: false } });
  await logAudit(eventId, "cup.lineup.hide", `Lineup taken back: ${stage.description.trim() || "a session"}`);
  await refresh(eventId);
  return { ok: true };
}

export async function removeCupMatch(matchId: string): Promise<Result> {
  const eventId = await requireStaffEvent();
  const m = await prisma.match.findFirst({
    where: { id: String(matchId), eventId, stage: { type: TEAM_SESSION } },
    select: { id: true, holes: true, teamAId: true, teamBId: true, forfeitedBy: true },
  });
  if (!m) return { ok: false, error: "That match isn't in this cup." };
  let started = !!m.forfeitedBy;
  try {
    started ||= (JSON.parse(m.holes) as unknown[]).some((h) => h !== null);
  } catch {
    started = true;
  }
  const sides = [m.teamAId, m.teamBId].filter((id): id is string => !!id);
  if (!started && sides.length) started = await sidesHaveScores(sides);
  if (started) return { ok: false, error: "That match has scores in it, so it stays. Clear its scores first." };
  await prisma.match.delete({ where: { id: m.id } });
  if (sides.length) await prisma.team.deleteMany({ where: { id: { in: sides }, eventId } });
  await logAudit(eventId, "cup.lineup", "Match removed from the lineup");
  await refresh(eventId);
  return { ok: true };
}
