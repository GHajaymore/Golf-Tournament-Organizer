"use client";
import { useState, useTransition } from "react";
import { addCupPoint, awardCupPoint, removeCupPoint } from "@/app/actions/cup";
import { cupPoints } from "@/lib/domain/cup";
import { readDecimal } from "@/lib/domain/decimal-text";
import { ConfirmButton } from "./ConfirmButton";

/**
 * POINTS OUTSIDE THE MATCHES, kept by the organizer (2026-10-19). The first
 * real cup played fifteen matches and a sixteenth point for the lower team net
 * total; CDG won it, and the cup had nowhere to put it. Add the point when the
 * cup is set up — it counts in the total, so the target is right from the start
 * — and give it to a team when it is decided.
 */
export function CupOtherPoints({
  teams,
  points,
}: {
  teams: [{ id: string; name: string }, { id: string; name: string }];
  points: Array<{ id: string; label: string; points: number; side: "A" | "B" | null }>;
}) {
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [worth, setWorth] = useState("1");
  const [error, setError] = useState("");
  const run = (act: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) => {
    setError("");
    start(async () => {
      const res = await act();
      if (!res.ok) setError(res.error ?? "Couldn't save that.");
      else after?.();
    });
  };

  return (
    <section aria-labelledby="other-points" style={{ marginTop: 16 }}>
      <h2 id="other-points" className="card-title" style={{ fontSize: 18, margin: "0 0 4px" }}>
        Other points
      </h2>
      <p className="text-muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
        A point that isn&rsquo;t a match — the lower team net total, say. It counts in the cup&rsquo;s total as soon as it
        is added, and in a team&rsquo;s score once you give it to them.
      </p>

      {points.length > 0 && (
        <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "grid", gap: 10 }}>
          {points.map((p) => (
            <li key={p.id} className="card elev-sm" style={{ padding: "10px 12px", display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <b>
                  {p.label} · {cupPoints(p.points)} {p.points === 1 ? "point" : "points"}
                </b>
                <ConfirmButton
                  onConfirm={() => run(() => removeCupPoint(p.id))}
                  label="Remove"
                  confirmLabel={`Remove ${p.label}`}
                  title={`Remove ${p.label} from the cup`}
                  disabled={pending}
                />
              </div>
              <div role="radiogroup" aria-label={`Who has ${p.label}`} style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14 }}>
                {[
                  { key: "", name: "To be decided", side: null },
                  { key: teams[0].id, name: teams[0].name, side: "A" as const },
                  { key: teams[1].id, name: teams[1].name, side: "B" as const },
                ].map((o) => (
                  <label key={o.key || "open"} style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 44 }}>
                    <input
                      type="radio"
                      name={`cup-point-${p.id}`}
                      checked={p.side === o.side}
                      disabled={pending}
                      onChange={() => run(() => awardCupPoint(p.id, o.key))}
                    />
                    {o.name}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = pointsTyped(worth);
          if (value === null) {
            setError("A point is worth a whole or half number, like 1 or ½.");
            return;
          }
          run(() => addCupPoint(label, value), () => {
            setLabel("");
            setWorth("1");
          });
        }}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
      >
        <div className="field" style={{ flex: "1 1 200px", minWidth: 0 }}>
          <label className="field-caption" htmlFor="cup-point-label">
            Add a point
          </label>
          <input
            id="cup-point-label"
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Team net total"
            maxLength={80}
          />
        </div>
        <div className="field" style={{ width: 90 }}>
          <label className="field-caption" htmlFor="cup-point-worth">
            Worth
          </label>
          <input
            id="cup-point-worth"
            className="input"
            inputMode="decimal"
            value={worth}
            onChange={(e) => setWorth(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending || !label.trim()} style={{ minHeight: 44 }}>
          Add point
        </button>
      </form>
      {error && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * What a point is worth, as typed: blank is one point; "1", "0,5" or "0.5"
 * through the app's one reader of a typed decimal (`readDecimal`); and a cup's
 * own "½" or "1½". Null for anything else — the server refuses what is not a
 * whole or half number, and says so.
 */
export function pointsTyped(text: string): number | null {
  const typed = text.trim();
  if (typed === "") return 1;
  const half = typed.endsWith("½");
  const whole = half ? typed.slice(0, -1).trim() : typed;
  if (half && whole === "") return 0.5;
  const read = readDecimal(whole);
  if (read.kind !== "number") return null;
  return half ? read.value + 0.5 : read.value;
}
