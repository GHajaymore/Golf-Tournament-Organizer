"use client";
import { useState, useTransition } from "react";
import { setAttendance } from "@/app/actions/attendance";
import type { AvailabilityRound, AvailabilityView, CaptainFlight } from "@/lib/services/availability";

export type { AvailabilityRound, CaptainFlight } from "@/lib/services/availability";

/**
 * The weekly question, asked where a player already looks.
 *
 * One row per round: In / Out, the day it is played, the deadline, and — the
 * honest part — whether the current answer is theirs or just the league's
 * default. "In (by default)" and "In" are different promises, and a tee sheet
 * built on the difference deserves to show it.
 *
 * Grouped rather than listed. A twelve-week league is twelve identical rows,
 * and the one that matters is the next one; a flat list makes the reader find
 * it every time. Next round is separated and emphasised, the rest sit under
 * "Future rounds", and rounds already played collapse out of the way without
 * being thrown away — what you answered is a record, not clutter to delete.
 *
 * Dates arrive pre-formatted from the server. A round is a calendar day, and a
 * browser asked to format one is a browser that will occasionally disagree
 * about which day it is.
 *
 * The captain's section is read-only on purpose. Seeing your flight's list is
 * an appointment; changing someone's answer stays between the player and the
 * committee, so the row shows who is in without offering a way to flip anyone
 * else.
 */
export function RoundAvailability({
  playerId,
  next,
  future,
  past,
  captainOf = [],
}: {
  /** The signed-in player's entry in this tournament. */
  playerId: string;
  next: AvailabilityView["next"];
  future: AvailabilityRound[];
  past: AvailabilityRound[];
  /** Flights this player captains, across the season. */
  captainOf?: CaptainFlight[];
}) {
  const all = [...(next ? [next] : []), ...future, ...past];
  const [byStage, setByStage] = useState<Record<string, "in" | "out">>(() =>
    Object.fromEntries(all.map((r) => [r.stageId, r.status])),
  );
  const [explicitByStage, setExplicitByStage] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(all.map((r) => [r.stageId, r.explicit])),
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const answer = (stageId: string, status: "in" | "out") => {
    setError("");
    const before = byStage[stageId];
    const beforeExplicit = explicitByStage[stageId];
    setByStage((m) => ({ ...m, [stageId]: status }));
    setExplicitByStage((m) => ({ ...m, [stageId]: true }));
    startTransition(async () => {
      const res = await setAttendance(stageId, playerId, status);
      if (!res.ok) {
        setByStage((m) => ({ ...m, [stageId]: before }));
        setExplicitByStage((m) => ({ ...m, [stageId]: beforeExplicit }));
        setError(res.error ?? "Couldn't save that.");
      }
    });
  };

  if (all.length === 0 && captainOf.length === 0) return null;

  const row = (r: AvailabilityRound, emphasis: boolean) => (
    <Round
      key={r.stageId}
      round={r}
      emphasis={emphasis}
      status={byStage[r.stageId]}
      explicit={explicitByStage[r.stageId]}
      pending={pending}
      onAnswer={answer}
    />
  );

  return (
    <div className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>
          Your availability
        </span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>
          Say whether you&rsquo;re playing, round by round. You can change your answer until each
          round&rsquo;s sign-up deadline; after that the organizer makes changes.
        </p>
      </div>

      {next && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="card-kicker">Next round</span>
          {row(next, true)}
        </section>
      )}

      {future.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="card-kicker">
            Future rounds <span style={{ opacity: 0.7 }}>({future.length})</span>
          </span>
          {future.map((r) => row(r, false))}
        </section>
      )}

      {/* Collapsed, not dropped. A player who wants to check what they said
          about a week that has been and gone can still open it. */}
      {past.length > 0 && (
        <details>
          <summary
            className="card-kicker touch-target"
            style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
          >
            Earlier rounds ({past.length})
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
            {past.map((r) => row(r, false))}
          </div>
        </details>
      )}

      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      {captainOf.map((f) => (
        <div key={f.flightName} style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
          <span className="card-kicker">
            {f.flightName} (you&rsquo;re {f.deputy ? "vice-captain" : "captain"})
          </span>
          <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 8px", lineHeight: 1.5 }}>
            Who your side has available, week by week. To change someone&rsquo;s answer, ask
            the organizer &mdash; captains don&rsquo;t set other players&rsquo; availability.
          </p>
          {/* A table, because this is a grid of two variables — who, and which
              week — and any other shape makes the reader hold one of them in
              their head. It scrolls sideways rather than squeezing the names. */}
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ fontSize: 12.5, minWidth: 260 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Player</th>
                  {f.rounds.map((r) => (
                    <th key={r.stageId} style={{ textAlign: "center", whiteSpace: "nowrap" }}>{r.label}</th>
                  ))}
                  <th style={{ textAlign: "center", whiteSpace: "nowrap" }}>In</th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((r) => (
                  <tr key={r.playerId}>
                    <td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 }}>
                      {r.name}
                    </td>
                    {r.cells.map((c) => (
                      <td key={c.stageId} style={{ textAlign: "center" }}>
                        <i
                          className={c.status === "in" ? "ph ph-check-circle" : "ph ph-x-circle"}
                          style={{ color: c.status === "in" ? "var(--color-accent-2)" : "var(--color-neutral-500)" }}
                          // The distinction the whole feature turns on: "in"
                          // and "in because nobody said otherwise" are
                          // different promises, and a captain counting heads
                          // deserves to know which one they are looking at.
                          title={`${c.status === "in" ? "In" : "Out"}${c.explicit ? "" : " (by default)"}`}
                          aria-label={`${c.status === "in" ? "In" : "Out"}${c.explicit ? "" : " by default"}`}
                        />
                        {/* 10.5, not 9.5. Nothing in this app should be set
                            below ten: it is read on a phone, outdoors, by
                            people who mostly do not have young eyes. */}
                        {!c.explicit && (
                          <span className="text-muted" style={{ fontSize: 10.5, display: "block", lineHeight: 1 }}>
                            default
                          </span>
                        )}
                      </td>
                    ))}
                    <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                      {r.cells.filter((c) => c.status === "in").length}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ fontWeight: 500 }}>Available</td>
                  {f.rounds.map((r, i) => {
                    const n = f.rows.filter((x) => x.cells[i]?.status === "in").length;
                    return (
                      <td
                        key={r.stageId}
                        style={{ textAlign: "center", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}
                      >
                        {n}
                      </td>
                    );
                  })}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One round's question.
 *
 * The next round is drawn as a panel rather than a list row — an accent rule
 * down its edge and a tinted ground — because it is the only one most players
 * will answer on any given visit, and everything below it is a list they scroll
 * past.
 */
function Round({
  round: r,
  emphasis,
  status,
  explicit,
  pending,
  onAnswer,
}: {
  round: AvailabilityRound;
  emphasis: boolean;
  status: "in" | "out";
  explicit: boolean;
  pending: boolean;
  onAnswer: (stageId: string, status: "in" | "out") => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        ...(emphasis
          ? {
              padding: 12,
              borderRadius: "var(--radius-md)",
              borderLeft: "3px solid var(--color-accent)",
              background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
            }
          : {}),
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: emphasis ? 15 : 13.5, fontWeight: 600 }}>{r.label}</span>
        {/* The date, which the row never carried — "Round 7" tells a player
            nothing about whether they are free. */}
        {r.dateLabel && (
          <span style={{ fontSize: emphasis ? 14 : 13, color: "var(--color-text-muted)" }}>{r.dateLabel}</span>
        )}
        {r.whenLabel && (
          <span className="tag tag-accent" style={{ fontSize: 10.5 }}>
            {r.whenLabel}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="seg">
          <label className="seg-opt" style={{ opacity: r.locked ? 0.5 : 1 }}>
            <input
              type="radio"
              name={`avail-${r.stageId}`}
              checked={status === "in"}
              disabled={pending || r.locked}
              onChange={() => onAnswer(r.stageId, "in")}
            />
            In
          </label>
          <label className="seg-opt" style={{ opacity: r.locked ? 0.5 : 1 }}>
            <input
              type="radio"
              name={`avail-${r.stageId}`}
              checked={status === "out"}
              disabled={pending || r.locked}
              onChange={() => onAnswer(r.stageId, "out")}
            />
            Out
          </label>
        </div>
        {!explicit && (
          <span className="tag tag-neutral" style={{ fontSize: 10.5 }}>
            by default
          </span>
        )}
        <span className="text-muted" style={{ fontSize: 11.5 }}>
          {r.deadlineLabel}
        </span>
      </div>
    </div>
  );
}
