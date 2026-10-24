import Link from "next/link";
import type { ReactNode } from "react";
import type { NeedsYouItem, ClubJob } from "@/lib/domain/needs-you-now";
import { enterTournament } from "@/app/actions/auth";
import { Icon } from "./Icon";

/**
 * "NEEDS YOU NOW" — the organizer's to-do list, at the top of the dashboard
 * (Ajay, 2026-10-05). One line per thing to do, each with the button that
 * goes and does it; `needsYouNow` decides the lines. `children` is for a
 * thing that needs more than a line — the cut, with its preview and its
 * two-tap approval (`CutReadyCard`).
 *
 * Renders nothing when there is nothing to do: an empty to-do list is not a
 * card worth a place at the top of the screen.
 */
export function NeedsYouNow({ items, children }: { items: NeedsYouItem[]; children?: ReactNode }) {
  if (items.length === 0 && !children) return null;
  return (
    <section aria-label="Needs you now" style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {items.length > 0 && (
        <div className="card elev-sm" style={{ gap: 0, borderColor: "var(--color-accent-700)" }}>
          <span className="card-kicker" style={{ marginBottom: 4 }}>
            Needs you now
          </span>
          {items.map((item, i) => (
            <div
              // The text, not the key: a cup can list two lineups at once.
              key={item.text}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
                padding: "8px 0",
                borderTop: i === 0 ? "none" : "1px solid var(--color-divider)",
              }}
            >
              <span style={{ fontSize: 15, fontWeight: 600, minWidth: 0 }}>
                {item.key === "disputed" && (
                  <Icon name="warning-circle" style={{ color: "var(--color-danger)", marginRight: 6 }} />
                )}
                {item.text}
              </span>
              <Link href={item.href} className="btn btn-secondary" style={{ minHeight: 44 }}>
                {item.action} <Icon name="arrow-right" />
              </Link>
            </div>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * "WHAT'S NEXT" — the same list, across the club (the secretary's home,
 * 2026-10-24; `whatsNext` decides the lines). One line per job, the tournament
 * it belongs to first, and one button that goes to the screen that does it:
 * a link when the job is in the tournament already open, and otherwise a press
 * that opens that tournament on that screen (`enterTournament` with the job's
 * screen — one of `JOB_SCREENS`, and nothing else).
 *
 * NO BUTTONS FOR SOMEBODY WHO MAY NOT ACT (`mayAct`: the club's `canEdit`). A
 * Guest running one tournament reads the same lines and is handed no doors.
 *
 * Said even when empty, unlike the card above: "nothing is waiting on you" is
 * the answer to the question the home exists for.
 */
export function WhatsNext({
  jobs,
  mayAct,
  openEventId,
  children,
}: {
  jobs: ClubJob[];
  mayAct: boolean;
  openEventId: string;
  children?: ReactNode;
}) {
  return (
    <section aria-label="What's next" style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="card elev-sm" style={{ gap: 0 }}>
        <span className="card-kicker" style={{ marginBottom: 4 }}>
          What&rsquo;s next
        </span>
        {jobs.length === 0 && (
          <p className="text-muted" style={{ fontSize: 14, margin: "6px 0" }}>
            Nothing is waiting on you in the club&rsquo;s tournaments.
          </p>
        )}
        {jobs.map((job, i) => (
          <div
            key={`${job.eventId}-${job.key}`}
            data-job={job.key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
              padding: "8px 0",
              borderTop: i === 0 ? "none" : "1px solid var(--color-divider)",
            }}
          >
            <span style={{ fontSize: 15, minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{job.eventName.trim() || "Untitled tournament"}</span>
              <span className="text-muted"> · </span>
              {job.text}
            </span>
            {mayAct &&
              (job.eventId === openEventId ? (
                <Link href={job.href} className="btn btn-secondary" style={{ minHeight: 44 }}>
                  {job.action} <Icon name="arrow-right" />
                </Link>
              ) : (
                <form action={enterTournament.bind(null, job.eventId, job.href)}>
                  <button type="submit" className="btn btn-secondary" style={{ minHeight: 44 }}>
                    {job.action} <Icon name="arrow-right" />
                  </button>
                </form>
              ))}
          </div>
        ))}
      </div>
      {children}
    </section>
  );
}
