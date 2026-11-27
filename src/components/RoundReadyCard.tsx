"use client";
import { useState } from "react";
import Link from "next/link";
import { setRoundClosed } from "@/app/actions/tournament";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { RoundCloseAsk } from "./RoundCloseAsk";
import { useAction } from "./useAction";
import { movedDoor } from "@/lib/domain/moved-door";
import type { ScreenKey } from "@/lib/domain/console-merges";
import type { ConsoleMode } from "@/lib/console-url";

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
  shown,
  previewMode = null,
}: {
  stageId: string;
  roundName: string;
  /** In the round's own unit — "Every match is finished" on a match round (`roundReadyWord`). */
  allInWords?: string;
  /** Players with no card, once the next round is under way (`missingFromRound`). */
  missing?: number;
  /**
   * The redesigned screens shown to this request (`screensShownFor`). While Score entry is shown a round is closed THERE (R12), so
   * the card sends the secretary to its "Close Round n" section instead of closing in place on two screens (B123). `movedDoor`
   * (`relocate`, the one rule) decides; the card holds no screen condition. Absent, the card closes in place as before.
   */
  shown?: ReadonlySet<ScreenKey>;
  /** The preview the request is in (`previewModeNow`), kept across the move; null once the screen is on. */
  previewMode?: ConsoleMode | null;
}) {
  const door = movedDoor({ href: `/stages?round=${encodeURIComponent(stageId)}`, job: "close", role: "admin", roundId: stageId }, shown, previewMode);
  const { pending, error, setError, startTransition } = useAction();
  /** The server's question — a card not yet approved or signed (`roundCloseCheck`) — while it is open. */
  const [asking, setAsking] = useState("");
  const close = (confirmUnsigned = false) =>
    startTransition(async () => {
      setError("");
      setAsking("");
      const res = await setRoundClosed(stageId, true, confirmUnsigned);
      if (res.needsUnsignedConfirm) setAsking(res.error ?? "");
      else if (!res.ok) setError(res.error ?? "Couldn't save that.");
    });
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
        everyone; you can re-open it on {door.moved ? "Score entry" : <>Rounds &amp; formats</>} to correct a card.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {door.moved ? (
          <Link href={door.href} className="btn btn-primary" style={{ minHeight: 44 }}>
            Close {roundName} on Score entry <Icon name="arrow-right" />
          </Link>
        ) : (
          <ConfirmButton
            className="btn btn-primary"
            icon="check-circle"
            label={`Close ${roundName}`}
            title={`Close ${roundName}`}
            confirmLabel="Close the round"
            note="The public board will read Final."
            disabled={pending || !!asking}
            onConfirm={() => close()}
            style={{ minHeight: 44 }}
          />
        )}
        <Link href="/leaderboard" className="btn btn-secondary" style={{ minHeight: 44 }}>
          See the board <Icon name="arrow-right" />
        </Link>
      </div>
      {asking && <RoundCloseAsk question={asking} pending={pending} onClose={() => close(true)} onKeepOpen={() => setAsking("")} />}
      {error && (
        <p className="form-error">
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}
