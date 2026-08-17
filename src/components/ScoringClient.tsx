"use client";
import { useState, useTransition } from "react";
import { saveScoring, saveTiebreakers } from "@/app/actions/tournament";
import { pts } from "@/lib/format";
import { tiebreakerLabel, tiebreakerHelp, FIXED_TIEBREAKER_KEYS, toughestN, MAX_TOUGHEST_N, type TiebreakerKey } from "@/lib/domain";
import { RuleCite } from "./RuleCite";
import FieldInfo from "@/components/FieldInfo";

interface Values {
  winPts: number;
  tiePts: number;
  lossPts: number;
  holeRatioPts: number;
  bonusPts: number;
  maxPerMatch: number;
}

const FIELDS: Array<{ key: keyof Values; label: string; hint: string; step: number }> = [
  { key: "winPts", label: "Win", hint: "Points for winning a match", step: 0.5 },
  { key: "tiePts", label: "Halve", hint: "Points for a halved match", step: 0.5 },
  { key: "lossPts", label: "Loss", hint: "Points for losing a match", step: 0.5 },
  { key: "holeRatioPts", label: "Hole-win ratio", hint: "Points per net hole won", step: 0.1 },
  { key: "bonusPts", label: "Bonus", hint: "Flat bonus per player", step: 0.5 },
  {
    key: "maxPerMatch",
    label: "Most from one match",
    hint: "0 for no limit",
    step: 0.5,
  },
];

export function ScoringClient({
  initial,
  tiebreakers,
}: {
  initial: Values;
  tiebreakers: TiebreakerKey[];
}) {
  const [values, setValues] = useState<Values>(initial);
  const [order, setOrder] = useState<TiebreakerKey[]>(tiebreakers);
  const [pending, startTransition] = useTransition();

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    startTransition(() => saveTiebreakers(next));
  };

  const toggle = (key: TiebreakerKey, on: boolean) => {
    const next = on ? [...order, key] : order.filter((k) => k !== key);
    setOrder(next);
    startTransition(() => saveTiebreakers(next));
  };

  /**
   * The fixed tiebreakers not already in the chain.
   *
   * The countbacks are not listed here: there are eighteen of them and a
   * committee wants one or two, so they are added by naming N below rather
   * than by scrolling a list of every possibility.
   */
  const available = FIXED_TIEBREAKER_KEYS.filter((k) => !order.includes(k));

  /** Which N are still free to add, so the same countback can't go in twice. */
  const usedN = new Set(order.map((k) => toughestN(k)).filter((n): n is number => n !== null));
  const addToughest = (n: number) => {
    const key = `toughest-${n}` as TiebreakerKey;
    if (order.includes(key)) return;
    const next = [...order, key];
    setOrder(next);
    startTransition(() => saveTiebreakers(next));
  };

  const save = (next: Values) => {
    setValues(next);
    startTransition(() => saveScoring(next));
  };

  const onChange = (key: keyof Values, raw: string) => {
    const n = parseFloat(raw);
    save({ ...values, [key]: Number.isFinite(n) ? n : 0 });
  };

  // Worked example: 2 wins, 1 halve, 12 net holes won — four holes a match
  // across the three, so the cap has something to apply to. Written per match
  // rather than from the totals because that is how the engine now counts,
  // and an example that ignored the cap would show a number the tournament
  // would never award.
  const exampleW = 2, exampleT = 1, exampleH = 12;
  const holesPerMatch = exampleH / (exampleW + exampleT);
  const cap = (n: number) => (values.maxPerMatch > 0 ? Math.min(n, values.maxPerMatch) : n);
  const perWin = cap(values.winPts + holesPerMatch * values.holeRatioPts);
  const perHalve = cap(values.tiePts + holesPerMatch * values.holeRatioPts);
  const total = exampleW * perWin + exampleT * perHalve + values.bonusPts;
  const capBites =
    values.maxPerMatch > 0 &&
    (values.winPts + holesPerMatch * values.holeRatioPts > values.maxPerMatch ||
      values.tiePts + holesPerMatch * values.holeRatioPts > values.maxPerMatch);

  return (
    <div className="page-split" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <div className="card elev-sm" style={{ gap: 14 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Points {pending && <span className="text-muted" style={{ fontSize: 12 }}>· saving…</span>}</span>
        {FIELDS.map((f) => (
          <div key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{f.label}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>{f.hint}</div>
            </div>
            <input
              className="input"
              type="number"
              step={f.step}
              style={{ width: 90, textAlign: "right" }}
              value={values[f.key]}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 15 }}>Tiebreakers</span>
          <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 4px" }}>
            Switch on the ones you want, applied in order when points are level. Reorder the active ones with the arrows.
          </p>
          {/* Cited here rather than anywhere else on the screen because this is
              the setting whose timing is governed: the method has to be settled
              before play, not chosen once there is a tie to break. */}
          <p style={{ margin: "0 0 8px" }}>
            <RuleCite rule="decidingTies" />
          </p>
          {order.map((t, i) => (
            <div
              key={t}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                padding: "6px 10px",
                background: "var(--color-bg)",
                borderRadius: 6,
                marginBottom: 5,
              }}
            >
              <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked disabled={pending} onChange={() => toggle(t, false)} />
              </label>
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  background: "var(--color-accent-800)",
                  color: "var(--color-accent-100)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 11,
                  flex: "none",
                }}
              >
                {i + 1}
              </span>
              <span style={{ flex: 1 }}>{tiebreakerLabel(t)}</span>
              <FieldInfo label={tiebreakerLabel(t)}>
                <p>{tiebreakerHelp(t)}</p>
              </FieldInfo>
              <button type="button" className="btn btn-icon" disabled={pending || i === 0} onClick={() => move(i, -1)} title="Move up" style={{ width: 28, height: 28 }}>
                <i className="ph ph-caret-up" />
              </button>
              <button type="button" className="btn btn-icon" disabled={pending || i === order.length - 1} onClick={() => move(i, 1)} title="Move down" style={{ width: 28, height: 28 }}>
                <i className="ph ph-caret-down" />
              </button>
            </div>
          ))}
          {order.length === 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: "4px 0" }}>
              None active — level standings fall back to seed order.
            </p>
          )}
          {available.length > 0 && (
            <>
              <div className="text-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", margin: "8px 0 4px" }}>
                Available
              </div>
              {available.map((t) => (
                // The info button sits OUTSIDE the label. Inside it, a tap on
                // "what does this mean" would also switch the tiebreaker on —
                // which is the opposite of what somebody asking the question
                // wants.
                <div
                  key={t}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    padding: "6px 10px",
                    borderRadius: 6,
                    marginBottom: 5,
                    color: "var(--color-neutral-400)",
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, cursor: "pointer" }}>
                    <input type="checkbox" checked={false} disabled={pending} onChange={() => toggle(t, true)} />
                    {tiebreakerLabel(t)}
                  </label>
                  <FieldInfo label={tiebreakerLabel(t)}>
                    <p>{tiebreakerHelp(t)}</p>
                  </FieldInfo>
                </div>
              ))}
            </>
          )}

          {/* Countbacks are added by naming N rather than picked off a list of
              eighteen. A committee writes its own ladder — hardest 9, then 6,
              then 3, then the hardest hole — and each one added is a tighter
              cut than the last, so several in a chain is the normal case
              rather than an odd one. */}
          <div className="text-muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", margin: "12px 0 4px" }}>
            Add a countback
          </div>
          <p className="text-muted" style={{ fontSize: 12, margin: "0 0 7px", lineHeight: 1.6 }}>
            Compares records over the hardest holes by stroke index. Add as many as you like — each one a
            tighter cut for players still level after the one before.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
            {[9, 6, 3, 1].map((n) => (
              <button
                key={n}
                type="button"
                className="tag tag-neutral"
                disabled={pending || usedN.has(n)}
                onClick={() => addToughest(n)}
                style={{ cursor: usedN.has(n) ? "default" : "pointer", border: "none", opacity: usedN.has(n) ? 0.45 : 1 }}
              >
                <i className="ph ph-plus" /> Toughest {n}
              </button>
            ))}
            <select
              className="input"
              value=""
              disabled={pending}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n) addToughest(n);
              }}
              style={{ fontSize: 12, padding: "3px 6px", width: "auto" }}
              aria-label="Add another countback"
            >
              <option value="">Another N…</option>
              {Array.from({ length: MAX_TOUGHEST_N }, (_, i) => i + 1)
                .filter((n) => !usedN.has(n))
                .map((n) => (
                  <option key={n} value={n}>
                    Toughest {n} {n === 1 ? "hole" : "holes"}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <div className="card elev-sm">
          <span className="card-kicker">Worked example</span>
          <p className="card-body" style={{ fontSize: 13 }}>
            A player with {exampleW} wins, {exampleT} halve and {exampleH} net holes won scores{" "}
            {exampleW}×{pts(perWin)} + {exampleT}×{pts(perHalve)}
            {values.bonusPts ? ` + ${pts(values.bonusPts)} bonus` : ""} = <strong>{pts(total)} pts</strong>.
          </p>
          {capBites && (
            <p className="text-muted" style={{ fontSize: 12, margin: "6px 0 0", lineHeight: 1.5 }}>
              The {pts(values.maxPerMatch)}-point limit is doing something here: a match worth more
              than that only counts {pts(values.maxPerMatch)}. That is the point of it — one runaway
              result can&rsquo;t settle a flight before the last match is played.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
