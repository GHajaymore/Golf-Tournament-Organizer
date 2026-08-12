"use client";
import { useState } from "react";
import { toParText } from "@/lib/domain";

/**
 * One hole at a time, for everyone sharing the card.
 *
 * The unit of score entry is the tee group, not the player. In a fourball one
 * person keeps the card for all four, and they write down hole 7 four times
 * before anybody walks to the 8th. A player-first screen inverts that: score a
 * hole, change player, score the same hole, change player — the selector
 * becomes the inner loop of the round, which is exactly backwards, and it is
 * the mistake this component was written to avoid. Hole is the outer loop.
 *
 * (Flights are a different axis and are not this component's business. A tee
 * group routinely spans several flights — you group by tee time for pace of
 * play and score by flight for fairness — so grouping here by flight would put
 * players on the screen who are not standing next to the scorer.)
 *
 * The control adapts to how many are on the card, because the right control is
 * not the same at one player as at four:
 *
 *   one   — the full par-relative pad, named the way golfers name the scores.
 *           A player posting their own round has the whole screen for it.
 *   many  — a row each with a stepper. Four pads do not fit a phone, and the
 *           scorer already knows the number; they need to enter it, not choose
 *           it from a menu.
 *
 * State lives in the parent, so this view and the full grid are two windows
 * onto one card and neither can drift from the other.
 */

/** Quick picks relative to par. Outside this, type it. */
const RELATIVE = [-2, -1, 0, 1, 2, 3];

export interface CardPlayer {
  id: string;
  name: string;
  /** Handicap strokes received on a given hole, from the real course-handicap
   *  allocation. Optional: an event with no ratings has none to show. */
  shotsOn?: (hole: number) => number;
}

function markStyle(v: number | null, par: number | undefined): React.CSSProperties {
  if (v == null || !par) return {};
  const d = v - par;
  if (d <= -2) return { borderRadius: "50%", boxShadow: "inset 0 0 0 2px var(--color-accent-2), inset 0 0 0 4px var(--color-surface), inset 0 0 0 6px var(--color-accent-2)" };
  if (d === -1) return { borderRadius: "50%", boxShadow: "inset 0 0 0 2px var(--color-accent-2)" };
  if (d === 1) return { borderRadius: 4, boxShadow: "inset 0 0 0 2px color-mix(in srgb, var(--color-danger) 65%, transparent)" };
  if (d >= 2) return { borderRadius: 4, boxShadow: "inset 0 0 0 2px color-mix(in srgb, var(--color-danger) 65%, transparent), inset 0 0 0 4px var(--color-surface), inset 0 0 0 6px color-mix(in srgb, var(--color-danger) 65%, transparent)" };
  return {};
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

function firstName(n: string): string {
  return n.split(" ")[0] ?? n;
}

export function HoleByHoleCard({
  players,
  cards,
  pars,
  yards,
  strokeIndex,
  holes,
  onSet,
}: {
  players: CardPlayer[];
  cards: Record<string, (number | null)[]>;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  holes: number;
  onSet: (playerId: string, hole: number, value: number | null) => void;
}) {
  // Open where the card has got to: the first hole nobody has scored yet.
  //
  // Not "the first hole someone is missing" — scoring is allowed to be partial,
  // so one player who has not reported would pin the screen to hole 1 for the
  // whole round while everyone else played on.
  const [hole, setHole] = useState(() => {
    for (let i = 0; i < holes; i += 1) {
      if (players.every((p) => (cards[p.id] ?? [])[i] == null)) return i;
    }
    return Math.max(0, holes - 1);
  });

  const par = pars[hole];
  const solo = players.length === 1;
  const go = (next: number) => setHole(Math.max(0, Math.min(holes - 1, next)));

  const strokesOf = (id: string) => cards[id] ?? new Array(holes).fill(null);

  /** Running to-par over the holes that player has actually completed. */
  const toParOf = (id: string) => {
    const s = strokesOf(id);
    let total = 0;
    let played = 0;
    for (let i = 0; i < holes; i += 1) {
      if (s[i] == null) continue;
      total += (s[i] as number) - (pars[i] ?? 0);
      played += 1;
    }
    return { toPar: total, played };
  };

  const set = (playerId: string, v: number | null) => {
    onSet(playerId, hole, v);
    // Only advance on a solo card. On a group card the scorer is part way
    // through the hole and moving the screen out from under them would be
    // actively hostile.
    if (solo && v != null && hole < holes - 1) window.setTimeout(() => go(hole + 1), 160);
  };

  const holeDone = (i: number) => players.every((p) => strokesOf(p.id)[i] != null);
  const holeStarted = (i: number) => players.some((p) => strokesOf(p.id)[i] != null);

  return (
    <div>
      {/* Position in the round, and which holes are in. Doubles as navigation,
          so a hole written down wrong is two taps away. */}
      <div style={{ display: "flex", gap: 3, marginBottom: 16, overflowX: "auto", paddingBottom: 2 }}>
        {Array.from({ length: holes }, (_, i) => {
          const done = holeDone(i);
          const part = !done && holeStarted(i);
          const here = i === hole;
          return (
            <button
              key={i}
              type="button"
              onClick={() => go(i)}
              aria-label={`Hole ${i + 1}${done ? ", complete" : part ? ", partly scored" : ", not scored"}`}
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
                background: done
                  ? "var(--color-accent-900)"
                  : part
                    ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
                    : "transparent",
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
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--color-neutral-400)" }}>
              Hole
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 54, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {hole + 1}
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13.5, lineHeight: 1.7, color: "var(--color-neutral-400)" }}>
            <div>Par <strong style={{ color: "var(--color-text)", fontSize: 16 }}>{par ?? "—"}</strong></div>
            {yards[hole] != null && <div style={{ fontVariantNumeric: "tabular-nums" }}>{yards[hole]} yds</div>}
            {strokeIndex[hole] != null && <div>S.I. {strokeIndex[hole]}</div>}
          </div>
        </div>

        {solo ? (
          <SoloPad
            player={players[0]}
            hole={hole}
            par={par}
            value={strokesOf(players[0].id)[hole] ?? null}
            onPick={(v) => set(players[0].id, v)}
          />
        ) : (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {players.map((p) => {
              const value = strokesOf(p.id)[hole] ?? null;
              const shots = p.shotsOn?.(hole) ?? 0;
              const { toPar, played } = toParOf(p.id);
              return (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    paddingTop: 10,
                    borderTop: "1px solid var(--color-divider)",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 15, fontWeight: 550, overflowWrap: "anywhere" }}>
                      {firstName(p.name)}
                      {shots > 0 && (
                        <span
                          title={`${shots} handicap ${shots === 1 ? "stroke" : "strokes"} on this hole`}
                          style={{ marginLeft: 5, color: "var(--color-accent-400)", fontWeight: 700 }}
                        >
                          {"•".repeat(shots)}
                        </span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--color-neutral-400)", fontVariantNumeric: "tabular-nums" }}>
                      {played ? `${toParText(toPar)} thru ${played}` : "no score yet"}
                    </span>
                  </span>

                  {/* A stepper, not a pad: the scorer knows the number and is
                      entering it, not choosing from a menu. First tap of + or −
                      starts from par, which is the commonest score on any hole. */}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-label={`One fewer stroke for ${p.name} on hole ${hole + 1}`}
                    onClick={() => set(p.id, Math.max(1, (value ?? (par ?? 4) + 1) - 1))}
                    style={{ minWidth: 44, minHeight: 44, fontSize: 18, padding: 0 }}
                  >
                    −
                  </button>
                  <span
                    aria-label={`${p.name}, hole ${hole + 1}${value == null ? ", not scored" : `, ${value} strokes`}`}
                    style={{
                      minWidth: 44,
                      minHeight: 44,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 19,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: value == null ? "var(--color-neutral-400)" : "var(--color-text)",
                      ...markStyle(value, par),
                    }}
                  >
                    {value ?? "–"}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    aria-label={`One more stroke for ${p.name} on hole ${hole + 1}`}
                    onClick={() => set(p.id, (value ?? (par ?? 4) - 1) + 1)}
                    style={{ minWidth: 44, minHeight: 44, fontSize: 18, padding: 0 }}
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={() => go(hole - 1)} disabled={hole === 0} style={{ flex: 1, minHeight: 46 }}>
          <i className="ph ph-caret-left" /> Previous
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => go(hole + 1)} disabled={hole === holes - 1} style={{ flex: 1, minHeight: 46 }}>
          Next <i className="ph ph-caret-right" />
        </button>
      </div>
    </div>
  );
}

/** The one-player pad: named, par-relative, and big enough for a gloved thumb. */
function SoloPad({
  player,
  hole,
  par,
  value,
  onPick,
}: {
  player: CardPlayer;
  hole: number;
  par: number | undefined;
  value: number | null;
  onPick: (v: number | null) => void;
}) {
  const shots = player.shotsOn?.(hole) ?? 0;
  return (
    <>
      {shots > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--color-accent-400)", fontWeight: 600 }}>
          {"•".repeat(shots)} {shots === 1 ? "1 shot" : `${shots} shots`} on this hole
        </p>
      )}
      {/* `keep-grid` is not decoration. globals.css stacks every inline grid
          inside <main> on phones — `main [style*="grid-template-columns"]` with
          !important — because most two-column layouts have no business staying
          side by side at 375px. This one does: six par-relative picks in a
          single column is a scrolling list, not a keypad. The rule's own
          comment says the hole grid opts out; it simply never did, so the pad
          shipped as six stacked full-width buttons. */}
      <div
        className="keep-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 16 }}
      >
        {RELATIVE.map((rel) => {
          const n = (par ?? 4) + rel;
          if (n < 1) return null;
          const chosen = value === n;
          return (
            <button
              key={rel}
              type="button"
              onClick={() => onPick(chosen ? null : n)}
              aria-pressed={chosen}
              style={{
                // 56px: above the 44px touch minimum, with a glove on.
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
        <label htmlFor="hbh-other" style={{ fontSize: 12.5, color: "var(--color-neutral-400)" }}>Other</label>
        <input
          id="hbh-other"
          className="input"
          inputMode="numeric"
          value={value ?? ""}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onPick(Number.isFinite(n) && n > 0 ? n : null);
          }}
          aria-label={`Strokes on hole ${hole + 1}`}
          style={{ width: 76, minHeight: 44, textAlign: "center", fontSize: 17, fontVariantNumeric: "tabular-nums", ...markStyle(value, par) }}
        />
      </div>
    </>
  );
}
