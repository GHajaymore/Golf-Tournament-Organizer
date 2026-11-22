"use client";
import Link from "next/link";
import FieldInfo from "@/components/FieldInfo";
import { SCORE_KEEPING, keepingShown } from "@/lib/domain/round-scoring";
import { SCORE_ENTRY_BY_LABEL } from "@/lib/tournament-settings";

/**
 * THE EVENT'S SCORING, ONCE, ABOVE THE ROUNDS (R4): who may enter scores, and who keeps the card in each round. It computes
 * nothing: the words are `keepingShown`'s (the display twin of the score gate, so the tile cannot say "one scorer per group"
 * where the committee keeps every card) and the event's own answer. The event's Change and a round's "This round only" wait
 * for R4c, which needs the event's column; until then the answer is changed where it was (Players & scoring, on Event).
 */
export interface ScoringTileRound {
  id: string;
  label: string;
  scoreKeeping: string | null;
  endCheck: string | null;
}

export function ScoringTile({ rounds, settings, canChange }: { rounds: ScoringTileRound[]; settings: { scoreEntryBy: string }; canChange: boolean }) {
  const players = settings.scoreEntryBy === "players";
  const keep = (r: ScoringTileRound) => SCORE_KEEPING.find((k) => k.key === keepingShown(settings, r))?.label ?? "";
  const lines = rounds.map((r) => ({ id: r.id, label: r.label, words: keep(r) }));
  const same = lines.length > 0 && lines.every((l) => l.words === lines[0].words);
  return (
    <section data-scoring-tile aria-label="Scoring" className="card elev-sm" style={{ minWidth: 0, gap: 8 }}>
      <span className="card-kicker">Scoring</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", minWidth: 0 }}>
        <div style={{ flex: "0 0 210px", maxWidth: "100%", minWidth: 0, fontWeight: 600 }}>
          Can players enter scores?
          <FieldInfo label="can players enter scores">
            <p>Organizers and assistants can always enter and correct scores. When players may not enter their own, the committee keeps every card, whatever a round says below.</p>
          </FieldInfo>
        </div>
        <div style={{ flex: "1 1 280px", minWidth: 0, overflowWrap: "anywhere" }}>
          {players ? SCORE_ENTRY_BY_LABEL.players : SCORE_ENTRY_BY_LABEL.staff}{" "}
          {canChange && (
            <Link href="/event" style={{ color: "var(--color-accent-200)" }}>
              Change
            </Link>
          )}
        </div>
      </div>
      {lines.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", minWidth: 0 }}>
          <div style={{ flex: "0 0 210px", maxWidth: "100%", minWidth: 0, fontWeight: 600 }}>Who keeps the card</div>
          <div style={{ flex: "1 1 280px", minWidth: 0, overflowWrap: "anywhere" }}>
            {same ? (
              <span>{lines[0].words}, every round</span>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {lines.map((l) => (
                  <li key={l.id}>
                    {l.label}: {l.words}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
