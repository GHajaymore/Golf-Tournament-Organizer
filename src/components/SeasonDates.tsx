"use client";
import { useState, useTransition } from "react";
import { dateUndatedRounds } from "@/app/actions/tournament";
import { weekdayOf, isIsoDate, shortDate, INTERVAL_OPTIONS } from "@/lib/domain/round-dates";
import { Icon } from "./Icon";

/**
 * DATE THE SEASON IN ONE GO — for a tournament whose rounds have no dates.
 *
 * Without a date a round cannot go on a player's availability calendar, so
 * they are shown a list instead — which is what the club saw on its Thursday
 * league (2026-09-19). The fix used to be opening every round and typing its
 * date. This asks two things — the first round's date and how often — and
 * dates every undated round in running order (`planSeasonDates`). Rounds that
 * already have a date are left exactly as they are.
 */
export function SeasonDates({ undated, suggestedStart }: { undated: number; suggestedStart: string }) {
  const [start, setStart] = useState(suggestedStart);
  const [every, setEvery] = useState(7);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const go = () => {
    setError("");
    setNote("");
    startTransition(async () => {
      try {
        const res = await dateUndatedRounds(start, every);
        setNote(`${res.dated} ${res.dated === 1 ? "round" : "rounds"} dated. Players now see them on their calendar.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't date the rounds.");
      }
    });
  };

  return (
    <section aria-label="Date the rounds" className="card elev-sm" style={{ marginBottom: 16, gap: 10 }}>
      <span className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="calendar-plus" /> {undated} {undated === 1 ? "round has" : "rounds have"} no date
      </span>
      <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
        A round without a day can&rsquo;t go on a player&rsquo;s availability calendar — and if none of them has
        one, players get a plain list instead. Date them all at once; rounds that already have a date are left as
        they are.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <div className="field" style={{ width: 172 }}>
          <label htmlFor="season-start">First round on</label>
          <input
            id="season-start"
            className="input"
            type="date"
            value={start}
            disabled={pending}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="field" style={{ width: 150 }}>
          <label htmlFor="season-every">How often</label>
          <select
            id="season-every"
            className="input"
            value={every}
            disabled={pending}
            onChange={(e) => setEvery(Number(e.target.value))}
          >
            {/* The cadences the round builder offers, in the club's words —
                all but "same day", which is not a season. */}
            {INTERVAL_OPTIONS.filter((o) => o.days > 0).map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" disabled={pending || !isIsoDate(start)} onClick={go} style={{ minHeight: 44 }}>
          {pending ? "Dating…" : `Date ${undated} ${undated === 1 ? "round" : "rounds"}`}
        </button>
      </div>
      {isIsoDate(start) && every === 7 && (
        <span className="text-muted" style={{ fontSize: 12.5 }}>
          Every {weekdayOf(start)}, starting {shortDate(start)}.
        </span>
      )}
      {note && (
        <p role="status" style={{ margin: 0, fontSize: 13 }}>
          {note}
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
