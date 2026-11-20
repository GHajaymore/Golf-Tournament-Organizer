"use client";
import { bringIntoView } from "@/lib/bring-into-view";
import { Icon } from "./Icon";

/**
 * THE SERVER'S QUESTION BEFORE A ROUND IS CLOSED (state machine PR 4; the
 * Tournament Director's ruling, panel 8.1 Q4): a card is not approved (or, where
 * players sign, not signed) yet. Closing leaves it as it stands — it can still
 * be approved or signed afterwards. Asked in the server's own words, which name
 * whose card ("Sam Reed’s card isn’t approved yet. Close Round 2 anyway? You
 * can still approve it afterwards."), where the close was pressed.
 *
 * One component for all three doors that close a round — the dashboard's ready
 * card, its cut card and Rounds & formats — so the question reads and answers
 * the same on each.
 */
export function RoundCloseAsk({
  question,
  pending,
  onClose,
  onKeepOpen,
}: {
  question: string;
  pending: boolean;
  onClose: () => void;
  onKeepOpen: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Close the round anyway?"
      ref={bringIntoView}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-accent-700)",
        background: "color-mix(in srgb, var(--color-accent) 7%, transparent)",
      }}
    >
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        <Icon name="warning-circle" /> {question}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={onClose} style={{ minHeight: 44 }}>
          <Icon name="check-circle" /> Close anyway
        </button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={onKeepOpen} style={{ minHeight: 44 }}>
          Keep it open
        </button>
      </div>
    </div>
  );
}
