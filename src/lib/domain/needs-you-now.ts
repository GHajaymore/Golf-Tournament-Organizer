import type { ReviewQueue } from "./review-queue";
import type { TournamentStatus, WayOut } from "./tournament-status";
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
 *   launch     "Starts Sat 25 Oct · ready to launch"
 *   draw       "Round 2 is not drawn yet"              (the next action, once live)
 *   cards      "Round 2: 4 cards not returned"
 *   results    "Every round closed · results not released"
 *
 * — each with the one button that goes to the screen that does it.
 *
 * EVERY FIGURE IS THE SCREEN'S OWN (`docs/one-rule-one-place.md`). The service
 * that gathers these facts (`services/whats-next.ts`) asks the same functions
 * the screens they point to ask: entries awaiting approval as Entries lists
 * them (`awaitingApproval`), the round the tee-sheet screen opens on
 * (`nextUnplayedRound`) and its `teeSheetPublished`, the board's round and its
 * `boardProgress`. This function only words and orders them, so the home
 * cannot disagree with the screen it sends the secretary to.
 *
 * THE TOURNAMENT'S OWN JOB IS THE MACHINE'S (state machine PR 6, J15): the one
 * next action of `tournamentStatus(facts)` — launch it, draw the next round,
 * date the next week, complete it — WITH ITS REFUSAL. So the home never says
 * "Complete the tournament" over a card the dashboard then refuses to complete
 * on (D3): it says the refusal and offers its way out. And a knockout whose
 * Final is decided reaches the home at all, which "every round closed" never
 * let it do — nobody closes a Bracket Stage (D3k).
 */

/**
 * The screens a job may send somebody to — and so the only ones `enterTournament` will open with one.
 * Rounds & formats joined with the machine's next actions (PR 6): a live tournament's next round is
 * drawn there, and a league's next week is dated there.
 */
export const JOB_SCREENS = ["/registration", "/foursomes", "/stages", "/entry", "/dashboard"] as const;
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
  nextSheet: { roundId?: string; round: string; day: string; published: boolean } | null;
  /** The board's round (`state.boardStage`) and its `boardProgress`. Null with no round. */
  board: {
    /** The round's id, so "Close Round 1" opens that round (`/stages?round=`). Optional for older callers. */
    roundId?: string;
    round: string;
    day: string;
    closed: boolean;
    unit: "cards" | "matches" | "sides" | "ties" | "manual";
    started: number;
    certified: number;
    total: number;
  } | null;
  /**
   * THE MACHINE'S ANSWER for this tournament (`tournamentStatus(facts)`): its
   * step, the line under "Play over", whether results are in unlaunched, and
   * THE one next action with its refusal and way out. Never worked out here.
   */
  status: Pick<TournamentStatus, "step" | "chipDetail" | "underWayUnlaunched" | "nextAction">;
  /** Its first and last day, `yyyy-mm-dd` or "" — when a launch falls due. */
  startOn: string;
  endOn: string;
  /**
   * Disputed results waiting to be settled (`state.reviewing.disputed`, as `needsYouNow` counts them).
   * A dispute outranks chasing cards: approving is never the answer to one. Absent is none.
   */
  disputed?: number;
}

/**
 * `settle` and `close` are jobs on the home and the one button (the panel's ruling on the stepper,
 * 9 Nov): a disputed result, and a round whose every card is in but which nobody has closed. `waiting`
 * and `reopen` are only ever a tournament's own answer (`tournamentJob`) — nothing to do yet, and a
 * completed tournament's remedy — never a line on the home.
 */
export type ClubJobKey =
  | "entries"
  | "settle"
  | "tee-sheet"
  | "launch"
  | "schedule"
  | "draw"
  | "cards"
  | "close"
  | "results"
  | "waiting"
  | "reopen";

export interface ClubJob {
  key: ClubJobKey;
  eventId: string;
  eventName: string;
  text: string;
  href: JobScreen;
  action: string;
  /** The day it falls due, `yyyy-mm-dd` — what the list is ordered by. */
  due: string;
  /** The round it opens, for a job done on one round (`Close Round 1`, a draw): `/stages?round=`. */
  roundId?: string;
}

/**
 * On the same day, the job earlier in a tournament's life first — and a dispute before the cards it
 * holds up. Launch before the tee sheet (the panel, 9 Nov): while setting up, the one button is
 * Launch, and a first round's sheet falls due on the first day, the day a launch does.
 */
const JOB_ORDER: Record<ClubJobKey, number> = {
  entries: 0,
  launch: 1,
  "tee-sheet": 2,
  schedule: 3,
  draw: 4,
  settle: 5,
  cards: 6,
  close: 7,
  results: 8,
  waiting: 9,
  reopen: 10,
};

/** A launch is a job once the first day is this near — the tee sheet's fortnight. */
export const LAUNCH_AHEAD_DAYS = TEE_SHEET_AHEAD_DAYS;

const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * THE TOURNAMENT'S OWN JOB — its next action, as the machine gives it.
 *
 *   setting up   Launch, when the first day is within a fortnight and not yet
 *                gone (a championship in March is not this week's work, and
 *                one whose dates went by unlaunched is the Tournaments list's
 *                "Dates passed", not a job) — or at once when results are in
 *                on it unlaunched (D2, D5)
 *   live         the next round's draw or the next week's day, when that is
 *                the next action; Complete is NOT a job while golf is being
 *                played — the cards are
 *   play over    Complete, or its refusal: "1 result is still waiting to be
 *                signed off" with Open Score entry, never a button the
 *                dashboard would refuse (D3)
 *   completed    nothing: a completed tournament never appears
 *
 * A refused action goes to its way out when that is a job's screen, and to the
 * dashboard otherwise, where the refusal is said in place with its way out.
 */
function lifecycleJob(t: TournamentJobFacts, today: string, day: (iso: string) => string, window = true): ClubJob | null {
  const st = t.status;
  const next = st.nextAction;
  if (!next) return null;
  const base = { eventId: t.eventId, eventName: t.name };
  const refused = (lead: string): Pick<ClubJob, "text" | "href" | "action"> => {
    const way = next.wayOut;
    const out = way && isJobScreen(way.href) ? way.href : null;
    return {
      text: lead ? `${lead} · ${next.disabledBecause ?? ""}` : (next.disabledBecause ?? ""),
      href: out ?? "/dashboard",
      action: out && way ? way.says : next.kind === "launch" ? "Finish setting up" : "Open the dashboard",
    };
  };
  const pressed = (href: string): JobScreen => (isJobScreen(href) ? href : "/dashboard");

  if (st.step === "setting-up" && next.kind === "launch") {
    const first = isIso(t.startOn) ? t.startOn : "";
    const last = isIso(t.endOn) ? t.endOn : first;
    const soon = !!first && first <= addDays(today, LAUNCH_AHEAD_DAYS) && last >= today;
    // The home waits for the fortnight; the tournament's own button does not (`tournamentJob`).
    if (window && !soon && !st.underWayUnlaunched) return null;
    const lead = st.underWayUnlaunched ? "Results are in · not launched" : first ? `Starts ${day(first)}` : "No dates yet";
    const due = first && first > today ? first : today;
    if (!next.enabled) return { ...base, key: "launch", due, ...refused(lead) };
    return { ...base, key: "launch", text: `${lead}${st.underWayUnlaunched ? "" : " · ready to launch"}`, href: "/dashboard", action: next.label, due };
  }
  if (st.step === "live" && (next.kind === "draw" || next.kind === "schedule")) {
    return {
      ...base,
      key: next.kind,
      text: next.kind === "draw" ? "The next round is not drawn yet" : "The next week has no day or deadline yet",
      href: pressed(next.href),
      action: next.label,
      due: today,
      ...(next.roundId ? { roundId: next.roundId } : {}),
    };
  }
  if (st.step === "play-over" && next.kind === "complete") {
    if (!next.enabled) return { ...base, key: "results", due: today, ...refused("") };
    return { ...base, key: "results", text: st.chipDetail, href: pressed(next.href), action: next.label, due: today };
  }
  return null;
}

export function whatsNext(input: {
  tournaments: readonly TournamentJobFacts[];
  /** Today at the club, `clubToday(zone)`. Required: this module has no clock. */
  today: string;
  /** How the club writes a day — `shortDate`'s locale. */
  locale: string;
}): ClubJob[] {
  const { today, locale } = input;
  const day = (iso: string) => shortDate(iso, locale);
  return byDue(input.tournaments.flatMap((t) => jobsOf(t, today, day, true)));
}

function byDue(jobs: ClubJob[]): ClubJob[] {
  return jobs.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : JOB_ORDER[a.key] - JOB_ORDER[b.key]));
}

/**
 * ONE TOURNAMENT'S JOBS — the home's lines for it (`window`: the fortnight for a tee sheet and a
 * launch), or, without the window, every job it has whenever it falls due (`tournamentJob`).
 */
function jobsOf(t: TournamentJobFacts, today: string, day: (iso: string) => string, window: boolean): ClubJob[] {
  const jobs: ClubJob[] = [];
  {
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
      (!window || sheet.day <= addDays(today, TEE_SHEET_AHEAD_DAYS))
    ) {
      jobs.push({
        ...base,
        key: "tee-sheet",
        text: `${sheet.round} tee sheet for ${day(sheet.day)} is not published`,
        href: "/foursomes",
        action: "Publish the tee sheet",
        due: sheet.day,
        ...(sheet.roundId ? { roundId: sheet.roundId } : {}),
      });
    }

    /**
     * Cards a round files and is waiting for — not a knockout's ties, a round
     * scored by hand or a round of fixtures — and only once the round is being
     * played: before its day every card is "not returned" and nobody is late.
     *
     * COUNTED IN, not out (the panel, 9 Nov): "Round 1 · 18 of 24 cards in", in
     * the board's own unit, so a scramble counts sides. A disputed result comes
     * before it on the same day — approving is never the answer to one — and once
     * every card is in, the job is closing the round, which opens that round on
     * Rounds & formats, where "Is this round over?" asks or refuses
     * (`roundCloseCheck`).
     */
    const b = t.board;
    const playing = !!b && !b.closed && (b.unit === "cards" || b.unit === "sides") && (b.started > 0 || (!!b.day && b.day <= today));
    const cardsDue = b && b.day && b.day < today ? b.day : today;
    if ((t.disputed ?? 0) > 0) {
      jobs.push({
        ...base,
        key: "settle",
        text: `${n(t.disputed ?? 0, "disputed result", "disputed results")} to settle`,
        href: "/entry",
        action: "Settle it",
        due: playing ? cardsDue : today,
        ...(b?.roundId ? { roundId: b.roundId } : {}),
      });
    }
    if (b && playing) {
      const unit = b.unit === "sides" ? "sides" : "cards";
      if (b.total - b.certified > 0) {
        jobs.push({
          ...base,
          key: "cards",
          text: `${b.round} · ${b.certified} of ${b.total} ${unit} in`,
          href: "/entry",
          action: "Open score entry",
          due: cardsDue,
          ...(b.roundId ? { roundId: b.roundId } : {}),
        });
      } else if (b.total > 0) {
        jobs.push({
          ...base,
          key: "close",
          text: `${b.round} · all ${b.total} ${unit} in`,
          href: "/stages",
          action: `Close ${b.round}`,
          due: cardsDue,
          ...(b.roundId ? { roundId: b.roundId } : {}),
        });
      }
    }

    const own = lifecycleJob(t, today, day, window);
    if (own) jobs.push(own);
  }
  return jobs;
}

/**
 * THE TOURNAMENT'S ONE BUTTON — what its dashboard card offers and the lifecycle stepper marks (the
 * panel's ruling, 9 Nov). Never "Complete tournament" while golf is being played: the machine's next
 * action offers Complete from the first card, which at a two-day outing is one press from ending it
 * before day 2. By phase:
 *
 *   setting up        Launch tournament (refused in place, with its way out) — at once, not only in
 *                     the fortnight the home waits for
 *   launched          Publish the tee sheet; with the sheet out, no button: "Round 1 tees off Sun 29 Nov"
 *   during play       Open score entry, "Round 1 · 18 of 24 cards in"; a dispute first ("Settle it")
 *   every card in     Close Round 1 (opens it on Rounds & formats)
 *   between rounds    Generate Round 2 pairings when a draw is owed; else the tee sheet; else waiting
 *   play over         Complete tournament, "Every round closed · results not released"
 *   completed         Reopen tournament (quiet)
 *
 * ONE ANSWER WITH THE HOME: when the home has a line for this tournament, the button is its FIRST line
 * — `whatsNext` of this tournament alone — so the two cannot disagree. Only when the home has none
 * (outside its fortnight, or nothing to do) is it the same jobs without the window, then waiting, then
 * the machine's own next action.
 */
export interface TournamentJob {
  key: ClubJobKey;
  /** The line: "Round 1 · 18 of 24 cards in", "Round 1 tees off Sun 29 Nov". */
  text: string;
  /** The button's words; null when there is nothing to press (waiting). */
  action: string | null;
  /** Where it is done, with the round when it is one round's (`/stages?round=…`). */
  href: string;
  enabled: boolean;
  /** The machine's refusal, word for word, when it is refused. */
  disabledBecause: string | null;
  wayOut: WayOut | null;
  /** Launch, Complete and Reopen MOVE the status: the dashboard's own button presses them (`nextAction`). */
  moves: boolean;
  /** Reopen is offered quietly: it is a remedy, not a need. */
  quiet: boolean;
  /** The round it is about — the board's, the tee sheet's, the draw's — or null for the whole tournament. */
  roundId: string | null;
}

export function tournamentJob(t: TournamentJobFacts, today: string, day: (iso: string) => string): TournamentJob | null {
  const next = t.status.nextAction;
  if (!next) return null;
  // A completed tournament waits on nobody — the home never lists one — and its button is Reopen.
  if (t.status.step === "completed") {
    return { key: "reopen", text: "Completed", action: next.label, href: next.href, enabled: next.enabled, disabledBecause: next.disabledBecause, wayOut: next.wayOut, moves: true, quiet: true, roundId: null };
  }
  const home = byDue(jobsOf(t, today, day, true))[0];
  const own = home ?? byDue(jobsOf(t, today, day, false))[0];
  if (own) return jobFrom(own, t);

  const st = t.status.step;
  if (st === "live") {
    // Nothing to press: when the next round tees off, or that it is being played.
    const sheet = t.nextSheet;
    const b = t.board;
    const teesOff = !!sheet && sheet.published && !!sheet.day && sheet.day >= today;
    const text = teesOff ? `${sheet!.round} tees off ${day(sheet!.day)}` : b && !b.closed ? `${b.round} is being played` : "Play is under way";
    const roundId = (teesOff ? sheet!.roundId : b && !b.closed ? b.roundId : undefined) ?? null;
    return { key: "waiting", text, action: null, href: "/dashboard", enabled: true, disabledBecause: null, wayOut: null, moves: false, quiet: true, roundId };
  }
  // The machine's own answer, as it gives it (never Complete while live: handled above).
  return {
    key: next.kind === "complete" ? "results" : next.kind === "reopen" ? "reopen" : next.kind === "launch" ? "launch" : next.kind,
    text: t.status.chipDetail || next.label,
    action: next.label,
    href: next.roundId && next.href === "/stages" ? `/stages?round=${next.roundId}` : next.href,
    enabled: next.enabled,
    disabledBecause: next.disabledBecause,
    wayOut: next.wayOut,
    moves: next.kind === "launch" || next.kind === "complete" || next.kind === "reopen",
    quiet: next.kind === "reopen",
    roundId: next.roundId,
  };
}

function jobFrom(j: ClubJob, t: TournamentJobFacts): TournamentJob {
  const next = t.status.nextAction!;
  const href = j.roundId && j.href === "/stages" ? `/stages?round=${j.roundId}` : j.href;
  // A status move is the machine's button, refused or not — its own words, refusal and way out.
  if (j.key === "launch" || j.key === "results") {
    // The home's line ends in the refusal ("Starts Sat 21 Nov · <refusal>"); here the refusal is said
    // beside the refused button, so the line keeps only its lead.
    const because = next.disabledBecause ?? "";
    const lead = !next.enabled && because && j.text.endsWith(because) ? j.text.slice(0, j.text.length - because.length).replace(/ · $/, "") : j.text;
    return {
      key: j.key,
      text: lead || t.status.chipDetail,
      action: next.label,
      href: next.href,
      enabled: next.enabled,
      disabledBecause: next.disabledBecause,
      wayOut: next.wayOut,
      moves: true,
      quiet: false,
      roundId: null,
    };
  }
  return { key: j.key, text: j.text, action: j.action, href, enabled: true, disabledBecause: null, wayOut: null, moves: false, quiet: false, roundId: j.roundId ?? null };
}
