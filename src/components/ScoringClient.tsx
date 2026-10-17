"use client";
import { figureOr, readDecimal } from "@/lib/domain/decimal-text";
import { useState, useTransition } from "react";
import { saveScoring, saveTiebreakers } from "@/app/actions/tournament";
import { pts } from "@/lib/format";
import { tiebreakerLabel, tiebreakerHelp, FIXED_TIEBREAKER_KEYS, toughestN, MAX_TOUGHEST_N, type TiebreakerKey } from "@/lib/domain";
import { RuleCite } from "./RuleCite";
import FieldInfo from "@/components/FieldInfo";
import { Icon } from "./Icon";

/**
 * A ROUND ROBIN'S POINTS, AND HOW ITS TABLE BREAKS A TIE — two controls, not one
 * (2026-10-16).
 *
 * They were one component, the points card beside the tie chain, under a
 * heading "Tiebreakers" at the foot of Customize. Ajay looked for the
 * tiebreakers and did not find them, on a phone, a tablet and a computer. The
 * review panel: points are SCORING, so they sit under Customize as "Points";
 * the tie chain is one line of the "Ties" group on the face of the round, and
 * opens here on Change. Every target in both is at least 44px.
 */

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

const TARGET = { minWidth: 44, minHeight: 44 } as const;

/** The points a round robin awards, in one line: "Win 3 · Halve 1 · Loss 0 · ½ per hole won". */
export function pointsInWords(v: Values): string {
  const parts = [`Win ${pts(v.winPts)}`, `Halve ${pts(v.tiePts)}`, `Loss ${pts(v.lossPts)}`];
  if (v.holeRatioPts) parts.push(`${pts(v.holeRatioPts)} per hole won`);
  if (v.bonusPts) parts.push(`${pts(v.bonusPts)} bonus`);
  if (v.maxPerMatch) parts.push(`at most ${pts(v.maxPerMatch)} a match`);
  return parts.join(" · ");
}

export function PointsControl({ initial, locked = false }: { initial: Values; locked?: boolean }) {
  const [values, setValues] = useState<Values>(initial);
  const [saving, startTransition] = useTransition();

  const save = (next: Values) => {
    setValues(next);
    startTransition(() => saveScoring(next));
  };
  const onChange = (key: keyof Values, raw: string) => {
    save({ ...values, [key]: figureOr(readDecimal(raw), 0) });
  };

  // Worked example: 2 wins, 1 halve, 12 net holes won — four holes a match
  // across the three, so the cap has something to apply to. Written per match
  // rather than from the totals because that is how the engine counts, and an
  // example that ignored the cap would show a number the tournament would never
  // award.
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 520 }}>
      {saving && <span className="text-muted" style={{ fontSize: 13 }}>Saving…</span>}
      {FIELDS.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 48 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{f.label}</div>
            <div className="text-muted" style={{ fontSize: 13 }}>{f.hint}</div>
          </div>
          <input
            className="input"
            type="number"
            step={f.step}
            style={{ width: 90, textAlign: "right", minHeight: 44 }}
            aria-label={`${f.label} — ${f.hint}`}
            value={values[f.key]}
            disabled={locked}
            onChange={(e) => onChange(f.key, e.target.value)}
          />
        </div>
      ))}
      <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
        For example, {exampleW} wins, {exampleT} halve and {exampleH} net holes won score{" "}
        {exampleW}×{pts(perWin)} + {exampleT}×{pts(perHalve)}
        {values.bonusPts ? ` + ${pts(values.bonusPts)} bonus` : ""} = <strong>{pts(total)} pts</strong>.
        {capBites &&
          ` The ${pts(values.maxPerMatch)}-point limit is doing something here: a match worth more counts ${pts(values.maxPerMatch)}, so one runaway result can't settle a flight before the last match.`}
      </p>
    </div>
  );
}

export function TableTiebreakControl({ tiebreakers, locked = false }: { tiebreakers: TiebreakerKey[]; locked?: boolean }) {
  const [order, setOrder] = useState<TiebreakerKey[]>(tiebreakers);
  const [saving, startTransition] = useTransition();
  const pending = saving || locked;

  const commit = (next: TiebreakerKey[]) => {
    setOrder(next);
    startTransition(() => saveTiebreakers(next));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };
  const toggle = (key: TiebreakerKey, on: boolean) => commit(on ? [...order, key] : order.filter((k) => k !== key));

  /**
   * The fixed tiebreakers not already in the chain. The countbacks are not
   * listed: there are eighteen and a committee wants one or two, so they are
   * added by naming N.
   */
  const available = FIXED_TIEBREAKER_KEYS.filter((k) => !order.includes(k));
  const usedN = new Set(order.map((k) => toughestN(k)).filter((n): n is number => n !== null));
  const addToughest = (n: number) => {
    const key = `toughest-${n}` as TiebreakerKey;
    if (!order.includes(key)) commit([...order, key]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 560 }}>
      <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
        Tried in order when players are level on points; the first that separates them decides.
      </p>
      {/* Cited here because this is the setting whose timing is governed: the
          method is settled before play, not chosen once there is a tie. */}
      <p style={{ margin: 0 }}>
        <RuleCite rule="decidingTies" />
      </p>
      {order.map((t, i) => (
        <div
          key={t}
          style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "2px 8px", background: "var(--color-bg)", borderRadius: 6, minHeight: 48 }}
        >
          <span style={{ width: 22, fontWeight: 700, color: "var(--color-accent-200)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{tiebreakerLabel(t)}</span>
          <FieldInfo label={tiebreakerLabel(t)}>
            <p>{tiebreakerHelp(t)}</p>
          </FieldInfo>
          <button type="button" className="btn btn-icon" disabled={pending || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${tiebreakerLabel(t)} earlier`} style={TARGET}>
            <Icon name="caret-up" />
          </button>
          <button type="button" className="btn btn-icon" disabled={pending || i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${tiebreakerLabel(t)} later`} style={TARGET}>
            <Icon name="caret-down" />
          </button>
          <button type="button" className="btn btn-icon" disabled={pending} onClick={() => toggle(t, false)} aria-label={`Remove ${tiebreakerLabel(t)}`} style={TARGET}>
            <Icon name="x" />
          </button>
        </div>
      ))}
      {order.length === 0 && (
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0" }}>
          None — players level on points share the place.
        </p>
      )}
      <div className="field" style={{ maxWidth: 360, marginTop: 4 }}>
        <label htmlFor="table-tie-add">Add a step</label>
        <select
          id="table-tie-add"
          className="input"
          value=""
          disabled={pending}
          style={{ minHeight: 44 }}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            if (v.startsWith("toughest:")) addToughest(Number(v.slice("toughest:".length)));
            else toggle(v as TiebreakerKey, true);
          }}
        >
          <option value="">Choose…</option>
          {available.map((t) => (
            <option key={t} value={t}>
              {tiebreakerLabel(t)}
            </option>
          ))}
          {Array.from({ length: MAX_TOUGHEST_N }, (_, i) => i + 1)
            .filter((n) => !usedN.has(n))
            .map((n) => (
              <option key={`t${n}`} value={`toughest:${n}`}>
                Toughest {n} {n === 1 ? "hole" : "holes"} (by stroke index)
              </option>
            ))}
        </select>
      </div>
      {order.includes("head-to-head" as TiebreakerKey) && (
        <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          Head-to-head decides nothing between players who never met; the next step is used.
        </p>
      )}
    </div>
  );
}
