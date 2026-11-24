"use client";
import { useState, useTransition } from "react";
import { generateNextRound } from "@/app/actions/tournament";
import { useCaughtUp } from "@/components/useAction";
import { cutTieRuleOf, cutTieRuleWords } from "@/lib/domain/cut";
import { generatesPairings } from "@/lib/stage-types";
import { Icon } from "@/components/Icon";
import dynamic from "next/dynamic";
import { PanelLoading, orNeedsSignal } from "@/components/LazyPanel";
import type { CutTieOnCard } from "@/components/CutReadyCard";

/**
 * THE TIE PANEL, LAZY AS ON ROUNDS & FORMATS (`rounds/shared.tsx` loads it the same way): it is behind a press and
 * is not part of a screen's first load. Declared here, not imported from `rounds/`, because this component is
 * mounted by Rounds & formats AND Tee times & draw, and a file of one screen's area may not import the other's
 * (`qa-framework.test.ts`, "imported by nothing outside that area").
 */
const CutTiePanel = dynamic(() => orNeedsSignal(() => import("./CutReadyCard").then((m) => m.CutTiePanel)), {
  ssr: false,
  loading: () => <PanelLoading />,
});



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
export interface DrawRoundStage {
  id: string;
  type: string;
  /** Matches already drawn for the round. */
  matchCount: number;
  cutEnabled: boolean;
  /** ties | playoff | countback — how a tie for the last place is settled. */
  cutTies: string;
  /** A round robin's cut into this round, where its line falls in a tie the committee settles; null where there is none. */
  cutTie?: { feederId: string; ties: CutTieOnCard[] } | null;
}

/** Mounted on Rounds & formats and on Tee times & draw (R9b), which holds only these six facts of a round. */
export function DrawRound({ stage, label }: { stage: DrawRoundStage; label: string }) {
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
