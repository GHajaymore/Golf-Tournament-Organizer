"use client";
import { useMemo, useState, useTransition } from "react";
import { Icon } from "./Icon";
import { setOwnAttendance } from "@/app/actions/attendance";
import { TONE_STYLE, TONE_ICON, LEGEND_ORDER } from "./AvailabilityCalendar";
import {
  buildClubCalendar,
  toneFor,
  TONE_LABEL,
  WEEKDAY_INITIALS,
  type Commitment,
  type CommitmentDay,
  type DayTone,
} from "@/lib/domain/club-calendar";

/**
 * A member's whole club, on days.
 *
 * The sibling `AvailabilityCalendar` puts one league on a calendar; this puts
 * every tournament a member is in on one calendar, so "what golf have I got on
 * in June" is answered without opening each in turn. A square can hold more
 * than one thing — the Tuesday league and a member-guest share a Saturday — so
 * the calendar is the GLANCE (which days, in which tone) and the interaction
 * lives in the list beneath each month, where a comfortable row can carry a
 * tournament's name and an In/Out control that a 44px square never could.
 *
 * Colour never carries meaning alone: every commitment also gets a mark and a
 * full text label, the same promise the sibling makes, for the one man in
 * twelve who cannot split red from green and for everyone reading in the sun.
 *
 * Four states, not two. "In" and "in because nobody said otherwise" are
 * different promises — `toneFor` is the shared reading of that, and the palette
 * is `TONE_STYLE`, both borrowed from the sibling so the two calendars cannot
 * come to disagree about what a colour means.
 */
export function ClubCalendar({
  commitments,
  today,
}: {
  commitments: Commitment[];
  /** Today as yyyy-mm-dd, from the server — a phone an hour ahead would ring
   *  the wrong square. */
  today: string;
}) {
  const [byStage, setByStage] = useState<Record<string, "in" | "out">>(() =>
    Object.fromEntries(commitments.map((c) => [c.stageId, c.status])),
  );
  const [explicitByStage, setExplicitByStage] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(commitments.map((c) => [c.stageId, c.explicit])),
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
      const res = await setOwnAttendance(stageId, status);
      if (!res.ok) {
        setByStage((m) => ({ ...m, [stageId]: before }));
        setExplicitByStage((m) => ({ ...m, [stageId]: beforeExplicit }));
        setError(res.error ?? "Couldn't save that.");
      }
    });
  };

  /**
   * The live view, with this session's answers folded in.
   *
   * Rebuilt from the optimistic state rather than the props, so a toggle in the
   * list re-tones its square in the grid above in the same paint — the grid and
   * the list are two readings of one array, and cannot disagree.
   */
  const live = useMemo<Commitment[]>(
    () =>
      commitments.map((c) => ({
        ...c,
        status: byStage[c.stageId] ?? c.status,
        explicit: explicitByStage[c.stageId] ?? c.explicit,
      })),
    [commitments, byStage, explicitByStage],
  );

  const { months, undated } = useMemo(() => buildClubCalendar(live, today), [live, today]);

  const legendTones = useMemo(() => {
    const present = new Set<DayTone>();
    for (const m of months) {
      for (const week of m.weeks) {
        for (const day of week) {
          for (const c of day.commitments) present.add(toneFor(c));
        }
      }
    }
    for (const c of undated) present.add(toneFor(c));
    return LEGEND_ORDER.filter((t) => present.has(t));
  }, [months, undated]);

  if (months.length === 0 && undated.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
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
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 16 }}>{m.label}</span>
            {m.count > 0 && (
              <span className="text-muted" style={{ fontSize: 11.5 }}>
                {m.count} {m.count === 1 ? "round" : "rounds"} · in for {m.inCount}
              </span>
            )}
          </div>

          {/* The weekday strip is aria-hidden decoration — every square carries
              its own date in its accessible name. */}
          <div aria-hidden className="cal-week">
            {WEEKDAY_INITIALS.map((d, i) => (
              <div
                key={`${d}${i}`}
                className="text-muted"
                style={{ textAlign: "center", fontSize: 10.5, letterSpacing: "0.06em", paddingBottom: 2 }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* The grid is the glance, and non-interactive: a square with two
              tournaments on it has no single answer to give, so the toggles
              live in the list below rather than in a 44px box. */}
          <div role="grid" aria-label={m.label} style={{ display: "grid", gap: 4 }}>
            {m.weeks.map((week, wi) => (
              <div key={week[0]?.iso ?? wi} role="row" className="cal-week">
                {week.map((day) => (
                  <GlanceCell key={day.iso} day={day} />
                ))}
              </div>
            ))}
          </div>

          {/* The month's rounds, in date order — the actionable half. */}
          <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {monthList(m.weeks).map((c) => (
              <CommitmentRow key={c.stageId} c={c} pending={pending} onAnswer={answer} />
            ))}
          </ul>
        </section>
      ))}

      <Legend tones={legendTones} />

      {error && (
        <p className="form-error">
          <Icon name="warning-circle" /> {error}
        </p>
      )}

      {/* Rounds nobody has dated cannot go on the grid and must not vanish —
          they are the ones most likely to still need an answer. */}
      {undated.length > 0 && (
        <section style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 12 }}>
          <span className="card-kicker">Not yet dated ({undated.length})</span>
          <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {undated.map((c) => (
              <CommitmentRow key={c.stageId} c={c} pending={pending} onAnswer={answer} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Every in-month day's commitments, flattened in date order. */
function monthList(weeks: CommitmentDay[][]): Commitment[] {
  const out: Commitment[] = [];
  for (const week of weeks) {
    for (const day of week) {
      if (day.inMonth) out.push(...day.commitments);
    }
  }
  return out;
}

/**
 * One square: the day, and a dot per commitment on it.
 *
 * A day with golf shows the number and a dot for each round, toned by
 * `toneFor` — so the SHAPE of the month (which days are busy, which answered)
 * reads at a glance, and the detail waits in the list. Not a button: there is
 * nothing to toggle here when a day can hold several rounds.
 */
function GlanceCell({ day }: { day: CommitmentDay }) {
  const ring = day.isToday ? { boxShadow: "0 0 0 2px var(--color-accent)" } : {};
  const base: React.CSSProperties = {
    minHeight: 44,
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    fontSize: 12.5,
    fontVariantNumeric: "tabular-nums",
    opacity: day.inMonth ? 1 : 0.28,
    ...ring,
  };

  const commitments = day.inMonth ? day.commitments : [];
  const label =
    commitments.length === 0
      ? day.inMonth
        ? `${day.iso}, no golf`
        : undefined
      : `${day.iso}: ${commitments
          .map((c) => `${c.eventName}${c.roundLabel ? ` ${c.roundLabel}` : ""} — ${TONE_LABEL[toneFor(c)]}`)
          .join("; ")}`;

  return (
    <div
      role="gridcell"
      aria-label={label}
      style={{
        ...base,
        color: commitments.length ? "var(--color-text)" : "var(--color-text-muted)",
        background: commitments.length ? "color-mix(in srgb, var(--color-surface-2) 60%, transparent)" : "transparent",
      }}
    >
      <span style={{ fontWeight: commitments.length ? 600 : 400, lineHeight: 1 }}>{day.day}</span>
      {commitments.length > 0 && (
        <span aria-hidden style={{ display: "flex", gap: 2, lineHeight: 1 }}>
          {commitments.slice(0, 4).map((c, i) => {
            const tone = toneFor(c);
            const s = TONE_STYLE[tone];
            return (
              <span
                key={`${c.stageId}${i}`}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: s.background && s.background !== "transparent" ? s.background : (s.borderColor as string),
                  border: `1px solid ${(s.borderColor as string) ?? "var(--color-neutral-500)"}`,
                }}
              />
            );
          })}
        </span>
      )}
    </div>
  );
}

/**
 * One round in the list: which tournament, which round, when, and — where the
 * mode still allows it — an In/Out control. Everything else is a read-only pill
 * that still says which of the four states it is.
 */
function CommitmentRow({
  c,
  pending,
  onAnswer,
}: {
  c: Commitment;
  pending: boolean;
  onAnswer: (stageId: string, status: "in" | "out") => void;
}) {
  const tone = toneFor(c);
  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "8px 0",
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      {c.dateLabel && (
        <span
          className="text-muted"
          style={{ fontSize: 12, fontVariantNumeric: "tabular-nums", minWidth: 74, whiteSpace: "nowrap" }}
        >
          {c.dateLabel}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c.eventName}
        </span>
        {c.roundLabel && (
          <span className="text-muted" style={{ fontSize: 11.5 }}>
            {c.roundLabel}
          </span>
        )}
      </span>

      {c.canAnswer ? (
        <div className="seg" style={{ flexShrink: 0 }}>
          <label className="seg-opt">
            <input
              type="radio"
              name={`club-avail-${c.stageId}`}
              checked={c.status === "in"}
              disabled={pending}
              onChange={() => onAnswer(c.stageId, "in")}
            />
            In
          </label>
          <label className="seg-opt">
            <input
              type="radio"
              name={`club-avail-${c.stageId}`}
              checked={c.status === "out"}
              disabled={pending}
              onChange={() => onAnswer(c.stageId, "out")}
            />
            Out
          </label>
        </div>
      ) : (
        <span
          className="tag"
          style={{
            flexShrink: 0,
            fontSize: 11.5,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            ...TONE_STYLE[tone],
          }}
        >
          <Icon name={TONE_ICON[tone]} aria-hidden />
          {TONE_LABEL[tone]}
        </span>
      )}
    </li>
  );
}

function Legend({ tones }: { tones: DayTone[] }) {
  if (tones.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      {tones.map((tone) => (
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
            <Icon name={TONE_ICON[tone]} style={{ fontSize: 10 }} />
          </span>
          <span className="text-muted">{TONE_LABEL[tone]}</span>
        </span>
      ))}
    </div>
  );
}
