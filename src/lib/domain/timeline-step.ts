/**
 * THE COURSE DAY TIMELINE, READ FROM THE MACHINE (state machine PR 5c, J16).
 *
 * Rounds & formats step 2 ("Course day", behind `?view=timeline`) shows three
 * things about where a tournament is: the step it is on (the chip above the
 * rounds), the one next thing and everything else that needs the organizer
 * (the "Needs you" strip), and each round's own state (the chip on its stop on
 * the spine). Until PR 5c it worked them out for itself — `roundNeeds` had its
 * own rules for a course, a date and tee times (D7: a one-round medal was told
 * "Round 1 has no date" while the rail was done; a round robin was asked for
 * tee times the launch dialog never asks for), and each round's chip read the
 * stored dates against today and the tournament's launch (D8: an undated round
 * "under way" with nothing played).
 *
 * Owner ruling, 3 Nov: no redesigned screen is switched on until it reads the
 * machine. So this module READS `tournamentStatus(facts)` and decides nothing:
 *
 *   the chip        `stepOf(st)` — the same chip, tone and second line as the
 *                   context bar and the dashboard's status card
 *   the lead        `st.nextAction`, with its refusal in place and its way out;
 *                   a way out onto THIS screen opens the round concerned
 *   the list        the setup steps that hold launch, in setup order, with the
 *                   rounds step drawn as each round's own needs (`st.rounds[i]
 *                   .needs`), then the launch dialog's warnings
 *   a round's chip  `st.rounds[i].state` (results only, D8) and its first need
 *
 * Pure, so the server works it out once and the tests read the same answer.
 * `the-timeline-reads-the-machine.test.ts` refuses a stored status, the
 * pre-launch list, the launch facts or a date compared with today in it.
 */
import { stepOf, type TournamentStep } from "./tournament-step";
import type { RoundNeed, RoundNeedKey, StatusRound, TournamentStatus } from "./tournament-status";

/** What a press in the strip does: open a round in place, or go to the screen that fixes it. */
export type GuideAction =
  | { kind: "round"; roundId: string; says: string }
  | { kind: "link"; href: string; says: string };

/** One line of "Needs you". */
export interface GuideItem {
  key: string;
  /** The round it is about ("" for a step or a warning) — read by a screen reader after a "Tee sheet" link. */
  round: string;
  /** The bold head: "Round 3 has no date", "Entries". Empty for a warning, which is one sentence. */
  said: string;
  /** After the head: "players cannot see when they play." — or the warning's whole sentence. */
  rest: string;
  /** Launch is refused while it is open. */
  holds: boolean;
  /** Null where the fix is the screen itself (a round to add, below). */
  action: GuideAction | null;
}

/** THE one next thing — the machine's `nextAction`, refused in place when it is refused. */
export interface GuideLead {
  label: string;
  enabled: boolean;
  /** What pressing it does, when it is enabled. */
  action: GuideAction | null;
  /** The machine's refusal, unchanged. */
  disabledBecause: string | null;
  /** Where the refusal is put right — the machine's, or the round it means on this screen. */
  wayOut: GuideAction | null;
}

/** A round's stop on the spine: its chip, and the shape the spine draws it in. */
export interface RoundStepView {
  chip: string;
  tone: "accent" | "accent-2" | "neutral";
  /** `data-standing`: the spine fills a played stop and rings the one in play. */
  standing: "setup" | "upcoming" | "active" | "played";
}

export interface CourseDay {
  step: TournamentStep;
  lead: GuideLead | null;
  items: GuideItem[];
  rounds: Record<string, RoundStepView>;
}

/** The chip a round's first need gives it. */
const NEED_CHIP: Record<RoundNeedKey, { chip: string; tone: RoundStepView["tone"] }> = {
  course: { chip: "No course", tone: "accent-2" },
  card: { chip: "No course card", tone: "accent-2" },
  format: { chip: "Format cannot score it", tone: "accent-2" },
  date: { chip: "No date", tone: "accent-2" },
  draw: { chip: "Not drawn yet", tone: "neutral" },
  teeSheet: { chip: "No tee times", tone: "accent-2" },
};

function roundStep(r: StatusRound, st: TournamentStatus): RoundStepView {
  if (r.state === "closed") return { chip: "Played", tone: "neutral", standing: "played" };
  // Once the tournament's play is over, a round with results is played, closed or not — nobody
  // closes a knockout's Bracket Stage, and its decided Final is not "in play" (D3).
  const over = st.step === "play-over" || st.step === "completed";
  if (r.state === "under-way") return over ? { chip: "Played", tone: "neutral", standing: "played" } : { chip: "In play", tone: "accent", standing: "active" };
  const settingUp = st.step === "setting-up";
  const first = r.needs[0];
  if (first) return { ...NEED_CHIP[first.key], standing: settingUp ? "setup" : "upcoming" };
  if (settingUp) return { chip: "Set up", tone: "accent", standing: "setup" };
  if (st.step === "completed") return { chip: "Not played", tone: "neutral", standing: "played" };
  return { chip: "Upcoming", tone: "neutral", standing: "upcoming" };
}

function needItem(r: StatusRound, n: RoundNeed): GuideItem {
  return {
    key: `${r.id}-${n.key}`,
    round: r.label,
    said: `${r.label} ${n.missing}`,
    rest: `${n.consequence}.`,
    holds: n.holds,
    action:
      n.fix === "tee-sheet"
        ? { kind: "link", href: `/foursomes?round=${r.id}`, says: "Tee sheet" }
        : { kind: "round", roundId: r.id, says: `Open ${r.label}` },
  };
}

/**
 * The timeline's whole reading of the machine. `here` is the screen it is drawn
 * on — Rounds & formats — so a step or a way out that points at it opens a
 * round instead of reloading the page.
 */
export function courseDayOf(st: TournamentStatus, here = "/stages"): CourseDay {
  const rounds: Record<string, RoundStepView> = {};
  for (const r of st.rounds) rounds[r.id] = roundStep(r, st);

  /* the lead: the machine's one next action (none once completed — Reopen is a remedy, not a need) */
  let lead: GuideLead | null = null;
  /** What the lead already says, so the list does not say it again. */
  const covered = { steps: new Set<string>(), needs: new Set<string>() };
  const na = st.nextAction;
  if (na && st.step !== "completed") {
    if (na.enabled) {
      const onRound = na.href === here && na.roundId;
      if (onRound) {
        // "Generate Round 2 pairings" / "Set Week 3's day": the round's own need is this action.
        covered.needs.add(`${na.roundId}-${na.kind === "draw" ? "draw" : "date"}`);
      }
      lead = {
        label: na.label,
        enabled: true,
        action: onRound ? { kind: "round", roundId: na.roundId!, says: na.label } : { kind: "link", href: na.href, says: na.label },
        disabledBecause: null,
        wayOut: null,
      };
    } else {
      let wayOut: GuideAction | null = null;
      if (na.wayOut && na.wayOut.href === here) {
        // The refusal is put right on THIS screen: open the first round that holds launch.
        covered.steps.add(here);
        const holding = st.rounds.find((r) => r.needs.some((n) => n.holds));
        if (holding) {
          wayOut = { kind: "round", roundId: holding.id, says: `Open ${holding.label}` };
          for (const n of holding.needs) if (n.holds) covered.needs.add(`${holding.id}-${n.key}`);
        }
      } else if (na.wayOut) {
        covered.steps.add(na.wayOut.href);
        wayOut = { kind: "link", href: na.wayOut.href, says: na.wayOut.says };
      }
      lead = { label: na.label, enabled: false, action: null, disabledBecause: na.disabledBecause, wayOut };
    }
  }

  /* the list: in setup order, the rounds step drawn as each round's own needs */
  const items: GuideItem[] = [];
  const roundItems = () => {
    for (const r of st.rounds) for (const n of r.needs) if (!covered.needs.has(`${r.id}-${n.key}`)) items.push(needItem(r, n));
  };
  const hasStagesStep = st.step === "setting-up" && st.setup.steps.some((s) => s.href === here);
  if (st.step === "setting-up") {
    for (const s of st.setup.steps) {
      if (s.href === here) {
        roundItems();
        // A rounds step that holds with no round to point at — no playing round yet — is said once.
        const saidByRounds = st.rounds.some((r) => r.needs.some((n) => n.holds));
        if (s.holds && !saidByRounds && !covered.steps.has(here)) {
          items.push({ key: `step-${s.key}`, round: "", said: s.label, rest: s.missing, holds: true, action: null });
        }
      } else if (s.holds && !covered.steps.has(s.href)) {
        items.push({ key: `step-${s.key}`, round: "", said: s.label, rest: s.missing, holds: true, action: { kind: "link", href: s.href, says: `Open ${s.label}` } });
      }
    }
  }
  if (!hasStagesStep) roundItems();

  /* the launch dialog's warnings, less what each round's own line already says */
  st.warnings.forEach((w, i) => {
    // The tee sheet is said round by round; so are the rounds' days — except a league's
    // later weeks, which are ONE line by design (J08), never a line per week.
    if (w.href === "/foursomes") return;
    if (w.href === here && st.family !== "league") return;
    const action: GuideAction | null = w.href === here ? null : { kind: "link", href: w.href, says: w.fix };
    items.push({ key: `warn-${i}`, round: "", said: "", rest: w.says, holds: false, action });
  });

  return { step: stepOf(st), lead, items, rounds };
}
