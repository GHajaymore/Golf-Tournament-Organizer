"use client";
import { useState, useTransition } from "react";
import { setBracketWinner, setBracketResult } from "@/app/actions/tournament";
import type { BracketView } from "@/lib/domain";
import { bracketScreenName } from "@/lib/domain/bracket-name";
import { Icon } from "./Icon";
import { leaveOnEnter } from "@/lib/leave-on-enter";

/** The draw itself, without the console's heading — the player board shows it read-only. */
export function BracketBoard({
  view,
  results,
  readOnly,
}: {
  view: BracketView;
  results: Record<string, string>;
  readOnly: boolean;
}) {
  const [pending, startTransition] = useTransition();
  /**
   * The match whose margin the server has just confirmed (2026-10-05).
   *
   * The margin saves when the box is left, and said nothing either way — an
   * organizer typing "2&1" and moving on could not tell it was kept, and one
   * who went straight to another screen could leave before it was. Found when
   * the knockout e2e spec, which did exactly that, lost a "1 UP" on CI.
   */
  const [savedKey, setSavedKey] = useState("");
  /**
   * What the server said no with, shown. A press here names one of the tie's
   * own two players, so it is not refused — unless the draw moved underneath
   * (a second organizer, a result taken back) and this screen is a moment
   * old. Then the press did nothing, and saying so is the difference between
   * "try again" and a result somebody believes they recorded.
   */
  const [refused, setRefused] = useState("");

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
        onClick={() =>
          clickable &&
          startTransition(async () => {
            const result = await setBracketWinner(matchKey, slot.playerId!);
            setRefused(result.ok ? "" : (result.error ?? "That result could not be recorded."));
          })
        }
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "9px 11px",
          border: "none",
          background: isWinner ? "var(--color-accent-900)" : "transparent",
          color: isWinner ? "var(--color-accent-100)" : "var(--color-text)",
          cursor: clickable ? "pointer" : "default",
          fontSize: 13,
          fontWeight: isWinner ? 600 : 400,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slot.name}</span>
        <span style={{ fontSize: 13, color: "var(--color-neutral-500)" }}>{slot.seed ?? ""}</span>
      </button>
    );
  };

  return (
    <div className="card elev-sm" style={{ overflowX: "auto" }}>
      {refused && (
        <p className="form-error" role="alert" style={{ margin: "0 0 10px" }}>
          {refused} Reload the draw and record it again.
        </p>
      )}
      <div style={{ display: "flex", gap: 26, minWidth: 640 }}>
        {view.rounds.map((rd) => (
          <div key={rd.roundIndex} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 14, minWidth: 190 }}>
            <div style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-500)", textAlign: "center" }}>
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
                    // A placeholder is not a name, and there is one of these
                    // per finished match — each says whose match it records.
                    aria-label={`Result of ${m.a?.name ?? "TBD"} v ${m.b?.name ?? "TBD"}, ${rd.label}`}
                    onKeyDown={leaveOnEnter}
                    onBlur={(e) => {
                      const value = e.target.value;
                      // Leaving the box unchanged saves nothing, and says nothing.
                      if (value.trim() === (results[m.key] ?? "").trim()) return;
                      setSavedKey("");
                      startTransition(async () => {
                        await setBracketResult(m.key, value);
                        setSavedKey(m.key);
                      });
                    }}
                    style={{ marginTop: 4, fontSize: 13, minHeight: 26, padding: "2px 8px" }}
                  />
                )}
                {m.winnerId && !readOnly && savedKey === m.key && !pending && (
                  <div role="status" className="text-muted" style={{ fontSize: 13, marginTop: 2, display: "flex", alignItems: "center", gap: 4 }}>
                    <Icon name="check" /> Saved
                  </div>
                )}
                {m.winnerId && readOnly && results[m.key] && (
                  <div className="text-muted" style={{ fontSize: 13, textAlign: "center", marginTop: 3 }}>{results[m.key]}</div>
                )}
              </div>
            ))}
          </div>
        ))}
        <div style={{ flex: "none", width: 150, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 6, textAlign: "center" }}>
          <div style={{ fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-neutral-500)" }}>Champion</div>
          <Icon name="trophy" weight="fill" style={{ fontSize: 30, color: "var(--color-accent-200)" }} />
          <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 15 }}>{view.champion?.name ?? "TBD"}</div>
        </div>
      </div>
    </div>
  );
}

export function BracketClient({
  winners,
  consolation,
  mainLabel = "Main draw",
  secondLabel = "",
  results = {},
  readOnly = false,
  straight = false,
  draws,
  awaitingFlights = false,
}: {
  winners: BracketView;
  consolation: BracketView;
  /**
   * EVERY draw, where the knockout is divided into flights (2026-10-12) — as
   * many as the organizer made, each with the name they gave it. When this is
   * handed in it is the whole list and the two props above are not read; the
   * older arrangements leave it out and are shown exactly as before.
   */
  draws?: { label: string; view: BracketView }[];
  /**
   * What the FIRST draw is called, which also depends on the mode.
   *
   * It read "Winners" whatever the arrangement. In `split` there are no
   * winners yet — the two draws are flights, divided by qualifying rank
   * before anybody tees off — so the tab named a thing that had not happened.
   * `drawBrackets` names both draws; this prints what it is given.
   */
  mainLabel?: string;
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
  /** No qualifying round before this bracket: the whole field is in it. */
  straight?: boolean;
  /**
   * Arranged in several flights and not yet divided. There is no draw then —
   * not an empty one. Without this the screen drew a bracket of "TBD v TBD"
   * under "The whole field, seeded in order": a draw nobody had made, described
   * by a sentence about a different arrangement.
   */
  awaitingFlights?: boolean;
}) {
  // "Seeded from qualification" was printed over a knockout nobody qualified
  // for — the bracket was the tournament's first round.
  const inFlights = !!draws && draws.length > 0;
  const seededFrom = inFlights
    ? "Each flight is its own knockout, seeded in order."
    : straight
      ? "The whole field, seeded in order."
      : "Seeded from qualification.";
  // Which draw is on screen, by its place in the list.
  const [tab, setTab] = useState(0);
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
  const list = inFlights
    ? draws
    : hasSecond
      ? [
          { label: mainLabel, view: winners },
          { label: secondLabel, view: consolation },
        ]
      : [{ label: mainLabel, view: winners }];
  const shown = (list[tab] ?? list[0]).view;
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-kicker">Manage</div>
          <h1 className="page-title">{bracketScreenName(readOnly)}</h1>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            {awaitingFlights
              ? readOnly
                ? "The field has not been divided into flights yet, so there is no draw."
                : "Nothing is drawn until the field is divided into flights."
              : readOnly
                ? `${seededFrom} Winners advance automatically as results come in.`
                : `${seededFrom} Click a name to advance the winner (results auto-advance the next round).`}
          </p>
        </div>
        {!awaitingFlights && list.length > 1 && (
          // Wraps: a knockout in flights may have a dozen of these.
          <div className="seg" style={{ flexWrap: "wrap" }}>
            {list.map((d, i) => (
              <label className="seg-opt" key={d.label}>
                <input type="radio" name="brk" checked={tab === i} onChange={() => setTab(i)} />
                {d.label}
              </label>
            ))}
          </div>
        )}
      </div>
      {!awaitingFlights && <BracketBoard view={shown} results={results} readOnly={readOnly} />}
    </>
  );
}
