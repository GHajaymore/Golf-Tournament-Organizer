import type { BracketView } from "@/lib/domain";
import { BracketBoard } from "./BracketClient";

/**
 * A knockout's draw, read-only, for the people playing in it and following
 * it — the player's Board and the club's public share link. The console has
 * its own screen for running the draw; this is the one for reading it.
 */
export function TheDraw({
  draws,
  results,
}: {
  draws: { label: string; view: BracketView }[];
  results: Record<string, string>;
}) {
  return (
    <section style={{ marginTop: 24 }} aria-labelledby="the-draw">
      <h2 id="the-draw" style={{ fontFamily: "var(--font-heading)", fontSize: 18, margin: 0 }}>
        The draw
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--color-neutral-400)" }}>
        Winners go through as the organizer records each result. Scroll sideways for the later rounds.
      </p>
      {draws.map((d) => (
        <div key={d.label || "main"} style={{ marginTop: 12 }}>
          {d.label && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.09em",
                textTransform: "uppercase",
                color: "var(--color-neutral-400)",
                marginBottom: 6,
              }}
            >
              {d.label}
            </div>
          )}
          <BracketBoard view={d.view} results={results} readOnly />
        </div>
      ))}
    </section>
  );
}
