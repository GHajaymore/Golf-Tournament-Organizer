"use client";
import { useState, useTransition } from "react";
import { setMatchTiebreakers } from "@/app/actions/tournament";
import {
  OFFERED_MATCH_TIEBREAKS,
  MATCH_TIEBREAK_LABELS,
  MATCH_TIEBREAK_BLURBS,
  STANDARD_COUNTBACK,
  STANDARD_COUNTBACK_9,
  type MatchTiebreakKey,
} from "@/lib/domain/match-tiebreak";

/**
 * How a single all-square match is decided.
 *
 * Deliberately separate from the standings tiebreakers, which sit further down
 * the same screen and answer a different question: those separate players
 * level on points across the tournament, this separates two players level in
 * one match. Putting them in one list would suggest they compete, when in fact
 * this one runs first and changes what the other one is ranking.
 *
 * An ordered ladder rather than a single choice, because the countback IS a
 * ladder — and a committee justifying a result quotes the whole thing.
 */
export function MatchTiebreakControl({
  selected,
  holes,
  locked,
}: {
  selected: MatchTiebreakKey[];
  /** The round length, which decides whether "last 9" means anything. */
  holes: number;
  locked: boolean;
}) {
  const [seq, setSeq] = useState<MatchTiebreakKey[]>(selected);
  const [pending, startTransition] = useTransition();

  const commit = (next: MatchTiebreakKey[]) => {
    setSeq(next);
    startTransition(() => void setMatchTiebreakers(next));
  };

  const toggle = (key: MatchTiebreakKey) => {
    commit(seq.includes(key) ? seq.filter((k) => k !== key) : [...seq, key]);
  };

  const move = (key: MatchTiebreakKey, dir: -1 | 1) => {
    const i = seq.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= seq.length) return;
    const next = [...seq];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  // "Last 9" on a nine-hole round is the whole round, so it can never separate
  // anyone — offering it would be offering a step that does nothing.
  const available = OFFERED_MATCH_TIEBREAKS.filter(
    (k) => !(holes === 9 && (k === "last-9" || k === "toughest-6")),
  );
  const standard = holes === 9 ? STANDARD_COUNTBACK_9 : STANDARD_COUNTBACK;
  const isStandard = seq.length === standard.length && seq.every((k, i) => k === standard[i]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <span className="card-kicker" style={{ display: "block" }}>
          If a match finishes all square
        </span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", maxWidth: "68ch", lineHeight: 1.5 }}>
          Tried in order, stopping at the first step that separates them. With nothing selected a
          halved match stays halved — correct match play, and the right answer unless a winner has
          to be produced today.
        </p>
      </div>

      {!locked && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ fontSize: 12 }}
            disabled={pending || isStandard}
            onClick={() => commit([...standard])}
          >
            <i className="ph ph-list-numbers" /> Use the standard countback
          </button>
          {seq.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ fontSize: 12 }}
              disabled={pending}
              onClick={() => commit([])}
            >
              Leave matches halved
            </button>
          )}
        </div>
      )}

      {/* The chosen ladder, in order, with the rungs movable. */}
      {seq.length > 0 && (
        <ol style={{ display: "flex", flexDirection: "column", gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
          {seq.map((key, i) => (
            <li
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: "var(--radius-md)",
                fontSize: 12.5,
                background: "color-mix(in srgb, var(--color-accent) 9%, transparent)",
                boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 26%, transparent)",
              }}
            >
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                  fontSize: 11,
                  color: "var(--color-accent-300)",
                  width: 14,
                }}
              >
                {i + 1}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>{MATCH_TIEBREAK_LABELS[key]}</span>
              {!locked && (
                <>
                  <button
                    type="button"
                    className="btn btn-icon"
                    style={{ width: 22, height: 22 }}
                    aria-label={`Move ${MATCH_TIEBREAK_LABELS[key]} earlier`}
                    disabled={pending || i === 0}
                    onClick={() => move(key, -1)}
                  >
                    <i className="ph ph-caret-up" style={{ fontSize: 11 }} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon"
                    style={{ width: 22, height: 22 }}
                    aria-label={`Move ${MATCH_TIEBREAK_LABELS[key]} later`}
                    disabled={pending || i === seq.length - 1}
                    onClick={() => move(key, 1)}
                  >
                    <i className="ph ph-caret-down" style={{ fontSize: 11 }} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-icon"
                    style={{ width: 22, height: 22 }}
                    aria-label={`Remove ${MATCH_TIEBREAK_LABELS[key]}`}
                    disabled={pending}
                    onClick={() => toggle(key)}
                  >
                    <i className="ph ph-x" style={{ fontSize: 10 }} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}

      {!locked && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 6 }}>
          {available
            .filter((k) => k !== "halved" && !seq.includes(k))
            .map((key) => (
              <button
                key={key}
                type="button"
                disabled={pending}
                onClick={() => toggle(key)}
                title={MATCH_TIEBREAK_BLURBS[key]}
                style={{
                  textAlign: "left",
                  padding: "7px 10px",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  color: "var(--color-text)",
                  background: "color-mix(in srgb, var(--color-text) 3%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--color-text) 12%, transparent)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 500 }}>
                  <i className="ph ph-plus" style={{ fontSize: 11, color: "var(--color-accent-400)" }} />
                  {MATCH_TIEBREAK_LABELS[key]}
                </div>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
