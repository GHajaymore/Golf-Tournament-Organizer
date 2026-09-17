"use client";

import { useState, useTransition } from "react";
import { setPlayoffHoleWinner } from "@/app/actions/league";
import { Icon } from "@/components/Icon";

export interface DecidableMeeting {
  stageId: string;
  roundName: string;
  clubA: string;
  clubB: string;
  clubAName: string;
  clubBName: string;
  /** Level and waiting on a play-off hole, rather than won on the points. */
  level: boolean;
  /** What is recorded now, if anything. */
  decided: { winner: string; overrode: boolean; note: string; decidedBy: string } | null;
}

/**
 * WHO WENT THROUGH, WHERE THE COURSE DECIDED IT AND THE APP CANNOT SEE.
 *
 * Two cases, one control, and the difference is stated rather than hidden:
 *
 *   LEVEL     the meeting finished all square and a play-off hole settles it.
 *             Nothing advances until somebody records the winner — the app no
 *             longer sends the higher seed through.
 *   PLAYED    somebody won on the points, and the committee is setting that
 *             aside. A disqualification, an appeal, an ineligible side. It
 *             takes a reason, it is labelled an override wherever it appears,
 *             and it carries the name of whoever recorded it.
 *
 * The caution is deliberate: overturning a played result is offered, never
 * casual. Two clicks and a sentence, and the sentence is printed next to the
 * result for every member to read.
 */
export function PlayoffDecision({ meetings }: { meetings: DecidableMeeting[] }) {
  const [openKey, setOpenKey] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (meetings.length === 0) return null;

  const record = (m: DecidableMeeting, winner: string) =>
    startTransition(async () => {
      setError("");
      const res = await setPlayoffHoleWinner(
        m.stageId,
        m.clubA,
        m.clubB,
        winner,
        m.level ? undefined : { reason },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpenKey("");
      setReason("");
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      {meetings.map((m) => {
        const key = `${m.stageId}:${m.clubA}:${m.clubB}`;
        const open = openKey === key;
        return (
          <div
            key={key}
            className="card elev-sm"
            style={{ borderLeft: m.level ? "3px solid var(--color-accent)" : undefined }}
          >
            <span className="card-title" style={{ fontSize: 14 }}>
              {m.roundName}: {m.clubAName} v {m.clubBName}
            </span>
            <p className="text-muted" style={{ fontSize: 12.5, margin: "4px 0 0", lineHeight: 1.55 }}>
              {m.level
                ? "Finished level. A play-off hole settles it — record who won and the bracket moves on."
                : m.decided?.overrode
                  ? "The committee overturned this result."
                  : "Won on the points. Overturning it is a committee decision and needs a reason."}
            </p>
            {m.decided && (
              <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                Recorded: {m.decided.winner === m.clubA ? m.clubAName : m.clubBName}
                {m.decided.note ? ` — ${m.decided.note}` : ""}
                {m.decided.decidedBy ? ` (${m.decided.decidedBy})` : ""}
              </p>
            )}

            {!open ? (
              <button
                type="button"
                className={m.level ? "btn btn-primary" : "btn btn-ghost"}
                style={{ alignSelf: "flex-start", marginTop: 8 }}
                onClick={() => {
                  setOpenKey(key);
                  setReason(m.decided?.note ?? "");
                  setError("");
                }}
              >
                {m.level ? (
                  <>
                    <Icon name="flag" /> Record the play-off hole
                  </>
                ) : (
                  <>
                    <Icon name="warning" /> Overturn this result
                  </>
                )}
              </button>
            ) : (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {!m.level && (
                  <div className="field">
                    <label htmlFor={`why-${key}`}>Why the committee is overturning it</label>
                    <input
                      id={`why-${key}`}
                      className="input"
                      value={reason}
                      disabled={pending}
                      placeholder="e.g. Ineligible player in the second pair"
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                      Shown beside the result, to members as well as staff, with your name.
                    </p>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    [m.clubA, m.clubAName],
                    [m.clubB, m.clubBName],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className="btn btn-secondary"
                      disabled={pending}
                      onClick={() => record(m, id)}
                    >
                      {label} {m.level ? "won the hole" : "goes through"}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setOpenKey("");
                      setError("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {open && error && (
              <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
