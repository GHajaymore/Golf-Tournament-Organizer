import type { BracketMatch, BracketView } from "./bracket";

/**
 * WHERE I AM IN THE DRAW — the knockout player's version of "who am I playing".
 *
 * `MyRound.matches` answers that question from `Match` rows, and a bracket
 * stage files none: a knockout's results are `BracketWinner` rows keyed by
 * slot (CLAUDE.md, "which table this round files its result in"). So a member
 * of the seeded Summer Knockout, one tie from the final, opened Today on
 * 2026-09-26 and read "your score is recorded against your opponent" — with
 * no opponent named anywhere in the player app, and no draw on its board.
 *
 * Read from the draw the console shows, so the two cannot disagree about who
 * plays whom.
 */
export interface MyTie {
  /** Which draw, when there are two ("Plate", "Consolation"); "" when one. */
  draw: string;
  /** The round of the draw, as the bracket labels it — "Semi-finals". */
  round: string;
  state: "to-play" | "out" | "champion";
  /**
   * Who it is against, or who beat me. "" when the other seat is not decided
   * yet — then `waitingOn` says which tie decides it.
   */
  opponent: string;
  /** "the winner of A v B", when the other seat is still to be decided. */
  waitingOn: string;
  /** The result as the organizer recorded it ("3&2"), when there is one. */
  result: string;
  /** The tie's key in the draw — what a report of its result is filed under. */
  key: string;
  /** Who it is against, by Player id; "" when that seat is not decided. */
  opponentId: string;
}

/**
 * The event's draws as a list, each with its name — the second only where
 * the mode has one (`secondLabel` is "" for a single bracket, and its empty
 * consolation view must not be searched as if it were a draw).
 */
export function bracketDraws(b: {
  winners: BracketView;
  consolation: BracketView;
  mainLabel?: string;
  secondLabel?: string;
}): { label: string; view: BracketView }[] {
  const second = b.secondLabel ?? "";
  if (!second) return [{ label: "", view: b.winners }];
  return [
    { label: b.mainLabel ?? "", view: b.winners },
    { label: second, view: b.consolation },
  ];
}

/** Whether a draw has anybody in it yet — an undrawn bracket is all "TBD". */
export function isDrawn(view: BracketView): boolean {
  return view.rounds.some((r) => r.matches.some((m) => m.a.playerId !== null || m.b.playerId !== null));
}

/** The draws worth showing a member: the mode's draws that hold somebody. */
export function drawnDraws(b: Parameters<typeof bracketDraws>[0]): { label: string; view: BracketView }[] {
  return bracketDraws(b).filter((d) => isDrawn(d.view));
}

function hasPlayer(m: BracketMatch, playerId: string): boolean {
  return m.a.playerId === playerId || m.b.playerId === playerId;
}

/**
 * The tie a player is in, across every draw handed in, or null when they are
 * in none of them (not drawn, or the bracket has not been drawn yet).
 *
 * Their LATEST tie decides it: a bracket advances a winner into the next round
 * the moment a result is recorded, so the furthest round they appear in is the
 * one they are playing — or the one they went out in.
 */
export function myTie(
  draws: { label: string; view: BracketView }[],
  playerId: string,
  results: Record<string, string> = {},
): MyTie | null {
  if (!playerId) return null;
  for (const { label, view } of draws) {
    let latest: BracketMatch | null = null;
    for (const rd of view.rounds) {
      for (const m of rd.matches) {
        if (hasPlayer(m, playerId) && (!latest || m.roundIndex > latest.roundIndex)) latest = m;
      }
    }
    if (!latest) continue;
    const round = view.rounds[latest.roundIndex];
    const mine = latest.a.playerId === playerId ? "a" : "b";
    const other = mine === "a" ? latest.b : latest.a;
    const base = {
      draw: label,
      round: round?.label ?? "",
      result: results[latest.key] ?? "",
      key: latest.key,
      opponentId: other.playerId ?? "",
    };

    if (view.champion?.playerId === playerId) {
      return { ...base, state: "champion", opponent: other.playerId ? other.name : "", waitingOn: "" };
    }
    // A winner always appears in the next round, so `latest` is only ever a
    // tie they won when it is the final — and that is the champion, above.
    // The second clause is a guard against a draw built some other way.
    if (latest.winnerId && latest.winnerId !== playerId) {
      return { ...base, state: "out", opponent: other.name, waitingOn: "" };
    }
    // Still to play. The other seat is either a name or the tie that fills it.
    let waitingOn = "";
    if (!other.playerId && latest.roundIndex > 0) {
      const prev = view.rounds[latest.roundIndex - 1]?.matches ?? [];
      const feeder = prev[latest.matchIndex * 2 + (mine === "a" ? 1 : 0)];
      if (feeder && feeder.a.playerId && feeder.b.playerId) {
        waitingOn = `the winner of ${feeder.a.name} v ${feeder.b.name}`;
      }
    }
    return { ...base, state: "to-play", opponent: other.playerId ? other.name : "", waitingOn };
  }
  return null;
}

/** The tie with this key, in whichever draw holds it, or null. */
export function tieByKey(
  draws: { label: string; view: BracketView }[],
  key: string,
): { draw: string; round: string; match: BracketMatch } | null {
  for (const { label, view } of draws) {
    for (const rd of view.rounds) {
      const match = rd.matches.find((m) => m.key === key);
      if (match) return { draw: label, round: rd.label, match };
    }
  }
  return null;
}

/**
 * WHY A PLAYER'S KNOCKOUT REPORT IS REFUSED, or null when it may be filed
 * (Ajay, 2026-09-28: "player may enter it but organizer/club needs to approve
 * it").
 *
 * A report is only ever a request — staff approve it before the draw moves —
 * but it still names a winner in front of the organizer, so it must come from
 * one of the two players in the tie, name one of those two, and be for a tie
 * that is actually waiting on a result.
 */
export function tieReportRefusal(input: {
  tie: { match: BracketMatch } | null;
  /** The reporter's Player rows in this event. */
  reporterIds: ReadonlySet<string>;
  winnerId: string;
}): string | null {
  const m = input.tie?.match;
  if (!m) return "That tie isn't in the draw.";
  if (!m.a.playerId || !m.b.playerId) return "Both players in that tie aren't known yet.";
  if (!input.reporterIds.has(m.a.playerId) && !input.reporterIds.has(m.b.playerId)) {
    return "You can only report a tie you are playing in.";
  }
  if (input.winnerId !== m.a.playerId && input.winnerId !== m.b.playerId) {
    return "Choose who won the tie.";
  }
  if (m.winnerId) return "That tie already has a result. Ask the organizer if it needs changing.";
  return null;
}

/**
 * A REPORTED TIE THAT STILL NEEDS AN ANSWER, named off the draw — or null when
 * the draw has moved on: the tie is gone, already has a result, or no longer
 * holds the reported winner.
 *
 * The one reader of that question. The dashboard's review count and the
 * Bracket screen's list both go through it, so the number and the list beneath
 * it cannot disagree about what is waiting.
 */
export function openTieReport(
  draws: { label: string; view: BracketView }[],
  report: { key: string; winnerId: string },
): { round: string; a: string; b: string; winner: string } | null {
  const tie = tieByKey(draws, report.key);
  const m = tie?.match;
  if (!tie || !m || m.winnerId) return null;
  const winner =
    m.a.playerId === report.winnerId ? m.a.name : m.b.playerId === report.winnerId ? m.b.name : "";
  if (!winner) return null;
  return { round: tie.draw ? `${tie.draw} · ${tie.round}` : tie.round, a: m.a.name, b: m.b.name, winner };
}

/**
 * What a player reads about a report waiting on the organizer — theirs or
 * their opponent's. Nobody is named to themselves in the third person:
 * "You won 3&2 — you reported it", "Bernadette won 3&2 — Bernadette reported it".
 */
export function tieReportSentence(r: { winnerName: string; result: string; reportedBy: string; byMe: boolean }): string {
  const winner = r.winnerName || "Your opponent";
  const margin = r.result ? ` ${r.result}` : "";
  const by = r.byMe ? "you reported it" : `${r.reportedBy || "your opponent"} reported it`;
  return `${winner} won${margin} — ${by}.`;
}

/**
 * The bracket labels a round by its column ("Semifinals"); one player is in
 * one tie of it ("Semifinal").
 */
function oneTie(round: string): string {
  return round.replace(/finals$/, "final");
}

/** One line a player can read: "Semifinal v Toby Marchetti". */
export function myTieLine(t: MyTie): string {
  const round = oneTie(t.round);
  const draw = t.draw ? ` (${t.draw})` : "";
  if (t.state === "champion") return `Champion${draw}`;
  if (t.state === "out") {
    // "19th" is a hole, not a margin: a tie settled on extra holes was lost
    // AT the 19th, where "3&2" and "1 up" are margins and read as they stand.
    const score = !t.result ? "" : /^\d+(st|nd|rd|th)$/i.test(t.result.trim()) ? ` at the ${t.result.trim()}` : ` ${t.result}`;
    if (round === "Final") return `Runner-up${draw} · lost the final to ${t.opponent}${score}`;
    return `Out in the ${round.toLowerCase()}${draw} · lost to ${t.opponent}${score}`;
  }
  if (t.opponent) return `${round}${draw} v ${t.opponent}`;
  if (t.waitingOn) return `${round}${draw} v ${t.waitingOn}`;
  return `${round}${draw} · opponent to be decided`;
}
