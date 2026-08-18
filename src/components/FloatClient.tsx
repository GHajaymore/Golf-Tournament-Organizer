"use client";
import { useState, useTransition } from "react";
import { addFundLine, removeFundLine } from "@/app/actions/money-setup";
import { floatSummary, type FundLine } from "@/lib/domain/money-mode";

/**
 * The tournament's kitty.
 *
 * Fees in, prizes and the celebration out, and one question at the top: did it
 * balance, and what is left. Deliberately not a settle-up — this money has
 * already left the entrants' hands, so there is nobody to owe anybody, and a
 * "who pays whom" table here would invent debts out of a float that is simply
 * short.
 */

export interface FundRow {
  id: string;
  direction: string;
  description: string;
  amountCents: number;
  category: string;
  occurredOn: string;
  stageId: string;
  createdBy: string;
}

const money = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.abs(cents / 100).toFixed(2)}`;

/** The categories a club actually writes on the back of an envelope. */
const IN_CATEGORIES = ["entry-fee", "sponsor", "raffle", "other"];
const OUT_CATEGORIES = ["prize", "trophy", "catering", "green-fee", "other"];

export function FloatClient({
  lines,
  rounds,
  canEdit,
}: {
  lines: FundRow[];
  rounds: Array<{ id: string; label: string }>;
  canEdit: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("entry-fee");
  const [stageId, setStageId] = useState("");

  const summary = floatSummary(lines as FundLine[]);
  const inLines = lines.filter((l) => l.direction === "in");
  const outLines = lines.filter((l) => l.direction === "out");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    startTransition(async () => {
      setError("");
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        return;
      }
      after?.();
    });

  const submit = () =>
    run(
      () => addFundLine({ direction, description, amount, category, stageId }),
      () => {
        setDescription("");
        setAmount("");
      },
    );

  const roundLabel = (id: string) => rounds.find((r) => r.id === id)?.label ?? "";

  const table = (rows: FundRow[], title: string, total: number) => (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span className="card-kicker">{title} ({rows.length})</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 12.5, margin: "6px 0 0" }}>Nothing yet.</p>
      ) : (
        <div style={{ marginTop: 6 }}>
          {rows.map((l) => (
            <div
              key={l.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 0",
                borderBottom: "1px solid var(--color-divider)",
                fontSize: 13,
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block" }}>{l.description}</span>
                <span className="text-muted" style={{ fontSize: 11.5 }}>
                  {[l.category, l.occurredOn, roundLabel(l.stageId), l.createdBy && `by ${l.createdBy}`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(l.amountCents)}</span>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-icon"
                  title="Remove this line"
                  disabled={pending}
                  onClick={() => run(() => removeFundLine(l.id))}
                >
                  <i className="ph ph-trash" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <section className="card elev-sm" style={{ marginTop: 16, gap: 10 }}>
      <span className="card-title" style={{ fontSize: 15 }}>The kitty</span>
      <p className="text-muted" style={{ fontSize: 12.5, margin: "-2px 0 0", lineHeight: 1.55 }}>
        What came in and what went out. One pot belonging to the tournament — nobody owes anybody here, so
        there is no settle-up. If people need to square up between themselves, that is the split ledger
        instead.
      </p>

      {/* The answer, before the working. */}
      <div className="stat-grid" style={{ marginTop: 4 }}>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">In</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{money(summary.inCents)}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>fees and collections</div>
        </div>
        <div className="card elev-sm" style={{ gap: 2 }}>
          <span className="card-kicker">Out</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{money(summary.outCents)}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>prizes, trophies, the meal</div>
        </div>
        <div
          className="card elev-sm"
          style={{
            gap: 2,
            borderLeft: `3px solid ${summary.shortfall ? "var(--color-danger)" : "var(--color-accent-2-500)"}`,
          }}
        >
          <span className="card-kicker">{summary.shortfall ? "Short by" : "Left over"}</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>
            {money(Math.abs(summary.balanceCents))}
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {summary.shortfall ? "more went out than came in" : "still in the pot"}
          </div>
        </div>
      </div>

      {canEdit && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className={`btn ${direction === "in" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, justifyContent: "center" }}
              onClick={() => {
                setDirection("in");
                setCategory("entry-fee");
              }}
            >
              Money in
            </button>
            <button
              type="button"
              className={`btn ${direction === "out" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1, justifyContent: "center" }}
              onClick={() => {
                setDirection("out");
                setCategory("prize");
              }}
            >
              Money out
            </button>
          </div>

          <div className="pair-grid">
            <div className="field">
              <label htmlFor="f-desc">What was it for?</label>
              <input
                id="f-desc"
                className="input"
                value={description}
                placeholder={direction === "in" ? "Entry fees, 24 players" : "Winner's trophy"}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="f-amt">Amount</label>
              <input
                id="f-amt"
                className="input"
                inputMode="decimal"
                value={amount}
                placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="pair-grid">
            <div className="field">
              <label htmlFor="f-cat">Category</label>
              <select id="f-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {(direction === "in" ? IN_CATEGORIES : OUT_CATEGORIES).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-round">Round (optional)</label>
              <select id="f-round" className="input" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                <option value="">The whole tournament</option>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !description.trim() || !amount.trim()}
            onClick={submit}
            style={{ justifyContent: "center" }}
          >
            <i className="ph ph-plus" /> Record {direction === "in" ? "money in" : "money out"}
          </button>

          {error && (
            <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {error}
            </p>
          )}
        </div>
      )}

      {table(inLines, "Money in", summary.inCents)}
      {table(outLines, "Money out", summary.outCents)}
    </section>
  );
}
