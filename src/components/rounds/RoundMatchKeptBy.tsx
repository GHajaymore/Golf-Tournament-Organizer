"use client";
import { MATCH_KEPT_BY, keptByScoreInput, matchKeptBy } from "@/lib/domain/match-kept-by";
import FieldInfo from "@/components/FieldInfo";
import type { RoundCtx } from "./use-round-ctx";

export function RoundMatchKeptBy({ ctx }: { ctx: RoundCtx }) {
  const { stage, locked, scoreInput, format, pending, keptBy, keptByRefusal, commitKeptBy } = ctx;
  return (
    <>
{/* HOW PLAYERS KEEP THEIR MATCHES (Ajay, 2026-10-19: "provide both
                options for organizer to decide while setting up the
                tournament"). Only on a round with matches whose format does
                not already carry the choice above — Match Play and Nassau ask
                it as "How scores are recorded", and one choice never gets two
                controls. */}
            {(() => {
              const kept = matchKeptBy({ type: stage.type, format, scoreInput, matchKeptBy: keptBy });
              if (kept === null || keptByScoreInput(format)) return null;
              return (
                <div className="field" style={{ maxWidth: 420, width: "100%" }}>
                  <span className="field-caption">
                    How players keep their matches
                    <FieldInfo label="how players keep their matches">
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {MATCH_KEPT_BY.map((m) => (
                          <li key={m.key}>
                            <b>{m.label}</b> — {m.detail}
                          </li>
                        ))}
                      </ul>
                      <p>
                        A round is kept one way, so choose before anyone scores: once a match has a
                        score the choice stays as it is.
                      </p>
                    </FieldInfo>
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {MATCH_KEPT_BY.map((m) => (
                      <label key={m.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                        <input
                          type="radio"
                          name={`match-kept-by-${stage.id}`}
                          checked={kept === m.key}
                          disabled={pending || locked}
                          onChange={() => commitKeptBy(m.key)}
                          style={{ marginTop: 3 }}
                        />
                        <span>{m.label}</span>
                      </label>
                    ))}
                  </div>
                  {keptByRefusal && (
                    <p role="alert" style={{ margin: "6px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
                      {keptByRefusal}
                    </p>
                  )}
                </div>
              );
            })()}
    </>
  );
}
