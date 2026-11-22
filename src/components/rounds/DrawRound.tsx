"use client";
import { useState, useTransition } from "react";
import { generateNextRound } from "@/app/actions/tournament";
import { useCaughtUp } from "@/components/useAction";
import { cutTieRuleOf, cutTieRuleWords } from "@/lib/domain/cut";
import { generatesPairings } from "@/lib/stage-types";
import { Icon } from "@/components/Icon";
import { CutTiePanel } from "./shared";
import type { StageView } from "@/components/StagesClient";



/**
 * ONE TIE QUESTION, ONE LINE (2026-10-16): the question, the rule in use in
 * words, and Change where there is a choice — which opens the control in place
 * and closes on Done. See "Ties" on the round card, and the review panel's
 * brief in docs/tiebreak-brief-2026-10-16.md.
 */
/**
 * DRAW THIS ROUND, ON THIS ROUND, ONCE THE TOURNAMENT IS LIVE (2026-10-16).
 * A round that follows another — a second round robin, a round after a cut —
 * is drawn from the field (or the survivors) when the committee is ready. It
 * was a button on the round BEFORE, shown from the day the tournament was made.
 */
export function DrawRound({ stage, label }: { stage: StageView; label: string }) {
  const [pending, startTransition] = useTransition();
  const caughtUp = useCaughtUp();
  const [refused, setRefused] = useState<string | null>(null);
  const pairings = generatesPairings(stage.type);
  const drawn = stage.matchCount > 0;
  const tie = stage.cutTie;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ minHeight: 44 }}
          // Not gated on the lock: drawing a round is running the event. The server
          // refuses — in words, shown below — a redraw of a round with scores in.
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setRefused(null);
              const res = caughtUp(await generateNextRound(stage.id));
              if (!res.ok) setRefused(res.error);
            })
          }
        >
          <Icon name="arrows-clockwise" /> {pairings ? `${drawn ? "Redraw" : "Draw"} ${label}'s matches` : `Give out ${label}'s cards`}
        </button>
        {(stage.cutEnabled || drawn) && (
          <span className="text-muted" style={{ fontSize: 13 }}>
            {stage.cutEnabled ? "From the standings once the round before is complete." : "Redrawing replaces its matches."}
          </span>
        )}
      </div>
      {refused && (
        <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> Not drawn. {refused}
        </p>
      )}
      {/* A TIE AT THE ROUND ROBIN'S LINE IS SETTLED HERE, ON THE ROUND IT
          DECIDES THE FIELD OF (J31): drawing it is what makes the cut, so the
          play-off or the draw by lot is recorded under the button that draws —
          where the refusal above says to record it. */}
      {tie?.ties.map((t) => (
        <CutTiePanel
          key={t.tied.join(",")}
          feederId={tie.feederId}
          tie={t}
          tieRule={cutTieRuleWords(cutTieRuleOf(stage.cutTies), "table")}
          decidedOn="table"
        />
      ))}
    </div>
  );
}
