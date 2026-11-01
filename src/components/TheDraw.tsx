import type { BracketView } from "@/lib/domain";
import { BracketDrawing } from "./BracketClient";
import type { PlayBy } from "@/lib/domain/knockout-play-by";

/**
 * A knockout's draw, read-only, for the people playing in it and following
 * it — the player's Board and the club's public share link. The console has
 * its own screen for running the draw; this is the one for reading it. Both
 * draw with `BracketDrawing`, the one drawing every surface uses.
 */
export function TheDraw({
  draws,
  results,
  me = "",
}: {
  /** Each draw, whether it was seeded, and its rounds' play-by dates (`roundPlayBy`). */
  draws: { label: string; view: BracketView; seeded: boolean; playBy?: Record<number, PlayBy> }[];
  results: Record<string, string>;
  /** The signed-in player, on the player app: their section opens and they are marked "You". */
  me?: string;
}) {
  return (
    <section style={{ marginTop: 24 }} aria-labelledby="the-draw">
      <h2 id="the-draw" style={{ fontFamily: "var(--font-heading)", fontSize: 18, margin: 0 }}>
        The draw
      </h2>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, lineHeight: 1.55, color: "var(--color-neutral-400)" }}>
        Winners go through as the organizer records each result. Scroll sideways for the later rounds.
      </p>
      {draws.map((d, i) => (
        <div key={d.label || "main"} style={{ marginTop: 12 }}>
          {d.label && (
            <div
              style={{
                fontSize: 13,
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
          <BracketDrawing
            view={d.view}
            results={results}
            readOnly
            seeded={d.seeded}
            me={me}
            param={i === 0 ? "section" : `section-${d.view.kind}`}
            name={draws.length > 1 ? d.label : ""}
            playBy={d.playBy}
          />
        </div>
      ))}
    </section>
  );
}
