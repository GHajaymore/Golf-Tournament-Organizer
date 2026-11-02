/**
 * THE REPORT'S SETTINGS AND A PLAYER'S PUBLIC NAME (2026-10-24; the owner
 * approved what the panel agreed, with its amendments).
 *
 *   who can open the report     "board" — anyone with the board's link (the
 *                               default); "players" — the players in this
 *                               tournament. NEVER MORE PUBLIC THAN THE BOARD:
 *                               a board that is not public makes the report
 *                               players-only, whatever this says.
 *   who sees side-game amounts  "players" — the field and the organizer; the
 *                               public sees the winners (the default, and the
 *                               rule before this setting); "none" — winners
 *                               only for everybody but the organizer, whose
 *                               copy is the record; "everyone" — on the public
 *                               link too. The SHARE CARD never carries an
 *                               amount, whatever this says: it has no field
 *                               for one (`report-card.ts`).
 *   a player's name             "Don't show my name on public pages", on the
 *                               player's entry: signed out — the public board,
 *                               the public report, a share card — they are
 *                               "Player (name withheld)"; the field and the
 *                               staff see the name. `publicName` is the one
 *                               reader of it, and `withholdNames` the one way
 *                               a public surface applies it.
 *
 * There is no handicap switch: the panel dropped it (gross minus net shows the
 * handicap anyway, and hiding it would make a net countback uncheckable).
 *
 * Pure, so it is tested by hand.
 */

export const REPORT_VISIBILITY = ["board", "players"] as const;
export type ReportVisibility = (typeof REPORT_VISIBILITY)[number];
export const REPORT_AMOUNTS = ["players", "none", "everyone"] as const;
export type ReportAmounts = (typeof REPORT_AMOUNTS)[number];

/** A stored value, read safely: anything unknown is the default — the less public answer. */
export function reportVisibilityOf(v: string | null | undefined): ReportVisibility {
  return v === "players" ? "players" : "board";
}
export function reportAmountsOf(v: string | null | undefined): ReportAmounts {
  return v === "none" || v === "everyone" ? v : "players";
}

/** May somebody who is not in the field open the report? Never when the board itself is not public. */
export function reportOpenToPublic(boardPublic: boolean, visibility: string | null | undefined): boolean {
  return boardPublic && reportVisibilityOf(visibility) === "board";
}

/**
 * WHO SEES AN AMOUNT — the rule `showsAmounts` asks at the sink. The
 * organizer's copy always carries them: it is the record the club settles from.
 */
export function amountsShownTo(audience: "staff" | "player" | "public", setting: string | null | undefined): boolean {
  if (audience === "staff") return true;
  const s = reportAmountsOf(setting);
  if (audience === "player") return s !== "none";
  return s === "everyone";
}

/** The choices, worded by what the PUBLIC sees — the owner's ruling. */
export const REPORT_VISIBILITY_CHOICES: ReadonlyArray<{ value: ReportVisibility; label: string }> = [
  { value: "board", label: "Anyone with the board link" },
  { value: "players", label: "Players in this tournament" },
];
export const REPORT_AMOUNTS_CHOICES: ReadonlyArray<{ value: ReportAmounts; label: string; caution: string }> = [
  { value: "players", label: "Only players see amounts; the public sees the winners", caution: "" },
  { value: "none", label: "Nobody sees amounts — winners only", caution: "" },
  { value: "everyone", label: "Everyone sees amounts", caution: "visible to anyone with the link" },
];

/** The one line beside Share, saying the settings in words. */
export function reportSettingsLine(boardPublic: boolean, visibility: string | null | undefined, amounts: string | null | undefined): string {
  const who = reportOpenToPublic(boardPublic, visibility)
    ? "Anyone with the board link can see this report"
    : "Only the players in this tournament can see this report";
  const a = reportAmountsOf(amounts);
  const money = a === "players" ? "players only" : a === "none" ? "nobody — winners only" : "everyone with the link";
  return `${who} · Side-game amounts: ${money}`;
}

/** Who sees the amounts, said on a copy that carries them — never on the public one. */
export function amountsNoteFor(setting: string | null | undefined): string {
  const a = reportAmountsOf(setting);
  if (a === "players") return "Amounts are shown to the organizer and to the players in this tournament. The public link names the winners only.";
  if (a === "none") return "Amounts are on the organizer's copy only. Players and the public see the winners.";
  return "Amounts are shown to everyone with the link.";
}

/** What a visitor who may not open the report is told: plainly, and where to go instead. */
export const REPORT_SHARED_WITH_PLAYERS = "This report is shared with the players in this tournament.";

/* ------------------------------------------------------------------------ */
/*  A player's public name                                                  */
/* ------------------------------------------------------------------------ */

export const NAME_WITHHELD = "Player (name withheld)";

/** The name a SIGNED-OUT reader is shown. The one reader of the flag. */
export function publicName(p: { name: string; publicNameWithheld?: boolean | null }): string {
  return p.publicNameWithheld ? NAME_WITHHELD : p.name;
}

/** "Ailsa Thorne" → the forms a page writes a name in: whole, and "Ailsa T." / "Ailsa". */
function nameForms(name: string): string[] {
  const parts = name.trim().split(/\s+/);
  const forms = [name.trim()];
  if (parts.length > 1) forms.push(`${parts[0]} ${parts[parts.length - 1].charAt(0)}.`);
  return forms;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * EVERY STRING IN A PUBLIC SURFACE'S DATA, with each withheld player's name —
 * whole, or shortened as the report's ladder shortens it — replaced by
 * `NAME_WITHHELD`. Matched as a whole word, longest first, so "Ann Lee"
 * never eats into "Ann Leech". Applied to the data a public page draws, before
 * it is drawn, so no component can print the name by forgetting to ask.
 */
export function withholdNames<T>(value: T, names: ReadonlyArray<string>): T {
  const forms = [...new Set(names.filter((n) => n.trim()).flatMap(nameForms))].sort((a, b) => b.length - a.length);
  if (forms.length === 0) return value;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(re, NAME_WITHHELD);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Map) return new Map([...v.entries()].map(([k, x]) => [k, walk(x)]));
    if (v instanceof Set || v instanceof Date || typeof v !== "object" || v === null) return v;
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
  };
  return walk(value) as T;
}
