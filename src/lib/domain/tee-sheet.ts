/**
 * The tee sheet as a saved thing.
 *
 * A draw that lives only in the organizer's browser is a draft nobody agreed
 * to: regenerated on every visit, gone on refresh, invisible to the field.
 * Saving it makes it a fact — who plays with whom, off which tee, at what
 * time — and publishing it is the separate act of telling the field, because
 * a draft draw is the organizer's until they say otherwise.
 *
 * Stored as one JSON unit: a sheet is replaced wholesale on regenerate and
 * read as a unit, never queried relationally.
 */

export interface TeeSheetGroup {
  name: string;
  startHole: number;
  /** Shotgun overflow: "A" or "B" when two groups share a start hole. */
  half?: "A" | "B";
  /** Display time, e.g. "8:10 AM". */
  time: string;
  playerIds: string[];
}

export interface TeeSheet {
  /** ISO timestamp of when the organizer saved it. */
  savedAt: string;
  /** tee | split | shotgun — display only; the truth is in the slots. */
  startType: string;
  groups: TeeSheetGroup[];
}

/** Parse stored JSON. Null for anything that isn't a sheet — never throws. */
export function parseTeeSheet(json: string): TeeSheet | null {
  if (!json.trim()) return null;
  try {
    const raw = JSON.parse(json) as TeeSheet;
    if (!raw || !Array.isArray(raw.groups)) return null;
    return {
      savedAt: typeof raw.savedAt === "string" ? raw.savedAt : "",
      startType: typeof raw.startType === "string" ? raw.startType : "tee",
      groups: raw.groups
        .filter((g) => g && Array.isArray(g.playerIds))
        .map((g) => ({
          name: String(g.name ?? ""),
          startHole: Number.isInteger(g.startHole) && g.startHole >= 1 ? g.startHole : 1,
          half: g.half === "A" || g.half === "B" ? g.half : undefined,
          time: String(g.time ?? ""),
          playerIds: g.playerIds.filter((id) => typeof id === "string" && id.length > 0),
        })),
    };
  } catch {
    return null;
  }
}

/**
 * Whether a sheet can be published against a field.
 *
 * The checks are the ones that make a sheet wrong on the day: a player drawn
 * twice tees off in two places at once; a player who isn't in the field is a
 * name nobody can find; an empty group is a tee time with nobody on it.
 */
export function validateTeeSheet(sheet: TeeSheet, confirmedIds: Set<string>): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const g of sheet.groups) {
    if (g.playerIds.length === 0) problems.push(`${g.name || "A group"} has nobody in it.`);
    for (const id of g.playerIds) {
      if (!confirmedIds.has(id)) {
        problems.push(`${g.name || "A group"} includes a player who isn't in the confirmed field.`);
        continue;
      }
      const already = seen.get(id);
      if (already) {
        problems.push(`A player appears in both ${already} and ${g.name || "another group"}.`);
      } else {
        seen.set(id, g.name || "a group");
      }
    }
  }
  if (sheet.groups.length === 0) problems.push("The sheet has no groups.");
  return problems;
}

/** The group a player is drawn in, for "your tee time" on their dashboard. */
export function groupForPlayer(sheet: TeeSheet, playerId: string): TeeSheetGroup | null {
  return sheet.groups.find((g) => g.playerIds.includes(playerId)) ?? null;
}
