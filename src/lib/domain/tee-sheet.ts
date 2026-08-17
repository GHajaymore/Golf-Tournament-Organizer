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

/**
 * A published sheet measured against the field as it stands now.
 *
 * `validateTeeSheet` runs when a sheet is published and never again, so the
 * sheet is a snapshot of a field that keeps moving. Withdraw a player on the
 * Wednesday and their id stays in the stored JSON: the group prints with three
 * names and a gap, the player still sees a tee time for a tournament they left,
 * and nothing anywhere says the sheet is out of date. The same drift the
 * messaging design was shaped to avoid — a stored list of people going stale
 * against a membership that changed.
 *
 * Deliberately reports rather than repairs. Rewriting a published sheet
 * underneath a committee is worse than telling them it needs republishing:
 * they may want to move somebody up rather than leave a three-ball, and that
 * is a decision about the draw, not a data-integrity chore.
 */
export interface TeeSheetDrift {
  /** Ids in the sheet that are no longer in the confirmed field. */
  departed: string[];
  /** Confirmed players the sheet does not place anywhere. */
  undrawn: string[];
  /** Groups left short by a departure, by name. */
  shortGroups: string[];
  /** True when the sheet no longer matches the field at all. */
  stale: boolean;
}

export function teeSheetDrift(sheet: TeeSheet, confirmedIds: Set<string>): TeeSheetDrift {
  const departed: string[] = [];
  const shortGroups: string[] = [];
  const drawn = new Set<string>();

  for (const g of sheet.groups) {
    let lost = 0;
    for (const id of g.playerIds) {
      if (confirmedIds.has(id)) {
        drawn.add(id);
      } else {
        departed.push(id);
        lost += 1;
      }
    }
    if (lost > 0) shortGroups.push(g.name || "A group");
  }

  // Someone entered after the sheet went out is as much a mismatch as someone
  // who left: they have no tee time and no way to find out except by asking.
  const undrawn = [...confirmedIds].filter((id) => !drawn.has(id));

  return {
    departed,
    undrawn,
    shortGroups,
    stale: departed.length > 0 || undrawn.length > 0,
  };
}

/**
 * The sheet as it should be read today: departed players dropped.
 *
 * For the screens that only display it — a player's own tee time, the printed
 * sheet — so a withdrawn name never appears in a group. The stored JSON is
 * left alone; this is a view, not a migration.
 */
export function teeSheetAsPlayed(sheet: TeeSheet, confirmedIds: Set<string>): TeeSheet {
  return {
    ...sheet,
    groups: sheet.groups.map((g) => ({
      ...g,
      playerIds: g.playerIds.filter((id) => confirmedIds.has(id)),
    })),
  };
}
