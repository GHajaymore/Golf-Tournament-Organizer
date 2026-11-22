import { Icon } from "@/components/Icon";
import { DRIFT_PLACE_LINE } from "@/lib/domain/tee-sheet";

/**
 * "THE PUBLISHED SHEET NO LONGER MATCHES THE FIELD" (R9a, moved whole from `foursomes/page.tsx`).
 *
 * A published sheet is a snapshot of a field that keeps moving: a player withdrawn on the Wednesday stays
 * in the stored draw, and the group prints with a gap. The print already drops the missing name; this is
 * what tells the committee it happened so they can move somebody up. `sentence` is `driftSentence`'s
 * answer, `anyUndrawn` says whether the place-in-group line applies.
 */
export function SheetDriftCard({ sentence, anyUndrawn }: { sentence: string; anyUndrawn: boolean }) {
  return (
    <div className="card elev-sm" style={{ marginBottom: 16, borderLeft: "3px solid var(--color-accent)", gap: 6 }}>
      <span className="card-title" style={{ fontSize: 14 }}>
        <Icon name="warning-circle" /> The published sheet no longer matches the field
      </span>
      <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
        {sentence} Re-pair and publish again to put it right — the printed sheet leaves out anyone who has gone, so
        it is correct but shorter than you drew it.
        {anyUndrawn && ` ${DRIFT_PLACE_LINE}`}
      </p>
    </div>
  );
}
