"use client";
import { removeStage } from "@/app/actions/tournament";
import { bringIntoView } from "@/lib/bring-into-view";
import { Icon } from "@/components/Icon";
import type { RoundCtx } from "./use-round-ctx";

export function RemoveWarning({ ctx }: { ctx: RoundCtx }) {
  const { stage, locked, caughtUp, thisRound, doors, removeCost, setRemoveCost, removeRefused, setRemoveRefused, removeWarningRef, pending, startTransition } = ctx;
  return (
    <>{removeRefused ? (
    <p role="alert" ref={bringIntoView} style={{ marginTop: 8, fontSize: 13, color: "var(--color-danger)" }}>
      {removeRefused}
    </p>
  ) : removeCost?.refused ? (
    <div ref={removeWarningRef} role="alert" style={{ marginTop: 8, padding: "8px 10px", border: "1px solid var(--color-danger)", borderRadius: 8, fontSize: 13, lineHeight: 1.55 }}>
      {removeCost.refused}
      <div style={{ marginTop: 6 }}>
        <button type="button" className="btn btn-ghost" onClick={() => setRemoveCost(null)}>
          Close
        </button>
      </div>
    </div>
  ) : removeCost && (
    <div
      ref={removeWarningRef}
      style={{
        marginTop: 8,
        padding: "8px 10px",
        border: "1px solid var(--color-danger)",
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      {removeCost.cards > 0 || removeCost.stakes > 0 || removeCost.records > 0 ? (
        <b style={{ color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> Deleting this round destroys{" "}
          {[
            removeCost.cards > 0 && `${removeCost.cards} entered card${removeCost.cards === 1 ? "" : "s"}`,
            removeCost.stakes > 0 && `${removeCost.stakes} paid stake${removeCost.stakes === 1 ? "" : "s"}`,
            removeCost.records > 0 && `${removeCost.records} money record${removeCost.records === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(", ")}
          .
        </b>
      ) : (
        <b style={{ color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> Delete {thisRound || "this round"}?
        </b>
      )}
      {/* The rounds rule's warning after the draw (J12, PR 7b): "Round 2's pairings go with it." */}
      {removeCost.drawn && <div style={{ marginTop: 4 }}>{removeCost.drawn}</div>}
      <div className="text-muted" style={{ marginTop: 4 }}>
        {removeCost.stakes > 0
          ? "The skins pot for this round goes with it, including the record of who has already paid in. That record is the only place the money is written down. This is permanent and cannot be undone."
          : "The matches, cards, handicaps and money records go with it. This is permanent and cannot be undone."}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || (!doors && locked)}
          onClick={() => {
            setRemoveCost(null);
            startTransition(async () => {
              // Said where the press was: a refusal comes back as words, never silence.
              const res = caughtUp(await removeStage(stage.id, true));
              if (res && "refused" in res && res.refused) setRemoveCost({ cards: 0, stakes: 0, records: 0, refused: res.refused });
              else if (res && !res.ok && "error" in res) setRemoveRefused(res.error ?? "");
            });
          }}
        >
          Delete the round anyway
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setRemoveCost(null)}>
          Keep it
        </button>
      </div>
    </div>
  )}</>
  );
}
