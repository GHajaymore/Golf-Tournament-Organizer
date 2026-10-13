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
 *
 * AND DRAWING THE PLAY-OFFS OFF A SEASON WITH A HOLE IN IT ASKS TOO
 * (2026-10-13). The two questions are separate and can both be put to one
 * press — a play-off round already drawn, off a season a week short — so what
 * has been agreed to is remembered across them rather than held as one flag.
 */
export function LeagueDraw({ stageId, drawn }: { stageId: string; drawn: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  /** The question on the screen, if there is one. */
  const [asked, setAsked] = useState<{ kind: "replace" } | { kind: "short"; missing: number } | null>(null);
  /** What has been said yes to so far in this press. */
  const [agreed, setAgreed] = useState({ replace: false, shortSeason: false });
  const [note, setNote] = useState("");

  const run = (yes: { replace: boolean; shortSeason: boolean }) => {
    setError("");
    setNote("");
    setAgreed(yes);
    startTransition(async () => {
      const res = await drawLeagueWeek(stageId, yes.replace, yes.shortSeason);
      if (!res.ok) {
        if (res.needsConfirm) {
          setAsked(res.missing ? { kind: "short", missing: res.missing } : { kind: "replace" });
        } else {
          setAsked(null);
          setError(res.error);
        }
        return;
      }
      setAsked(null);
      setAgreed({ replace: false, shortSeason: false });
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
  const decline = () => {
    setAsked(null);
    setAgreed({ replace: false, shortSeason: false });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() => run({ replace: false, shortSeason: false })}
        style={{ alignSelf: "flex-start" }}
      >
        <Icon name="shuffle" /> {drawn > 0 ? "Redraw this week" : "Draw this week"}
      </button>
      <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
        Clubs meet on a round-robin rotation across the weeks, and pairs play in the order each
        club nominated them — first pair against first pair.
      </p>

      {asked?.kind === "replace" && (
        <div className="card elev-sm" style={{ gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
          <span className="card-title" style={{ fontSize: 14 }}>Replace this week&apos;s draw?</span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            This week already has {drawn} {drawn === 1 ? "match" : "matches"}. Drawing again discards
            them and pairs the nominated pairs again.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run({ ...agreed, replace: true })}>
              Replace them
            </button>
            <button type="button" className="btn btn-secondary" onClick={decline}>
              Keep them
            </button>
          </div>
        </div>
      )}

      {asked?.kind === "short" && (
        <div className="card elev-sm" style={{ gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
          <span className="card-title" style={{ fontSize: 14 }}>Draw the play-offs before the season is finished?</span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
            {asked.missing === 1
              ? "One season meeting was never played"
              : `${asked.missing} season meetings were never played`}{" "}
            — a week that was not drawn, or a club that put up no pair. The play-offs would be seeded
            from the table as it stands today.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => run({ ...agreed, shortSeason: true })}>
              Draw the play-offs
            </button>
            <button type="button" className="btn btn-secondary" onClick={decline}>
              Not yet
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
