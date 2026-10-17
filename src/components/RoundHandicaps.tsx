"use client";
import { useState } from "react";
import { setRoundHandicapOverride, applyRoundHandicapToRest } from "@/app/actions/tournament";
import { indexChangeFacts, setPlayerIndex, type IndexChangeView } from "@/app/actions/player-index";
import FieldInfo from "@/components/FieldInfo";
import type { RoundHandicapView } from "@/lib/services/round-handicap";
import { indexFigure, parseStrokesInput, readHandicapIndex } from "@/lib/domain/handicap-label";
import { indexChangePreview, indexDecimalRefusal } from "@/lib/domain/index-change";
import { useAction } from "./useAction";

/**
 * What each player plays off in THIS round, and the one place a committee
 * changes it — for this round, or as the player's handicap index.
 *
 * The roster handicap is the default and almost always the answer, so this
 * opens as one sentence rather than a list of inputs — a field of twenty-eight
 * spin boxes would suggest an organizer is expected to fill them in.
 *
 * Two things it must say out loud:
 *
 *   - Once cards are in, the round keeps what it was scored against. Not a
 *     disabled box: "cards are in" is an answer, and a box that does nothing
 *     is not.
 *   - When a frozen round disagrees with today's roster, it says so and shows
 *     both numbers. That line is the answer to "why is my net different in
 *     round one", and without it somebody eventually decides the app is wrong
 *     and re-enters the round.
 *
 * CHANGE ASKS WHAT IS BEING CHANGED (2026-10-16; Ajay asked for the index to
 * reach the member record, and the review panel shaped it —
 * docs/handicap-push-brief-2026-10-16.md). Two different numbers, never both
 * called "handicap": the round's own figure, in whole STROKES, for this round
 * only; or the player's INDEX, to one decimal, which moves every round not yet
 * played and, when asked and allowed, the member record.
 */

const numberFor = (v: number) => (v > 0 ? String(v) : v === 0 ? "scratch" : `+${Math.abs(v)}`);

type Kind = "strokes" | "index";

/** Every target on this screen is at least 44px — these were about 26. */
const BUTTON = { minHeight: 44, padding: "6px 14px", fontSize: 13 } as const;

export function RoundHandicaps({
  stageId,
  rows,
  roundName = "this round",
}: {
  stageId: string;
  rows: RoundHandicapView[];
  /** "Round 2" — said in the choices and the sentences. */
  roundName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const [editing, setEditing] = useState("");
  const [kind, setKind] = useState<Kind>("strokes");
  const [value, setValue] = useState("");
  const [alsoMember, setAlsoMember] = useState(false);
  const [reason, setReason] = useState("");
  const [facts, setFacts] = useState<IndexChangeView | null>(null);
  const [done, setDone] = useState<{ playerId: string; text: string } | null>(null);
  const { pending, error, setError, run } = useAction();

  const overridden = rows.filter((r) => r.source === "override");
  const differing = rows.filter((r) => r.differsFromCurrent !== null);
  /**
   * Settled — the round has been scored, so its handicaps are not up for
   * discussion.
   *
   * Read from `editable`, not from whether a frozen value is stored. A round
   * played before the freeze existed has cards and nothing frozen; keying on
   * the stored value would print "everyone plays off the roster" over a round
   * whose cards are in, and offer a control the action then refuses.
   */
  const isFrozen = rows.length > 0 && rows.every((r) => !r.editable);
  const shown = find.trim()
    ? rows.filter((r) => r.name.toLowerCase().includes(find.trim().toLowerCase()))
    : rows;

  const startEditing = (r: RoundHandicapView) => {
    setEditing(r.playerId);
    setKind("strokes");
    // What the sentence beside it says: "+2", never the stored "-2".
    setValue(indexFigure(r.handicap));
    setAlsoMember(false);
    setReason("");
    setFacts(null);
    setError("");
    setDone(null);
  };

  const chooseIndex = (r: RoundHandicapView) => {
    setKind("index");
    setError("");
    setValue("");
    setFacts(null);
    run(async () => {
      const f = await indexChangeFacts(r.playerId);
      if (f.ok) {
        setFacts(f);
        setValue(indexFigure(f.from ?? 0));
      }
      return f;
    });
  };

  /** What is typed, read the one way every index box reads it, or why it cannot be saved. */
  const typedIndex = (): { ok: true; value: number } | { ok: false; error: string } => {
    const read = readHandicapIndex(value);
    if (read.kind === "blank" || read.kind === "unreadable") return { ok: false, error: "Type the index as a golfer writes it — 14.2, or +2.4 for a plus handicap." };
    if (read.kind === "out-of-range") return { ok: false, error: "A handicap index runs from +10 to 54." };
    const decimals = indexDecimalRefusal(read.value);
    return decimals ? { ok: false, error: decimals } : { ok: true, value: read.value };
  };

  const preview = (r: RoundHandicapView): string => {
    if (kind === "strokes") {
      const t = parseStrokesInput(value);
      return t.ok
        ? `${r.name} plays off ${numberFor(t.value)} in ${roundName}. Their index and every other round stay as they are.`
        : "";
    }
    if (!facts?.ok || !facts.plan) return "";
    const t = typedIndex();
    if (!t.ok) return "";
    return indexChangePreview({
      name: facts.name ?? r.name,
      from: facts.from ?? 0,
      to: t.value,
      plan: facts.plan,
      fieldStarted: !!facts.fieldStarted,
      alsoMember: alsoMember && !facts.memberRefusal,
      otherEntries: facts.otherEntries ?? [],
    });
  };

  const save = (r: RoundHandicapView) => {
    if (kind === "strokes") {
      const t = parseStrokesInput(value);
      if (!t.ok) {
        setError(t.error);
        return;
      }
      run(
        () => setRoundHandicapOverride(stageId, r.playerId, t.value),
        () => {
          setEditing("");
          setDone({ playerId: r.playerId, text: `Done. ${r.name} plays off ${numberFor(t.value)} in ${roundName}.` });
        },
      );
      return;
    }
    const t = typedIndex();
    if (!t.ok) {
      setError(t.error);
      return;
    }
    if (!facts?.ok) return;
    let said = "";
    run(
      async () => {
        const res = await setPlayerIndex(r.playerId, {
          index: t.value,
          expectedFrom: facts.from ?? 0,
          alsoMember: alsoMember && !facts.memberRefusal,
          reason,
        });
        said = res.said ?? "";
        return res;
      },
      () => {
        setEditing("");
        setDone({ playerId: r.playerId, text: said });
      },
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {isFrozen ? (
            <>Cards are in, so this round keeps the handicaps it was scored against.</>
          ) : overridden.length === 0 ? (
            <>Everyone plays off their handicap from the roster.</>
          ) : (
            <>
              <b style={{ color: "var(--color-text)" }}>{overridden.length}</b>{" "}
              {overridden.length === 1 ? "player has" : "players have"} a handicap set for this round;
              the rest play off the roster.
            </>
          )}
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          style={BUTTON}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : isFrozen ? "Show what it was scored off" : "Change a player's handicap"}
        </button>
        <FieldInfo label="handicaps for this round">
          <p>
            A player&rsquo;s handicap index is what they play off; this round turns it into strokes
            for its course and tees. <b>Change</b> offers two things. <b>Their strokes in this round
            only</b> is a whole number for this round, and nothing else moves. <b>Their handicap
            index</b> moves every round of this tournament not yet played and, if you tick it and
            the club keeps its own handicaps, the member&rsquo;s index on Members for every
            tournament after.
          </p>
          <p>
            When the first card comes in, this round keeps whatever it was being scored against.
            After that a change of index moves the next round, not this one.
          </p>
          <p>
            These are course handicaps. The round&rsquo;s allowance still applies on top, and it is
            taken of the course handicap before that is rounded, as the Rules of Handicapping say:
            a course handicap of 7 that was 6.6 plays off 6 at 95%, not 7. A figure you set here
            yourself is a whole number, and the allowance is taken of that.
          </p>
          <p>
            Where the field plays tees of different pars, in stroke play or a match, the players on
            the higher par are given the difference as extra strokes, added after the allowance
            (Rules of Handicapping, 6.2b). A round counted in Stableford points gives none: there
            each player is already measured against the par of their own tees.
          </p>
        </FieldInfo>
      </div>

      {/* The answer to "why is my net different in round one", volunteered
          rather than waited for. */}
      {differing.map((r) => (
        <p key={r.playerId} className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          <b style={{ color: "var(--color-text)" }}>{r.name}</b> was scored off{" "}
          {numberFor(r.frozen ?? 0)} in this round and plays off {numberFor(r.differsFromCurrent ?? 0)}{" "}
          now.
        </p>
      ))}

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.length === 0 && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Nobody is confirmed in the field yet.
            </p>
          )}
          {rows.length >= 12 && (
            <input
              className="input"
              type="search"
              placeholder="Find a player"
              aria-label="Find a player"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              style={{ maxWidth: 280 }}
            />
          )}
          {shown.map((r) => {
            const isEditing = editing === r.playerId;
            const said = preview(r);
            return (
              <div
                key={r.playerId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  padding: "6px 0",
                  borderTop: "1px solid var(--color-divider)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, minWidth: 0, flex: "1 1 140px" }}>{r.name}</span>
                  <span className="text-muted" style={{ fontSize: 13, flex: "1 1 200px" }}>
                    {/* WITH AN ALLOWANCE, BOTH FIGURES — the one they are told and the
                        one their card is scored off. The allowance is taken of the
                        course handicap BEFORE it is rounded (Rule 6.2a), so "7 at 95%"
                        is 6 when the 7 was 6.6; without the middle figure an organizer
                        working it by hand gets 7 and decides the board is wrong. */}
                    {r.playing !== null && (r.allowance !== 100 || r.parStrokes > 0) ? (
                      <>
                        course handicap <b style={{ color: "var(--color-text)" }}>{numberFor(r.handicap)}</b>
                        {r.allowance !== 100 && r.exact !== r.handicap
                          ? ` (${indexFigure(Number(r.exact.toFixed(2)))} before rounding)`
                          : ""}
                        {" · plays off "}
                        <b style={{ color: "var(--color-text)" }}>{numberFor(r.playing)}</b>
                        {r.allowance !== 100 ? ` at ${r.allowance}%` : ""}
                        {/* AND WHY IT IS MORE THAN THE ALLOWANCE GIVES. Without this an
                            organizer checking "12 at 95%" gets 11, reads 12, and decides
                            the board is wrong — about the one player it is right for. */}
                        {r.parStrokes > 0
                          ? `, with ${r.parStrokes} ${r.parStrokes === 1 ? "stroke" : "strokes"} for tees of a higher par`
                          : ""}
                      </>
                    ) : (
                      <>
                        plays off <b style={{ color: "var(--color-text)" }}>{numberFor(r.handicap)}</b>
                      </>
                    )}
                    {r.source === "frozen"
                      ? " — what this round was scored off"
                      : r.source === "override"
                        ? ` — set for this round, in place of ${numberFor(r.member)}`
                        : ""}
                  </span>
                  {r.editable && !isEditing && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={BUTTON}
                      aria-label={`Change ${r.name}'s handicap`}
                      onClick={() => startEditing(r)}
                    >
                      Change
                    </button>
                  )}
                </div>

                {/* The confirmation, where Save was pressed — not at the top of a list of 28. */}
                {done?.playerId === r.playerId && !isEditing && done.text && (
                  <p role="status" className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                    {done.text}
                  </p>
                )}

                {isEditing && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingLeft: 4 }}>
                    <div role="radiogroup" aria-label={`What are you changing for ${r.name}?`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>What are you changing?</span>
                      {(
                        [
                          ["strokes", `Their strokes in ${roundName} only`, "A figure for this round. Their index stays as it is."],
                          ["index", "Their handicap index", "Moves every round not yet played."],
                        ] as const
                      ).map(([k, label, hint]) => (
                        <label
                          key={k}
                          style={{ display: "flex", gap: 8, alignItems: "flex-start", minHeight: 44, cursor: "pointer", fontSize: 13 }}
                        >
                          <input
                            type="radio"
                            name={`hcp-kind-${r.playerId}`}
                            checked={kind === k}
                            disabled={pending}
                            onChange={() => (k === "index" ? chooseIndex(r) : (setKind("strokes"), setValue(indexFigure(r.handicap)), setError("")))}
                            style={{ marginTop: 3 }}
                          />
                          <span>
                            <span style={{ fontWeight: 500 }}>{label}</span>
                            <span className="text-muted" style={{ display: "block" }}>{hint}</span>
                          </span>
                        </label>
                      ))}
                    </div>

                    <div className="field" style={{ maxWidth: 220 }}>
                      <label htmlFor={`hcp-${r.playerId}`}>
                        {kind === "strokes" ? `Strokes in ${roundName}` : "Handicap index"}
                      </label>
                      <input
                        id={`hcp-${r.playerId}`}
                        className="input"
                        // Text, and not the digits-only keypad: a plus handicap is typed with its plus.
                        inputMode="text"
                        value={value}
                        placeholder={kind === "strokes" ? "e.g. 14 or +2" : "e.g. 14.2 or +2.4"}
                        disabled={pending || (kind === "index" && !facts?.ok)}
                        onChange={(e) => setValue(e.target.value)}
                      />
                    </div>

                    {kind === "index" && facts?.ok && (
                      facts.memberRefusal ? (
                        <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                          {facts.memberRefusal}
                        </p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", minHeight: 44, cursor: "pointer", fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={alsoMember}
                              disabled={pending}
                              onChange={(e) => setAlsoMember(e.target.checked)}
                              style={{ marginTop: 3 }}
                            />
                            <span>
                              <span style={{ fontWeight: 500 }}>Also make it their handicap on Members</span>
                              <span className="text-muted" style={{ display: "block" }}>
                                Members has {indexFigure(facts.memberFrom ?? 0)} now. Every tournament they enter from now on copies it.
                              </span>
                            </span>
                          </label>
                          {alsoMember && (
                            <div className="field" style={{ maxWidth: 420 }}>
                              <label htmlFor={`hcp-why-${r.playerId}`}>Why — kept in the history</label>
                              <input
                                id={`hcp-why-${r.playerId}`}
                                className="input"
                                value={reason}
                                maxLength={200}
                                placeholder="e.g. Committee adjustment after the club championship"
                                disabled={pending}
                                onChange={(e) => setReason(e.target.value)}
                              />
                            </div>
                          )}
                        </div>
                      )
                    )}

                    {said && (
                      <p style={{ fontSize: 13, margin: 0, lineHeight: 1.55, maxWidth: "68ch" }}>{said}</p>
                    )}
                    {/* WHY SAVE IS GREY, said under the box as it is typed — a disabled
                        button with no reason is the app refusing to explain itself. */}
                    {!said && (kind === "strokes" || facts?.ok) && (
                      <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
                        {kind === "strokes"
                          ? (() => {
                              const t = parseStrokesInput(value);
                              return t.ok ? "" : t.error;
                            })()
                          : (() => {
                              const t = typedIndex();
                              return t.ok ? "" : t.error;
                            })()}
                      </p>
                    )}
                    {error && (
                      <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>{error}</p>
                    )}

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={BUTTON}
                        disabled={pending || !said || (kind === "index" && alsoMember && !facts?.memberRefusal && !reason.trim())}
                        onClick={() => save(r)}
                      >
                        {kind === "strokes"
                          ? `Save for ${roundName}`
                          : alsoMember && !facts?.memberRefusal
                            ? "Save index and Members"
                            : "Save index"}
                      </button>
                      <button type="button" className="btn btn-secondary" style={BUTTON} onClick={() => setEditing("")}>
                        Cancel
                      </button>
                    </div>

                    {/* The round's own figure, once set: carried on, or cleared. In the
                        editor, not on the face of every row. */}
                    {kind === "strokes" && r.source === "override" && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={BUTTON}
                          disabled={pending}
                          onClick={() => {
                            let text = "";
                            run(
                              () =>
                                applyRoundHandicapToRest(stageId, r.playerId).then((res) => {
                                  if (res.ok) {
                                    text =
                                      res.written === 0
                                        ? "There are no later rounds to use it in."
                                        : `Set on ${res.written} later ${res.written === 1 ? "round" : "rounds"}` +
                                          (res.skipped > 0 ? `, leaving ${res.skipped} that ${res.skipped === 1 ? "has" : "have"} cards in or ${res.skipped === 1 ? "is" : "are"} on other tees.` : ".");
                                  }
                                  return res;
                                }),
                              () => {
                                setEditing("");
                                setDone({ playerId: r.playerId, text });
                              },
                            );
                          }}
                        >
                          Use in later rounds too
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={BUTTON}
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => setRoundHandicapOverride(stageId, r.playerId, null),
                              () => {
                                setEditing("");
                                setDone({ playerId: r.playerId, text: `Done. ${r.name} plays off their index again in ${roundName}.` });
                              },
                            )
                          }
                        >
                          Clear this round&rsquo;s figure
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
