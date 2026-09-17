"use client";
import { Icon } from "./Icon";

/**
 * THE QUESTION ASKED BEFORE A ROUND IS RE-SCORED.
 *
 * Settings on Rounds & formats change what a round's existing cards MEAN
 * without touching a stroke: its format, how many holes it is, and what it is
 * scored on — and, on a team round, the allowance, the split and how many
 * scores count. `enteredCardCount` is the fact behind all three — "asked
 * before anything that RE-SCORES a round rather than edits it" — and each
 * refusal comes back with the number of cards at stake.
 *
 * Beside the control that caused it, never a toast: the toast has gone by the
 * time the organizer decides. And the COUNT is the decision — "re-score 37
 * cards" is a different question from "change the format", and only the server
 * can answer the first.
 *
 * ONE COMPONENT BECAUSE IT WAS ABOUT TO BE THREE. The format's block existed
 * alone; extending the guard to holes and basis added a second near-identical
 * copy, and a third was the obvious next step. Copies of one warning drift the
 * same way copies of one rule do — and this one is read at the moment somebody
 * is deciding whether to overwrite a day's scoring.
 *
 * Rendered as a plain inline card rather than a dialog, deliberately. It
 * belongs to the control it sits under, and CLAUDE.md has a long entry on what
 * an inline card wearing a dialog role costs.
 */
export function RescoreWarning({
  cards,
  consequence,
  keepLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  /** How many cards this round already holds. Never zero — the caller only
   *  renders this when the server refused, and it refuses on a count above 0. */
  cards: number;
  /** What changing THIS setting does to them, in the organizer's terms. */
  consequence: string;
  /** The value the round actually has, so declining names what it keeps. */
  keepLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: "8px 10px",
        border: "1px solid var(--color-accent)",
        borderRadius: 8,
        fontSize: 12.5,
        lineHeight: 1.55,
      }}
    >
      <b>
        <Icon name="warning" /> This round already has {cards} card{cards === 1 ? "" : "s"} entered.
      </b>
      <div className="text-muted" style={{ marginTop: 4 }}>
        {consequence}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={onConfirm}>
          Change it anyway
        </button>
        {/* Declining has to put the control back to what is STORED, or it goes
            on showing a value the round does not have. That is the caller's
            job — each of the three has a different setter — so this only says
            which value it is returning to. */}
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Keep {keepLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * What each setting does to the cards already in, said once.
 *
 * Here rather than at the three call sites because they are the same claim
 * about the same fact, and a club reading one of them has to be able to trust
 * the other two.
 */
export const RESCORE_CONSEQUENCE = {
  format:
    "Changing the format re-scores every one of them. No stroke is altered — the same numbers are simply counted a different way, so the results change and nothing on screen looks any different afterwards.",
  holes:
    "Changing how many holes it is re-scores every one of them against a different round — the stroke index is re-ranked to the holes actually played, so handicap shots move to different holes than the ones they were given on.",
  basis:
    "Changing what it is scored on re-scores every one of them. Gross, net and Stableford rank the same numbers into three different orders, and this also decides every tie.",
  // The three a team round adds — see `RoundTeamScoring`.
  allowance:
    "Changing the allowance re-scores every one of them. Each side receives a different number of strokes, so net scores and results move while no stroke on a card changes.",
  split:
    "Changing the split re-scores every one of them. The side's handicap is worked out from different shares of its players', so its strokes — and its result — change.",
  venue:
    "Changing where it was played re-scores every one of them against a different card. Par decides every to-par, and the new stroke index moves handicap shots onto different holes.",
  countBest:
    "Changing how many scores count re-scores every one of them. Best one of four and best two of four are different competitions played off the same cards.",
} as const;
