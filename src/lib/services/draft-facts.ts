import { loadEventState } from "@/lib/services/tournament";
import { skinsSeasonFor } from "@/lib/services/skins-pot";

/**
 * The facts a drafted message is allowed to be built from.
 *
 * This is the whole safety design of the drafting feature. A language model
 * asked to "write a recap of the club championship" will happily produce one
 * out of nothing — plausible names, plausible margins, a thrilling back nine
 * that never happened. Asked to narrate a fact sheet, it has nothing to invent
 * FROM, and the one lie it might still tell (a name nobody has) is the thing
 * checkDraft looks for afterwards.
 *
 * So the model is never told the event's name and left to remember the rest.
 * It is handed the standings, and the standings are all it gets.
 */

export interface DraftFacts {
  /** Plain text handed to the model. Human-readable on purpose — an organizer
   *  can read it and see exactly what the draft was allowed to know. */
  text: string;
  /** Every name that legitimately appears. Anything else in a draft is invented. */
  names: string[];
  eventName: string;
  /** True when there is nothing to narrate yet. */
  empty: boolean;
}

/** Two decimal places without a floating-point tail. */
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function toPar(n: number): string {
  if (n === 0) return "level";
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Assemble what is true about an event right now.
 *
 * Deliberately capped. A 120-player field listed in full would crowd out the
 * result itself and cost more per draft, and no recap names everybody — the
 * leaders, the movers and the money are what a club writes about.
 */
export async function draftFactsFor(eventId: string): Promise<DraftFacts> {
  const state = await loadEventState(eventId);
  if (!state) return { text: "", names: [], eventName: "", empty: true };

  const lines: string[] = [];
  const names = new Set<string>();
  const note = (s: string) => lines.push(s);

  note(`Event: ${state.event.name}`);
  note(`Field: ${state.confirmed.length} confirmed player${state.confirmed.length === 1 ? "" : "s"}`);

  const rounds = state.playRounds;
  if (rounds.length > 0) {
    note(
      `Rounds: ${rounds
        .map((r, i) => `${i + 1}. ${r.format} (${r.holes} holes, ${r.scoringBasis})`)
        .join("; ")}`,
    );
  }

  // Stroke and match tournaments rank on different things; say which, because
  // "leading by two" means strokes in one and holes in the other.
  if (state.isStroke && state.strokeStandings.length > 0) {
    note("");
    note("Leaderboard (stroke play, best first):");
    for (const s of state.strokeStandings.slice(0, 10)) {
      names.add(s.player.name);
      note(
        `  ${s.rank}. ${s.player.name} — gross ${s.gross}, net ${s.net}, ${toPar(s.toPar)}, through ${s.thru}`,
      );
    }
  } else if (state.overall.length > 0) {
    note("");
    note("Standings (match play points, best first):");
    for (const r of state.overall.slice(0, 10)) {
      names.add(r.player.name);
      const st = r.stats;
      note(
        `  ${r.rank}. ${r.player.name} — ${st.points} pts from ${st.played} played (${st.wins}W ${st.losses}L ${st.ties}H)`,
      );
    }
  }

  // Money is the part a club reads twice, so it goes in exactly as recorded
  // rather than being described.
  try {
    const skins = await skinsSeasonFor(eventId);
    // Season position is what a player is UP OR DOWN on the year, after the
    // stakes they put in. Passing it as "won" would be a lie by label, and the
    // model would repeat the label.
    const up = skins.filter((r) => r.netCents !== 0);
    if (up.length > 0) {
      note("");
      note("Skins, season to date (net of stakes paid in):");
      for (const r of up.slice(0, 10)) {
        names.add(r.name);
        const sign = r.netCents > 0 ? "up" : "down";
        note(
          `  ${r.name} — ${sign} ${money(Math.abs(r.netCents))} over ${r.weeksPlayed} week${r.weeksPlayed === 1 ? "" : "s"}`,
        );
      }
    }
  } catch {
    // A league without skins is the normal case, not an error worth surfacing.
  }

  const empty = names.size === 0;
  if (empty) {
    note("");
    note("No results have been entered yet.");
  }

  return {
    text: lines.join("\n"),
    names: [...names],
    eventName: state.event.name,
    empty,
  };
}
