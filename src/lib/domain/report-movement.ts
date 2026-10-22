import { placeOrdinal, plural } from "../format";
import { listWords } from "./final-report";

/**
 * HOW A TOURNAMENT OF SEVERAL ROUNDS WAS WON, told from the table after each
 * round (Ajay, 2026-10-21: "leaderboard movement").
 *
 * The tables are the week sheet's (`weekViewFor` → `movementBetween`): the
 * standings after each round with what moved since the round before. Nothing
 * here ranks anybody — a place, a share of one and a climb are read off those
 * rows exactly as the week sheet prints them — so the report and the week
 * sheet cannot tell a round's story two ways.
 *
 * One sentence a round, in the plain words the owner asked for ("a number and
 * a sentence"): who led, who went top, who climbed furthest.
 */

export interface MovementRow {
  playerId: string;
  name: string;
  value: number;
  /** Place after this round, ties sharing it. */
  position: number;
  /** Places gained since the round before; negative is a drop. */
  change: number;
  /** First time in the table — not a climb from anywhere. */
  isNew: boolean;
}

export interface MovementRound {
  label: string;
  rows: ReadonlyArray<MovementRow>;
}

export interface ReportMovement {
  /** One sentence for each round, in play order. */
  story: Array<{ label: string; text: string }>;
  /** The biggest climb in any one round after the first — two places or more. */
  climb: { names: string[]; places: number; round: string; place: string } | null;
}

/** "T3" when the place is shared, "3" when it is not; "" for somebody not in the table. */
export function placeIn(rows: ReadonlyArray<MovementRow>, playerId: string): string {
  const row = rows.find((r) => r.playerId === playerId);
  if (!row || row.position <= 0) return "";
  const shared = rows.filter((r) => r.position === row.position).length > 1;
  return `${shared ? "T" : ""}${row.position}`;
}

/** "3rd", or "a share of 3rd". */
function placeWords(rows: ReadonlyArray<MovementRow>, row: MovementRow): string {
  const shared = rows.filter((r) => r.position === row.position).length > 1;
  return `${shared ? "a share of " : ""}${placeOrdinal(row.position)}`;
}

/**
 * Who, in a sentence somebody can read: the names up to three, and past that a
 * count — a dozen players level is "12 players", not a paragraph of names.
 */
export function whoWords(names: string[]): string {
  return names.length > 3 ? plural(names.length, "player") : listWords(names);
}

/** The biggest climb in one round: every player who made it, when it is two places or more. */
function biggestClimb(round: MovementRound, except: ReadonlySet<string>): MovementRow[] {
  const climbers = round.rows.filter((r) => !r.isNew && r.change >= 2 && !except.has(r.playerId));
  const most = Math.max(0, ...climbers.map((r) => r.change));
  return most >= 2 ? climbers.filter((r) => r.change === most) : [];
}

export function movementStory(
  rounds: ReadonlyArray<MovementRound>,
  /** The figure in the board's words: "49 points", "net 140", "10½ match points". */
  valueWords: (value: number) => string,
): ReportMovement {
  const story: ReportMovement["story"] = [];
  let climb: ReportMovement["climb"] = null;
  let before: MovementRound | null = null;

  for (const round of rounds) {
    const leaders = round.rows.filter((r) => r.position === 1);
    if (leaders.length === 0) {
      before = round;
      continue;
    }
    const names = whoWords(leaders.map((l) => l.name));
    const figure = valueWords(leaders[0].value);
    const parts: string[] = [];

    if (!before) {
      parts.push(
        leaders.length === 1
          ? `${names} led after ${round.label} on ${figure}.`
          : `${names} shared the lead after ${round.label} on ${figure}.`,
      );
      const nextPlace = Math.min(...round.rows.filter((r) => r.position > 1).map((r) => r.position));
      const next = Number.isFinite(nextPlace) ? round.rows.filter((r) => r.position === nextPlace) : [];
      if (next.length > 0) {
        parts.push(
          `${whoWords(next.map((n) => n.name))} ${next.length === 1 ? "was" : "were"} next on ${valueWords(next[0].value)}.`,
        );
      }
    } else {
      const wasTop = new Set(before.rows.filter((r) => r.position === 1).map((r) => r.playerId));
      const same = leaders.length === wasTop.size && leaders.every((l) => wasTop.has(l.playerId));
      if (same) {
        parts.push(
          leaders.length === 1
            ? `${names} stayed top after ${round.label}, on ${figure}.`
            : `${names} were still level at the top after ${round.label}, on ${figure}.`,
        );
      } else if (leaders.length === 1) {
        const prev = before.rows.find((r) => r.playerId === leaders[0].playerId);
        const from = prev && prev.position > 1 ? `, up from ${placeWords(before.rows, prev)}` : "";
        parts.push(`${names} went top after ${round.label} on ${figure}${from}.`);
      } else {
        parts.push(`${names} were level at the top after ${round.label}, on ${figure}.`);
      }
      const climbers = biggestClimb(round, new Set(leaders.map((l) => l.playerId)));
      if (climbers.length === 1) {
        const c = climbers[0];
        parts.push(`${c.name} climbed ${plural(c.change, "place")} to ${placeWords(round.rows, c)}.`);
      } else if (climbers.length > 1) {
        parts.push(`${whoWords(climbers.map((c) => c.name))} each climbed ${plural(climbers[0].change, "place")}.`);
      }
      // Leaders count too for the tournament's biggest move — a climb to the top is a climb.
      const all = biggestClimb(round, new Set());
      if (all.length > 0 && (!climb || all[0].change > climb.places)) {
        climb = {
          names: all.map((c) => c.name),
          places: all[0].change,
          round: round.label,
          place: all.length === 1 ? placeIn(round.rows, all[0].playerId) : "",
        };
      }
    }
    story.push({ label: round.label, text: parts.join(" ") });
    before = round;
  }
  return { story, climb };
}
