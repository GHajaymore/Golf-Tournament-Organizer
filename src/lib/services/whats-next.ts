import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import type { Session } from "../auth";
import { accessibleEvents } from "./access";
import { organizationAccess } from "./org-access";
import { loadEventState } from "./tournament";
import { todayForEvent } from "./club-clock";
import { formattingForEvent } from "./organization";
import { awaitingApproval, parseDeadlineIso } from "../registration";
import { tournamentJob, whatsNext, type ClubJob, type TournamentJob, type TournamentJobFacts } from "../domain/needs-you-now";
import { shortDate } from "../domain/round-dates";
import { isFinished } from "../domain/lifecycle-state";
import { tournamentStatus, type TournamentStatus } from "../domain/tournament-status";
import { tournamentFactsForMany } from "./tournament-facts";
import { tournamentStatusFor } from "./tournament-status";
import { roundLabel } from "../domain/round-label";
import { isPlayingRound } from "../stage-types";
import { TEAM_SESSION } from "./cup";
import { needsStrokesFor, playersNeedingFigure, type NeedsStrokesRound } from "./committee-figure";

/**
 * THE SECRETARY'S HOME — what's next for every tournament of the open
 * tournament's club, and the tournaments "Copy last event" may start from.
 *
 * WHOSE TOURNAMENTS: the ones this person runs (admin or assistant) in the club
 * the open tournament belongs to — `accessibleEvents`, the same list every
 * door asks, narrowed to staff and to one club. Another club's tournaments are
 * never in it, even for somebody who runs both: the home is the club's.
 *
 * WHO MAY ACT: `canEdit` — the club's Commissioner or an Admin (or an ownerless
 * club's organizer, `canAdministerOrganization`). Anybody else on the console
 * sees the same lines with no buttons, and is offered no copy: a Guest who runs
 * one tournament reads what the club is waiting on and is not handed its doors.
 */

export interface SecretaryHome {
  jobs: ClubJob[];
  /** Whether this person may press the jobs' buttons and copy a tournament. */
  mayAct: boolean;
  /**
   * Tournaments a copy may start from, newest first — the first is "last event".
   * `isCup` when it is a team cup, whose two flights ARE its teams: the copy
   * panel then names no flights (a cup's dashboard never does).
   */
  copyable: { id: string; name: string; startOn: string; isCup: boolean }[];
  /** Today at the club, `yyyy-mm-dd` — the earliest day a copy may be given. */
  today: string;
}

export async function secretaryHomeFor(session: Session): Promise<SecretaryHome> {
  const today = await todayForEvent(session.eventId);
  const open = await prisma.event.findUnique({ where: { id: session.eventId }, select: { organizationId: true } });
  if (!open) return { jobs: [], mayAct: false, copyable: [], today };

  const [reach, club, formatting] = await Promise.all([
    accessibleEvents(session.email),
    organizationAccess(session),
    formattingForEvent(session.eventId),
  ]);
  const staffOf = new Map(reach.filter((r) => r.role === "admin" || r.role === "assistant").map((r) => [r.eventId, r.role]));
  const mayAct = !!club?.canEdit;

  /**
   * The club's TOURNAMENTS — never a casual round (`shape: "match"`, or the
   * expiry only a casual round carries; the same two tests `clubEventsFor`
   * makes) — that this person runs.
   */
  const events = await prisma.event.findMany({
    where: {
      id: { in: [...staffOf.keys()] },
      organizationId: open.organizationId,
      shape: { not: "match" },
      expiresAt: null,
    },
    select: {
      id: true,
      name: true,
      status: true,
      regDeadline: true,
      startOn: true,
      endOn: true,
      archivedAt: true,
      createdAt: true,
      stages: { select: { type: true, closedAt: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const copyable = mayAct
    ? events
        .filter((e) => staffOf.get(e.id) === "admin" && !e.archivedAt)
        // Newest first by the day it was played, then by when it was made — the
        // tournament a club repeats is nearly always the last one it ran.
        .sort((a, b) => (b.startOn || "").localeCompare(a.startOn || "") || b.createdAt.getTime() - a.createdAt.getTime())
        .map((e) => ({
          id: e.id,
          name: e.name,
          startOn: e.startOn,
          isCup: e.stages.some((s) => s.type === TEAM_SESSION),
        }))
    : [];

  // A finished tournament is waiting on nobody; nor is one in a lapsed club's archive.
  const running = events.filter((e) => !isFinished(e.status) && !e.archivedAt);
  if (running.length === 0) return { jobs: [], mayAct, copyable, today };

  // Entries awaiting approval, by the rule Entries reads its list with.
  const entrants = await prisma.player.findMany({
    where: { eventId: { in: running.map((e) => e.id) } },
    select: { eventId: true, status: true },
  });
  const waitingIn = new Map<string, number>();
  for (const p of awaitingApproval(entrants)) waitingIn.set(p.eventId, (waitingIn.get(p.eventId) ?? 0) + 1);
  const hasField = new Set(entrants.filter((p) => p.status === "confirmed").map((p) => p.eventId));

  /**
   * EACH TOURNAMENT'S STEP AND NEXT ACTION ARE THE MACHINE'S (state machine PR
   * 6): `tournamentStatus` of the facts, read for the whole club in one batch
   * (`tournamentFactsForMany`, the grouped read PR 2 measured on this home).
   * The open tournament is the one the layout and the dashboard have already
   * asked (`tournamentStatusFor`, request-cached on the same club day), so it
   * is not read twice.
   */
  const others = running.filter((e) => e.id !== session.eventId).map((e) => e.id);
  const [opened, batch, strokes] = await Promise.all([
    running.some((e) => e.id === session.eventId) ? tournamentStatusFor(session.eventId, today) : null,
    tournamentFactsForMany(others, today),
    // Who needs strokes from the committee, for every running tournament at once (`needsCommitteeFigure`).
    needsStrokesFor(running.map((e) => e.id)),
  ]);
  const statusOf = new Map<string, TournamentStatus>();
  if (opened) statusOf.set(session.eventId, opened.status);
  for (const [id, f] of batch) statusOf.set(id, tournamentStatus(f));

  const tournaments: TournamentJobFacts[] = [];
  for (const e of running) {
    const status = statusOf.get(e.id);
    if (!status) continue;
    const facts: TournamentJobFacts = {
      eventId: e.id,
      name: e.name,
      awaitingApproval: waitingIn.get(e.id) ?? 0,
      entriesClose: parseDeadlineIso(e.regDeadline),
      nextSheet: null,
      board: null,
      status,
      startOn: e.startOn,
      endOn: e.endOn,
      strokes: strokesJobFactsOf(strokes.get(e.id) ?? []),
    };
    /**
     * THE ROUND FACTS ARE THE TOURNAMENT'S OWN STATE — `loadEventState`, the
     * call the tee-sheet screen, score entry and the dashboard make — and only
     * for a tournament with a field and a round still open, where there can be
     * a sheet to publish or a card to chase. Everything else is answered from
     * the rows above without building a tournament's whole state.
     */
    const roundOpen = e.stages.some((s) => isPlayingRound(s.type) && s.closedAt == null);
    if (roundOpen && hasField.has(e.id)) {
      const state = await loadEventState(e.id);
      if (state) Object.assign(facts, roundJobFactsOf(state));
    }
    tournaments.push(facts);
  }

  return { jobs: whatsNext({ tournaments, today, locale: formatting.locale }), mayAct, copyable, today };
}

type EventState = NonNullable<Awaited<ReturnType<typeof loadEventState>>>;

/** The job's round: the first of `playersNeedingFigure`'s rounds (play order), and how many need strokes in it. */
function strokesJobFactsOf(rounds: readonly NeedsStrokesRound[]): TournamentJobFacts["strokes"] {
  const first = rounds[0];
  return first ? { roundId: first.stageId, round: first.label, day: first.day, count: first.players.length } : null;
}

/**
 * THE ROUND FACTS OF A TOURNAMENT'S JOBS — one builder, for the home's lines and for the open
 * tournament's one button (`openTournamentJob`), so the two read the same figures: the round the tee
 * sheet opens on, the board's round and its `boardProgress`, and the disputes `needsYouNow` counts.
 */
function roundJobFactsOf(state: EventState): Pick<TournamentJobFacts, "nextSheet" | "board" | "disputed"> {
  const next = state.nextUnplayedRound;
  const b = state.boardStage;
  return {
    nextSheet:
      next && state.confirmed.length > 0
        ? { roundId: next.id, round: roundLabel(state.stages, next.id) || "The next round", day: next.playedOn, published: next.teeSheetPublished }
        : null,
    board: b
      ? {
          roundId: b.id,
          round: roundLabel(state.stages, b.id) || "The round",
          day: b.playedOn,
          closed: b.closedAt != null,
          unit: state.boardProgress.unit,
          started: state.boardProgress.started,
          certified: state.boardProgress.certified,
          total: state.boardProgress.total,
        }
      : null,
    disputed: state.reviewing.disputed,
  };
}

/**
 * THE OPEN TOURNAMENT'S ONE BUTTON (the panel's ruling on the stepper, 9 Nov): `tournamentJob` of the
 * same facts the home reads, from the status the layout and the dashboard already asked
 * (`tournamentStatusFor`, request-cached on the club's day). The dashboard's status card presses it and
 * the lifecycle stepper marks it. Null for a casual round, which has neither.
 */
export const openTournamentJob = cache(async (eventId: string, today: string): Promise<TournamentJob | null> => {
  const [event, told, state, formatting, strokes] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { name: true, regDeadline: true, startOn: true, endOn: true } }),
    tournamentStatusFor(eventId, today),
    loadEventState(eventId),
    formattingForEvent(eventId),
    // As the home reads it, so the one button and the home's first line cannot disagree.
    playersNeedingFigure(eventId),
  ]);
  if (!event || !told || !state) return null;
  const entrants = await prisma.player.findMany({ where: { eventId }, select: { eventId: true, status: true } });
  const facts: TournamentJobFacts = {
    eventId,
    name: event.name,
    awaitingApproval: awaitingApproval(entrants).length,
    entriesClose: parseDeadlineIso(event.regDeadline),
    nextSheet: null,
    board: null,
    status: told.status,
    startOn: event.startOn,
    endOn: event.endOn,
    strokes: strokesJobFactsOf(strokes),
    // As the home reads them: a sheet to publish or a card to chase only with a field and a round open.
    ...(state.confirmed.length > 0 && state.stages.some((s) => isPlayingRound(s.type) && s.closedAt == null) ? roundJobFactsOf(state) : {}),
  };
  return tournamentJob(facts, today, (iso) => shortDate(iso, formatting.locale));
});
