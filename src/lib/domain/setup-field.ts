import type { RoundNeedKey, TournamentStatus } from "./tournament-status";
import type { ScreenKey } from "./console-merges";

/**
 * THE ONE RULE FOR A SET-UP FIELD'S MARK (redesign R1a).
 *
 * Every redesigned set-up screen draws its fields with `SetupField`, and that component draws only
 * what `markOf` answers. The mark is never written by a screen: a screen that says "Required" about a
 * field launch does not refuse is a lie the organizer acts on, and one that stays silent about a
 * field launch DOES refuse sends them to a Launch button that will not work.
 *
 * So the rule is read from the machine, not from the screen. A field names its HOLDER, the thing in
 * `tournamentStatus` that refuses launch while the field is wrong:
 *
 *   { step }    a set-up step (`StatusStep.holds`)
 *   { need }    one of a round's needs (`RoundNeed.holds`), on ANY round
 *   { action }  the create form's own refusal: there is no event yet for the machine to ask
 *   null        never required
 *
 * The marks, strongest first:
 *   required-before-launch  its holder holds, so launch is refused until it is answered; shown only
 *                           while the tournament is still being set up (nothing is "before launch"
 *                           once it has launched)
 *   required                an `action` holder whose value is still empty
 *   default                 the value is the one the app proposed (`DefaultOf`), not one chosen
 *   null                    nothing: an answered field shows no mark
 *
 * Required wins over Default. A field that launch refuses is required even when its value equals the
 * proposal: the proposal is not an answer yet.
 *
 * `required-is-what-launch-refuses.test.ts` walks every family and every opening move and holds this
 * registry to what `tournamentStatus` actually refuses, both ways.
 */

/** A value the app proposed, and where it came from ("the club's usual", "the Rules' 95%"). */
export interface DefaultOf {
  value: string;
  source: string;
}

/** The `StatusStep.key`s that can hold launch. */
export type HolderStep = "event" | "stages" | "registration" | "cup" | "teams" | "grouping";

export type Holder = { step: HolderStep } | { need: RoundNeedKey } | { action: true } | null;

export interface FieldSpec {
  screen: ScreenKey;
  holder: Holder;
}

export const SETUP_FIELDS = {
  // Event: the create form refuses an empty name itself; the dates are the launch gate's.
  name: { screen: "event", holder: { action: true } },
  dates: { screen: "event", holder: { step: "event" } },
  venue: { screen: "event", holder: null },
  // Rounds & formats: the rounds themselves, then each need a round can carry.
  rounds: { screen: "rounds", holder: { step: "stages" } },
  course: { screen: "rounds", holder: { need: "course" } },
  card: { screen: "rounds", holder: { need: "card" } },
  format: { screen: "rounds", holder: { need: "format" } },
  roundDate: { screen: "rounds", holder: { need: "date" } },
  pairings: { screen: "rounds", holder: { need: "draw" } },
  teeSheet: { screen: "teeTimes", holder: { need: "teeSheet" } },
  // Players.
  entries: { screen: "players", holder: { step: "registration" } },
  cupTeams: { screen: "players", holder: { step: "cup" } },
  sides: { screen: "players", holder: { step: "teams" } },
  flights: { screen: "players", holder: { step: "grouping" } },
} as const satisfies Record<string, FieldSpec>;

export type FieldKey = keyof typeof SETUP_FIELDS;

export type Mark = "required-before-launch" | "required" | "default";

/** Is the holder open, in this status? Only while the tournament is still being set up. */
function holderHolds(holder: Holder, st: TournamentStatus): boolean {
  if (holder === null || st.step !== "setting-up") return false;
  if ("step" in holder) return st.setup.steps.some((s) => s.key === holder.step && s.holds);
  if ("need" in holder) return st.rounds.some((r) => r.needs.some((n) => n.key === holder.need && n.holds));
  return false;
}

/**
 * THE MARK FOR ONE FIELD. `value` is what the field holds now, as text ("" is empty); `dflt` is the
 * app's proposal for it, or null when it proposes none. Both are REQUIRED: a caller that has no
 * proposal says so with null rather than leaving it out.
 */
export function markOf(field: FieldKey, st: TournamentStatus, value: string, dflt: DefaultOf | null): Mark | null {
  const { holder } = SETUP_FIELDS[field] as FieldSpec;
  if (holderHolds(holder, st)) return "required-before-launch";
  if (holder !== null && "action" in holder && value.trim() === "") return "required";
  if (dflt !== null && value === dflt.value) return "default";
  return null;
}
