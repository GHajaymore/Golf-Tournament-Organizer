import Link from "next/link";
import { Icon } from "@/components/Icon";
import { StalePaperLine } from "./StalePaperLine";

/**
 * PRINT… — THE TEE SHEET'S ONE DOOR TO THE PRINT KIT (decision A; moved whole from `foursomes/page.tsx`).
 *
 * The kit opens with this sheet's documents ticked and is the one way to the printer. The anchor
 * `#print-scorecards` stays on the door (`/scorecard` and Reports send people here to find the button).
 * It also says when paper already out has gone stale (decision D).
 */
export function PrintDoor({
  stageId,
  roundName,
  cartWord,
  stale,
}: {
  stageId: string;
  /** "Round 2", or "this round". */
  roundName: string;
  /** The club's word for a cart sign. */
  cartWord: string;
  stale: readonly { label: string }[];
}) {
  return (
    <div id="print-scorecards" className="card elev-sm" style={{ marginTop: 16, gap: 8, scrollMarginTop: 80 }}>
      <StalePaperLine stageId={stageId} stale={stale} />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Link
          href={`/print?round=${stageId}&docs=cards,cup,slips,signs,spare,start`}
          className="btn btn-secondary"
          style={{ minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Icon name="printer" /> Print…
        </Link>
        <span className="text-muted" style={{ fontSize: 13 }}>
          Scorecards, {cartWord} signs and the starting sheet for {roundName}, from the saved sheet.
        </span>
      </div>
    </div>
  );
}
