"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cloneEvent } from "@/app/actions/tournament";
import { Icon } from "./Icon";

/**
 * "COPY LAST EVENT" — the secretary's home (the panel's item 4, 2026-10-24).
 *
 * Most of a club's calendar is last year's calendar again, so the quickest
 * route to the next tournament is the last one, re-dated. One card: which
 * tournament (the last one, unless they pick another), what to call it, and
 * the day it is played. `cloneEvent` does the rest — its format, rounds,
 * allowances, tees policy, flights, side games, entry settings and who sees the
 * board come across; its field, cards, results, money, dates and links never
 * do — and dates the entry window and the rounds from the day picked, against
 * the club's own today.
 *
 * Offered only to somebody who may copy (`canEdit`); the page decides, and the
 * action asks again.
 */
export function CopyLastEvent({
  copyable,
  today,
}: {
  copyable: { id: string; name: string; startOn: string }[];
  /** Today at the club — the earliest day the copy may be given. */
  today: string;
}) {
  const fid = useId();
  const router = useRouter();
  const [sourceId, setSourceId] = useState(copyable[0]?.id ?? "");
  const source = copyable.find((e) => e.id === sourceId) ?? copyable[0];
  const [name, setName] = useState(source?.name ?? "");
  const [startOn, setStartOn] = useState("");
  const [endOn, setEndOn] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (!source) return null;

  const missing = !name.trim() ? "Name the copy first." : !startOn ? "Pick the day it is played." : "";

  return (
    <section aria-label="Copy last event" className="card elev-sm" style={{ marginBottom: 16, gap: 10 }}>
      <div>
        <span className="card-kicker">Copy last event</span>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
          Starts the next one from {source.name.trim() || "that tournament"}: its format, rounds, allowances, tees,
          flights, side games, entry settings and who sees the board. Never its players, cards, results, money or
          links. Its entry window and rounds move with the day you pick.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        {copyable.length > 1 && (
          <div className="field">
            <label htmlFor={`${fid}-from`}>Copy from</label>
            <select
              id={`${fid}-from`}
              className="input"
              value={sourceId}
              onChange={(e) => {
                const next = copyable.find((c) => c.id === e.target.value);
                setSourceId(e.target.value);
                if (next) setName(next.name);
              }}
            >
              {copyable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name.trim() || "Untitled tournament"}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${fid}-name`}>Name of the copy</label>
          <input
            id={`${fid}-name`}
            className="input"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${fid}-start`}>First day</label>
          <input
            id={`${fid}-start`}
            className="input"
            type="date"
            min={today}
            value={startOn}
            onChange={(e) => setStartOn(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${fid}-end`}>Last day (if more than one)</label>
          <input
            id={`${fid}-end`}
            className="input"
            type="date"
            min={startOn || today}
            value={endOn}
            onChange={(e) => setEndOn(e.target.value)}
          />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 44 }}
          disabled={pending || !!missing}
          onClick={() => {
            setError("");
            startTransition(async () => {
              const res = await cloneEvent(source.id, name, { startOn, endOn });
              if (!res.ok) {
                setError(res.error ?? "The copy could not be made.");
                return;
              }
              // `cloneEvent` opened the copy; the home is now the copy's.
              router.push("/dashboard");
              router.refresh();
            });
          }}
        >
          <Icon name="copy" /> {pending ? "Copying…" : "Create the copy"}
        </button>
        {!pending && missing && (
          <span className="text-muted" style={{ fontSize: 13 }}>
            {missing}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="form-error" style={{ margin: 0 }}>
          {error}
        </p>
      )}
    </section>
  );
}
