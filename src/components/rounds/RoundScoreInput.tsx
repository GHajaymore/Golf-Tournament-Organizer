"use client";
import { setStageScoreInput } from "@/app/actions/tournament";
import { declaredInput, inputChoices } from "@/lib/formats";
import { MATCH_ENTRY_MODES } from "@/lib/domain/match-entry";
import FieldInfo from "@/components/FieldInfo";
import { SCORE_WORDS, Refused } from "@/components/rounds/shared";
import type { RoundCtx } from "./use-round-ctx";

/**
 * THE ONE WRITER OF `Stage.scoreInput` (R4): how a round's scores are recorded. Two screens used to write it, the
 * round card's radio list and the team round's select (`RoundTeamScoring`); both now call this, so a refusal, a
 * lock or a discarded value is answered one way (`one-writer-of-score-input.test.ts` refuses a second caller).
 */
export function writeScoreInput(stageId: string, next: string) {
  return setStageScoreInput(stageId, next);
}

export function RoundScoreInput({ ctx }: { ctx: RoundCtx }) {
  const { stage, locked, scoreInput, format, pending, refused, commitScoreInput } = ctx;
  return (
    <>
{/* Only where the format offers a choice at all — which is the
                "opt out, not opt in" rule made visible. Every other round
                takes a card and has nothing to decide, so it gets no control
                rather than a control with one option in it. */}
            {inputChoices(format).length > 1 && (
              <div className="field" style={{ maxWidth: 420, width: "100%" }}>
                <span className="field-caption">
                  How scores are recorded
                  <FieldInfo label="how scores are recorded">
                    <p>
                      Separate from <b>Handicap</b> on the round itself, and the distinction is the
                      point: gross or net is what the round is played FOR, this is what the field
                      writes DOWN.
                    </p>
                    <p>
                      A full card is the raw fact — net, Stableford and every tiebreaker are
                      readings of it, so a card can be re-scored if the round changes from gross to
                      net. Hole results and a final margin cannot: the strokes were never recorded.
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {MATCH_ENTRY_MODES.filter((m) => inputChoices(format).includes(m.key)).map((m) => (
                        <li key={m.key}>
                          <b>{m.label}</b> — {m.blurb}
                        </li>
                      ))}
                    </ul>
                    <p>
                      Ask for cards from a match-play day when you want the round to count for
                      handicapping. Under WHS a match-play score is acceptable only when a full
                      card is returned.
                    </p>
                  </FieldInfo>
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {inputChoices(format).map((key) => {
                    const info = MATCH_ENTRY_MODES.find((m) => m.key === key);
                    const natural = key === declaredInput(format);
                    return (
                      <label key={key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                        <input
                          type="radio"
                          name={`score-input-${stage.id}`}
                          // "" resolves to the format's own answer, so the
                          // natural option is the one lit when nobody has
                          // chosen — the round is not silently overridden.
                          checked={scoreInput === key || (scoreInput === "" && natural)}
                          disabled={pending || locked}
                          // Choosing the natural input CLEARS the override
                          // rather than storing it. A round that says nothing
                          // follows its format when the format's mind changes.
                          onChange={() => commitScoreInput(natural ? "" : key)}
                          style={{ marginTop: 3 }}
                        />
                        <span>
                          {SCORE_WORDS[key] ?? info?.label ?? key}
                          {/* Each option's explanation is in the ⓘ above (2026-10-16, "redundancies"). */}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <Refused text={refused.input} />
              </div>
            )}
    </>
  );
}
