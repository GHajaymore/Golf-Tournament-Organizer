"use client";
import { useState, useTransition } from "react";
import { HoleByHoleCard } from "./HoleByHoleCard";
import { saveScorecard, certifyScorecard } from "@/app/actions/tournament";
import { RuleCite } from "./RuleCite";

/**
 * A player filling in their own round.
 *
 * Deliberately thinner than the console's StrokePlayEntry: no player picker,
 * no tee-group selector, no grid view. Those exist because an organizer enters
 * other people's cards; a player has exactly one, and every extra control is
 * something to mis-tap on a tee box.
 *
 * The two buttons are the two acts, kept apart on purpose. Saving records the
 * strokes and can happen as often as you like. Certifying is the claim that
 * the card is right — Rule 3.3b's player certification — and it is the one the
 * committee then accepts, so it asks first and is not undoable from here.
 */
export function PlayerCard({
  stageId,
  playerId,
  playerName,
  roundLabel,
  holes,
  pars,
  yards,
  strokeIndex,
  status,
}: {
  stageId: string;
  playerId: string;
  playerName: string;
  roundLabel: string;
  holes: number;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  status: string;
}) {
  const [strokes, setStrokes] = useState<(number | null)[]>(new Array(holes).fill(null));
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [state, setState] = useState(status);

  const filled = strokes.filter((s) => s != null).length;
  const complete = filled >= holes;
  const locked = state === "approved";

  const save = () =>
    startTransition(async () => {
      await saveScorecard(stageId, playerId, strokes);
      setNote("Saved.");
    });

  const certify = () =>
    startTransition(async () => {
      // Save first: certifying a card the server has not seen would certify
      // whatever was last written, which is not what is on this screen.
      await saveScorecard(stageId, playerId, strokes);
      await certifyScorecard(stageId, playerId);
      setState("certified");
      setNote("Certified. It's with the committee now.");
    });

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--color-neutral-400)",
        }}
      >
        {roundLabel}
      </div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: "6px 0 16px" }}>
        {playerName || "My card"}
      </h1>

      {locked ? (
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          This card has been approved by the committee. Ask an organizer if something needs changing.
        </p>
      ) : (
        <>
          <HoleByHoleCard
            players={[{ id: playerId, name: playerName }]}
            cards={{ [playerId]: strokes }}
            pars={pars}
            yards={yards}
            strokeIndex={strokeIndex}
            holes={holes}
            onSet={(_pid, hole, value) =>
              setStrokes((prev) => {
                const next = [...prev];
                next[hole] = value;
                return next;
              })
            }
          />

          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={save} style={{ flex: 1 }}>
              <i className="ph ph-floppy-disk" /> Save
            </button>
            <button
              type="button"
              className="btn btn-primary"
              // Certifying an unfinished card would be claiming holes that were
              // never played were right.
              disabled={pending || !complete || state === "certified"}
              onClick={certify}
              style={{ flex: 1 }}
            >
              <i className="ph ph-check" /> {state === "certified" ? "Certified" : "Certify"}
            </button>
          </div>

          <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
            {complete
              ? "Certifying says these hole scores are correct. The committee accepts it after that."
              : `${filled} of ${holes} holes in — certify once the round is complete.`}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <RuleCite rule="scorecardCertification" />
          </p>
          {note && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-accent-2-300)" }}>
              <i className="ph ph-check" /> {note}
            </p>
          )}
        </>
      )}
    </div>
  );
}
