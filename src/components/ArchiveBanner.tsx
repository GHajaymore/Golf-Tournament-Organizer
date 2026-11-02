import Link from "next/link";
import { Icon } from "./Icon";

/**
 * A LAPSED CLUB'S TOURNAMENT IS A READ-ONLY ARCHIVE — said across the top of
 * every console and player screen of it (2026-10-21, `domain/club-archive.ts`).
 *
 * The same sentence the actions refuse with (`archiveRefusalFor`), so the
 * screen and the refusal cannot disagree; it is on the screen before anybody
 * presses anything, which is where a refusal that a production build would
 * blank still has its words. `role="status"`, not an alert: nothing is wrong
 * with the golf, and nobody is in danger.
 */
export function ArchiveBanner({ sentence, resubscribe }: { sentence: string | null; resubscribe: boolean }) {
  if (!sentence) return null;
  return (
    <div
      role="status"
      data-archive-banner=""
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "12px 14px",
        marginBottom: 14,
        borderRadius: 10,
        background: "var(--color-surface-2)",
        border: "2px solid var(--color-warning)",
        color: "var(--color-text)",
        lineHeight: 1.5,
      }}
    >
      <Icon name="clock-countdown" style={{ fontSize: 20, flex: "none", marginTop: 2 }} />
      <div style={{ minWidth: 0, fontSize: 14 }}>
        <strong style={{ display: "block", fontSize: 15, marginBottom: 2 }}>Read-only</strong>
        {sentence}
        {resubscribe && (
          <>
            {" "}
            <Link href="/organization#plan">Go to Your plan</Link>
          </>
        )}
      </div>
    </div>
  );
}
