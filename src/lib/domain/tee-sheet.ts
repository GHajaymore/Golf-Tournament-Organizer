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

/**
 * How a saved sheet's field went off, for the builder to start a re-draw from.
 *
 * `startType` was stored on every sheet and read back by nothing, so Re-draw
 * on a shotgun sheet opened on "One tee" — and moving two players quietly
 * changed how the whole field starts. One tee is the answer where there is
 * no sheet, or the stored word is not a way of starting.
 */
export function startStyleOf(stored: string | null | undefined): "tee" | "split" | "shotgun" {
  return stored === "split" || stored === "shotgun" ? stored : "tee";
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

/**
 * Which groups the tee-sheet screen shows: the SHEET OF RECORD once one has
 * been saved, and the draw being made only while the organizer is re-drawing.
 *
 * It always showed the draw — a fresh, seeded shuffle on every visit — even
 * over a published sheet. So the secretary opening Tee sheet on the morning
 * read "Séamus · Group 6 · 8:50" while Séamus had been told Group 1 at 8:10,
 * and the printed cards ("from the saved sheet") on the same page said 8:10
 * too. The one line admitting it — "regenerating here only changes the
 * preview" — reads as a note about pressing a button, not as "these are not
 * the times" (walked 2026-09-27).
 */
export function sheetOnScreen(
  saved: readonly TeeSheetGroup[],
  preview: readonly TeeSheetGroup[],
  redrawing: boolean,
): { source: "saved" | "preview"; groups: readonly TeeSheetGroup[] } {
  return !redrawing && saved.length > 0
    ? { source: "saved", groups: saved }
    : { source: "preview", groups: preview };
}

/**
 * Whether two sheets send the same people off the same tee at the same time —
 * names aside, since "Group 3" is a label and not a fact anybody acts on.
 */
export function sameSheet(a: readonly TeeSheetGroup[], b: readonly TeeSheetGroup[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((g, i) => {
    const h = b[i];
    return (
      g.startHole === h.startHole &&
      (g.half ?? "") === (h.half ?? "") &&
      g.time === h.time &&
      g.playerIds.length === h.playerIds.length &&
      g.playerIds.every((id, j) => id === h.playerIds[j])
    );
  });
}

/** A sheet's printed time ("12:45 PM", "8:10 AM", "13:05") as minutes after midnight, or null. */
function minutesOf(display: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*$/.exec(display);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const ampm = m[3]?.toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/**
 * THE FIRST TEE AND THE INTERVAL A RE-DRAW STARTS FROM — the saved sheet's own.
 *
 * A re-draw opened at 8:00 and ten minutes whatever the sheet said, so changing
 * one thing about a sheet off at 12:45 at nine-minute intervals meant typing
 * both back in, and a re-draw saved without noticing moved the whole field to
 * the morning (the eve of the first real tournament, 2026-10-17). Read off the
 * first two groups from the same tee; a time this cannot read leaves the
 * default, which is what happened before.
 */
export function drawTimesFrom(saved: readonly TeeSheetGroup[]): { firstTee?: string; interval?: number } {
  const first = saved[0];
  const start = first ? minutesOf(first.time) : null;
  if (start === null) return {};
  const pad = (n: number) => String(n).padStart(2, "0");
  const out: { firstTee?: string; interval?: number } = { firstTee: `${pad(Math.floor(start / 60))}:${pad(start % 60)}` };
  const next = saved.slice(1).find((g) => g.startHole === first.startHole && (g.half ?? "") === (first.half ?? ""));
  const then = next ? minutesOf(next.time) : null;
  if (then !== null && then > start) out.interval = then - start;
  return out;
}

/**
 * THE LINE UNDER THE DRAW CONTROLS — what the organizer is looking at, and
 * whether the players have it.
 *
 * Found on the eve of the first real tournament (2026-10-17): straight after
 * "Save & publish" it read "Published to players — this is a new draw, not the
 * saved sheet, until you save it." The draw on screen WAS the sheet just
 * published; the line asked only whether the controls were open, not whether
 * what they showed differed from what was saved. Asked of the groups now.
 */
export function sheetStatusLine(s: { published: boolean; onScreenIsSaved: boolean }): string {
  const what = s.published ? "Published to players" : "Saved as a draft";
  return s.onScreenIsSaved
    ? `${what} — this is the sheet ${s.published ? "they have" : "you saved"}.`
    : `${what} — the draw below is new and not saved. ${s.published ? "Players still have the published sheet" : "The saved sheet is unchanged"} until you save this one.`;
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

/**
 * WHAT IS WRONG WITH A PUBLISHED SHEET, in one sentence a secretary can act on.
 *
 * A sheet drawn before a cut and checked after it read "79 drawn players have
 * left the field" (2026-10-10) — nobody had left; they had missed the cut, and
 * "left" is the word for a withdrawal. So the two are counted apart, by the
 * caller's `cutOut` (drawn, still entered, not in the cut's field). And one
 * short group read "leaving short: Group 1"; a long list of them is a number.
 */
export function driftSentence(drift: TeeSheetDrift, cutOut: ReadonlySet<string> = new Set()): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const missed = drift.departed.filter((id) => cutOut.has(id)).length;
  const left = drift.departed.length - missed;
  const parts: string[] = [];
  if (missed > 0) parts.push(`${plural(missed, "drawn player has", "drawn players have")} missed the cut.`);
  if (left > 0) parts.push(`${plural(left, "drawn player has", "drawn players have")} left the field.`);
  const g = drift.shortGroups;
  if (g.length === 1) parts.push(`That leaves ${g[0]} short.`);
  else if (g.length > 1 && g.length <= 6) parts.push(`That leaves these groups short: ${g.join(", ")}.`);
  else if (g.length > 6) parts.push(`That leaves ${g.length} groups short.`);
  if (drift.undrawn.length > 0) {
    parts.push(`${plural(drift.undrawn.length, "confirmed player has", "confirmed players have")} no tee time.`);
  }
  return parts.join(" ");
}
