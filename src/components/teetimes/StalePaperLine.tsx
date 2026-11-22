import Link from "next/link";
import { Icon } from "@/components/Icon";
import { staleSentence } from "@/lib/domain/print-kit";
import { screenName } from "@/lib/nav";

/**
 * WHEN PAPER ALREADY OUT HAS STOPPED BEING TRUE (print-kit decision D; moved whole from
 * `foursomes/page.tsx`): a group moved, a tee time changed, a code reissued after the cards and signs
 * were printed. Draws nothing when nothing is stale.
 */
export function StalePaperLine({ stageId, stale }: { stageId: string; stale: readonly { label: string }[] }) {
  if (stale.length === 0) return null;
  return (
    <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
      <Icon name="warning-circle" /> <strong>{staleSentence(stale.length)}:</strong> {stale.slice(0, 8).map((s) => s.label).join(" · ")}
      {stale.length > 8 ? ` and ${stale.length - 8} more` : ""}.{" "}
      <Link href={`/print?round=${stageId}&stale=1`}>Reprint them in the {screenName("/print")}</Link>
    </p>
  );
}
