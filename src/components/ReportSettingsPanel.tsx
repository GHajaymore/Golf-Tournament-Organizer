"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { setReportSettings } from "@/app/actions/report-settings";
import {
  REPORT_AMOUNTS_CHOICES,
  REPORT_VISIBILITY_CHOICES,
  reportOpenToPublic,
  reportSettingsLine,
  type ReportAmounts,
  type ReportVisibility,
} from "@/lib/domain/report-settings";

/**
 * THE REPORT'S SETTINGS, ON THE REPORT'S OWN SCREEN (2026-10-24): one line in
 * words beside the link — "Anyone with the board link can see this report ·
 * Side-game amounts: players only" — with Change opening the two choices, and
 * "See it as the public does" for the copy a visitor is sent.
 */
export function ReportSettingsPanel({
  visibility,
  amounts,
  boardPublic,
}: {
  visibility: ReportVisibility;
  amounts: ReportAmounts;
  boardPublic: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ReportVisibility>(visibility);
  const [a, setA] = useState<ReportAmounts>(amounts);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, startTransition] = useTransition();
  const line = reportSettingsLine(boardPublic, visibility, amounts);

  return (
    <div className="no-print" style={{ display: "grid", gap: 10, maxWidth: "72ch" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 14 }} data-report-settings-line>
          {line}
        </p>
        <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Change"}
        </button>
        <Link href="/reports/final?as=public" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
          See it as the public does
        </Link>
      </div>
      {open && (
        <form
          className="card elev-sm"
          style={{ display: "grid", gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            setSaved("");
            startTransition(async () => {
              const r = await setReportSettings(v, a);
              if (r.ok) {
                setSaved("Saved.");
                setOpen(false);
              } else setError(r.error ?? "That did not save.");
            });
          }}
        >
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>Who can see the report</legend>
            {REPORT_VISIBILITY_CHOICES.map((c) => (
              <label key={c.value} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
                <input type="radio" name="report-visibility" value={c.value} checked={v === c.value} onChange={() => setV(c.value)} />
                {c.label}
              </label>
            ))}
            {!boardPublic && (
              <p className="text-muted" style={{ margin: 0, fontSize: 13.5 }}>
                The leaderboard is not public, so the report is for the players in this tournament whichever you choose:
                it is never more public than the board.
              </p>
            )}
            {!reportOpenToPublic(boardPublic, v) && (
              <p className="text-muted" style={{ margin: 0, fontSize: 13.5 }}>
                The WhatsApp and Facebook share card is off: a link shared outside the field shows no names.
              </p>
            )}
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>Side-game amounts</legend>
            {REPORT_AMOUNTS_CHOICES.map((c) => (
              <label key={c.value} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44, flexWrap: "wrap" }}>
                <input type="radio" name="report-amounts" value={c.value} checked={a === c.value} onChange={() => setA(c.value)} />
                {c.label}
                {c.caution && <span className="text-muted" style={{ fontSize: 13.5 }}>— {c.caution}</span>}
              </label>
            ))}
            <p className="text-muted" style={{ margin: 0, fontSize: 13.5 }}>
              Your copy here always has the amounts. The share card never does.
            </p>
          </fieldset>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" style={{ minHeight: 44 }} disabled={pending}>
              Save report settings
            </button>
            {error && (
              <span role="alert" style={{ color: "var(--color-danger)" }}>
                {error}
              </span>
            )}
          </div>
        </form>
      )}
      {saved && (
        <p role="status" className="text-muted" style={{ margin: 0, fontSize: 13.5 }}>
          {saved}
        </p>
      )}
    </div>
  );
}
