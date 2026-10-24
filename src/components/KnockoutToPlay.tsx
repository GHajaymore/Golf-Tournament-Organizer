"use client";
import { useState, useTransition } from "react";
import { recordTieResult } from "@/app/actions/tournament";
import type { PlayBy } from "@/lib/domain/knockout-play-by";
import { Icon } from "./Icon";

export interface ToPlayTie {
  key: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
}

export interface ToPlayGroup {
  draw: string;
  round: string;
  playBy: PlayBy | null;
  ties: ToPlayTie[];
}

const HOW = [
  { key: "played", label: "Played" },
  { key: "conceded", label: "Conceded" },
  { key: "walkover", label: "Walkover" },
  { key: "withdrawn", label: "Withdrawn" },
] as const;

/**
 * "TO PLAY" — what the secretary's Bracket screen opens on (the panel,
 * 2026-10-23): every tie that can be played now, round by round in draw order,
 * each with its round's play-by date and "Overdue" written out once the club's
 * day is past it, and its result entered right there: who won, how (played,
 * with the margin; conceded; walkover; withdrawn), Save.
 *
 * A result is sent with the tie's key AND its two players (`recordTieResult`),
 * so it lands on that tie or is refused — never on whatever now stands in its
 * place. What was recorded is said back in a sentence naming the round and both
 * players, and kept at the top of the list while the screen is open.
 */
export function KnockoutToPlay({ groups, waiting }: { groups: ToPlayGroup[]; waiting: number }) {
  const [said, setSaid] = useState<string[]>([]);
  const ties = groups.reduce((n, g) => n + g.ties.length, 0);
  return (
    <section aria-labelledby="to-play-head" className="card elev-sm" style={{ display: "grid", gap: 14 }}>
      <div>
        <h2 id="to-play-head" style={{ fontFamily: "var(--font-heading)", fontSize: 18, margin: 0 }}>
          To play
        </h2>
        <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.5 }}>
          {ties === 0
            ? waiting > 0
              ? `Nothing can be played yet: ${waiting} ${waiting === 1 ? "tie waits" : "ties wait"} on a result before ${waiting === 1 ? "it" : "them"}.`
              : "Every tie has a result."
            : `${ties} ${ties === 1 ? "tie is" : "ties are"} ready to play.${waiting > 0 ? ` ${waiting} more ${waiting === 1 ? "waits" : "wait"} on a result before ${waiting === 1 ? "it" : "them"}.` : ""}`}
        </p>
      </div>
      {said.length > 0 && (
        <ul aria-label="Just recorded" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
          {said.map((s) => (
            <li key={s} style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
              <Icon name="check-circle" weight="fill" /> Recorded — {s}.
            </li>
          ))}
        </ul>
      )}
      {groups.map((g) => (
        <div key={`${g.draw}|${g.round}`} style={{ display: "grid", gap: 8 }}>
          <h3 style={{ fontSize: 14.5, margin: 0 }}>
            {g.draw ? `${g.draw} · ` : ""}
            {g.round}
            {g.playBy && (
              <span style={{ fontWeight: 400 }}>
                {" "}
                · Play by {g.playBy.words}
                {g.playBy.overdue && <strong style={{ color: "var(--color-danger)" }}> · Overdue</strong>}
              </span>
            )}
          </h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {g.ties.map((t) => (
              <TieRow key={t.key} tie={t} onSaid={(s) => setSaid((x) => [s, ...x.filter((y) => y !== s)].slice(0, 6))} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function TieRow({ tie, onSaid }: { tie: ToPlayTie; onSaid: (s: string) => void }) {
  const [pending, start] = useTransition();
  const [winner, setWinner] = useState("");
  const [how, setHow] = useState<(typeof HOW)[number]["key"]>("played");
  const [margin, setMargin] = useState("");
  const [refused, setRefused] = useState("");
  const pair = `${tie.a.name} v ${tie.b.name}`;
  const save = () =>
    start(async () => {
      if (!winner) {
        setRefused("Choose who won.");
        return;
      }
      const r = await recordTieResult({ key: tie.key, players: [tie.a.id, tie.b.id], winnerId: winner, how, margin });
      if (r.ok && r.said) {
        setRefused("");
        onSaid(r.said);
      } else setRefused(r.error ?? "That result could not be recorded.");
    });
  return (
    <li data-tie-row={tie.key} style={{ border: "1px solid var(--color-divider)", borderRadius: 8, padding: "8px 12px", display: "grid", gap: 6 }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "center" }}>
        <legend style={{ fontWeight: 600, fontSize: 14, padding: 0, marginBottom: 2 }}>{pair}</legend>
        {[tie.a, tie.b].map((p) => (
          <label key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, minHeight: 44 }}>
            <input type="radio" name={`won-${tie.key}`} value={p.id} checked={winner === p.id} onChange={() => setWinner(p.id)} />
            {p.name} won
          </label>
        ))}
      </fieldset>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <select
          className="input"
          aria-label={`How it was settled, ${pair}`}
          value={how}
          onChange={(e) => setHow(e.target.value as typeof how)}
          style={{ minHeight: 44, width: "auto" }}
        >
          {HOW.map((h) => (
            <option key={h.key} value={h.key}>
              {h.label}
            </option>
          ))}
        </select>
        {how === "played" && (
          <input
            className="input"
            aria-label={`Margin, ${pair}`}
            placeholder="Margin e.g. 3&2"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            onKeyDown={(e) => {
              // Enter, as a person finishing a figure presses, saves the result.
              if (e.key === "Enter") save();
            }}
            style={{ minHeight: 44, width: 140 }}
          />
        )}
        <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={pending} onClick={save}>
          Save result
        </button>
      </div>
      {refused && (
        <p className="form-error" role="alert" style={{ margin: 0 }}>
          {refused}
        </p>
      )}
    </li>
  );
}
