"use client";
import { useState, useTransition } from "react";
import { generateTeamMatches } from "@/app/actions/teams";
import { sideDrawReadiness } from "@/lib/domain/draw-readiness";
import { bringIntoView } from "@/lib/bring-into-view";
import { Icon } from "@/components/Icon";
import { ScopeLockMark } from "@/components/ScopeLockBanner";
import { useCaughtUp } from "@/components/useAction";

/**
 * "GENERATE MATCHES": A ROUND OF SIDES PAIRED AGAINST EACH OTHER (R9b; lifted whole from `TeamsClient`).
 *
 * One component, mounted in ONE place at a time: Teams & pairs, or the draw section of Tee times & draw once
 * that screen builds the round (`drawSections(...).built`, the one boolean; `TeamsClient`'s `matchesHere`).
 * It keeps its own `needsConfirm` handling rather than `useAction`'s `run`, for the reason `useAction.ts`
 * gives: a `needsConfirm` is the server asking a question, neither a success nor a refusal.
 *
 * It computes no draw: `generateTeamMatches` pairs the sides, and `sideDrawReadiness` says why it cannot yet.
 */
export function TeamMatchesControl({
  roundId,
  matchCount,
  sideCount,
  locked,
  otherBusy,
}: {
  roundId: string;
  /** Matches already generated for this round. */
  matchCount: number;
  sideCount: number;
  /** The sides are locked (the machine's `locks.sides`, drawn by the banner above). */
  locked: boolean;
  /** The screen that mounts this is saving something else: wait for it. */
  otherBusy: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const caughtUp = useCaughtUp();
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const busy = pending || locked || otherBusy;
  // Why matches cannot be drawn yet, or null. Said on the page rather than in a `title`.
  const sideBlock = sideDrawReadiness({ sideCount });

  const makeMatches = (replace: boolean) => {
    setError("");
    startTransition(async () => {
      const res = caughtUp(await generateTeamMatches(roundId, replace));
      if (res.needsConfirm) {
        setConfirm(true);
        return;
      }
      setConfirm(false);
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });
  };

  return (
    <div data-team-matches="" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {locked && <ScopeLockMark />}
        <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} disabled={busy || !!sideBlock} onClick={() => makeMatches(false)}>
          <Icon name="arrows-clockwise" /> {matchCount > 0 ? "Regenerate" : "Generate"} matches
        </button>
      </div>

      {sideBlock && (
        <p
          style={{
            fontSize: 13,
            margin: 0,
            lineHeight: 1.5,
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            padding: "9px 11px",
            borderRadius: 9,
            background: "color-mix(in srgb, var(--color-text) 5%, transparent)",
          }}
        >
          <Icon name="info" style={{ fontSize: 14, marginTop: 1, flex: "none" }} />
          <span>{sideBlock.problem}</span>
        </p>
      )}

      {error && (
        <p role="alert" ref={bringIntoView} style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}

      {confirm && (
        <div className="card elev-sm" style={{ gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
          <span className="card-title" style={{ fontSize: 14 }}>Replace this round&apos;s matches?</span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            This round already has {matchCount} {matchCount === 1 ? "match" : "matches"}. Regenerating
            discards them and pairs the sides again.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => makeMatches(true)}>
              Replace them
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>
              Keep them
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
