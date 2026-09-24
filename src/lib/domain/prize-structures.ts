/**
 * PRIZE STRUCTURES — the common shapes a club puts up, as editable starting
 * points.
 *
 * The `Prize` model is a free-form list (category · detail · amount · winner),
 * which is flexible and slow: a committee retypes "Flight 1 — Winner, Flight 2
 * — Winner, …, Nearest the Pin, Longest Drive" every single medal. A structure
 * is a named set of prize LINES that populates that list in one tap, after
 * which every line is edited exactly as a hand-added one — the amounts are left
 * at zero on purpose, because what a club pays is the club's decision and a
 * default number is a wrong number for most of them.
 *
 * IT ADDS ROWS AND NOTHING ELSE. A structure never sets an amount, never names
 * a winner, and never touches how skins, a sweep or a settle-up are computed.
 * Hard rule 7 holds without it having to think about the rule: this is data
 * entry, not money movement, and a Prize row is club money that never enters a
 * player settle-up (see the `Prize` vs side-bet note in schema.prisma).
 *
 * Flight winners are the one structure that reads the event: it makes one line
 * per flight the field is ACTUALLY in, so it scales with the draw rather than
 * assuming three. Everything else is fixed text.
 */

export interface PrizeLine {
  category: string;
  detail?: string;
}

export interface PrizeStructureContext {
  /** The flight/division names the field is drawn into, in order. */
  flights: string[];
}

export interface PrizeStructure {
  key: string;
  /** The button label an organizer reads. */
  label: string;
  /** One line of help, so the structure explains what it will add. */
  blurb: string;
  /** The lines it adds, given the event's context. May be empty (e.g. flight
   *  winners on a field with no flights adds nothing rather than a bad row). */
  lines: (ctx: PrizeStructureContext) => PrizeLine[];
}

/**
 * The catalogue. Order is the order the buttons appear in.
 *
 * Kept as data so a screen renders the buttons and a test enumerates the shapes
 * from the same list — a structure added here appears in the UI and is swept by
 * the test without anybody wiring it twice.
 */
export const PRIZE_STRUCTURES: PrizeStructure[] = [
  {
    key: "overall-top-3",
    label: "Top 3 overall",
    blurb: "Winner, runner-up and third place across the whole field.",
    lines: () => [
      { category: "Winner" },
      { category: "Runner-up" },
      { category: "Third place" },
    ],
  },
  {
    key: "gross-net",
    label: "Best gross & net",
    blurb: "One prize for the lowest gross score, one for the lowest net.",
    lines: () => [
      { category: "Best gross" },
      { category: "Best net" },
    ],
  },
  {
    key: "flight-winners",
    label: "Flight winners",
    blurb: "A winner in each flight the field is drawn into.",
    lines: (ctx) => ctx.flights.map((name) => ({ category: `${name} — Winner` })),
  },
  {
    key: "twos",
    label: "Twos pot",
    blurb: "A sweep for every two made on a par 3.",
    lines: () => [{ category: "Twos", detail: "A share for every 2 made on a par 3" }],
  },
  {
    key: "specials",
    label: "Nearest the pin & longest drive",
    blurb: "The two first-tee specials, ready to name the holes.",
    lines: () => [
      { category: "Nearest the pin", detail: "Hole —" },
      { category: "Longest drive", detail: "Hole —" },
    ],
  },
];

/** Look a structure up by key. Null for an unknown key, so the caller decides
 *  what an unknown value means rather than throwing on a string somebody typed. */
export function prizeStructure(key: string): PrizeStructure | null {
  return PRIZE_STRUCTURES.find((s) => s.key === key) ?? null;
}

/**
 * The lines a structure would add for this context — the ONE place the shape is
 * resolved, so the action that writes rows and any preview a screen shows agree.
 * An unknown key resolves to no lines.
 */
export function prizeStructureLines(key: string, ctx: PrizeStructureContext): PrizeLine[] {
  const structure = prizeStructure(key);
  if (!structure) return [];
  return structure.lines(ctx).filter((line) => line.category.trim().length > 0);
}
