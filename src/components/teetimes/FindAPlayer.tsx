"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { findAPlayer, type FindPlayer, type FindRound } from "@/lib/domain/find-a-player";
import { consoleUrl, type ConsoleMode } from "@/lib/console-url";

/**
 * FIND A PLAYER, at the head of Tee times & draw (R9a). One box; the answer drops directly under it, at
 * most three rows of 48px or more, so on a phone they sit above the keyboard. All the words and the
 * seven states are `findAPlayer`'s; this draws its answer and decides nothing. It searches what the
 * screen already loaded, so a dropped signal does not stop it. Staff only: the page does not draw it for anybody else.
 */
const ROW = {
  display: "flex",
  alignItems: "center",
  minHeight: 48,
  minWidth: 0,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-divider)",
  color: "var(--color-text)",
  background: "var(--color-surface)",
  textDecoration: "none",
  overflowWrap: "anywhere",
  fontSize: "0.9375rem",
} as const;

export function FindAPlayer({
  players,
  rounds,
  nextUnplayedId,
  previewMode,
}: {
  players: readonly FindPlayer[];
  rounds: readonly FindRound[];
  nextUnplayedId: string | null;
  /** While the screen is only previewed, its links keep the preview on (`consoleUrl`); null once it is on. */
  previewMode: ConsoleMode | null;
}) {
  const [typed, setTyped] = useState("");
  const id = useId();
  const answer = findAPlayer(typed, players, rounds, nextUnplayedId);
  const to = (href: string) => (previewMode ? consoleUrl(href, previewMode) : href);
  return (
    <div role="search" data-find-a-player="" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <label htmlFor={id} className="field-caption" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        Find a player
      </label>
      <input
        id={id}
        type="search"
        className="input"
        autoComplete="off"
        placeholder="Find a player"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        style={{ minHeight: 48, minWidth: 0, width: "100%" }}
      />
      <div aria-live="polite" data-find-state={answer.state} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        {answer.state === "short" && (
          <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
            {answer.text}
          </p>
        )}
        {answer.state === "found" && (
          <>
            {answer.rows.map((r) => (
              <Link key={r.key} href={to(r.href)} style={ROW}>
                {r.text}
              </Link>
            ))}
            {answer.more && (
              <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
                {answer.more}
              </p>
            )}
          </>
        )}
        {(answer.state === "unplaced" || answer.state === "gone" || answer.state === "nobody") && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, minWidth: 0 }}>{answer.text}</p>
            <Link href={to(answer.way.href)} style={{ ...ROW, display: "inline-flex", width: "auto" }}>
              {answer.way.says}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
