"use client";

import { useEffect, useState } from "react";
import type { RecentChange } from "@/lib/services/recent-changes";

/**
 * "RECENT CHANGES" — the tournament's audit log, on screen (Ajay, 2026-09-27).
 *
 * The rows come from `recentChanges`. A client component only for the TIME:
 * the server has no idea what zone the organizer is in, so the time is written
 * in UTC for the first paint and in the viewer's own zone once the page is
 * running — the same two-step `ScoreEntryClient` uses, because rendering a
 * local time on the server is a hydration error for a few hours around every
 * midnight (#629).
 */
export function RecentChanges({
  rows,
  title,
  empty,
  locale,
  showKind = true,
}: {
  rows: RecentChange[];
  title: string;
  /** What to say when there is nothing yet — in the words of the screen it is on. */
  empty: string;
  locale: string;
  showKind?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      ...(mounted ? {} : { timeZone: "UTC" }),
    });

  return (
    <section className="card elev-sm" aria-label={title} style={{ gap: 8 }}>
      <span className="card-title" style={{ fontSize: 15 }}>
        {title}
      </span>
      {rows.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          {empty}
        </p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>{r.what}</span>
              <span className="text-muted" style={{ fontSize: 13 }}>
                {[when(r.at), r.actor, showKind ? r.kind : ""].filter(Boolean).join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
