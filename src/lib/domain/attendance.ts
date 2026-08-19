/**
 * Weekly-league attendance: who is in for which round.
 *
 * A Wednesday league doesn't re-register forty players every week — it needs
 * one question answered per round: are you in? Two philosophies exist and
 * both are real, so both are modes rather than one being right:
 *
 *   - opt-out: regulars are in unless they say otherwise. The standing
 *     member league. Silence means playing, which is what those clubs mean
 *     by "regular".
 *   - opt-in: only those who put their name down. The drop-in league, where
 *     silence means absent and nobody chases you.
 *   - everyone: the feature switched off — every confirmed player is in
 *     every round, exactly as tournaments have always worked here.
 *   - captains: nobody is asked in the app at all. Team captains send their
 *     pairs to the club by whatever means they already use — a WhatsApp
 *     message, an email, a phone call on Tuesday night — and the club records
 *     them. Common in inter-club and pairs leagues, where the captain owns the
 *     selection and the club owns the sheet.
 *
 * Only explicit choices are stored; absence resolves to the mode's default.
 * That is what makes "by default you're in" literally true for a forty-player
 * roster without forty rows, and what lets an organizer change mode without
 * rewriting history.
 */

import { deadlinePassed } from "../deadline";

export const ATTENDANCE_MODES = ["everyone", "opt-out", "opt-in", "captains"] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

export const ATTENDANCE_MODE_LABEL: Record<AttendanceMode, string> = {
  everyone: "Everyone plays every round",
  "opt-out": "In unless they opt out",
  "opt-in": "Out unless they opt in",
  captains: "Captains send the list, the club enters it",
};

export const ATTENDANCE_MODE_HELP: Record<AttendanceMode, string> = {
  everyone: "No weekly sign-up — the whole confirmed field is in every round. How tournaments work.",
  "opt-out":
    "The standing league. Regulars are in by default and say so when they can't make a week. Best when most people play most weeks.",
  "opt-in":
    "The drop-in league. Nobody is assumed; players put their name down for the weeks they want. Best when the field varies a lot.",
  captains:
    "Captains pick their pairs and send them in — a message, an email, a call — and your staff enter them. Players are never asked in the app, so nothing a player does can contradict the list their captain sent.",
};

export function isAttendanceMode(v: string): v is AttendanceMode {
  return (ATTENDANCE_MODES as readonly string[]).includes(v);
}

/**
 * Whether attendance is tracked per round at all.
 *
 * False only for `everyone`, where the confirmed field plays every round and
 * there is nothing to record.
 *
 * Distinct from `playersAnswer`, and the distinction is why `captains` could
 * not simply be bolted on: four places compared `mode === "everyone"` and were
 * really asking two different questions with one comparison. A tee sheet, a
 * foursome builder and a flight's leadership all want to know whether a
 * per-round field EXISTS. Only the player's own screen wants to know whether
 * the player is asked. Under `captains` the first is true and the second is
 * false, so one flag could not have answered both.
 */
export function tracksPerRound(mode: AttendanceMode): boolean {
  return mode !== "everyone";
}

/**
 * Whether the PLAYER is asked, on their own phone.
 *
 * False for `captains`: the captain has already decided and sent it in, so
 * asking the player would invite them to contradict a list the club has
 * already written down — and the club would have no way to know which was
 * meant. It is also false for `everyone`, where there is no question at all.
 */
export function playersAnswer(mode: AttendanceMode): boolean {
  return mode === "opt-in" || mode === "opt-out";
}

/**
 * What the mode says about a player who has said nothing.
 *
 * `captains` resolves to OUT, like opt-in: until a captain's list arrives
 * naming somebody, the club has not been told they are playing, and a tee
 * sheet that assumed them in would be inventing a pairing.
 */
export function defaultStatus(mode: AttendanceMode): "in" | "out" {
  return mode === "opt-in" || mode === "captains" ? "out" : "in";
}

/** A player's effective status: their explicit choice, else the default. */
export function effectiveStatus(
  mode: AttendanceMode,
  explicit: "in" | "out" | null | undefined,
): "in" | "out" {
  if (explicit === "in" || explicit === "out") return explicit;
  return defaultStatus(mode);
}

/**
 * Whether a player may still change their answer for a round.
 *
 * The deadline day is inclusive — "opt out by Tuesday" means all of Tuesday,
 * the same reading as every other deadline in the app. An empty deadline
 * leaves the window open. Staff are never bound by this; the organizer who
 * needs to mark a no-show on the morning is the person the freeze exists to
 * protect, not to obstruct.
 */
export function playerMayChange(optDeadline: string, now: Date = new Date()): boolean {
  return !deadlinePassed(optDeadline, now);
}

export interface AttendanceRow {
  playerId: string;
  status: "in" | "out";
  /** True when this is the player's (or staff's) explicit choice. */
  explicit: boolean;
  decidedBy: string;
}

export interface AttendanceSummary {
  in: number;
  out: number;
  /** How many of the "in" are in only by default — the organizer's honest
   *  uncertainty on a Wednesday morning. */
  inByDefault: number;
  rows: AttendanceRow[];
}

/**
 * The whole field resolved for one round.
 *
 * The summary separates "said they're in" from "in because they said
 * nothing", because those are different facts to an organizer building a tee
 * sheet: sixteen confirmed and eight silent is a different Wednesday from
 * twenty-four confirmed.
 */
export function resolveAttendance(
  mode: AttendanceMode,
  confirmedPlayerIds: string[],
  explicit: Array<{ playerId: string; status: string; decidedBy: string }>,
): AttendanceSummary {
  const byPlayer = new Map(explicit.map((e) => [e.playerId, e]));
  const rows: AttendanceRow[] = confirmedPlayerIds.map((playerId) => {
    const e = byPlayer.get(playerId);
    const chosen = e && (e.status === "in" || e.status === "out") ? (e.status as "in" | "out") : null;
    return {
      playerId,
      status: effectiveStatus(mode, chosen),
      explicit: chosen !== null,
      decidedBy: chosen !== null ? e!.decidedBy : "",
    };
  });
  return {
    in: rows.filter((r) => r.status === "in").length,
    out: rows.filter((r) => r.status === "out").length,
    inByDefault: rows.filter((r) => r.status === "in" && !r.explicit).length,
    rows,
  };
}
