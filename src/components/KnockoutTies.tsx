"use client";
import { useState, useTransition } from "react";
import { recordTieResult, approveBracketReport, rejectBracketReport } from "@/app/actions/tournament";
import { undoTieResult } from "@/app/actions/knockout-results";
import { goesThroughWords, type EntryTie } from "@/lib/domain/knockout-ties";
import { bringIntoView } from "@/lib/bring-into-view";
import { Icon } from "./Icon";

const HOW = [
  { key: "played", label: "Played" },
  { key: "conceded", label: "Conceded" },
  { key: "walkover", label: "Walkover" },
  { key: "withdrawn", label: "Withdrawn" },
] as const;
type How = (typeof HOW)[number]["key"];

/** What the bar under the heading says after a press, with Undo when there is something to undo. */
type Undo = { key: string; players: [string, string] } | null;
type Bar = { text: string; undo: Undo } | null;

const BIG = { minHeight: 48 } as const;

/**
 * A KNOCKOUT ROUND ON SCORE ENTRY: ITS TIES AS A LIST (simplicity review, cut 3,
 * 2026-11-14; console step 3 §2.4).
 *
 * The tree recorded a winner on one tap of a 13.5 px seat, with no confirm and no
 * undo. Here each tie is a row with the two players' names on two large buttons,
 * the cup-day card's "tap who won". How it ended is Played unless the secretary
 * says otherwise, and the margin is optional, so the usual result is one press.
 * After it a bar says who goes through, with Undo; a decided tie keeps Change
 * result. Both take the result back through `undoTieResult`, which the server
 * refuses once the winner has played on, and say so on the row.
 *
 * Order: ties a player has reported (Approve on the tie itself), then ties ready
 * to play, then decided ones. A tie with a TBD seat has no buttons. There is no
 * Halved: a knockout tie level after the last hole is played on (Rule 3.2a(4)).
 *
 * Every write is an existing action: `recordTieResult` (the list's one write),
 * `approveBracketReport` and `rejectBracketReport`, and `undoTieResult`.
 */
export function KnockoutTies({ ties, waiting }: { ties: EntryTie[]; waiting: number }) {
  const [bar, setBar] = useState<Bar>(null);
  const [pending, start] = useTransition();
  const [barRefused, setBarRefused] = useState("");
  const reported = ties.filter((t) => t.state === "reported");
  const open = ties.filter((t) => t.state !== "decided").length;

  const undoFromBar = () =>
    bar?.undo &&
    start(async () => {
      const r = await undoTieResult(bar.undo!);
      if (r.ok) {
        setBarRefused("");
        setBar({ text: `Taken back. ${r.said ?? ""} is off the draw; record it again below.`, undo: null });
      } else setBarRefused(r.error ?? "That could not be taken back.");
    });

  return (
    <section aria-labelledby="ko-ties-head" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <h2 id="ko-ties-head" style={{ fontFamily: "var(--font-heading)", fontSize: 18, margin: 0 }}>
          Ties
        </h2>
        {reported.length > 0 && (
          <a href={`#tie-${reported[0].key}`} className="btn btn-ghost" style={BIG}>
            Needs approval ({reported.length})
          </a>
        )}
      </div>
      <p className="text-muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        {open === 0
          ? waiting > 0
            ? `Nothing can be played yet: ${waiting} ${waiting === 1 ? "tie waits" : "ties wait"} on a result before ${waiting === 1 ? "it" : "them"}.`
            : "Every tie has a result."
          : `Press who won. ${waiting > 0 ? `${waiting} more ${waiting === 1 ? "tie waits" : "ties wait"} on a result before ${waiting === 1 ? "it" : "them"}. ` : ""}Level? Play on; record the winner when it is decided.`}
      </p>
      {bar && (
        <div
          role="status"
          className="card"
          style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "8px 12px" }}
        >
          <Icon name="check-circle" weight="fill" />
          <span style={{ flex: "1 1 12rem", minWidth: 0 }}>{bar.text}</span>
          {bar.undo && (
            <button type="button" className="btn btn-ghost" style={BIG} disabled={pending} onClick={undoFromBar}>
              Undo
            </button>
          )}
          {barRefused && (
            <p key={barRefused} className="form-error" role="alert" style={{ margin: 0, flexBasis: "100%" }} ref={bringIntoView}>
              {barRefused}
            </p>
          )}
        </div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {ties.map((t) => (
          <TieRow
            key={`${t.key}|${t.state}|${t.a.id}|${t.b.id}`}
            tie={t}
            onRecorded={(text, undo) => {
              setBarRefused("");
              setBar({ text, undo });
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function TieRow({ tie, onRecorded }: { tie: EntryTie; onRecorded: (text: string, undo: Undo) => void }) {
  const [pending, start] = useTransition();
  const [how, setHow] = useState<How>("played");
  const [margin, setMargin] = useState("");
  const [refused, setRefused] = useState("");
  const pair = `${tie.a.name} v ${tie.b.name}`;
  const players: [string, string] = [tie.a.id, tie.b.id];

  const act = (fn: () => Promise<{ ok: boolean; error?: string; said?: string }>, after: (said: string) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setRefused("");
        after(r.said ?? "");
      } else setRefused(r.error ?? "That didn't save. Try again.");
    });

  const record = (winnerId: string) =>
    act(
      () => recordTieResult({ key: tie.key, players, winnerId, how, margin: how === "played" ? margin : "" }),
      () => onRecorded(goesThroughWords(tie, winnerId), { key: tie.key, players }),
    );

  return (
    <li
      id={`tie-${tie.key}`}
      data-tie={tie.key}
      aria-label={`${tie.round}: ${pair}`}
      className="card"
      style={{ display: "grid", gap: 8, padding: "10px 12px", minWidth: 0 }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="text-muted" style={{ fontSize: 13 }}>{tie.round}</div>
        <div style={{ fontWeight: 600, fontSize: 15.5, overflowWrap: "anywhere" }}>{pair}</div>
      </div>

      {tie.state === "decided" ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ flex: "1 1 12rem", minWidth: 0 }}>
            <strong>{tie.winnerId === tie.a.id ? tie.a.name : tie.b.name}</strong> won{tie.margin}
          </span>
          <button
            type="button"
            className="btn btn-ghost"
            style={BIG}
            disabled={pending}
            aria-label={`Change result, ${pair}`}
            onClick={() =>
              act(
                () => undoTieResult({ key: tie.key, players }),
                (said) => onRecorded(`Taken back. ${said} is off the draw; record it again below.`, null),
              )
            }
          >
            Change result
          </button>
        </div>
      ) : (
        <>
          {tie.report && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ flex: "1 1 12rem", minWidth: 0 }}>
                Reported by {tie.report.reportedBy}: <strong>{tie.report.winner}</strong> won{tie.report.margin}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                style={BIG}
                disabled={pending}
                aria-label={`Approve: ${tie.report.winner} won ${pair}`}
                onClick={() =>
                  act(
                    () => approveBracketReport(tie.key),
                    () => onRecorded(goesThroughWords(tie, tie.report!.winnerId), { key: tie.key, players }),
                  )
                }
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={BIG}
                disabled={pending}
                aria-label={`Turn down the report of ${pair}`}
                onClick={() => act(() => rejectBracketReport(tie.key), () => onRecorded(`Turned down. ${pair} has no result.`, null))}
              >
                Turn down
              </button>
            </div>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <select
              className="input"
              aria-label={`How it ended, ${pair}`}
              value={how}
              onChange={(e) => setHow(e.target.value as How)}
              style={{ ...BIG, width: "auto" }}
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
                aria-label={`Margin, ${pair} (optional)`}
                placeholder="Margin, e.g. 3&2"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                style={{ ...BIG, width: 150, minWidth: 0 }}
              />
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))", gap: 8 }}>
            {[tie.a, tie.b].map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn btn-primary"
                style={{ ...BIG, minWidth: 0, overflowWrap: "anywhere" }}
                disabled={pending}
                onClick={() => record(p.id)}
              >
                {p.name} won
              </button>
            ))}
          </div>
        </>
      )}
      {refused && (
        // On a phone the row's buttons wrap and a refusal can land below the
        // bottom edge, where the press cannot see it.
        <p key={refused} className="form-error" role="alert" style={{ margin: 0 }} ref={bringIntoView}>
          {refused}
        </p>
      )}
    </li>
  );
}
