"use client";
import { useState, useTransition } from "react";
import { setBracketWinner, setBracketResult } from "@/app/actions/tournament";
import type { BracketView } from "@/lib/domain";
import { bracketScreenName } from "@/lib/domain/bracket-name";
import { Icon } from "./Icon";

function BracketBoard({
  view,
  results,
  readOnly,
}: {
  view: BracketView;
  results: Record<string, string>;
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const slotButton = (
    matchKey: string,
    slot: { playerId: string | null; seed: number | null; name: string },
    winnerId: string | null,
  ) => {
    const isWinner = winnerId !== null && slot.playerId === winnerId;
    const clickable = !readOnly && slot.playerId !== null;
    return (
      <button
        type="button"
        className="bracket-seat"
        disabled={!clickable || pending}
        onClick={() => clickable && startTransition(() => setBracketWinner(matchKey, slot.playerId!))}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "9px 11px",
          border: "none",
          background: isWinner ? "var(--color-accent-800)" : "transparent",
          color: isWinner ? "var(--color-accent-100)" : "var(--color-text)",
          cursor: clickable ? "pointer" : "default",
          fontSize: 13,
          fontWeight: isWinner ? 600 : 400,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slot.name}</span>
        <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>{slot.seed ?? ""}</span>
      </button>
    );
  };

  return (
    <div className="card elev-sm" style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", gap: 26, minWidth: 640 }}>
        {view.rounds.map((rd) => (
          <div key={rd.roundIndex} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 14, minWidth: 190 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-500)", textAlign: "center" }}>
              {rd.label}
            </div>
            {rd.matches.map((m) => (
              <div key={m.key}>
                <div style={{ border: "1px solid var(--color-divider)", borderRadius: 8, overflow: "hidden" }}>
                  {slotButton(m.key, m.a, m.winnerId)}
                  <div style={{ height: 1, background: "var(--color-divider)" }} />
                  {slotButton(m.key, m.b, m.winnerId)}
                </div>
                {m.winnerId && !readOnly && (
                  <input
                    className="input"
                    defaultValue={results[m.key] ?? ""}
                    placeholder="Result e.g. 3&2"
                    onBlur={(e) => startTransition(() => setBracketResult(m.key, e.target.value))}
                    style={{ marginTop: 4, fontSize: 11, minHeight: 26, padding: "2px 8px" }}
                  />
                )}
                {m.winnerId && readOnly && results[m.key] && (
                  <div className="text-muted" style={{ fontSize: 11, textAlign: "center", marginTop: 3 }}>{results[m.key]}</div>
                )}
              </div>
            ))}
          </div>
        ))}
        <div style={{ flex: "none", width: 150, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 6, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>Champion</div>
          <Icon name="trophy" weight="fill" style={{ fontSize: 30, color: "var(--color-accent)" }} />
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 15 }}>{view.champion?.name ?? "TBD"}</div>
        </div>
      </div>
    </div>
  );
}

export function BracketClient({
  winners,
  consolation,
  secondLabel = "",
  results = {},
  readOnly = false,
}: {
  winners: BracketView;
  consolation: BracketView;
  /**
   * What the second bracket is called, or "" when there is not one.
   *
   * `drawBrackets` decides both: `single` returns no second field and an empty
   * label, `split` returns "Consolation", `plate` returns "Plate". This is the
   * same string the mode picker is handed, so the toggle and the arrangement
   * cannot come to disagree about whether a second bracket exists.
   */
  secondLabel?: string;
  results?: Record<string, string>;
  readOnly?: boolean;
}) {
  const [tab, setTab] = useState<"winners" | "consolation">("winners");
  /**
   * ONLY WHERE THERE IS A SECOND BRACKET — and it is named, not assumed.
   *
   * Two faults, both read off the seeded club's knockout on 2026-09-23.
   *
   * The toggle rendered ALWAYS. That knockout is `single` mode — the panel
   * directly above says "One bracket … lose and you're out" — and an organizer
   * was still offered a Consolation tab, which shows a draw that does not
   * exist. The same fault the flights toggle had on `LeaderboardBoard`, fixed
   * there on 2026-09-11 for the same reason: a control that switches to a view
   * containing nothing is worse than no control.
   *
   * And the label was HARDCODED. In `plate` mode the second bracket is a
   * Plate — `drawBrackets` says so, and a club calls it that — while this tab
   * said "Consolation". One thing with two names, on the screen that runs it.
   */
  const hasSecond = secondLabel !== "";
  const shown = hasSecond && tab === "consolation" ? consolation : winners;
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-kicker">Manage</div>
          <h1 className="page-title">{bracketScreenName(readOnly)}</h1>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {readOnly
              ? "Seeded from qualification. Winners advance automatically as results come in."
              : "Seeded from qualification. Click a name to advance the winner (results auto-advance the next round)."}
          </p>
        </div>
        {hasSecond && (
          <div className="seg">
            <label className="seg-opt">
              <input type="radio" name="brk" checked={tab === "winners"} onChange={() => setTab("winners")} />
              Winners
            </label>
            <label className="seg-opt">
              <input type="radio" name="brk" checked={tab === "consolation"} onChange={() => setTab("consolation")} />
              {secondLabel}
            </label>
          </div>
        )}
      </div>
      <BracketBoard view={shown} results={results} readOnly={readOnly} />
    </>
  );
}
