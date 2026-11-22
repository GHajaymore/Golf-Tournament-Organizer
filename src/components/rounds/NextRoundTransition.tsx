"use client";
import React, { useState, useTransition } from "react";
import { roundLabel as roundLabelOf } from "@/lib/domain/round-label";
import { setStageCarry, addStage } from "@/app/actions/tournament";
import { useCaughtUp } from "@/components/useAction";
import FieldInfo from "@/components/FieldInfo";
import { cutFeederOf } from "@/lib/domain/cut-ready";
import { type CarryPrompt } from "@/lib/format-chain";
import { seededFromQualifiers } from "@/lib/stage-types";
import { CutControl } from "@/components/CutControl";
import { Icon } from "@/components/Icon";
import { SetupLocked, Refused } from "./shared";
import type { StageView } from "@/components/StagesClient";



/**
 * Configures what happens between this round and the next one — carry-forward
 * and the cut line — right from the round you're currently looking at.
 *
 * When there IS no next round it says so and offers a button, rather than
 * creating one silently on the first click. Keyed by the next stage's id
 * (or "none") so its local state re-syncs whenever a round gets added/removed.
 */
export function NextRoundTransition({
  stageId,
  nextStage,
  allStages,
  confirmedCount,
  flightCount = 1,
  carry,
}: {
  /** The current round's id — where a newly-created next round gets appended after. */
  stageId: string;
  nextStage: StageView | undefined;
  /** Every stage, so the next round can be numbered the way the app numbers rounds. */
  allStages: StageView[];
  confirmedCount: number;
  /** Number of flights, so a per-flight cut can say what it really advances. */
  flightCount?: number;
  /** Whether to put the carry-forward question in front of the organizer. */
  carry: CarryPrompt;
}) {
  const [carryEnabled, setCarryEnabled] = useState(nextStage?.carryEnabled ?? false);
  const [carryPct, setCarryPct] = useState(nextStage?.carryPct ?? 0);
  const [pending, startTransition] = useTransition();
  const caughtUp = useCaughtUp();
  // Every control in this section is behind the lock — see `SetupLocked`.
  const locked = React.useContext(SetupLocked);
  /**
   * Why the round would not build. Null until the server refuses.
   *
   * The action returned nothing, so pressing Generate on a round whose
   * qualifying had not been played looked identical to success: the spinner
   * stopped and the round was still empty. The refusal it now returns is the
   * only warning an organizer gets before a cut ranks the field on zero.
   */

  // The next round is guaranteed to exist by the time anything below runs —
  // the no-next-round case returns early. Kept as a function because the cut
  // control takes a getter rather than an id.
  const ensureNextStageId = async (): Promise<string> => nextStage?.id ?? stageId;

  /** A refused carry or a refused new round, said under the control that was pressed. */
  const [carryRefused, setCarryRefused] = useState("");
  const [addRefused, setAddRefused] = useState("");

  const commitCarry = (nextEnabled: boolean, nextPct: number) => {
    const before = { enabled: carryEnabled, pct: carryPct };
    setCarryEnabled(nextEnabled);
    setCarryPct(nextPct);
    setCarryRefused("");
    startTransition(async () => {
      const id = await ensureNextStageId();
      const res = caughtUp(await setStageCarry(id, nextEnabled, nextPct));
      if (!res.ok) {
        // Back to what is stored, and why — never a choice the round does not have.
        setCarryEnabled(before.enabled);
        setCarryPct(before.pct);
        setCarryRefused(res.error ?? "Couldn't save that.");
      }
    });
  };

  // No next round yet, so there is nothing to cut INTO and nothing to carry
  // INTO. These controls used to stay live and create a Round Robin round the
  // moment either was touched, which meant an organizer who opened the section
  // to read the options came away with a round they never asked for and then
  // had to find and delete. Adding a round is a decision, so it gets a button
  // and a name rather than happening as a side effect of a click somewhere
  // else. The statement stays — it is true and worth reading — and only the
  // controls that would have conjured a round are withheld.
  if (!nextStage) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 9,
          padding: "11px 13px",
          borderRadius: "var(--radius-md)",
          background: "color-mix(in srgb, var(--color-text) 3%, transparent)",
        }}
      >
        <span className="text-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
          <Icon name="info" /> No round after this yet. A cut and a carry-forward both need
          somewhere to go, so add the next round first and they will appear here.
        </span>
        <div>
          <button
            type="button"
            className="btn"
            // Not gated on the lock: adding a round is running the event, and
            // `addStage` allows it on a live tournament (2026-09-27).
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setAddRefused("");
                const res = await addStage("Round Robin");
                if (res.error) setAddRefused(res.error);
              })
            }
          >
            <Icon name="plus" /> Add the next round
          </button>
          <Refused text={addRefused} />
        </div>
      </div>
    );
  }

  // From the tournament's own count, not `position + 1`, which counts a cut as
  // a round and so named this one differently from every other screen.
  const roundLabel = roundLabelOf(allStages, nextStage.id);
  // A stroke-play / medal next round draws no pairings — the field returns
  // cards — so it is "generated" by handing the survivors a card, not by
  // building matches. Before it exists, assume a Round Robin (what gets created).
  /**
   * A bracket takes its field from Qualification, not from a cut here.
   *
   * Both controls below were offered for one anyway, and neither did anything.
   * The cut saved, displayed as saved, printed on the published rules sheet as
   * "Top 8 advance" — and the draw went on seeding two per flight, because it
   * reads the event's qualification settings. Generate then handed every
   * "survivor" an empty stroke-play card for a knockout round.
   *
   * Offering a setting that does nothing is worse than not offering it: the
   * organizer believes they have set the thing, and the sheet agrees with them.
   */
  const nextIsSeeded = nextStage ? seededFromQualifiers(nextStage.type) : false;
  // What a tie at the next round's cut line is decided on — a card, a round
  // robin's table — or null for a cut that settles no tie of its own
  // (`cutFeederOf`, the one answer the rules sheet and both engines ask).
  const cutLineKind = nextStage ? (cutFeederOf(allStages, nextStage.id)?.kind ?? null) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* ONE ROW FOR ONE DECISION (2026-10-16; the review panel, on Ajay's "I still
          see redundancies"). Whether points carry into the next round was asked
          three times over: a prompt card with Yes / No, then a tick-box, a slider
          and a sentence about the same thing. Now one choice — Start fresh, Carry
          all, Carry part — with the share only under Carry part. Still ASKED where
          it matters (`carry.ask`): nothing is chosen until the organizer chooses. */}
      {carry.inert ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {carry.detail}
        </p>
      ) : (
        <div className="field" style={{ gap: 6 }}>
          <span className="field-caption">
            Points into {roundLabel}
            <FieldInfo label="carrying points forward">
              <p>{carry.detail}</p>
              <p>
                Carry all and a player takes their whole total into {roundLabel}, so a strong round still
                counts at the end. Carry part and it is cut to the share you choose — the lead narrows but
                does not vanish. Start fresh and every player begins {roundLabel} level.
              </p>
            </FieldInfo>
          </span>
          <div className="seg" role="radiogroup" aria-label={`Points into ${roundLabel}`} style={{ flexWrap: "wrap" }}>
            {(
              [
                ["fresh", "Start fresh"],
                ["all", "Carry all"],
                ["part", "Carry part"],
              ] as const
            ).map(([key, label]) => {
              const chosen = carry.ask
                ? false
                : key === "fresh"
                  ? !carryEnabled
                  : key === "all"
                    ? carryEnabled && carryPct === 100
                    : carryEnabled && carryPct !== 100;
              return (
                <label key={key} className="seg-opt" style={{ minHeight: 44 }}>
                  <input
                    type="radio"
                    name={`carry-${stageId}`}
                    checked={chosen}
                    disabled={pending || locked}
                    onChange={() =>
                      key === "fresh"
                        ? commitCarry(false, 0)
                        : key === "all"
                          ? commitCarry(true, 100)
                          : commitCarry(true, carryPct > 0 && carryPct < 100 ? carryPct : 50)
                    }
                  />
                  {label}
                </label>
              );
            })}
          </div>
          <Refused text={carryRefused} />
          {carry.ask && (
            <p style={{ fontSize: 13, margin: 0 }}>
              <b>{carry.question}</b> <span className="text-muted">Until you choose, {roundLabel} starts fresh.</span>
            </p>
          )}
          {!carry.ask && carryEnabled && carryPct !== 100 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <input
                type="range"
                min={5}
                max={95}
                step={5}
                value={carryPct}
                disabled={locked}
                onChange={(e) => commitCarry(true, parseInt(e.target.value, 10))}
                style={{ flex: 1, minWidth: 120, minHeight: 44 }}
                aria-label={`Share of points carried into ${roundLabel}`}
                aria-valuetext={`${carryPct}%`}
              />
              <span className="tag tag-accent" style={{ minWidth: 48, textAlign: "center" }}>{carryPct}%</span>
            </div>
          )}
          {!carry.ask && carryEnabled && (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              A player on 12 pts here starts {roundLabel} on {(12 * carryPct) / 100}.
            </p>
          )}
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-divider)", margin: "4px 0", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Before a bracket there is no cut to make: its field is its qualifiers,
            set on the bracket's own card (2026-10-16 — the sentence saying so went). */}
        {nextIsSeeded ? null : (
          <CutControl
            formId={stageId}
            getStageId={ensureNextStageId}
            roundLabel={roundLabel}
            enabled={nextStage?.cutEnabled ?? false}
            mode={nextStage?.cutMode ?? "count"}
            count={nextStage?.cutCount ?? 16}
            percent={nextStage?.cutPercent ?? 50}
            scope={nextStage?.cutScope ?? "overall"}
            confirmedCount={confirmedCount}
            flightCount={flightCount}
            locked={locked}
            // A tie at a round robin's line is settled the way the committee
            // chose, as a stroke cut's is (J31) — on points and the table's
            // tie-breaks, so the words are the table's. ONLY where a cut out of
            // this round settles a tie of its own (`cutFeederOf`): a team
            // medal's cut, or a round robin cut out of a stroke round, is
            // honoured by no engine and printed by no rules sheet, so it offers
            // no choice to store.
            tiesGoThrough={cutLineKind !== null}
            tieRule={nextStage?.cutTies ?? "ties"}
            decidedOn={cutLineKind ?? undefined}
          />
        )}
        {/* DRAWING THE NEXT ROUND IS NOT SETTING THIS ONE UP (2026-10-16; Ajay: "is this
            needed here?"). "Generate Round 2 pairings" sat on Round 1's card from the
            day the tournament was made. It is a match-day job, so it is on the round it
            draws, once the tournament is live — see `DrawRound`. */}
      </div>
    </div>
  );
}
