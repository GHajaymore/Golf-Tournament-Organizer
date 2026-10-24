import Link from "next/link";
import { REPORT_CSS } from "@/lib/report/report-styles";
import { REPORT_SHARED_WITH_PLAYERS } from "@/lib/domain/report-settings";

/**
 * WHAT A VISITOR SEES WHEN THE REPORT IS FOR THE PLAYERS (2026-10-24): one
 * plain sentence, and the way in for a player — `/play`, the round code. No
 * padlock, never "closed" or "private", and nothing about the tournament: not
 * its name, not a winner.
 */
export function ReportForPlayersOnly({ embedded = false }: { embedded?: boolean }) {
  const body = (
    <section className="fr-card" aria-labelledby="fr-players-h">
      <h1 id="fr-players-h" style={{ font: "600 1.45rem/1.25 var(--font-heading)", margin: 0 }}>
        {REPORT_SHARED_WITH_PLAYERS}
      </h1>
      <p className="fr-line">
        Playing in it? Sign in, or <Link href="/play">go to tourneyhq.club/play</Link> and enter your organizer&rsquo;s round code.
      </p>
    </section>
  );
  return (
    <div className={embedded ? "fr fr-embedded" : "fr"}>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      {embedded ? <div className="fr-page">{body}</div> : <main className="fr-page">{body}</main>}
    </div>
  );
}
