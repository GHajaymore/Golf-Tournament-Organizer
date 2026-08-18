"use client";
import { useState, useTransition } from "react";
import { setSingleMatchRule, createSingleMatch } from "@/app/actions/tournament";
import type { SingleMatchRule } from "@/lib/domain/single-match";

/**
 * Who plays a Single Match Stage.
 *
 * The stage has always been in the picker and never done anything, because
 * nothing created its match. This is the missing half: the organizer says HOW
 * the two players are chosen, and the pairing is worked out from the standings
 * as they stand when the round opens.
 *
 * The resolved pairing is shown before it is committed — "Halloran v Nair" —
 * because the whole point of a derived pairing is that it can still change,
 * and a committee wants to see who it currently means before they say yes.
 * When it cannot be resolved yet, the reason is shown instead of an empty box,
 * because "waiting on the earlier rounds" is the ordinary state for most of a
 * tournament rather than something going wrong.
 */
export function SingleMatchRulePicker({
  stageId,
  rule,
  ruleLabel,
  problem,
  aName,
  bName,
  matchId,
  stale,
  rounds,
  players,
  locked,
}: {
  stageId: string;
  rule: SingleMatchRule | null;
  ruleLabel: string;
  /** Why there is no pairing yet, from the resolver. Empty when there is one. */
  problem: string;
  aName: string;
  bName: string;
  matchId: string | null;
  /** A match exists, but the rule now resolves to different players. */
  stale: boolean;
  /** The other rounds, for "winner of X against winner of Y". */
  rounds: Array<{ id: string; label: string }>;
  players: Array<{ id: string; name: string }>;
  /**
   * Optional. Both actions call assertUnlocked on the server, so a locked
   * tournament is refused there with a message either way — this only saves
   * the round trip when the caller already knows.
   */
  locked?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [kind, setKind] = useState<SingleMatchRule["kind"]>(rule?.kind ?? "seeds");

  const save = (next: { kind: string; a: string | number; b: string | number }) =>
    startTransition(async () => {
      setError("");
      const res = await setSingleMatchRule(stageId, next);
      if (!res.ok) setError(res.error ?? "Couldn't save that pairing.");
    });

  const others = rounds.filter((r) => r.id !== stageId);
  const seedA = rule?.kind === "seeds" ? rule.a : 1;
  const seedB = rule?.kind === "seeds" ? rule.b : 2;
  const idA = rule && rule.kind !== "seeds" ? String(rule.a) : "";
  const idB = rule && rule.kind !== "seeds" ? String(rule.b) : "";

  return (
    <div className="card elev-sm" style={{ marginTop: 12, gap: 10 }}>
      <span className="card-title" style={{ fontSize: 14 }}>Who plays this match</span>
      <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 0", lineHeight: 1.55 }}>
        One match, and the two players are worked out when the round opens rather than fixed now — so
        correcting a score in an earlier round changes who plays it.
      </p>

      <div className="seg" style={{ width: "100%" }}>
        {(
          [
            ["seeds", "From the standings"],
            ["stage-winners", "Winners of two rounds"],
            ["named", "Two players I pick"],
          ] as Array<[SingleMatchRule["kind"], string]>
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={kind === k ? "on" : ""}
            disabled={pending || locked}
            onClick={() => {
              setKind(k);
              if (k === "seeds") save({ kind: k, a: seedA, b: seedB });
              else if (others.length >= 2) save({ kind: k, a: idA || others[0].id, b: idB || others[1].id });
              else if (k === "named" && players.length >= 2) save({ kind: k, a: idA || players[0].id, b: idB || players[1].id });
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {kind === "seeds" && (
        <div className="pair-grid">
          {([["a", seedA], ["b", seedB]] as Array<["a" | "b", number]>).map(([side, value]) => (
            <div className="field" key={side}>
              <label>{side === "a" ? "First player" : "Second player"}</label>
              <select
                className="input"
                value={value}
                disabled={pending || locked}
                onChange={(e) =>
                  save({
                    kind: "seeds",
                    a: side === "a" ? Number(e.target.value) : seedA,
                    b: side === "b" ? Number(e.target.value) : seedB,
                  })
                }
              >
                {Array.from({ length: Math.max(8, players.length) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "1st in the standings" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {kind === "stage-winners" && (
        <div className="pair-grid">
          {([["a", idA], ["b", idB]] as Array<["a" | "b", string]>).map(([side, value]) => (
            <div className="field" key={side}>
              <label>{side === "a" ? "Winner of" : "Against winner of"}</label>
              <select
                className="input"
                value={value || others[side === "a" ? 0 : 1]?.id || ""}
                disabled={pending || locked}
                onChange={(e) =>
                  save({
                    kind: "stage-winners",
                    a: side === "a" ? e.target.value : idA || others[0]?.id,
                    b: side === "b" ? e.target.value : idB || others[1]?.id,
                  })
                }
              >
                {others.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {kind === "named" && (
        <div className="pair-grid">
          {([["a", idA], ["b", idB]] as Array<["a" | "b", string]>).map(([side, value]) => (
            <div className="field" key={side}>
              <label>{side === "a" ? "Player" : "Against"}</label>
              <select
                className="input"
                value={value}
                disabled={pending || locked}
                onChange={(e) =>
                  save({
                    kind: "named",
                    a: side === "a" ? e.target.value : idA,
                    b: side === "b" ? e.target.value : idB,
                  })
                }
              >
                <option value="">Choose…</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* What the rule currently means, before anybody commits to it. */}
      <div
        style={{
          padding: "9px 11px",
          borderRadius: "var(--radius-md)",
          background: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        <span className="text-muted">{ruleLabel}</span>
        <br />
        {problem ? (
          <span className="text-muted">
            <i className="ph ph-hourglass" /> {problem}
          </span>
        ) : (
          <strong>
            {aName} v {bName}
          </strong>
        )}
      </div>

      {stale && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)", lineHeight: 1.55 }}>
          <i className="ph ph-warning-circle" /> The match already created for this round is between different
          players than the rule now gives. Results have changed since it was made — clear the match and create
          it again if the rule is the one you want.
        </p>
      )}

      {matchId ? (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          <i className="ph ph-check-circle" /> The match is made. Enter its result on Score entry.
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || locked || !!problem}
          onClick={() =>
            startTransition(async () => {
              setError("");
              const res = await createSingleMatch(stageId);
              if (!res.ok) setError(res.error ?? "Couldn't create the match.");
            })
          }
          style={{ justifyContent: "center" }}
        >
          <i className="ph ph-flag-checkered" /> Create this match
        </button>
      )}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
