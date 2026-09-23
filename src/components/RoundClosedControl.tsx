"use client";
import { setRoundClosed } from "@/app/actions/tournament";
import { Icon } from "./Icon";
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
  /** True on a points round, where closing changes nothing about who is ranked. */
  pointsBoard = false,
}: {
  stageId: string;
  closed: boolean;
  pointsBoard?: boolean;
}) {
  const { pending, error, run } = useAction();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={closed}
          disabled={pending}
          onChange={(e) => run(() => setRoundClosed(stageId, e.target.checked))}
          style={{ marginTop: 3, accentColor: "var(--color-accent)" }}
        />
        <span>
          <span style={{ fontWeight: 500 }}>This round is finished</span>
          <span className="text-muted" style={{ display: "block", fontSize: 12, lineHeight: 1.6 }}>
            {pointsBoard
              ? // A missed week already costs a points player the points it was
                // worth, so nothing about the board changes here. Saying so is
                // better than a control whose effect is invisible.
                "Marks the round as played. On a points round this changes nobody's position — a missed round already costs the points it was worth."
              : "Tell the board the round is over. Anybody without a card for it is then shown without a place, the same as a card that stopped short — they have not completed the competition. Leave it unticked while cards are still coming in."}
          </span>
        </span>
      </label>

      {closed && !pointsBoard && (
        <div
          style={{
            padding: "9px 11px",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
            fontSize: 12.5,
            lineHeight: 1.6,
          }}
        >
          <span className="text-muted">
            <Icon name="check-circle" /> Closed. Untick it to take a late card or correct one — nothing
            is lost either way.
          </span>
        </div>
      )}

      {error && (
        <p className="form-error">
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
