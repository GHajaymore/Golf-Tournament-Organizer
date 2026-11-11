/**
 * THE LIFECYCLE STEPPER, READ FROM THE MACHINE (backlog B03, J16; the panel's ruling of 9 Nov).
 *
 * The "Setting up n of 5" rail, grown to the whole of running a tournament:
 * Set up · Tee times (Draw for a knockout) · Play · Results. One connected
 * track, a stop for each step, each stop in one of four states with its reason
 * in words:
 *
 *   done   finished (said by its tick and the word; no "Done." sentence)
 *   now    the stop the tournament is on, and its press is allowed
 *   held   something waits on it: it holds launch, or the one button is refused
 *          on it (the refusal, word for word, is its reason)
 *   todo   not yet, or optional ("Optional — one field.")
 *
 * IT DECIDES NOTHING. The stops are the machine's (`tournamentStatus(facts)`):
 *
 *   Set up      `st.setup.steps` — their own `done`, `holds`, `optional`, `missing` — then Launch
 *   Tee times   the first round's draw and tee times (`st.rounds[0].needs`)
 *   Play        one stop per playing round (`st.rounds[i].state` and its needs)
 *   Results     `st.step`
 *
 * and the stop it marks is where the ONE BUTTON is: `tournamentJob` (needs-you-
 * now.ts), the job the dashboard's card presses and the home's first line for
 * this tournament. The track carries that job as `press`, unchanged, so the
 * track, the dashboard and What's next are one answer and cannot disagree
 * (`lifecycle-track.test.ts` holds it over every family at every stage, and over
 * generated tournaments):
 *
 *   launch, refused, a step holds it   that setup stop (held; its way out opens it)
 *   launch                             the Launch stop
 *   entries                            Entries
 *   tee-sheet, draw, schedule          the round it names: the first round's is the
 *                                      Tee times stop, a later one's is its Play stop
 *   settle, cards, close, waiting      the round being played (or next to play)
 *   results, reopen                    Results
 *
 * A casual round has no track: it is created live, on one screen, and the rail
 * never drew for one either. Pure, so the server works it out once and the
 * tests read the same answer.
 */
import type { TournamentJob } from "./needs-you-now";
import type { Family, NextAction, RoundNeed, StatusRound, TournamentStatus } from "./tournament-status";

export type TrackState = "done" | "now" | "held" | "todo";
export type PhaseKey = "setup" | "draw" | "day" | "after";

/** The words beside a stop: the state is said, never only coloured. */
export const STATE_WORD: Record<TrackState, string> = {
  done: "Done",
  now: "Now",
  held: "Needs you",
  todo: "To do",
};

/**
 * What a golfer calls each phase (the UX Writer, 9 Nov): a knockout is drawn, a cup names its
 * lineups, a league works week by week; everything else gets tee times (the console structure
 * review, 9 Nov; the Golf Pro: "a knockout organizer says the draw").
 *
 * THE ONE PLACE THE STOPS ARE NAMED: the stepper's track reads it (`lifecycleTrack`), and the
 * console's menu takes its headings from that track (`lifecycleNav`, nav-lifecycle.ts), so the
 * stepper and the menu cannot call one stop two things.
 */
export function phaseTitle(key: PhaseKey, family: Family): string {
  if (key === "setup") return "Set up";
  if (key === "draw") {
    if (family === "knockout" || family === "flightedKnockout") return "Draw";
    if (family === "teamCup") return "Lineups";
    if (family === "league") return "This week";
    return "Tee times";
  }
  if (key === "day") return "Play";
  return "Results";
}

export interface TrackStep {
  key: string;
  phase: PhaseKey;
  label: string;
  href: string;
  state: TrackState;
  /** Why it is in that state, as a sentence. Empty only for a finished stop. */
  reason: string;
  /** Nothing waits for it (a medal's flights, the money answer): left out of the count. */
  optional: boolean;
  /** The round it is, for a Play stop (and the round a draw is about). */
  roundId: string | null;
}

export interface TrackPhase {
  key: PhaseKey;
  title: string;
  /** The current stop's state when it is in this phase; else done when every stop is, else held/todo. */
  state: TrackState;
  steps: TrackStep[];
  /** "4 of 5 done": the stops finished, of the ones that count (optional ones left out). */
  done: number;
  counted: number;
}

export interface LifecycleTrack {
  family: Family;
  /** The machine's step: where the track is drawn in full depends on it (`stepperOpenOn`). */
  step: TournamentStatus["step"];
  /** The machine's chip — "Setting up", "Live · Suspended", "Play over" — said once, in the stepper's head. */
  chip: string;
  chipDetail: string;
  phases: TrackPhase[];
  /** Every stop, in order — `phases` flattened. */
  steps: TrackStep[];
  /** Index into `steps` of the one current stop. */
  current: number;
  /** THE one button — `tournamentJob`, unchanged. */
  press: TournamentJob;
}

/** The first round's draw, by family: what a golfer calls it, and where it is done. */
function drawStop(family: Family, needs: RoundNeed[]): { label: string; href: string } {
  const teeSheet = needs.some((n) => n.fix === "tee-sheet");
  if (family === "stroke" || family === "stableford" || teeSheet) return { label: "Tee sheet", href: "/foursomes" };
  if (family === "knockout" || family === "flightedKnockout") return { label: "The draw", href: "/bracket" };
  if (family === "match") return { label: "The match", href: "/stages" };
  return { label: "Pairings", href: "/stages" };
}

const DRAW_KEYS = new Set(["draw", "teeSheet"]);

/** "Round 2 has no date, so players cannot see when they play." */
function needSentence(label: string, n: RoundNeed): string {
  return `${label} ${n.missing}, so ${n.consequence}.`;
}

function sentence(s: string): string {
  const t = s.trim();
  if (!t) return t;
  const up = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(up) ? up : `${up}.`;
}

/** The machine's own name for a round (`roundLabel`, never counted here); the machine's own stand-in when it has none. */
function roundLabel(r: StatusRound): string {
  return r.label || "A round";
}

/**
 * THE TRACK — or null for a casual round (no setup, no lifecycle to walk).
 * `job` is the tournament's one button (`tournamentJob`); null only for a casual round.
 */
export function lifecycleTrack(st: TournamentStatus, job: TournamentJob | null): LifecycleTrack | null {
  if (!job || st.family === "casual") return null;
  const settingUp = st.step === "setting-up";
  const over = st.step === "play-over" || st.step === "completed";

  /* ---------------------------------------------------------------- set up */
  const setup: TrackStep[] = st.setup.steps.map((s) => {
    const missing = s.missing || s.question;
    const reason = s.done
      ? ""
      : s.holds
        ? `${sentence(missing)} Launch waits for this.`
        : /^optional/i.test(missing)
          ? sentence(missing)
          : `Optional — ${sentence(missing)}`;
    return {
      key: `setup-${s.key}`,
      phase: "setup",
      label: s.label,
      href: s.href,
      state: s.done ? "done" : s.holds ? "held" : "todo",
      reason,
      optional: s.optional,
      roundId: null,
    };
  });

  /* ------------------------------------------------------------- tee times */
  const first = st.rounds[0] ?? null;
  const firstDrawNeeds = first ? first.needs.filter((n) => DRAW_KEYS.has(n.key)) : [];
  const ds = drawStop(st.family, firstDrawNeeds);
  const entries = st.setup.steps.find((s) => s.key === "registration");
  const drawBase = { key: "draw", phase: "draw" as const, ...ds, optional: false, roundId: first?.id ?? null };
  let drawStep: TrackStep;
  if (!first) {
    drawStep = { ...drawBase, state: "todo", reason: "Waits for a round to play." };
  } else if (firstDrawNeeds.length > 0) {
    drawStep = {
      ...drawBase,
      state: firstDrawNeeds.some((n) => n.holds) ? "held" : "todo",
      reason: firstDrawNeeds.map((n) => needSentence(roundLabel(first), n)).join(" "),
    };
  } else if (settingUp && entries && !entries.done) {
    drawStep = { ...drawBase, state: "todo", reason: `Waits for ${entries.label}: it is made from the field.` };
  } else {
    drawStep = { ...drawBase, state: "done", reason: "" };
  }
  const launch: TrackStep = {
    key: "launch",
    // The last step of setting up: launched, the tee times come next (the panel, 9 Nov).
    phase: "setup",
    label: "Launch",
    href: "/dashboard",
    state: settingUp ? "todo" : "done",
    reason: settingUp ? (st.setup.current ? `Waits for ${st.setup.current.label}.` : "Nothing holds launch.") : "",
    optional: false,
    roundId: null,
  };

  /* ------------------------------------------------------------------ play */
  const day: TrackStep[] = st.rounds.map((r, i) => {
    const label = roundLabel(r);
    // The first round's draw and tee times are the Tee times stop's; a round's other needs are its own
    // once the tournament is live (before launch they are the Rounds & formats step's).
    const own = r.needs.filter((n) => !(i === 0 && DRAW_KEYS.has(n.key)));
    let state: TrackState;
    let reason: string;
    if (r.state === "closed") {
      state = "done";
      reason = "";
    } else if (over) {
      state = "done";
      reason = r.state === "under-way" ? "" : "Not played: play is over.";
    } else if (r.state === "under-way") {
      state = "todo";
      reason = `Under way. Close ${label} when its last card is in.`;
    } else {
      state = "todo";
      reason = settingUp || own.length === 0 ? "Not started." : `Not started. ${own.map((n) => needSentence(label, n)).join(" ")}`;
    }
    return { key: `round-${r.id}`, phase: "day", label, href: r.state === "under-way" && !over ? "/entry" : "/stages", state, reason, optional: false, roundId: r.id };
  });

  /* --------------------------------------------------------------- results */
  const results: TrackStep = {
    key: "results",
    phase: "after",
    label: "Results",
    href: "/dashboard",
    state: st.step === "completed" ? "done" : "todo",
    reason: st.step === "completed" ? "" : "Completing releases the results.",
    optional: false,
    roundId: null,
  };

  const steps = [...setup, launch, drawStep, ...day, results];

  /* ------------------------------------------------- where the one button is */
  const playStop = (roundId: string | null) => (roundId ? steps.findIndex((s) => s.phase === "day" && s.roundId === roundId) : -1);
  /** A round's stop: the first round's tee times and draw are the Tee times stop. */
  const roundStop = (roundId: string | null) => (first && roundId === first.id ? steps.indexOf(drawStep) : playStop(roundId));
  /** The round being played or next to play — or, every round closed while play goes on (a knockout's Final still to decide), the last. */
  const openRound = () => {
    const open = st.rounds.find((r) => r.state !== "closed") ?? st.rounds[st.rounds.length - 1];
    return open ? playStop(open.id) : -1;
  };
  let current: number;
  switch (job.key) {
    case "launch": {
      const held = !job.enabled && st.setup.current ? steps.findIndex((s) => s.key === `setup-${st.setup.current!.key}`) : -1;
      current = held >= 0 ? held : steps.indexOf(launch);
      break;
    }
    case "entries": {
      const at = steps.findIndex((s) => s.key === "setup-registration");
      current = at >= 0 ? at : steps.indexOf(launch);
      break;
    }
    case "tee-sheet":
      current = job.roundId ? roundStop(job.roundId) : steps.indexOf(drawStep);
      break;
    case "draw":
    case "schedule":
      current = roundStop(job.roundId);
      break;
    case "settle":
    case "cards":
    case "close":
    case "waiting": {
      const at = playStop(job.roundId);
      current = at >= 0 ? at : openRound();
      break;
    }
    default:
      current = steps.indexOf(results);
  }
  // Never backwards: a job with no stop of its own sits at Launch while setting up, at Results after.
  if (current < 0) current = settingUp ? steps.indexOf(launch) : steps.indexOf(results);

  // The current stop takes the button's verdict: refused is held, its reason the refusal word for word;
  // allowed is now, its reason the job's own line. Completed stays done — its button reopens.
  const cur = steps[current];
  if (st.step === "completed") {
    cur.state = "done";
  } else if (!job.enabled) {
    cur.state = "held";
    cur.reason = job.disabledBecause ?? cur.reason;
  } else {
    cur.state = "now";
    if (job.text) cur.reason = sentence(job.text);
  }

  const keys: PhaseKey[] = ["setup", "draw", "day", "after"];
  const phases: TrackPhase[] = keys.map((key) => {
    const own = steps.filter((s) => s.phase === key);
    const counted = own.filter((s) => !s.optional);
    const state: TrackState = own.includes(cur)
      ? cur.state
      : own.every((s) => s.state === "done")
        ? "done"
        : own.some((s) => s.state === "held")
          ? "held"
          : "todo";
    return { key, title: phaseTitle(key, st.family), state, steps: own, done: counted.filter((s) => s.state === "done").length, counted: counted.length };
  });

  return { family: st.family, step: st.step, chip: st.chip, chipDetail: st.chipDetail, phases, steps, current, press: job };
}

/** "Set up · 4 of 5 done" — the current stop's phase, counted without its optional stops. */
export function trackCount(track: LifecycleTrack): string {
  const p = track.phases.find((x) => x.steps.includes(track.steps[track.current]))!;
  return `${p.title} · ${p.done} of ${p.counted} done`;
}

/* ------------------------------------------------- the dashboard card's button */

/**
 * WHAT THE DASHBOARD'S STATUS CARD PRESSES (`LifecycleBar`) — composed in the page from the same job
 * the stepper marks, never inside `statusCardOf`:
 *
 *   move   Launch, Complete or Reopen: the machine's next action, with its dialogs and its refusal
 *   link   any other job: a primary link to where it is done ("Open score entry", "Close Round 1")
 *   none   waiting: its line and no button ("Round 1 tees off Sun 29 Nov")
 *
 * With no job (the switch off) the card presses the next action, exactly as before.
 */
export type CardPress =
  | { kind: "move"; action: NextAction; text: string }
  | { kind: "link"; label: string; href: string; text: string }
  | { kind: "none"; text: string };

/** The overflow's one item: a deliberately named, early, destructive action — never the routine button. */
export const END_EARLY = "End this event early…";

/**
 * ENDING EARLY, IN THE CARD'S OVERFLOW — never a "Complete" button while golf remains to be played.
 *
 * The panel (9 Nov) and the PM (10 Nov): between rounds — the Saturday night of a two-day event — is the
 * exact moment a routine "Complete tournament" beside the job ends a tournament one press before day 2.
 * But ending early is a real need (Round 2 rained off), so it stays, as a deliberately named action
 * behind a quiet "More": "End this event early…". It is the machine's own Complete — its refusal and
 * way out, and its question naming the rounds nobody played (`completingCheckFor`) — under a name that
 * says what it does.
 *
 * Offered while live and while any round remains to be played: before the first card, with cards still
 * out, between rounds, a knockout's ties. Not when the one round left open has every card in (closing it
 * is the job, and then Complete is the button). Never once play is over: Complete is the card's one
 * filled button then (`results`).
 */
export function endEarlyOf(st: Pick<TournamentStatus, "nextAction" | "rounds">, job: TournamentJob | null | undefined): NextAction | null {
  const next = st.nextAction;
  if (!next || next.kind !== "complete" || !job || job.moves) return null;
  const left = st.rounds.filter((r) => r.state !== "closed" && !(job.key === "close" && r.id === job.roundId));
  return left.length > 0 ? next : null;
}

export function cardPressOf(next: NextAction | null, job?: TournamentJob | null): CardPress {
  if (job === undefined) return next ? { kind: "move", action: next, text: "" } : { kind: "none", text: "" };
  if (!job || !next) return { kind: "none", text: "" };
  if (job.moves) return { kind: "move", action: next, text: "" };
  if (job.action && job.enabled) return { kind: "link", label: job.action, href: job.href, text: job.text };
  return { kind: "none", text: job.text };
}

/* ------------------------------------------------------------------ switch */

/**
 * THE SWITCH (off until Ajay's OK, like #994's timeline). While it is off the
 * stepper is drawn only for a preview — `?stepper=1` on any console screen —
 * and the rail, the journey card and the dashboard's button stay exactly as
 * they are. Switching it on is this one line.
 */
export const LIFECYCLE_STEPPER_ON = false;

/** The preview's query: its own name, so it never collides with Rounds & formats' `?view=timeline`. */
export const STEPPER_PREVIEW = "stepper";

export function stepperShown(search: string): boolean {
  if (LIFECYCLE_STEPPER_ON) return true;
  return new URLSearchParams(search).get(STEPPER_PREVIEW) === "1";
}

/**
 * A link that KEEPS THE PREVIEW ON: the console's layout is not drawn again as an organizer moves
 * between its screens, but anything that draws it afresh (a reload, a saved form) reads the address,
 * so every link the stepper and the menu draw while previewing carries the query (before a `#place`).
 * Called only while previewing: once the switch is on, links are plain.
 */
export function keepPreview(href: string): string {
  const at = href.indexOf("#");
  const path = at === -1 ? href : href.slice(0, at);
  const place = at === -1 ? "" : href.slice(at);
  return `${path}${path.includes("?") ? "&" : "?"}${STEPPER_PREVIEW}=1${place}`;
}

/**
 * WHERE THE TRACK IS DRAWN IN FULL (the panel, 9 Nov): the dashboard always; Tournament details only
 * while the tournament is being set up. Everywhere else it is folded to one line.
 */
export function stepperOpenOn(here: string, step: TournamentStatus["step"] | string): boolean {
  return here === "/dashboard" || (here === "/event" && step === "setting-up");
}
