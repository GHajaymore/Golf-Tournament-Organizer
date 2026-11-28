"use client";
import { useState } from "react";
import { setRoundClosed } from "@/app/actions/tournament";
import { bringIntoView } from "@/lib/bring-into-view";
import { closingWords, type ClosingKind } from "@/lib/domain/closing-words";
import FieldInfo from "./FieldInfo";
import { Icon } from "./Icon";
import { RoundCloseAsk } from "./RoundCloseAsk";
import { useAction } from "./useAction";

/**
 * Whether the organizer has declared this round finished.
 *
 * THE ONE THING A ROUND COULD NOT SAY ABOUT ITSELF. Everything that needs to
 * know whether a round is over has had to guess at it, and a stroke aggregate
 * could not tell "has not played those holes yet" from "did not turn up" —
 * so in a two-round event one round at +4 out-ranked two rounds at +6.
 *
 * STATED AS A CONSEQUENCE, not as a checkbox nobody reads. Closing a round
 * takes a place away from anybody who did not return a card for it, and an
 * organizer should be told that before they tick it rather than discover it
 * on the board afterwards. The sentence changes with the state so it is never
 * describing a thing that has already happened.
 *
 * RE-OPENING IS OFFERED because a committee correcting a card after the fact
 * is ordinary, and a control that only goes one way makes people avoid it.
 */
export function RoundClosedControl({
  stageId,
  closed,
  kind,
  infoBehind,
}: {
  stageId: string;
  closed: boolean;
  /** REQUIRED: the words the round speaks (`closingKind`) — a points round changes nobody's position, a match round has no card or place. */
  kind: ClosingKind;
  /**
   * REQUIRED (R12): the redesigned Score entry says what closing does behind an ⓘ and keeps one short line beside the
   * tick; the old Rounds screen draws the whole paragraph exactly as it always did. The words are the same either way
   * (`closingWords`), so the two screens cannot say different things about one press.
   */
  infoBehind: boolean;
}) {
  const { pending, error, setError, startTransition } = useAction();
  const words = closingWords(kind);
  /** The server's question — a card not yet approved or signed (`roundCloseCheck`) — while it is open. */
  const [asking, setAsking] = useState("");
  const close = (shut: boolean, confirmUnsigned = false) =>
    startTransition(async () => {
      setError("");
      setAsking("");
      const res = await setRoundClosed(stageId, shut, confirmUnsigned);
      if (res.needsUnsignedConfirm) setAsking(res.error ?? "");
      else if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={closed}
          disabled={pending || !!asking}
          onChange={(e) => close(e.target.checked)}
          style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
        />
        <span>
          <span style={{ fontWeight: 500 }}>This round is finished</span>
          <span className="text-muted" style={{ display: "block", fontSize: 13, lineHeight: 1.6 }}>
            {infoBehind ? words.short : words.whole}
          </span>
        </span>
      </label>

      {infoBehind && (
        <div>
          <FieldInfo label="what closing a round does">
            <p>{words.whole}</p>
          </FieldInfo>
        </div>
      )}

      {closed && words.closedNote && (
        <div
          style={{
            padding: "9px 11px",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          <span className="text-muted">
            <Icon name="check-circle" /> {words.closedNote}
          </span>
        </div>
      )}

      {asking && (
        <RoundCloseAsk question={asking} pending={pending} onClose={() => close(true, true)} onKeepOpen={() => setAsking("")} />
      )}

      {/* An alert, brought into view: it sits under the paragraph above, which on a phone is
          most of a screen, and round G245-1 saw "1 card is disputed. Closing Round 1 makes the
          cut…" refused out of view of the tick that was pressed (2026-10-21). */}
      {error && (
        <p className="form-error" role="alert" ref={bringIntoView}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
