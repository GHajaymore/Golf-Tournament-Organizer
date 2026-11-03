"use client";
import { useState, useTransition } from "react";
import { checkAiAccount } from "@/app/actions/owner-ai";
import type { AiCheckLine } from "@/lib/domain/ai-check";

/**
 * CHECK AI, on the owner console's AI card (2026-11-03). One press sends each
 * AI job one tiny real request and says, per job, OK with the model and the
 * time it took, or the API's own error. The check to run after any swap of
 * account (`docs/ai-account.md`). Never shows the key.
 */
export function OwnerAiCheck() {
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<AiCheckLine[] | null>(null);
  const [error, setError] = useState("");

  const press = () =>
    start(async () => {
      const res = await checkAiAccount();
      setError(res.ok ? "" : res.error || "The check did not run.");
      setLines(res.ok ? res.lines ?? [] : null);
    });

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 13, margin: "0 0 6px" }}>Sends each AI job one tiny real request.</p>
      <button type="button" className="btn btn-secondary" disabled={pending} onClick={press}>
        {pending ? "Checking…" : "Check AI"}
      </button>
      {error && (
        <p role="alert" className="form-error" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {error}
        </p>
      )}
      {lines && (
        <ul role="status" style={{ fontSize: 13, margin: "8px 0 0", paddingLeft: 18 }}>
          {lines.map((l) => (
            <li key={l.job} style={{ overflowWrap: "anywhere" }}>
              <strong>{l.words}</strong>:{" "}
              {l.ok
                ? `OK · ${l.model} · ${l.ms} ms`
                : `${l.status ? `${l.status} · ` : ""}${l.error}${l.model ? ` · ${l.model}` : ""}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
