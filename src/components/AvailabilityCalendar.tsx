"use client";
import { useMemo } from "react";
import {
  buildAvailabilityCalendar,
  toneOf,
  TONE_LABEL,
  WEEKDAY_INITIALS,
  type CalendarDay,
  type CalendarRound,
  type DayTone,
} from "@/lib/domain/availability-calendar";

/**
 * The season on days.
 *
 * A twelve-week league is twelve identical rows in a list, and a member
 * checking them against a holiday is doing calendar arithmetic in their head.
 * Same answers, same action, on the shape the question is actually asked in.
 *
 * Colour carries the state, and never alone: every square also carries a mark
 * (a tick, a cross, a dot for an unanswered default) and a full text label for
 * a screen reader. Roughly one man in twelve cannot separate the red from the
 * green, and this is read outdoors in sun where a tint is the first thing to
 * go.
 *
 * Four states, not two. "In" and "in because nobody said otherwise" are
 * different promises — the whole feature turns on the difference — so a
 * default is drawn as an outline and a stated answer as a solid.
 */

const TONE_STYLE: Record<DayTone, React.CSSProperties> = {
  in: {
    background: "var(--color-accent-2)",
    borderColor: "var(--color-accent-2)",
    // The token the theme resolves against whichever ground is in force; a
    // literal here would be legible on one of the two and not the other.
    color: "var(--color-on-accent)",
  },
  "in-default": {
    background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)",
    borderColor: "color-mix(in srgb, var(--color-accent-2) 55%, transparent)",
    borderStyle: "dashed",
  },
  out: {
    background: "color-mix(in srgb, var(--color-danger) 22%, transparent)",
    borderColor: "var(--color-danger)",
  },
  "out-default": {
    background: "transparent",
    borderColor: "var(--color-neutral-500)",
    borderStyle: "dashed",
  },
  locked: {
    background: "color-mix(in srgb, var(--color-neutral-500) 22%, transparent)",
    borderColor: "var(--color-neutral-500)",
  },
  none: {},
};

const TONE_ICON: Record<DayTone, string> = {
  in: "ph-check-bold",
  "in-default": "ph-check",
  out: "ph-x-bold",
  "out-default": "ph-minus",
  locked: "ph-lock-simple",
  none: "",
};

export function AvailabilityCalendar({
  rounds,
  today,
  pending,
  onAnswer,
}: {
  rounds: CalendarRound[];
  /** Today as yyyy-mm-dd, resolved on the server — a browser asked which day
   *  it is will occasionally disagree with the club. */
  today: string;
  pending: boolean;
  onAnswer: (stageId: string, status: "in" | "out") => void;
}) {
  const { months, undated } = useMemo(
    () => buildAvailabilityCalendar(rounds, today),
    [rounds, today],
  );

  if (months.length === 0 && undated.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {months.map((m) => (
        <section key={m.key}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 15 }}>{m.label}</span>
            {m.roundCount > 0 && (
              <span className="text-muted" style={{ fontSize: 11.5 }}>
                {m.roundCount} {m.roundCount === 1 ? "round" : "rounds"} · in for {m.inCount}
              </span>
            )}
          </div>

          <div
            role="grid"
            aria-label={m.label}
            style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}
          >
            {WEEKDAY_INITIALS.map((d, i) => (
              <div
                key={`${d}${i}`}
                aria-hidden
                className="text-muted"
                style={{ textAlign: "center", fontSize: 10.5, letterSpacing: "0.06em", paddingBottom: 2 }}
              >
                {d}
              </div>
            ))}

            {m.weeks.flat().map((day) => (
              <Square
                key={day.iso}
                day={day}
                pending={pending}
                onAnswer={onAnswer}
              />
            ))}
          </div>
        </section>
      ))}

      <Legend />

      {/* A round nobody has dated cannot go on a grid, and dropping it would
          hide the one round most likely to need an answer. */}
      {undated.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
          <span className="card-kicker">Not yet dated ({undated.length})</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {undated.map((r) => (
              <button
                key={r.stageId}
                type="button"
                className="btn btn-secondary touch-target"
                style={{ fontSize: 12 }}
                disabled={pending || r.locked}
                onClick={() => onAnswer(r.stageId, r.status === "in" ? "out" : "in")}
                aria-label={`${r.label}: ${TONE_LABEL[toneOf({ iso: "", day: 0, inMonth: true, isToday: false, isPast: false, round: r })]}. Tap to change.`}
              >
                {r.label} · {r.status === "in" ? "In" : "Out"}
                {!r.explicit && <span className="text-muted"> (default)</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One day.
 *
 * A day with no round is not a button — there is nothing to answer, and a
 * grid of thirty tappable nothings is how a player taps the wrong one.
 */
function Square({
  day,
  pending,
  onAnswer,
}: {
  day: CalendarDay;
  pending: boolean;
  onAnswer: (stageId: string, status: "in" | "out") => void;
}) {
  const tone = toneOf(day);
  const round = day.inMonth ? day.round : null;
  const ring = day.isToday
    ? { boxShadow: "0 0 0 2px var(--color-accent)" }
    : {};

  const base: React.CSSProperties = {
    // Square-ish and never below the 44px the thumb needs, on the screen this
    // is actually used on.
    minHeight: 44,
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    fontSize: 12.5,
    fontVariantNumeric: "tabular-nums",
    opacity: day.inMonth ? 1 : 0.28,
    ...ring,
  };

  if (!round) {
    return (
      <div
        role="gridcell"
        style={{ ...base, color: "var(--color-text-muted)" }}
        aria-label={day.inMonth ? `${day.iso}, no round` : undefined}
      >
        {day.day}
      </div>
    );
  }

  const label = `${round.label}, ${day.iso}: ${TONE_LABEL[tone]}${
    round.locked ? "" : `. Tap to mark ${round.status === "in" ? "not playing" : "playing"}.`
  }`;

  return (
    <button
      type="button"
      role="gridcell"
      className="touch-target"
      disabled={pending || round.locked}
      // One tap flips the answer. A segmented In/Out inside a 44px square is
      // two targets nobody can hit; the state is unambiguous on the face of
      // the square, so the tap has only one thing it can mean.
      onClick={() => onAnswer(round.stageId, round.status === "in" ? "out" : "in")}
      aria-label={label}
      aria-pressed={round.status === "in"}
      title={label}
      style={{
        ...base,
        cursor: round.locked ? "default" : "pointer",
        ...TONE_STYLE[tone],
      }}
    >
      <span style={{ fontWeight: 600, lineHeight: 1 }}>{day.day}</span>
      <i className={`ph ${TONE_ICON[tone]}`} style={{ fontSize: 13, lineHeight: 1 }} aria-hidden />
    </button>
  );
}

function Legend() {
  const items: DayTone[] = ["in", "in-default", "out", "out-default", "locked"];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      {items.map((tone) => (
        <span key={tone} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5 }}>
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: 5,
              border: "1px solid transparent",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              ...TONE_STYLE[tone],
            }}
          >
            <i className={`ph ${TONE_ICON[tone]}`} style={{ fontSize: 10 }} />
          </span>
          <span className="text-muted">{TONE_LABEL[tone]}</span>
        </span>
      ))}
    </div>
  );
}
