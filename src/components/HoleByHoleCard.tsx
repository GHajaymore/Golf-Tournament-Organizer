"use client";
import { useState } from "react";
import { toParText } from "@/lib/domain";

/**
 * One hole at a time — the card as it is actually filled in, on a phone, by
 * someone standing on the next tee.
 *
 * The full eighteen-column card is the right shape for an organizer entering a
 * stack of returned cards at a desk: every hole visible, tab across, done. It
 * is the wrong shape for the player. Eighteen columns cannot fit a phone, so
 * the grid becomes a 960px table behind a horizontal scrollbar, and filling it
 * in means scrolling sideways to find the hole you just played, typing into a
 * 36px box next to seventeen identical ones, and scrolling back to see what it
 * did to your score. Every mis-keyed hole in that flow lands silently.
 *
 * So on a phone the same card is entered a hole at a time: the hole's own
 * numbers big enough to read at arm's length, the score chosen by tapping
 * rather than typing, and the running total always on screen. This is what
 * every golf app that people actually use on a course does, and it is worth
 * copying.
 *
 * State lives in the parent — this only presents it, so the full grid and this
 * view are two windows onto one card and neither can drift from the other.
 */

/** The quick picks, relative to par. Beyond this range, type it. */
const RELATIVE = [-2, -1, 0, 1, 2, 3];

function markClass(v: number | null, par: number | undefined): string {
  if (v == null || !par) return "";
  const d = v - par;
  return d <= -2 ? " is-eagle" : d === -1 ? " is-under" : d === 1 ? " is-over" : d >= 2 ? " is-double" : "";
}

/** What a golfer calls it, which is what belongs on the button. */
function nameFor(rel: number, par: number | undefined): string {
  if (!par) return "";
  if (par + rel === 1) return "Ace";
  switch (rel) {
    case -2: return "Eagle";
    case -1: return "Birdie";
    case 0: return "Par";
    case 1: return "Bogey";
    case 2: return "Double";
    default: return `+${rel}`;
  }
}

export function HoleByHoleCard({
  strokes,
  pars,
  yards,
  strokeIndex,
  holes,
  /** Handicap strokes received per hole, so the card can show the dots. */
  shotsOn,
  onSet,
}: {
  strokes: (number | null)[];
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  holes: number;
  shotsOn?: (hole: number) => number;
  onSet: (hole: number, value: number | null) => void;
}) {
  // Open on the first hole with no score — where a player filling the card in
  // order actually is. Falls back to the last hole on a complete card.
  const [hole, setHole] = useState(() => {
    const next = strokes.slice(0, holes).findIndex((s) => s == null);
    return next === -1 ? holes - 1 : next;
  });

  const par = pars[hole];
  const value = strokes[hole] ?? null;
  const shots = shotsOn?.(hole) ?? 0;

  // Running total over the holes played so far, which is the number a player
  // is carrying in their head and the one thing a paper card cannot show them.
  const played = strokes.slice(0, holes).filter((s): s is number => s != null);
  // `reduce<number>` because the array is (number | null)[], so without it the
  // accumulator is inferred as number | null and the sum stops type-checking.
  const playedPar = strokes
    .slice(0, holes)
    .reduce<number>((t, s, i) => (s == null ? t : t + (pars[i] ?? 0)), 0);
  const runningToPar = played.reduce((a, b) => a + b, 0) - playedPar;

  const go = (next: number) => setHole(Math.max(0, Math.min(holes - 1, next)));

  const set = (v: number | null) => {
    onSet(hole, v);
    // Move on once a hole is scored — the next thing the player wants is the
    // next hole, not this one again. The last hole stays put so the card can
    // be reviewed before it is saved.
    if (v != null && hole < holes - 1) window.setTimeout(() => go(hole + 1), 160);
  };

  return (
    <div>
      {/* Hole strip: position in the round, and which holes are already in.
          Doubles as navigation — a mis-keyed hole is two taps away. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 16, overflowX: "auto", paddingBottom: 2 }}>
        {Array.from({ length: holes }, (_, i) => {
          const done = strokes[i] != null;
          const here = i === hole;
          return (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Hole ${i + 1}${done ? `, ${strokes[i]} strokes` : ", not scored"}`}
              aria-current={here ? "true" : undefined}
              style={{
                flex: "1 0 auto",
                minWidth: 26,
                height: 30,
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                fontWeight: here ? 700 : 500,
                cursor: "pointer",
                borderRadius: 6,
                border: here ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
                background: done ? "var(--color-accent-900)" : "transparent",
                color: "var(--color-text)",
              }}
            >
              {i + 1}
            </button>
          );
        })}
      </div>

      <div className="card elev-sm" style={{ padding: "18px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
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
              Hole
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 54,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {hole + 1}
            </div>
          </div>

          <div style={{ textAlign: "right", fontSize: 13.5, lineHeight: 1.7, color: "var(--color-neutral-400)" }}>
            <div>
              Par <strong style={{ color: "var(--color-text)", fontSize: 16 }}>{par ?? "—"}</strong>
            </div>
            {yards[hole] != null && <div style={{ fontVariantNumeric: "tabular-nums" }}>{yards[hole]} yds</div>}
            {strokeIndex[hole] != null && <div>S.I. {strokeIndex[hole]}</div>}
            {shots > 0 && (
              <div style={{ color: "var(--color-accent-400)", fontWeight: 600 }}>
                {"•".repeat(shots)} {shots === 1 ? "1 shot" : `${shots} shots`}
              </div>
            )}
          </div>
        </div>

        {/* Tap, don't type. A number pad on a phone covers half the screen and
            offers ten digits when only about six are plausible. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
            marginTop: 18,
          }}
        >
          {RELATIVE.map((rel) => {
            const n = (par ?? 4) + rel;
            if (n < 1) return null;
            const chosen = value === n;
            return (
              <button
                key={rel}
                type="button"
                onClick={() => set(chosen ? null : n)}
                aria-pressed={chosen}
                style={{
                  // 56px: comfortably above the 44px touch minimum, with a
                  // glove on, on a moving cart.
                  minHeight: 56,
                  borderRadius: 10,
                  cursor: "pointer",
                  border: chosen ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
                  background: chosen ? "var(--color-accent-900)" : "var(--color-surface)",
                  color: "var(--color-text)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                }}
              >
                <span style={{ fontSize: 21, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{n}</span>
                <span style={{ fontSize: 10.5, color: "var(--color-neutral-400)" }}>{nameFor(rel, par)}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
          <label htmlFor="hbh-other" style={{ fontSize: 12.5, color: "var(--color-neutral-400)" }}>
            Other
          </label>
          <input
            id="hbh-other"
            className={`input${markClass(value, par)}`}
            inputMode="numeric"
            value={value ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onSet(hole, Number.isFinite(n) && n > 0 ? n : null);
            }}
            aria-label={`Strokes on hole ${hole + 1}`}
            style={{ width: 76, minHeight: 44, textAlign: "center", fontSize: 17, fontVariantNumeric: "tabular-nums" }}
          />
          <span style={{ marginLeft: "auto", textAlign: "right" }}>
            <span
              style={{
                display: "block",
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-neutral-400)",
              }}
            >
              Thru {played.length}
            </span>
            <span
              style={{
                display: "block",
                fontFamily: "var(--font-heading)",
                fontSize: 26,
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
                color: runningToPar < 0 ? "var(--color-accent-2-300)" : "var(--color-text)",
              }}
            >
              {played.length ? toParText(runningToPar) : "—"}
            </span>
          </span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => go(hole - 1)}
          disabled={hole === 0}
          style={{ flex: 1, minHeight: 46 }}
        >
          <i className="ph ph-caret-left" /> Previous
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => go(hole + 1)}
          disabled={hole === holes - 1}
          style={{ flex: 1, minHeight: 46 }}
        >
          Next <i className="ph ph-caret-right" />
        </button>
      </div>
    </div>
  );
}
