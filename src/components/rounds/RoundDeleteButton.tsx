"use client";
import { removeStage } from "@/app/actions/tournament";
import { Icon } from "@/components/Icon";
import type { RoundCtx } from "./use-round-ctx";

export function RoundDeleteButton({ ctx }: { ctx: RoundCtx }) {
  const { stage, locked, caughtUp, thisRound, doors, setRemoveCost, setRemoveRefused, pending, startTransition } = ctx;
  return (
    <>
<button
          type="button"
          className="btn btn-icon"
          // Named for the round, in the house word: a screen reader heard
          // "Remove stage" on a screen where every other word says round.
          title={`Delete ${thisRound || "this round"}`}
          aria-label={`Delete ${thisRound || "this round"}`}
          // Not shut by the rounds rule's door: a press on a round with scores is answered in
          // words where it was ("Round 2 has scores. Clear them on Score entry first."), which a
          // greyed bin cannot say (J12, PR 7b). The setup lock still shuts it where no doors came.
          disabled={pending || (!doors && locked)}
          onClick={() =>
            startTransition(async () => {
              // The server refuses when the round holds results, and asks when it holds money or
              // a draw, saying how much of each. An undrawn round still deletes on one press.
              setRemoveRefused("");
              const res = caughtUp(await removeStage(stage.id));
              if (res && "refused" in res && res.refused) setRemoveCost({ cards: 0, stakes: 0, records: 0, refused: res.refused });
              else if (res?.needsConfirm) setRemoveCost({ cards: res.cards ?? 0, stakes: res.stakes ?? 0, records: res.records ?? 0, drawn: res.drawn });
              // Refused outright — the rounds are locked — and said where the press was (PR 5b).
              else if (res && !res.ok && "error" in res) setRemoveRefused(res.error ?? "");
            })
          }
        >
          <Icon name="trash" />
        </button>
    </>
  );
}
