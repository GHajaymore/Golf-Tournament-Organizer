import type { NextAction, Step } from "./tournament-status";

/**
 * RESULTS HAS ONE VERB FOR THE LAST ACT (R12). The tournament's last act is the machine's `complete` move, which closes every
 * round and makes the final report final. Its word is the machine's own: `nextAction.label`, "Make results final" (the UX
 * Writer's ruling, 23 Nov; it was "Complete tournament"), drawn by the Dashboard's button, the stepper, What's next and this
 * card alike. This module chooses SENTENCES and a destination around that label; it holds no second word for the act, so a
 * change of word is made once, at the machine's label.
 *
 * NO DIRECTIVE: the page (server) and a test both read it.
 */

export type ReleaseView =
  /** Play is over and the tournament may be completed: the machine's own label, pointing at the machine's press. */
  | { kind: "ready"; says: string; verb: string; href: string; asks: string | null }
  /** Refused in place, with the reason the machine gave. */
  | { kind: "blocked"; says: string }
  /** The results are final. Reopening to correct a card is the way back. */
  | { kind: "final"; says: string; reopen: { label: string; href: string } | null }
  /** Not yet: there is still golf to close. No verb is offered. */
  | { kind: "later"; says: string };

/** What ended play, in the machine's words with its tail ("· results not released") left off: "Every round closed". */
function endedPlay(chipDetail: string): string {
  const first = chipDetail.split(" · ")[0].trim();
  return first ? `${first}.` : "Play is over.";
}

export function releaseView(
  step: Step,
  next: Pick<NextAction, "kind" | "label" | "href" | "enabled" | "disabledBecause" | "asks"> | null,
  /** The machine's second line under "Play over" (`status.chipDetail`): it knows a knockout's final from a round's close. */
  chipDetail: string,
  /** Only the Organizer may complete or reopen (`setEventStatus`): everybody else reads the sentence and sees no control. */
  isAdmin: boolean,
): ReleaseView {
  if (step === "completed") {
    const reopen = isAdmin && next && next.kind === "reopen" && next.enabled ? { label: "Reopen to correct a card", href: next.href } : null;
    return {
      kind: "final",
      says: "The results are final: the final report is the record, shown to whoever the report settings allow.",
      reopen,
    };
  }
  if (step === "play-over" && next && next.kind === "complete") {
    if (!next.enabled) return { kind: "blocked", says: next.disabledBecause ?? "The results cannot be made final yet." };
    const says = `${endedPlay(chipDetail)} ${next.label} completes the tournament; the final report and the money are then final.`;
    return isAdmin ? { kind: "ready", says, verb: next.label, href: next.href, asks: next.asks } : { kind: "blocked", says };
  }
  return { kind: "later", says: "The results are made final here once play is over." };
}
