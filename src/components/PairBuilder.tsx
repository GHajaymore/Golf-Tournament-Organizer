"use client";

import { indexLabel } from "@/lib/domain/handicap-label";
import { useState, useTransition } from "react";
import { nominatePair, withdrawPair } from "@/app/actions/league";
import { Icon } from "@/components/Icon";
import type { ClubNominations } from "@/lib/services/league-nomination";

/**
 * THE CAPTAIN'S TEAM SHEET: who is available, and who is paired with whom.
 *
 * A club holds a roster of ten or more and puts up pairs for a week. This
 * picks two names and nominates them; the pair becomes an ordinary four-ball
 * side, scored the way every other side is.
 *
 * AVAILABILITY IS SHOWN AND NEVER ENFORCED. `RoundAttendance` is the player's
 * answer to "am I around on Thursday" and this is the captain's answer to "are
 * you playing, and with whom" — two questions, two places. Somebody who has
 * not answered can still be picked, because a captain often knows something
 * the app does not. What the screen owes them is the information, not a
 * refusal.
 *
 * THE SERVER DECIDES, and this only asks. Every rule that matters — on the
 * roster, not already out this week, both in this tournament — is enforced in
 * `nominatePair`, because the screen is a convenience and the action is a
 * public HTTP endpoint. The two-at-a-time limit here is to stop a captain
 * clicking a third name, not to keep anything safe.
 */
export function PairBuilder({ club, stageId }: { club: ClubNominations; stageId: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const unpaired = club.roster.filter((r) => !r.pairId);

  const toggle = (playerId: string) => {
    setError("");
    setPicked((current) =>
      current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : current.length >= 2
          ? current
          : [...current, playerId],
    );
  };

  const nominate = () => {
    startTransition(async () => {
      const result = await nominatePair(stageId, club.clubId, picked);
      if (result.ok) setPicked([]);
      else setError(result.error);
    });
  };

  const withdraw = (pairId: string) => {
    startTransition(async () => {
      const result = await withdrawPair(pairId);
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card elev-sm">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span className="card-title">{club.clubName}</span>
          {/* How many a club puts up is the league's own setting — six is one
              club's number, not a rule — so this says nothing at all until
              somebody has declared one. */}
          {club.expected > 0 && (
            <span
              className={club.pairs.length >= club.expected ? "tag tag-accent" : "tag tag-neutral"}
            >
              {club.pairs.length} of {club.expected} pairs
            </span>
          )}
        </div>
        {/* The captain is appointed in flights setup, and only where a league
            has one — so a club without one simply shows no line. */}
        {club.captainName && (
          <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
            Captain: {club.captainName}
          </div>
        )}

        {club.pairs.length === 0 ? (
          <p className="text-muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            No pairs nominated for this round yet. Pick two names below.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
            {club.pairs.map((p) => (
              <li
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "6px 0",
                  borderTop: "1px solid var(--color-divider)",
                }}
              >
                <span>{p.name}</span>
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={pending}
                  onClick={() => withdraw(p.id)}
                >
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card elev-sm">
        <span className="card-title">Available to pick</span>
        {unpaired.length === 0 ? (
          <p className="text-muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            Everybody on the roster is already in a pair this round.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
            {unpaired.map((r) => {
              const on = picked.includes(r.playerId);
              return (
                <li key={r.playerId} style={{ borderTop: "1px solid var(--color-divider)" }}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(r.playerId)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 4px",
                      background: on ? "color-mix(in srgb, var(--color-accent) 14%, transparent)" : "none",
                      border: "none",
                      color: "inherit",
                      font: "inherit",
                      textAlign: "left",
                      cursor: pending ? "default" : "pointer",
                    }}
                  >
                    <span>
                      {r.name}{" "}
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        ({indexLabel(r)})
                      </span>
                    </span>
                    {/* Said so, or merely assumed by the round's mode. A
                        captain reads those differently: silence under opt-out
                        is not the same as somebody answering yes. */}
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {r.available ? (r.answered ? "Available" : "No reply") : "Out"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-danger)" }}>{error}</p>
        )}

        <button
          className="btn btn-primary"
          type="button"
          disabled={pending || picked.length !== 2}
          onClick={nominate}
          style={{ alignSelf: "flex-start", marginTop: 12 }}
        >
          <Icon name="user-plus" /> Nominate pair
        </button>
      </div>
    </div>
  );
}
