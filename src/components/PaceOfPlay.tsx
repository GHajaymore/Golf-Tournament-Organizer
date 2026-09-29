"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_PACE_MINUTES, hoursAndMinutes, OUT_OF_POSITION, paceOfPlay, type PaceRow } from "@/lib/domain/pace";
import type { PaceRound } from "@/lib/services/pace";
import { Icon } from "./Icon";

/**
 * PACE OF PLAY on the committee's dashboard, for a round being played today.
 *
 * Everything is worked out HERE, against the device's clock, because the
 * committee is at the course and their clock is the course's — see
 * `domain/pace.ts`. Rendered only after mount for the same reason: the server
 * does not know what time it is where the golf is.
 *
 * The figures move every half minute on their own; the cards behind them are
 * re-read every two minutes. It never interrupts anybody — this is a panel a
 * committee member glances at, not an alarm.
 */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const clock = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");

function statusText(r: PaceRow): string {
  switch (r.state) {
    case "not-started":
      return `Off at ${r.time}`;
    case "finished":
      return "Finished";
    case "no-scores":
      return "No scores yet";
    case "overdue":
      return r.thru ? `Cards stop at ${r.thru} — chase them` : "No cards in — chase them";
    case "on-pace":
      return "On pace";
    case "behind":
    case "out-of-position":
      return `${r.behind} min behind`;
    default:
      return "";
  }
}

export function PaceOfPlay({ rounds }: { rounds: PaceRound[] }) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 30_000);
    const reread = setInterval(() => router.refresh(), 120_000);
    return () => {
      clearInterval(tick);
      clearInterval(reread);
    };
  }, [router]);

  if (!now) return null;
  const today = rounds.filter((r) => r.playedOn === localDay(now));
  if (today.length === 0) return null;

  return (
    <>
      {today.map((round) => {
        const rows = paceOfPlay({ ...round, now });
        const late = rows.filter((r) => r.state === "out-of-position");
        const overdue = rows.filter((r) => r.state === "overdue");
        const allowed = round.paceMinutes || DEFAULT_PACE_MINUTES;
        const started = rows.some((r) => r.state !== "not-started");
        return (
          <section key={round.stageId} className="card elev-sm" style={{ marginBottom: 20, gap: 10 }} aria-labelledby={`pace-${round.stageId}`}>
            <div>
              <h2 id={`pace-${round.stageId}`} className="card-title" style={{ fontSize: 16, margin: 0 }}>
                <Icon name="clock" /> Pace of play{round.label ? ` — ${round.label}` : ""}
              </h2>
              <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
                {hoursAndMinutes(allowed)} allowed for a four-ball
                {round.holes === 9 ? ` (${hoursAndMinutes(allowed / 2)} for these nine)` : ""}. Measured from each
                group&rsquo;s tee time and the holes on its cards — a group that isn&rsquo;t entering scores
                can&rsquo;t be measured.
              </p>
            </div>
            {started && (
              <p role="status" style={{ margin: 0, fontSize: 14, fontWeight: 600, color: late.length ? "var(--color-danger)" : undefined }}>
                {late.length > 0
                  ? `${late.length} ${late.length === 1 ? "group is" : "groups are"} ${OUT_OF_POSITION}+ minutes behind: ${late.map((r) => r.name).join(", ")}.`
                  : overdue.length === 0
                    ? "Every group is within the time allowed."
                    : "Nobody on the course is behind."}
                {overdue.length > 0 &&
                  ` ${overdue.length} ${overdue.length === 1 ? "card is" : "cards are"} well overdue and short of holes: ${overdue.map((r) => r.name).join(", ")}.`}
              </p>
            )}
            <div style={{ overflowX: "auto" }}>
              <table className="table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th scope="col">Group</th>
                    <th scope="col">Off</th>
                    <th scope="col">Thru</th>
                    <th scope="col">Due in</th>
                    <th scope="col">Pace</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name}>
                      <th scope="row" style={{ fontWeight: 600 }}>{r.name}</th>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.time}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.thru || "–"}</td>
                      <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{clock(r.dueIn)}</td>
                      <td
                        style={{
                          fontWeight: r.state === "out-of-position" ? 700 : undefined,
                          color:
                            r.state === "out-of-position"
                              ? "var(--color-danger)"
                              : r.state === "on-pace" || r.state === "finished"
                                ? "var(--color-accent-2-300)"
                                : undefined,
                        }}
                      >
                        {r.state === "out-of-position" && <Icon name="warning" />} {statusText(r)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
