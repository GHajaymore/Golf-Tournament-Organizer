"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmMatches } from "@/app/actions/tournament";
import { Icon } from "./Icon";

/**
 * SIGN OFF ONE FINISHED MATCH (2026-10-20) — for a round kept by tapping who
 * won each hole, whose Score entry shows the tap card and nothing else.
 *
 * Found on the first real cup: two four-balls corrected the day after sat
 * "Awaiting approval", and the Dashboard would neither close the round nor
 * complete the tournament until they were signed off — while the one screen
 * its "Review" link opens had no way to sign them off. The singles beside them
 * (kept on stroke cards) had "Confirm result" all along. Same action, same
 * rule (`confirmMatches`: staff only, this tournament's matches, only what is
 * genuinely waiting), now on both.
 *
 * Not optimistic, as the stroke panel's `doConfirm` is not: the screen says
 * "Confirmed" only after the server has, and a refusal is said here, where
 * the press was.
 */
export function ConfirmMatchResult({ matchId, result }: { matchId: string; result: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const confirm = () =>
    start(async () => {
      setSaid(null);
      const r = await confirmMatches([matchId]);
      if (!r.ok) {
        setSaid({ ok: false, text: r.error ?? "The result wasn't signed off. Try again." });
        return;
      }
      setSaid(
        r.confirmed > 0
          ? { ok: true, text: "Confirmed." }
          : { ok: true, text: "Already signed off — nothing left to confirm here." },
      );
      router.refresh();
    });

  return (
    <div className="card elev-sm" role="group" aria-label="Sign off this result" style={{ marginTop: 12 }}>
      <p style={{ margin: 0, fontWeight: 600 }}>Awaiting approval: {result}</p>
      <p className="text-muted" style={{ margin: "4px 0 10px", fontSize: 13.5 }}>
        The match is finished. Confirm the result to make it official, or correct the holes above first.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={confirm} style={{ minHeight: 44 }}>
          <Icon name="check" /> {pending ? "Confirming…" : "Confirm result"}
        </button>
        {said && (
          <span role={said.ok ? "status" : "alert"} style={{ fontSize: 13.5, color: said.ok ? "var(--color-text)" : "var(--color-danger)" }}>
            {said.text}
          </span>
        )}
      </div>
    </div>
  );
}
