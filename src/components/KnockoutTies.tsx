"use client";
import { useState, useTransition } from "react";
import { recordTieResult, approveBracketReport, rejectBracketReport, keepMyMatchResult, clearMatch } from "@/app/actions/tournament";
import { undoTieResult } from "@/app/actions/knockout-results";
import { goesThroughWords, THIRD_PLACE_KEY, type EntryTie, type ThirdPlaceCard } from "@/lib/domain/knockout-ties";
import { bringIntoView } from "@/lib/bring-into-view";
import { Icon } from "./Icon";

const HOW = [
  { key: "played", label: "Played" },
  { key: "conceded", label: "Conceded" },
  { key: "walkover", label: "Walkover" },
  { key: "withdrawn", label: "Withdrawn" },
] as const;
type How = (typeof HOW)[number]["key"];

/** Controls a thumb presses outdoors: 48 px, full-contrast text. */
const BIG = { minHeight: 48, fontSize: 15 } as const;
/** Small print that still reads in sunlight: full text colour, never muted at 13 px. */
const PLAIN = { color: "var(--color-text)", fontSize: 15, lineHeight: 1.5 } as const;

/** A refusal said where the press was, linking the tie it names when there is one. */
type Refusal = { said: string; heldBy: string };

/**
 * A KNOCKOUT ROUND ON SCORE ENTRY: ITS TIES AS A LIST (simplicity review, cut 3,
 * 2026-11-14; console step 3 §2.4; persona walk of cut 3).
 *
 * The tree recorded a winner on one tap of a 13.5 px seat, with no confirm and no
 * undo. Here each tie is a card with the two players' names on two large buttons,
 * the cup-day card's "tap who won". How it ended is Played unless the secretary
 * opens "How it ended, or the margin" and says otherwise, so the usual result is
 * one press. After it the SAME card says "Final: ‹name› goes through." with Undo,
 * so the way back is where the thumb already is, and the list does not reorder
 * under it: the order is the one the screen opened with (ties a player reported,
 * then ties to play, then decided), new ties added at the foot.
 *
 * Undo and Change result take the result back through `undoTieResult`, which the
 * server refuses once something rests on it. The refusal is said on the card,
 * names what to take back first and how many results that is, and links to that
 * card. The play-off for third has its own card, since it is fed by the
 * semi-finals' losers and a refusal can name it.
 *
 * There is no Halved on a knockout tie: level after the last hole, it is played
 * on (Rule 3.2a(4)). Every write is an existing action: `recordTieResult`,
 * `approveBracketReport`, `rejectBracketReport`, `undoTieResult`, and for the
 * play-off `keepMyMatchResult` and `clearMatch`.
 */
export function KnockoutTies({ ties, waiting, thirdPlace = null }: { ties: EntryTie[]; waiting: number; thirdPlace?: ThirdPlaceCard | null }) {
  // The order the screen opened with: a tie that is recorded stays where the thumb was.
  const [order] = useState<string[]>(() => ties.map((t) => t.key));
  const placed = [...ties].sort((x, y) => rank(order, x.key) - rank(order, y.key));
  // What each card said after its last press ("Final: Ann goes through."), by key.
  const [said, setSaid] = useState<Record<string, string>>({});
  const reported = ties.filter((t) => t.state === "reported");
  const open = ties.filter((t) => t.state !== "decided").length;

  return (
    <section aria-labelledby="ko-ties-head" style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <h2 id="ko-ties-head" style={{ fontFamily: "var(--font-heading)", fontSize: 18, margin: 0 }}>
          Ties
        </h2>
        {reported.length > 0 && (
          <a href={`#tie-${reported[0].key}`} className="btn btn-secondary" style={BIG}>
            Needs approval ({reported.length})
          </a>
        )}
      </div>
      <p style={{ ...PLAIN, margin: 0 }}>
        {open === 0
          ? waiting > 0
            ? `Nothing can be played yet: ${waiting} ${waiting === 1 ? "tie waits" : "ties wait"} on a result before ${waiting === 1 ? "it" : "them"}.`
            : "Every tie has a result."
          : `Press who won. ${waiting > 0 ? `${waiting} more ${waiting === 1 ? "tie waits" : "ties wait"} on a result before ${waiting === 1 ? "it" : "them"}. ` : ""}Level? Play on; record the winner when it is decided.`}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {placed.map((t) => (
          <TieRow
            key={`${t.key}|${t.state}|${t.a.id}|${t.b.id}`}
            tie={t}
            said={said[t.key] ?? ""}
            onSaid={(text) => setSaid((s) => ({ ...s, [t.key]: text }))}
          />
        ))}
        {thirdPlace && <PlayoffRow key={`${thirdPlace.matchId}|${thirdPlace.state}|${thirdPlace.a.id}|${thirdPlace.b.id}`} p={thirdPlace} />}
      </ul>
    </section>
  );
}

function rank(order: string[], key: string): number {
  const i = order.indexOf(key);
  return i === -1 ? order.length : i;
}

/** The refusal on the card, with a link to the card it names. */
function RefusalLine({ refused }: { refused: Refusal }) {
  return (
    <p key={refused.said} className="form-error" role="alert" style={{ margin: 0, fontSize: 15 }} ref={bringIntoView}>
      {refused.said}
      {refused.heldBy && (
        <>
          {" "}
          <a href={`#tie-${refused.heldBy}`} style={{ fontWeight: 600 }}>
            Go to {refused.heldBy === THIRD_PLACE_KEY ? "the play-off" : "that tie"}
          </a>
        </>
      )}
    </p>
  );
}

function TieRow({ tie, said, onSaid }: { tie: EntryTie; said: string; onSaid: (s: string) => void }) {
  const [pending, start] = useTransition();
  const [how, setHow] = useState<How>("played");
  const [margin, setMargin] = useState("");
  const [refused, setRefused] = useState<Refusal | null>(null);
  const pair = `${tie.a.name} v ${tie.b.name}`;
  const players: [string, string] = [tie.a.id, tie.b.id];

  const act = (fn: () => Promise<{ ok: boolean; error?: string; said?: string; heldBy?: string }>, after: (said: string) => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setRefused(null);
        after(r.said ?? "");
      } else setRefused({ said: r.error ?? "That didn't save. Try again.", heldBy: r.heldBy ?? "" });
    });

  const record = (winnerId: string) =>
    act(
      () => recordTieResult({ key: tie.key, players, winnerId, how, margin: how === "played" ? margin : "" }),
      () => onSaid(goesThroughWords(tie, winnerId)),
    );
  const takeBack = () =>
    act(
      () => undoTieResult({ key: tie.key, players }),
      (was) => onSaid(`Taken back: ${was}. Record it again below.`),
    );

  return (
    <li
      id={`tie-${tie.key}`}
      data-tie={tie.key}
      aria-label={`${tie.round}: ${pair}`}
      className="card"
      style={{ display: "grid", gap: 8, padding: "10px 12px", minWidth: 0, scrollMarginTop: 80 }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ ...PLAIN, fontWeight: 600 }}>{tie.round}</div>
        <div style={{ fontWeight: 700, fontSize: 16, overflowWrap: "anywhere" }}>{pair}</div>
      </div>

      {said && (
        <p role="status" style={{ ...PLAIN, margin: 0, display: "flex", flexDirection: "row", gap: 6, alignItems: "center" }}>
          <Icon name="check-circle" weight="fill" /> {said}
        </p>
      )}

      {tie.state === "decided" ? (
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ ...PLAIN, flex: "1 1 12rem", minWidth: 0 }}>
            <strong>{tie.winnerId === tie.a.id ? tie.a.name : tie.b.name}</strong> won{tie.margin}
          </span>
          {/* Straight after the press it is Undo; later it is Change result. One action. */}
          <button type="button" className="btn btn-secondary" style={BIG} disabled={pending} aria-label={`${said && !said.startsWith("Taken back") ? "Undo" : "Change result"}, ${pair}`} onClick={takeBack}>
            {said && !said.startsWith("Taken back") ? "Undo" : "Change result"}
          </button>
        </div>
      ) : (
        <>
          {tie.report && (
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ ...PLAIN, flex: "1 1 12rem", minWidth: 0 }}>
                Reported by {tie.report.reportedBy}: <strong>{tie.report.winner}</strong> won{tie.report.margin}
              </span>
              <button
                type="button"
                className="btn btn-primary"
                style={BIG}
                disabled={pending}
                aria-label={`Approve: ${tie.report.winner} won ${pair}`}
                onClick={() => act(() => approveBracketReport(tie.key), () => onSaid(goesThroughWords(tie, tie.report!.winnerId)))}
              >
                Approve
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                style={BIG}
                disabled={pending}
                aria-label={`Turn down the report of ${pair}`}
                onClick={() => act(() => rejectBracketReport(tie.key), () => onSaid(`Turned down: ${pair} has no result.`))}
              >
                Turn down
              </button>
            </div>
          )}
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
          {/* Folded: Played with no margin is the usual result, and costs no press. */}
          <details>
            <summary style={{ ...PLAIN, minHeight: 48, display: "flex", alignItems: "center", cursor: "pointer" }}>
              How it ended, or the margin{how !== "played" || margin ? `: ${HOW.find((h) => h.key === how)?.label}${how === "played" && margin ? ` ${margin}` : ""}` : ""}
            </summary>
            <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 6 }}>
              <select className="input" aria-label={`How it ended, ${pair}`} value={how} onChange={(e) => setHow(e.target.value as How)} style={{ ...BIG, width: "auto" }}>
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
          </details>
        </>
      )}
      {refused && <RefusalLine refused={refused} />}
    </li>
  );
}

/**
 * THE PLAY-OFF FOR THIRD: the two beaten semi-finalists. Recorded as the match it
 * is stored as (`keepMyMatchResult`, which says its refusals in words: a match
 * result takes its margin), and taken back by `clearMatch` (an organizer reopens a
 * confirmed one first, and the refusal says so).
 */
function PlayoffRow({ p }: { p: ThirdPlaceCard }) {
  const [pending, start] = useTransition();
  const [margin, setMargin] = useState("");
  const [said, setSaid] = useState("");
  const [refused, setRefused] = useState("");
  const [armed, setArmed] = useState(false);
  const pair = `${p.a.name} v ${p.b.name}`;
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, after: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setRefused("");
        setSaid(after);
      } else setRefused(r.error ?? "That didn't save. Try again.");
    });
  const winner = p.winnerId === p.a.id ? p.a.name : p.winnerId === p.b.id ? p.b.name : "";
  return (
    <li id={`tie-${THIRD_PLACE_KEY}`} data-tie={THIRD_PLACE_KEY} aria-label={`Play-off for third: ${pair}`} className="card" style={{ display: "grid", gap: 8, padding: "10px 12px", minWidth: 0, scrollMarginTop: 80 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ ...PLAIN, fontWeight: 600 }}>Play-off for third</div>
        <div style={{ fontWeight: 700, fontSize: 16, overflowWrap: "anywhere" }}>{pair}</div>
      </div>
      {said && (
        <p role="status" style={{ ...PLAIN, margin: 0 }}>
          <Icon name="check-circle" weight="fill" /> {said}
        </p>
      )}
      {p.state === "to-play" ? (
        <>
          <input
            className="input"
            aria-label={`Margin, ${pair}`}
            placeholder="Margin, e.g. 2&1 or 1 up"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            style={{ ...BIG, width: 190, minWidth: 0 }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(9rem, 1fr))", gap: 8 }}>
            {(["A", "B"] as const).map((side) => {
              const who = side === "A" ? p.a : p.b;
              return (
                <button
                  key={side}
                  type="button"
                  className="btn btn-primary"
                  style={{ ...BIG, minWidth: 0, overflowWrap: "anywhere" }}
                  disabled={pending}
                  onClick={() => act(() => keepMyMatchResult(p.matchId, side, margin), `Play-off for third: ${who.name} is third.`)}
                >
                  {who.name} won
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ ...PLAIN, flex: "1 1 12rem", minWidth: 0 }}>
            {p.state === "under-way" ? "Scores are in; not finished yet." : winner ? (<><strong>{winner}</strong> won: third place.</>) : "Halved: the two share third."}
          </span>
          {armed ? (
            // A match's result is not a tie's: taking it back clears its card, so it asks first.
            <span role="group" aria-label="Take back the play-off's result?" style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <span style={PLAIN}>Clear its result?</span>
              <button
                type="button"
                className="btn btn-primary"
                style={BIG}
                disabled={pending}
                onClick={() => {
                  setArmed(false);
                  act(() => clearMatch(p.matchId), "Taken back: the play-off has no result. Record it again below.");
                }}
              >
                Clear the result
              </button>
              <button type="button" className="btn btn-secondary" style={BIG} onClick={() => setArmed(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-secondary" style={BIG} disabled={pending} aria-label="Change result, play-off for third" onClick={() => setArmed(true)}>
              Change result
            </button>
          )}
        </div>
      )}
      {refused && (
        <p key={refused} className="form-error" role="alert" style={{ margin: 0, fontSize: 15 }} ref={bringIntoView}>
          {refused}
        </p>
      )}
    </li>
  );
}
