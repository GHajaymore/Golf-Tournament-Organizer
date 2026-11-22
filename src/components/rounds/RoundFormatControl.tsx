"use client";
import { roundLabel as roundLabelOf } from "@/lib/domain/round-label";
import { formatChoicesFor } from "@/lib/domain/round-choices";
import { formatTagline } from "@/lib/formats";
import { RescoreWarning, RESCORE_CONSEQUENCE } from "@/components/RescoreWarning";
import { Icon } from "@/components/Icon";
import { BASIS_OPTIONS, WELL_KNOWN_FORMATS } from "@/components/rounds/shared";
import { RemoveWarning } from "./RemoveWarning";
import type { RoundCtx } from "./use-round-ctx";

export function RoundFormatControl({ ctx, removeWarningHere = true }: { ctx: RoundCtx; /** False where the screen says the refusal beside Delete itself (the redesigned Rounds screen): once, not twice. */ removeWarningHere?: boolean }) {
  const { stage, allStages, venues, asPanel, format, setFormatInfoOpen, formatSaid, doors, shut, rescore, pending, confirmRescore, cancelRescore, commitFormat, activeFormat, shapeProblem, activePending } = ctx;
  return (
    <>
<div className="field" style={{ width: 200 }}>
          <span className="field-caption" style={{ display: "flex", alignItems: "center", gap: 5 }}>
            Format
            <button
              type="button"
              onClick={() => setFormatInfoOpen((o) => !o)}
              title="About this round"
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-neutral-500)", display: "inline-flex" }}
            >
              <Icon name="info" style={{ fontSize: 13 }} />
            </button>
          </span>
          {/* Grouped, because this is where team golf actually lives and a flat
              list of fifteen names does not say which of them need a partner.
              An organizer scanning for "how do we play four-ball" now finds a
              heading rather than having to recognise the name. */}
          {/* Named directly: the caption above holds the ⓘ button, so it
              cannot be the control's label without the button's name riding
              along. Same pattern as the date field below. */}
          <select
            className="input"
            aria-label={`Format for ${roundLabelOf(allStages, stage.id) || "this round"}`}
            value={format}
            disabled={pending || shut("format")}
            onChange={(e) => commitFormat(e.target.value)}
          >
            {/* ONLY WHAT THIS KIND OF ROUND CAN BE SCORED IN — `formatChoicesFor`,
                the list the server also holds `setStageFormat` to. Every format
                was offered for every type, Match Play first on a stroke round. */}
            {(["own", "side"] as const).map((g) => {
              const opts = formatChoicesFor(stage.type, format).filter((c) => c.group === g);
              return opts.length === 0 ? null : (
                <optgroup key={g} label={g === "own" ? "Played on your own" : "Played as a side"}>
                  {opts.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          {/* WHAT THIS FORMAT IS, in one line under the choice (Ajay,
              2026-09-28: "keep most of it in the information button"). The
              first sentence only — "Partners play one ball, alternating
              shots…" — is what a newcomer needs while choosing; the full
              description and the round notes stay behind the ⓘ. */}
          {/* ONLY WHERE THE NAME DOES NOT ALREADY SAY IT (2026-10-16, Ajay: "I still see
              redundancies"). Under Match Play it read "Head-to-head, hole-by-hole…" — what every
              golfer knows — and a side format's label in the picker already explains it. Kept for
              the ones a newcomer may not know (Skins, Nassau, Modified Stableford), as Ajay asked on
              2026-09-28: the first sentence shows, the rest stays behind the ⓘ. */}
          {activeFormat && !WELL_KNOWN_FORMATS.has(format) && (formatChoicesFor(stage.type, format).find((c) => c.name === format)?.label ?? format) === format && (
            <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.45 }}>
              {formatTagline(activeFormat.desc)}
            </p>
          )}
          {/* Beside the control that caused it, not in a toast that has gone
              by the time the organizer decides. The COUNT is the decision:
              "re-score 37 cards" is a different question from "change the
              format", and only the server can answer the first. */}
          {/* THE ROUNDS RULE, under the Format box (J12, PR 7b): why the box is shut — the round
              has scores, or the tournament is completed — or what a taken change left to draw. */}
          {doors?.format && !formatSaid && (
            <p className="text-muted" data-testid="format-door" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.45 }}>
              {doors.format}
            </p>
          )}
          {/* The Holes choice beside it is shut on the same ground (8 Nov: holes are format-like); said once, here, where there is room. */}
          {doors?.holes && (
            <p className="text-muted" data-testid="holes-door" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.45 }}>
              {doors.holes}
            </p>
          )}
          {formatSaid && (
            <p role={formatSaid.refused ? "alert" : "status"} style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.45, ...(formatSaid.refused ? { color: "var(--color-danger)" } : {}) }}>
              {formatSaid.words}
            </p>
          )}

          {/* THE OTHER TWO SETTINGS THAT RE-SCORE THE ROUND.
              The format warning above was the only one of the three, and the
              two controls beside it wrote straight through. See
              `enteredCardCount`, whose header already names this whole class:
              "asked before anything that RE-SCORES a round rather than edits
              it". Nothing is deleted by any of them, which is exactly why it
              is quiet — the strokes stay and the results move underneath. */}
          {rescore && (
            <RescoreWarning
              cards={rescore.cards}
              // The rounds rule's words where it asked (the Golf Pro's: a term changed after play).
              consequence={rescore.says ?? RESCORE_CONSEQUENCE[rescore.kind]}
              keepLabel={
                rescore.kind === "holes"
                  ? `${stage.holes} holes`
                  : rescore.kind === "venue"
                    ? venues.find((v) => v.id === stage.courseId)?.name ?? "the tournament's course"
                    : BASIS_OPTIONS.find((o) => o.key === stage.scoringBasis)?.label ??
                      stage.scoringBasis
              }
              pending={pending}
              onConfirm={confirmRescore}
              onCancel={cancelRescore}
            />
          )}

          {/* THE ROUND'S TYPE AND ITS FORMAT, DISAGREEING — said beside the
              two controls that set them.

              The type is chosen when the round is added and the format here,
              on a different visit, so the pair is easy to get wrong and
              impossible to see. Two named templates held it until 2026-09-10:
              a charity day drew twelve head-to-head matches for a Stableford
              outing, and every player's own card screen told them their score
              belonged to an opponent.

              A warning rather than a refusal, for the same reason
              `scoring-mismatch.ts` gives one level up: these are real controls
              an organizer sets on purpose, and rewriting one under them would
              be worse than saying so. `roundShapeMismatch` is the one rule,
              read by the templates' own sweep and by this. */}
          {shapeProblem && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 10px",
                border: "1px solid var(--color-danger)",
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              <b style={{ color: "var(--color-danger)" }}>
                <Icon name="warning-circle" /> This round cannot be scored as set.
              </b>
              <div className="text-muted" style={{ marginTop: 4 }}>{shapeProblem.message}</div>
            </div>
          )}

          {/* Today's screen: under the Format box, as it always was. The timeline's panel says it
              beside its Delete button instead (`removeWarning`, below). */}
          {!asPanel && removeWarningHere && <RemoveWarning ctx={ctx} />}
          {activePending && (
            <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
              This round is set to {activePending.name}, which can be configured but not yet
              scored — {activePending.pendingReason}.
            </p>
          )}
        </div>
    </>
  );
}
