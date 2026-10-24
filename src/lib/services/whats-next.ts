import "server-only";
import { prisma } from "../db";
import type { Session } from "../auth";
import { accessibleEvents } from "./access";
import { organizationAccess } from "./org-access";
import { loadEventState } from "./tournament";
import { todayForEvent } from "./club-clock";
import { formattingForEvent } from "./organization";
import { awaitingApproval, parseDeadlineIso } from "../registration";
import { whatsNext, type ClubJob, type TournamentJobFacts } from "../domain/needs-you-now";
import { playOverOf } from "../domain/tournament-switcher";
import { isFinished, isLaunched } from "../domain/lifecycle-state";
import { roundLabel } from "../domain/round-label";
import { isPlayingRound } from "../stage-types";

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
  /** Tournaments a copy may start from, newest first — the first is "last event". */
  copyable: { id: string; name: string; startOn: string }[];
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
        .map((e) => ({ id: e.id, name: e.name, startOn: e.startOn }))
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

  const tournaments: TournamentJobFacts[] = [];
  for (const e of running) {
    const facts: TournamentJobFacts = {
      eventId: e.id,
      name: e.name,
      awaitingApproval: waitingIn.get(e.id) ?? 0,
      entriesClose: parseDeadlineIso(e.regDeadline),
      nextSheet: null,
      board: null,
      resultsWaiting: isLaunched(e.status) && playOverOf(e.stages),
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
      if (state) {
        const next = state.nextUnplayedRound;
        facts.nextSheet =
          next && state.confirmed.length > 0
            ? { round: roundLabel(state.stages, next.id) || "The next round", day: next.playedOn, published: next.teeSheetPublished }
            : null;
        const b = state.boardStage;
        facts.board = b
          ? {
              round: roundLabel(state.stages, b.id) || "The round",
              day: b.playedOn,
              closed: b.closedAt != null,
              unit: state.boardProgress.unit,
              started: state.boardProgress.started,
              certified: state.boardProgress.certified,
              total: state.boardProgress.total,
            }
          : null;
      }
    }
    tournaments.push(facts);
  }

  return { jobs: whatsNext({ tournaments, today, locale: formatting.locale }), mayAct, copyable, today };
}
