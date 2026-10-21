"use client";
import { useState } from "react";
import { bringIntoView } from "@/lib/bring-into-view";
import { typedAllowance } from "@/lib/domain/team";
import { allowanceSaid } from "@/lib/domain/allowance-words";
import { setStageAllowance, type TeamResult } from "@/app/actions/teams";
import { RescoreWarning, RESCORE_CONSEQUENCE } from "./RescoreWarning";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";
import { useAction } from "./useAction";
import type { RoundAllowanceInfo } from "@/lib/round-allowance";

/**
 * THE ALLOWANCE AN INDIVIDUAL NET ROUND PLAYS AT, and the control to change it.
 *
 * A team round has had this on its card for months (`RoundTeamScoring`). An
 * individual round had nothing: `Stage.handicapAllowance` was honoured wherever
 * a card is priced, and no screen could set it — while the organizer's guide
 * said "Change it per round under Handicaps for this round", which is the panel
 * that sets one PLAYER's handicap.
 *
 * It matters for exactly the clubs this app is for. The Rules of Handicapping,
 * Appendix C, give individual stroke play and Stableford 95% for a field of
 * thirty or more, and say a committee may use 100% for a smaller one. A society
 * of twelve could not.
 *
 * The same shape as the team panel's line, deliberately: a plain statement of
 * what the format recommends until somebody chooses to change it; the box
 * refuses "9o" and 0 in words beside it; a round with cards in is asked about
 * first, with the number of cards at stake; and the sentence itself comes from
 * `allowanceSaid`, which both panels read.
 */
export type { RoundAllowanceInfo } from "@/lib/round-allowance";

export function RoundAllowance({
  stageId,
  info,
  locked = false,
}: {
  stageId: string;
  info: RoundAllowanceInfo;
  /** Setup is locked, which the action refuses by throwing. */
  locked?: boolean;
}) {
  const { pending: saving, error, setError, run, startTransition } = useAction();
  const pending = saving || locked;
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState("");
  /** The server asking before it re-scores: how many cards, and how to go ahead. */
  const [asked, setAsked] = useState<{ cards: number; call: (force: boolean) => Promise<TeamResult> } | null>(null);

  // Its own body rather than `run`, as in `RoundTeamScoring`: `needsConfirm` is
  // the server asking a question, neither a success nor a refusal, and the box
  // closes only once the figure is actually saved.
  const save = (call: (force: boolean) => Promise<TeamResult>) =>
    startTransition(async () => {
      setError("");
      setAsked(null);
      const res = await call(false);
      if (res.needsConfirm) {
        setAsked({ cards: res.cards ?? 0, call });
        return;
      }
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        return;
      }
      setEditing(false);
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Handicap allowance <b style={{ color: "var(--color-text)" }}>{info.allowance}%</b>
          {allowanceSaid({ allowance: info.allowance, recommended: info.recommended, overridden: info.overridden, isConvention: false })}
          <FieldInfo label="the handicap allowance">
            <p>
              The share of a player&rsquo;s course handicap that counts in this round. It is taken
              before the course handicap is rounded, and the result rounded once.
            </p>
            <p>
              The Rules of Handicapping recommend {info.recommended}% for a field of thirty or more.
              For a smaller field a committee may play at 100%.
            </p>
          </FieldInfo>
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ padding: "2px 10px", fontSize: 13 }}
          onClick={() => {
            setTyped(String(info.allowance));
            setError("");
            setAsked(null);
            setEditing((o) => !o);
          }}
        >
          {editing ? "Cancel" : "Change"}
        </button>
      </div>

      {editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            inputMode="numeric"
            style={{ width: 90 }}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-label="Handicap allowance percent"
          />
          <span className="text-muted" style={{ fontSize: 13 }}>% of course handicap</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending}
            onClick={() => {
              const read = typedAllowance(typed);
              save((force) => (read.ok ? setStageAllowance(stageId, read.percent, force) : Promise.resolve({ ok: false, error: read.error })));
            }}
          >
            Save
          </button>
          {info.overridden && (
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => save((force) => setStageAllowance(stageId, 0, force))}>
              Back to {info.recommended}%
            </button>
          )}
        </div>
      )}

      {asked && (
        <RescoreWarning
          cards={asked.cards}
          consequence={RESCORE_CONSEQUENCE.allowanceIndividual}
          keepLabel={`${info.allowance}%`}
          pending={pending}
          onConfirm={() =>
            run(
              () => asked.call(true),
              () => {
                setAsked(null);
                setEditing(false);
              },
            )
          }
          onCancel={() => {
            setAsked(null);
            setEditing(false);
          }}
        />
      )}

      {/* Brought into view: the box often sits at the foot of a phone's screen, and round G245-1
          saw "0% is playing off scratch" refused out of view (2026-10-21). */}
      {error && (
        <p className="form-error" role="alert" ref={bringIntoView}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
