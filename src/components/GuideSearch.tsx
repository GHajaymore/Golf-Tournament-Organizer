"use client";
import { useId, useMemo, useState } from "react";
import { searchGuide, type GuideEntry } from "@/lib/guide-search";
import { Icon } from "./Icon";

/**
 * The guide's search box — see `guide-search.ts` for why it is a filter over
 * the guide's own text and not a model. Results are links to the place in the
 * guide; nothing is answered that the guide does not say.
 */
export function GuideSearch({ index }: { index: GuideEntry[] }) {
  const id = useId();
  const [q, setQ] = useState("");
  const results = useMemo(() => searchGuide(index, q), [index, q]);
  const asked = q.trim().length >= 2;

  return (
    <div className="card elev-sm" style={{ padding: "12px 14px", gap: 8, marginBottom: 12 }}>
      <label htmlFor={id} className="card-kicker" style={{ margin: 0 }}>
        Search the guide
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon name="magnifying-glass" className="text-muted" />
        <input
          id={id}
          type="search"
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="cut, waiting list, tee sheet…"
          autoComplete="off"
          style={{ flex: 1, minWidth: 0 }}
        />
      </div>
      {/* Announced, so a screen reader hears the count change as they type. */}
      <div role="status" aria-live="polite" style={{ fontSize: 13.5 }}>
        {asked && results.length === 0 && (
          <span className="text-muted">
            Nothing in the guide matches &ldquo;{q.trim()}&rdquo;. Try one word, such as &ldquo;cut&rdquo;.
          </span>
        )}
        {results.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }}>
            {results.map((r) => (
              <li key={r.anchor}>
                <a
                  href={`#${r.anchor}`}
                  style={{ display: "block", padding: "8px 6px", textDecoration: "none", color: "var(--color-text)", minHeight: 44 }}
                >
                  <span style={{ fontWeight: 600 }}>{r.heading || r.section}</span>
                  {r.heading && <span className="text-muted"> · {r.section}</span>}
                  {r.text !== r.heading && (
                    <span className="text-muted" style={{ display: "block", fontSize: 13 }}>
                      {r.text.length > 140 ? `${r.text.slice(0, 140)}…` : r.text}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
