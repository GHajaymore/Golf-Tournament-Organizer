"use client";
import type { PlayerPrize } from "@/lib/services/player-prizes";
import { usePrizeMoney } from "./usePrizeMoney";
import { Icon } from "./Icon";

/**
 * WHAT IS BEING PLAYED FOR, on the Board of somebody playing for it.
 *
 * `prizesForEntrant` has already decided who may see this — confirmed in this
 * tournament's field, nobody else — so an empty list means "nothing for you
 * here" and renders nothing. The amounts go through the committee screen's own
 * formatter, so a club's prizes read in the club's currency on both.
 */
export function PlayerPrizes({ prizes }: { prizes: PlayerPrize[] }) {
  const money = usePrizeMoney();
  if (prizes.length === 0) return null;
  return (
    <section className="card elev-sm" style={{ marginTop: 18, gap: 8 }} aria-labelledby="player-prizes-title">
      <h2 id="player-prizes-title" className="card-title" style={{ fontSize: 15, margin: 0 }}>
        <Icon name="trophy" /> Prizes
      </h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {prizes.map((p) => (
          <li
            key={p.id}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{p.category}</span>
              {p.detail && <span className="text-muted"> — {p.detail}</span>}
              {p.winner && (
                <span style={{ display: "block", fontSize: 13 }} className="text-muted">
                  Won by {p.winner}
                </span>
              )}
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{money(p.amount)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
