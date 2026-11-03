"use client";
import { useState, useTransition } from "react";
import { setAiBudget } from "@/app/actions/owner-ai";

/**
 * THE AI BUDGET on the owner console's AI card (Ajay, 2026-11-03: "let's set
 * the budget to $20 / month. make it configurable in owner's console").
 *
 * What this UTC month's model calls have cost, against the budget, per job,
 * and a box to change the budget. The figures are worked out on the server
 * (`services/ai-spend.ts`) and arrive here as words; this only draws them and
 * sends the box. A record and a stop: nothing here pays for anything.
 */
export function OwnerAiBudget({
  monthWords,
  spentWords,
  budgetWords,
  leftWords,
  budgetBox,
  stopped,
  jobs,
}: {
  monthWords: string;
  spentWords: string;
  budgetWords: string;
  leftWords: string;
  /** The budget as the box shows it, e.g. "20.00". */
  budgetBox: string;
  stopped: string | null;
  jobs: { job: string; line: string }[];
}) {
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState(budgetBox);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const save = () =>
    start(async () => {
      const res = await setAiBudget(typed);
      setError(res.ok ? "" : res.error || "The budget was not saved.");
      setSaved(res.ok ? "Saved." : "");
    });

  return (
    <div style={{ marginTop: 10 }}>
      <p style={{ fontSize: 13, margin: 0 }}>
        <strong>Budget</strong> · {monthWords}: {spentWords} spent of {budgetWords} · {leftWords} left
      </p>
      {stopped && (
        <p className="form-error" style={{ fontSize: 13, margin: "4px 0 0" }}>
          {stopped}
        </p>
      )}
      {jobs.length > 0 ? (
        <ul style={{ fontSize: 13, margin: "4px 0 0", paddingLeft: 18 }} aria-label="AI spend per job this month">
          {jobs.map((j) => (
            <li key={j.job}>{j.line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          No AI calls yet this month.
        </p>
      )}
      <form
        style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", fontSize: 13, gap: 2, minWidth: 0 }}>
          Monthly AI budget (US dollars)
          <input
            className="input"
            inputMode="decimal"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setSaved("");
            }}
            style={{ maxWidth: 140 }}
          />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Saving…" : "Save budget"}
        </button>
      </form>
      <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
        When the month&apos;s spend reaches the budget, every AI feature says it is off until the 1st (UTC). $0 turns AI
        off for everyone. The Anthropic console&apos;s own spend limit is a separate hard cap.
      </p>
      {error && (
        <p role="alert" className="form-error" style={{ fontSize: 13, margin: "4px 0 0" }}>
          {error}
        </p>
      )}
      {saved && (
        <p role="status" style={{ fontSize: 13, margin: "4px 0 0" }}>
          {saved}
        </p>
      )}
    </div>
  );
}
