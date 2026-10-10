"use client";
import Link from "next/link";
import { setRoundClosed } from "@/app/actions/tournament";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { useAction } from "./useAction";

/**
 * EVERY CARD IS IN — CLOSE THE ROUND TO MAKE IT OFFICIAL (2026-10-08).
 *
 * A result becomes official when the committee closes the round, so the public
 * board reads "All in · unofficial" until somebody does. The only door used to
 * be a checkbox on Rounds & formats; this asks on the dashboard, the moment
 * there is nothing left to wait for (`roundReadyToClose`). Same shape as
 * `CutReadyCard`, which does this for a round a cut is taken out of.
 */
export function RoundReadyCard({
  stageId,
  roundName,
  allInWords = "Every card is in",
  missing = 0,
}: {
  stageId: string;
  roundName: string;
  /** In the round's own unit — "Every match is finished" on a match round (`roundReadyWord`). */
  allInWords?: string;
  /** Players with no card, once the next round is under way (`missingFromRound`). */
  missing?: number;
}) {
  const { pending, error, run } = useAction();
  return (
    <section
      aria-label="The round is ready to close"
      className="card elev-sm"
      style={{ marginBottom: 16, gap: 10, borderColor: "var(--color-accent-700)" }}
    >
      <span className="card-kicker">{roundName}</span>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>
        {allInWords} — close {roundName} to make the result official.
      </p>
      {missing > 0 && (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          The next round is already under way, so {missing === 1 ? "the player" : `the ${missing}`} with no card did
          not play this one. Closing records that and moves everybody on.
        </p>
      )}
      <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        Until then the public board reads &ldquo;All in · unofficial&rdquo;. Closing it makes the result final for
        everyone; you can re-open it on Rounds &amp; formats to correct a card.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <ConfirmButton
          className="btn btn-primary"
          icon="check-circle"
          label={`Close ${roundName}`}
          title={`Close ${roundName}`}
          confirmLabel="Close the round"
          note="The public board will read Final."
          disabled={pending}
          onConfirm={() => run(() => setRoundClosed(stageId, true))}
          style={{ minHeight: 44 }}
        />
        <Link href="/leaderboard" className="btn btn-secondary" style={{ minHeight: 44 }}>
          See the board <Icon name="arrow-right" />
        </Link>
      </div>
      {error && (
        <p className="form-error">
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}
