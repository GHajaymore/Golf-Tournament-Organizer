import Link from "next/link";
import { Icon } from "@/components/Icon";

/**
 * "THE CUT IS WAITING ON A TIE" (R9a, moved whole from `foursomes/page.tsx`): until the committee
 * records the play-off or the draw for the last place, the cut into this round cannot be made, so the
 * sheet is still the whole field. The sentence is `page.tsx`'s own (`cutTieRefusal`); this only draws it.
 */
export function CutWaitingCard({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div role="status" className="card elev-sm" style={{ marginBottom: 16, borderLeft: "3px solid var(--color-accent)", gap: 6 }}>
      <span className="card-title" style={{ fontSize: 14 }}>
        <Icon name="warning-circle" /> The cut is waiting on a tie
      </span>
      <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
        {text} <Link href="/dashboard">Go to the cut card</Link>
      </p>
    </div>
  );
}
