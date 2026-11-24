"use client";
import { CupTile } from "@/components/CupTile";
import { useAction } from "@/components/useAction";
import { bringIntoView } from "@/lib/bring-into-view";
import type { ScopeLock } from "@/lib/domain/tournament-status";

/**
 * THE CUP'S POINTS TO WIN AND HOLDER, ON ROUNDS & FORMATS (R4d; phase 1 Q5: they are rounds-scope settings): the one
 * `CupTile` the cup page draws while Rounds & formats is not shown, beside the event's Scoring. It adds the press and the
 * refusal (`useAction`) and nothing else: the figures, the lock and its reason are handed down by the page.
 */
export interface CupSettingsView {
  teams: [{ id: string; name: string }, { id: string; name: string }];
  pointsToWin: number;
  holder: string;
}

export function CupSettings({ cup, locks }: { cup: CupSettingsView; locks: readonly ScopeLock[] }) {
  const { pending, error, run } = useAction();
  return (
    <section data-cup-settings aria-label="The cup" style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <span className="card-kicker">The cup</span>
      {error && (
        <p role="alert" className="form-error" style={{ margin: 0 }} ref={bringIntoView}>
          {error}
        </p>
      )}
      <CupTile teams={cup.teams} pointsToWin={cup.pointsToWin} holder={cup.holder} locked={locks.length > 0} lockWhy={locks[0] ?? null} pending={pending} run={run} />
    </section>
  );
}
