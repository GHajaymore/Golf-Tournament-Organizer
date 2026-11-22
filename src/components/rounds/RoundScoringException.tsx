"use client";
import { matchKeptBy } from "@/lib/domain/match-kept-by";
import { SCORE_KEEPING, endCheckLabel, scoringSummary } from "@/lib/domain/round-scoring";
import { noSheetWarning } from "@/lib/domain/keeping-words";
import FieldInfo from "@/components/FieldInfo";
import { isKnockoutRound } from "@/lib/stage-types";
import { Icon } from "@/components/Icon";
import type { RoundCtx } from "./use-round-ctx";

export function RoundScoringException({ ctx }: { ctx: RoundCtx }) {
  const { stage, scoreInput, format, pending, keptBy, scoringNow, scoringOpen, setScoringOpen, scoringRefusal, commitScoring } = ctx;
  return (
    <>
{/* WHO KEEPS THE CARD, AND WHO CHECKS IT (2026-11-04, sprint 2 part B).
                One line that says how the round is kept, the choices behind
                Customize — a knockout's draw files a winner per tie, so it has
                no card to keep. */}
            {!isKnockoutRound(stage.type) &&
              (() => {
                const matchPlay = matchKeptBy({ type: stage.type, format, scoreInput, matchKeptBy: keptBy }) !== null;
                return (
                  <div className="field" style={{ maxWidth: 420, width: "100%" }} data-testid={`round-scoring-${stage.id}`}>
                    <span className="field-caption">
                      Who keeps score
                      <FieldInfo label="who keeps score">
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                          {SCORE_KEEPING.map((s) => (
                            <li key={s.key}>
                              <b>{s.label}</b> — {s.detail}
                            </li>
                          ))}
                        </ul>
                        <p>
                          <b>End-of-round check</b> —{" "}
                          {matchPlay
                            ? "when a match is over, someone from the other side confirms the result on their phone. A disputed result stays off the leaderboard until you settle it."
                            : "each player confirms their own card when the round is over. A disputed card stays off the leaderboard until you settle it."}
                        </p>
                        <p>Choose one scorer per group before anyone scores: once players have entered their own, the round stays that way.</p>
                      </FieldInfo>
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                      <span style={{ fontSize: 13, minWidth: 0 }}>{scoringSummary(scoringNow, matchPlay)}</span>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-expanded={scoringOpen}
                        aria-label="Customize who keeps score"
                        onClick={() => setScoringOpen((o) => !o)}
                        style={{ fontSize: 13 }}
                      >
                        Customize
                      </button>
                    </div>
                    {scoringOpen && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                        <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                          <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Who keeps the card</legend>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {SCORE_KEEPING.map((s) => (
                              <label key={s.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                                <input
                                  type="radio"
                                  name={`score-keeping-${stage.id}`}
                                  checked={scoringNow.scoreKeeping === s.key}
                                  disabled={pending}
                                  onChange={() => commitScoring({ scoreKeeping: s.key })}
                                  style={{ marginTop: 3 }}
                                />
                                <span>{s.label}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
                          <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>End-of-round check</legend>
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {(["on", "off"] as const).map((key) => (
                              <label key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                                <input
                                  type="radio"
                                  name={`end-check-${stage.id}`}
                                  checked={scoringNow.endCheck === key}
                                  disabled={pending}
                                  onChange={() => commitScoring({ endCheck: key })}
                                  style={{ marginTop: 3 }}
                                />
                                <span>{endCheckLabel(key, matchPlay)}</span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      </div>
                    )}
                    {/* GROUPS COME FROM THE TEE SHEET (2026-11-05): before it is published a
                        round kept by one scorer per group has no groups, so each player keeps
                        their own card (a match is its own group). Said here, where it is chosen. */}
                    {scoringNow.scoreKeeping === "group" && stage.groupsPublished === false && (
                      <p data-testid={`round-scoring-no-sheet-${stage.id}`} style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                        <Icon name="info" /> {noSheetWarning(matchPlay)}
                      </p>
                    )}
                    {scoringRefusal && (
                      <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
                        {scoringRefusal}
                      </p>
                    )}
                  </div>
                );
              })()}
    </>
  );
}
