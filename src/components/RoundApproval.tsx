"use client";
import { useMemo, useTransition, useState } from "react";
import { approveRound, approveScorecard, reopenScorecard } from "@/app/actions/tournament";
import {
  reviewCards,
  approvalSummary,
  EXCEPTION_LABEL,
  type CardForReview,
} from "@/lib/domain/card-approval";
import { RuleCite } from "./RuleCite";

/**
 * The committee's step: accepting a round's cards.
 *
 * Built so the fast path stays fast and the exceptions stay visible. One
 * control approves everything that is clean; everything that is not is listed
 * underneath by name and reason, and cannot be included in that action — the
 * server recomputes the split rather than trusting anything sent from here,
 * so this list is a description of what will happen, not the instruction.
 *
 * The count that will be left behind is stated on the button's own line. That
 * is the whole anti-rubber-stamp design: approving is meant to be a decision,
 * and a decision needs both numbers in front of it.
 */
export function RoundApproval({
  stageId,
  cards,
  isAdmin,
}: {
  stageId: string;
  cards: CardForReview[];
  /** Reopening an approved card is the organizer's, not an assistant's. */
  isAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  const review = useMemo(() => reviewCards(cards), [cards]);
  const summary = approvalSummary(review);

  if (cards.length === 0) return null;

  const approveAll = () =>
    startTransition(async () => {
      const r = await approveRound(stageId);
      setNote(
        r.exceptions.length
          ? `Approved ${r.approved}. ${r.exceptions.length} still need attention.`
          : `Approved ${r.approved}.`,
      );
    });

  return (
    <div className="card elev-sm" style={{ marginTop: 16 }}>
      <span className="card-title" style={{ fontSize: 15 }}>Approve this round</span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: "-2px 0 4px", lineHeight: 1.5 }}>
        Cards are certified by the marker and the player, then accepted here. Only accepted cards are results.
      </p>
      <p style={{ margin: "0 0 12px" }}>
        <RuleCite rule="scorecardCertification" />
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || review.ready.length === 0}
          onClick={approveAll}
        >
          <i className="ph ph-check-circle" />{" "}
          {pending ? "Approving…" : `Approve ${review.ready.length} clean ${review.ready.length === 1 ? "card" : "cards"}`}
        </button>
        <span style={{ fontSize: 12.5, color: "var(--color-neutral-400)" }}>{summary}</span>
      </div>

      {note && (
        <p style={{ fontSize: 12.5, margin: "10px 0 0", color: "var(--color-accent-2-300)" }}>
          <i className="ph ph-check" /> {note}
        </p>
      )}

      {review.exceptions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-neutral-400)",
              marginBottom: 8,
            }}
          >
            Needs attention
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {review.exceptions.map((e) => (
              <div
                key={e.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  paddingTop: 8,
                  borderTop: "1px solid var(--color-divider)",
                }}
              >
                <span style={{ flex: 1, minWidth: 150, fontSize: 14 }}>
                  {e.playerName}
                  <span style={{ display: "block", fontSize: 12, color: "var(--color-neutral-400)" }}>
                    {EXCEPTION_LABEL[e.reason]}
                    {e.reason === "incomplete" && ` — ${e.filled} of ${e.holes}`}
                  </span>
                </span>

                {/* Approving an exception is deliberately one card at a time,
                    named, and never part of the blanket action. */}
                {e.reason !== "already-approved" && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await approveScorecard(stageId, e.playerId);
                        setNote(`Approved ${e.playerName}'s card individually.`);
                      })
                    }
                    style={{ fontSize: 12 }}
                  >
                    Approve anyway
                  </button>
                )}
                {e.reason === "already-approved" && isAdmin && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await reopenScorecard(stageId, e.playerId);
                        setNote(`Reopened ${e.playerName}'s card.`);
                      })
                    }
                    style={{ fontSize: 12 }}
                  >
                    Reopen
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
