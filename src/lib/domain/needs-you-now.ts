import type { ReviewQueue } from "./review-queue";
import { addDays, shortDate } from "./round-dates";

/**
 * THE ORGANIZER'S TO-DO LIST ON THE DAY — Ajay, 2026-10-05.
 *
 * Read off the dashboard at 393px: a disputed result was a paragraph in the
 * status card, cards to approve were an "Awaiting review" tile, and "1
 * disputed" sat under the round's progress bar. All three were right; an
 * organizer on a phone had to find them. This is one list — a line per thing
 * to do, each with the screen it is done on.
 *
 * From `state.reviewing` only, so it cannot disagree with the counts on the
 * same screen. Disputes first: they block finishing the tournament
 * (`finishRefusal`), and approving is never the answer to one.
 */
export interface NeedsYouItem {
  key: "disputed" | "review" | "knockouts" | "lineup";
  text: string;
  href: string;
  action: string;
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function needsYouNow(input: {
  reviewing: ReviewQueue;
  /**
   * A team cup's sessions, in order (2026-10-06). Its job before every
   * session is the lineup — picked, then announced — so a drafted lineup is
   * waiting on the organizer, and so is the NEXT session with none. Only the
   * next: Sunday's singles are not Saturday morning's problem.
   */
  cup?: { sessions: { name: string; published: boolean; matches: number }[] };
}): NeedsYouItem[] {
  const q = input.reviewing;
  const items: NeedsYouItem[] = [];

  if (q.disputed > 0) {
    items.push({ key: "disputed", text: `${n(q.disputed, "disputed result", "disputed results")} to settle`, href: "/entry", action: "Settle it" });
  }

  const toApprove = [
    q.cards > 0 ? n(q.cards, "card", "cards") : "",
    q.matches > 0 ? n(q.matches, "match result", "match results") : "",
  ].filter(Boolean);
  if (toApprove.length > 0) {
    items.push({ key: "review", text: `${toApprove.join(" and ")} to approve`, href: "/entry", action: "Review" });
  }

  if (q.knockouts > 0) {
    items.push({
      key: "knockouts",
      text: `${n(q.knockouts, "knockout result", "knockout results")} reported`,
      href: "/bracket",
      action: "Review",
    });
  }

  // After the results: a pairing waits on a person, a result waits on a field.
  for (const s of input.cup?.sessions ?? []) {
    if (!s.published && s.matches > 0) {
      items.push({ key: "lineup", text: `${s.name} lineup is ready to announce`, href: "/cup", action: "Announce" });
    }
  }
  const next = input.cup?.sessions.find((s) => !s.published && s.matches === 0);
  if (next) items.push({ key: "lineup", text: `${next.name} has no lineup yet`, href: "/cup", action: "Set the lineup" });

  return items;
}

/**
 * WHAT'S NEXT, ACROSS THE CLUB — the secretary's home (the panel's item 4,
 * approved by Ajay, 2026-10-24).
 *
 * `needsYouNow` above is the open tournament's results waiting on a person.
 * This is the club's calendar of jobs: for every tournament the secretary runs,
 * the next thing it is waiting on them for, one line each, in the order they
 * fall due —
 *
 *   entries    "Entries close Fri 24 Oct · 3 entries awaiting approval"
 *   tee sheet  "Round 1 tee sheet for Sat 25 Oct is not published"
 *   cards      "Round 2: 4 cards not returned"
 *   results    "Every round is closed · results not released"
 *
 * — each with the one button that goes to the screen that does it.
 *
 * EVERY FIGURE IS THE SCREEN'S OWN (`docs/one-rule-one-place.md`). The service
 * that gathers these facts (`services/whats-next.ts`) asks the same functions
 * the screens they point to ask: entries awaiting approval as Entries lists
 * them (`awaitingApproval`), the round the tee-sheet screen opens on
 * (`nextUnplayedRound`) and its `teeSheetPublished`, the board's round and its
 * `boardProgress`, and `playOverOf` for a tournament whose golf is finished.
 * This function only words and orders them, so the home cannot disagree with
 * the screen it sends the secretary to.
 */

/** The screens a job may send somebody to — and so the only ones `enterTournament` will open with one. */
export const JOB_SCREENS = ["/registration", "/foursomes", "/entry", "/dashboard"] as const;
export type JobScreen = (typeof JOB_SCREENS)[number];
export const isJobScreen = (v: unknown): v is JobScreen =>
  typeof v === "string" && (JOB_SCREENS as readonly string[]).includes(v);

/** How far ahead an unpublished tee sheet is a job. A sheet for a round next month is not this week's work. */
export const TEE_SHEET_AHEAD_DAYS = 14;

export interface TournamentJobFacts {
  eventId: string;
  name: string;
  /** Entries waiting for the committee to approve — `awaitingApproval`, as Entries lists them. */
  awaitingApproval: number;
  /** The sign-up deadline, `yyyy-mm-dd`, or "" when none parses. */
  entriesClose: string;
  /**
   * The round the tee-sheet screen opens on (`state.nextUnplayedRound`), when
   * the tournament has a field to draw it from. Null when there is none.
   */
  nextSheet: { round: string; day: string; published: boolean } | null;
  /** The board's round (`state.boardStage`) and its `boardProgress`. Null with no round. */
  board: {
    round: string;
    day: string;
    closed: boolean;
    unit: "cards" | "matches" | "sides" | "ties" | "manual";
    started: number;
    certified: number;
    total: number;
  } | null;
  /** Launched, not completed, and every round closed (`playOverOf`). */
  resultsWaiting: boolean;
}

export type ClubJobKey = "entries" | "tee-sheet" | "cards" | "results";

export interface ClubJob {
  key: ClubJobKey;
  eventId: string;
  eventName: string;
  text: string;
  href: JobScreen;
  action: string;
  /** The day it falls due, `yyyy-mm-dd` — what the list is ordered by. */
  due: string;
}

const JOB_ORDER: Record<ClubJobKey, number> = { entries: 0, "tee-sheet": 1, cards: 2, results: 3 };

export function whatsNext(input: {
  tournaments: readonly TournamentJobFacts[];
  /** Today at the club, `clubToday(zone)`. Required: this module has no clock. */
  today: string;
  /** How the club writes a day — `shortDate`'s locale. */
  locale: string;
}): ClubJob[] {
  const { today, locale } = input;
  const jobs: ClubJob[] = [];
  const day = (iso: string) => shortDate(iso, locale);

  for (const t of input.tournaments) {
    const base = { eventId: t.eventId, eventName: t.name };

    if (t.awaitingApproval > 0) {
      const waiting = n(t.awaitingApproval, "entry awaiting approval", "entries awaiting approval");
      // The deadline day itself is still open (`registrationStatus`), so it is said until it has gone.
      const closes = t.entriesClose && t.entriesClose >= today ? t.entriesClose : "";
      jobs.push({
        ...base,
        key: "entries",
        text: closes ? `Entries close ${day(closes)} · ${waiting}` : waiting,
        href: "/registration",
        action: "Approve entries",
        due: closes || today,
      });
    }

    const sheet = t.nextSheet;
    if (
      sheet &&
      !sheet.published &&
      sheet.day &&
      sheet.day >= today &&
      sheet.day <= addDays(today, TEE_SHEET_AHEAD_DAYS)
    ) {
      jobs.push({
        ...base,
        key: "tee-sheet",
        text: `${sheet.round} tee sheet for ${day(sheet.day)} is not published`,
        href: "/foursomes",
        action: "Publish the tee sheet",
        due: sheet.day,
      });
    }

    /**
     * Cards a round files and is waiting for — not a knockout's ties, a round
     * scored by hand or a round of fixtures — and only once the round is being
     * played: before its day every card is "not returned" and nobody is late.
     */
    const b = t.board;
    if (b && !b.closed && (b.unit === "cards" || b.unit === "sides") && (b.started > 0 || (!!b.day && b.day <= today))) {
      const out = b.total - b.certified;
      if (out > 0) {
        const sides = b.unit === "sides";
        jobs.push({
          ...base,
          key: "cards",
          text: `${b.round}: ${n(out, sides ? "side" : "card", sides ? "sides" : "cards")} not returned`,
          href: "/entry",
          action: "Open score entry",
          due: b.day && b.day < today ? b.day : today,
        });
      }
    }

    if (t.resultsWaiting) {
      jobs.push({
        ...base,
        key: "results",
        text: "Every round is closed · results not released",
        href: "/dashboard",
        action: "Complete the tournament",
        due: today,
      });
    }
  }

  return jobs.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : JOB_ORDER[a.key] - JOB_ORDER[b.key]));
}
