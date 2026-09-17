"use client";

import { useState, useTransition } from "react";
import { setLeagueSettings } from "@/app/actions/league";
import {
  LEAGUE_POINTS_HELP,
  LEAGUE_POINTS_LABEL,
  LEAGUE_POINTS_SYSTEMS,
  type LeaguePointsSystem,
} from "@/lib/domain/league-meeting";
import {
  isLeaguePlayoffSize,
  LEAGUE_PLAYOFF_LABEL,
  LEAGUE_PLAYOFF_SIZES,
  type LeaguePlayoffSize,
} from "@/lib/domain/league-playoff";

/**
 * THE LEAGUE'S RULES, WHERE THE LEAGUE IS.
 *
 * Three answers a club gives once a season: how a four-ball becomes points,
 * what winning the match is worth on top, and how many pairs each club puts
 * up. None of them is a constant — six pairs and a two-point bonus are one
 * club's choices — so every one is asked rather than assumed.
 *
 * The organizer edits; everybody else reads. The server refuses anyone but
 * the organizer regardless, so `canEdit` only decides what is offered.
 */
export function LeagueSettings({
  points,
  matchBonus,
  pairs,
  playoffs,
  canEdit,
}: {
  /** Empty when the tournament is not a league. */
  points: LeaguePointsSystem | "";
  matchBonus: number;
  pairs: number;
  playoffs: number;
  canEdit: boolean;
}) {
  const [system, setSystem] = useState<LeaguePointsSystem | "">(points);
  const [bonus, setBonus] = useState(String(matchBonus));
  const [count, setCount] = useState(String(pairs));
  const [playoffSize, setPlayoffSize] = useState<LeaguePlayoffSize>(
    isLeaguePlayoffSize(playoffs) ? playoffs : 0,
  );
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const touched = () => {
    setSaved(false);
    setError("");
  };

  const save = () => {
    startTransition(async () => {
      const result = await setLeagueSettings({
        points: system,
        // An empty box is sent as NaN and refused by the server, rather than
        // quietly becoming zero.
        matchBonus: bonus.trim() === "" ? Number.NaN : Number(bonus),
        pairs: count.trim() === "" ? Number.NaN : Number(count),
        playoffs: playoffSize,
      });
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  };

  return (
    // Open while the league is off: the switch is the only thing on offer.
    <details
      className="card elev-sm"
      style={{ marginTop: 12 }}
      open={points === "" || undefined}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>
        League settings
      </summary>

      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="league-points">Scoring</label>
        <select
          id="league-points"
          className="input"
          value={system}
          disabled={!canEdit || pending}
          onChange={(e) => {
            setSystem(e.target.value as LeaguePointsSystem | "");
            touched();
          }}
        >
          <option value="">Not a league</option>
          {LEAGUE_POINTS_SYSTEMS.map((s) => (
            <option key={s} value={s}>
              {LEAGUE_POINTS_LABEL[s]}
            </option>
          ))}
        </select>
        <p
          className="text-muted"
          style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.55 }}
        >
          {system
            ? LEAGUE_POINTS_HELP[system]
            : "The Teams screen shows no league. Pairs already nominated are kept."}
        </p>
      </div>

      {/* Only one system has a bonus, and a box that changes nothing is a
          question the organizer should not have to wonder about. */}
      {system === "holes-and-match" && (
        <div className="field">
          <label htmlFor="league-bonus">Points for winning the match</label>
          <input
            id="league-bonus"
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={18}
            step={1}
            value={bonus}
            disabled={!canEdit || pending}
            onChange={(e) => {
              setBonus(e.target.value);
              touched();
            }}
            style={{ maxWidth: 120 }}
          />
        </div>
      )}

      {system !== "" && (
        <div className="field">
          <label htmlFor="league-pairs">
            Pairs per club each week{" "}
            <span className="text-muted">· 0 if it varies</span>
          </label>
          <input
            id="league-pairs"
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            step={1}
            value={count}
            disabled={!canEdit || pending}
            onChange={(e) => {
              setCount(e.target.value);
              touched();
            }}
            style={{ maxWidth: 120 }}
          />
          <p
            className="text-muted"
            style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.55 }}
          >
            Used to flag a club that is short on the night. Changing the scoring
            re-scores every week already played.
          </p>
        </div>
      )}

      {system !== "" && (
        <div className="field">
          <label htmlFor="league-playoffs">Play-offs</label>
          <select
            id="league-playoffs"
            className="input"
            value={playoffSize}
            disabled={!canEdit || pending}
            onChange={(e) => {
              setPlayoffSize(Number(e.target.value) as LeaguePlayoffSize);
              touched();
            }}
          >
            {LEAGUE_PLAYOFF_SIZES.map((n) => (
              <option key={n} value={n}>
                {LEAGUE_PLAYOFF_LABEL[n]}
              </option>
            ))}
          </select>
          <p
            className="text-muted"
            style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.55 }}
          >
            {playoffSize === 0
              ? "The season table is the final word."
              : `The last ${Math.log2(playoffSize) === 1 ? "team round is the final" : `${Math.log2(playoffSize)} team rounds are the play-offs`}, and the table counts only the weeks before. Seeds go by points, then meetings won, then name; a level play-off meeting goes to the higher seed.`}
          </p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          style={{
            margin: "4px 0 0",
            fontSize: 13,
            color: "var(--color-danger)",
          }}
        >
          {error}
        </p>
      )}
      {saved && (
        <p style={{ margin: "4px 0 0", fontSize: 13 }} className="text-muted">
          Saved.
        </p>
      )}

      {canEdit && (
        <button
          className="btn btn-primary"
          type="button"
          disabled={pending}
          onClick={save}
          style={{ marginTop: 8 }}
        >
          Save league settings
        </button>
      )}
    </details>
  );
}
