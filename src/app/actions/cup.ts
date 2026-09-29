"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { boardChanged } from "@/lib/services/board-refresh";
import { matchCarrierGroup } from "@/lib/services/match-carrier";
import { lookupFormat } from "@/lib/formats";
import { holesPlayed } from "@/lib/domain/handicap";
import { TEAM_SESSION } from "@/lib/services/cup";

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

/** The event's two teams, or null when it does not have exactly two flights. */
async function teamsOf(eventId: string) {
  const flights = await prisma.group.findMany({
    where: { eventId, stageId: null, isCarrier: false },
    orderBy: { position: "asc" },
    select: { id: true, name: true },
  });
  return flights.length === 2 ? (flights as [(typeof flights)[0], (typeof flights)[0]]) : null;
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
    select: { id: true, format: true, holes: true, position: true },
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
  if (!started && sides.length) {
    started = (await prisma.teamScorecard.count({ where: { teamId: { in: sides }, NOT: { strokes: "[]" } } })) > 0;
  }
  if (started) return { ok: false, error: "That match has scores in it, so it stays. Clear its scores first." };
  await prisma.match.delete({ where: { id: m.id } });
  if (sides.length) await prisma.team.deleteMany({ where: { id: { in: sides }, eventId } });
  await logAudit(eventId, "cup.lineup", "Match removed from the lineup");
  await refresh(eventId);
  return { ok: true };
}
