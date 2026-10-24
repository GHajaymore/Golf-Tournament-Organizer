"use client";
import { useState, useTransition } from "react";
import { setKnockoutPlayBy } from "@/app/actions/tournament";
import { Icon } from "./Icon";

/**
 * EACH ROUND'S "PLAY BY" DATE, set on the Bracket screen (the panel,
 * 2026-10-23). One date per round, the final last; empty for none. Saved with
 * one press, and said back — or refused beside the button, in words.
 */
export function KnockoutPlayByForm({
  stageId,
  rounds,
  dates,
}: {
  stageId: string;
  /** Rounds back from the final, earliest first, each with the name the draw gives it. */
  rounds: Array<{ fromFinal: number; label: string }>;
  dates: Record<number, string>;
}) {
  const [values, setValues] = useState<Record<number, string>>(() => ({ ...dates }));
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const save = () =>
    start(async () => {
      const sent = Object.fromEntries(rounds.map((r) => [String(r.fromFinal), values[r.fromFinal] ?? ""]));
      const res = await setKnockoutPlayBy(stageId, sent);
      setSaid(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error ?? "Those dates could not be saved." });
    });
  return (
    <section aria-labelledby="play-by-head" className="card elev-sm" style={{ display: "grid", gap: 10, marginTop: 16 }}>
      <div>
        <h2 id="play-by-head" style={{ fontFamily: "var(--font-heading)", fontSize: 17, margin: 0 }}>
          Play-by dates
        </h2>
        <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.5 }}>
          The day each round must be played by. Every round heading on the draw, this list and each player&rsquo;s own tie show it,
          and a tie not played by then reads Overdue.
        </p>
      </div>
      <div className="pair-grid">
        {rounds.map((r) => (
          <label key={r.fromFinal} style={{ display: "grid", gap: 4, fontSize: 13.5 }}>
            <span>{r.label}</span>
            <input
              className="input"
              type="date"
              value={values[r.fromFinal] ?? ""}
              onChange={(e) => {
                setSaid(null);
                setValues((v) => ({ ...v, [r.fromFinal]: e.target.value }));
              }}
              style={{ minHeight: 44 }}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={pending} onClick={save}>
          Save dates
        </button>
        {said?.ok && (
          <span role="status" className="text-muted" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="check" /> {said.text}
          </span>
        )}
        {said && !said.ok && (
          <p className="form-error" role="alert" style={{ margin: 0 }}>
            {said.text}
          </p>
        )}
      </div>
    </section>
  );
}
