"use client";

import { useState, useTransition } from "react";
import { drawLeagueWeek } from "@/app/actions/league";
import { Icon } from "@/components/Icon";

/**
 * DRAW THIS WEEK: which clubs meet, and pair against pair.
 *
 * Sits between the team sheets and the meetings because that is the order of
 * the night: captains nominate, the organizer draws, the meetings appear.
 *
 * Replacing a drawn week asks first, like the generic draw does — the server
 * refuses outright once a card has a score on it.
 */
export function LeagueDraw({ stageId, drawn }: { stageId: string; drawn: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");

  const run = (replace: boolean) => {
    setError("");
    setNote("");
    startTransition(async () => {
      const res = await drawLeagueWeek(stageId, replace);
      if (!res.ok) {
        if (res.needsConfirm) setConfirm(true);
        else setError(res.error);
        return;
      }
      setConfirm(false);
      const parts = [`${res.matches} ${res.matches === 1 ? "four-ball" : "four-balls"} drawn.`];
      if (res.byeClub) parts.push(`${res.byeClub} sits out this week.`);
      if (res.unmatched > 0) {
        parts.push(
          `${res.unmatched} ${res.unmatched === 1 ? "pair has" : "pairs have"} no opponent — the other club put up fewer.`,
        );
      }
      setNote(parts.join(" "));
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => run(false)}
        style={{ alignSelf: "flex-start" }}
      >
        <Icon name="shuffle" /> {drawn > 0 ? "Redraw this week" : "Draw this week"}
      </button>
      <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.55 }}>
        Clubs meet on a round-robin rotation across the weeks, and pairs play in the order each
        club nominated them — first pair against first pair.
      </p>

      {confirm && (
        <div className="card elev-sm" style={{ gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
          <span className="card-title" style={{ fontSize: 14 }}>Replace this week&apos;s draw?</span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            This week already has {drawn} {drawn === 1 ? "match" : "matches"}. Drawing again discards
            them and pairs the nominated pairs again.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run(true)}>
              Replace them
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirm(false)}>
              Keep them
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
      {note && (
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          {note}
        </p>
      )}
    </div>
  );
}
