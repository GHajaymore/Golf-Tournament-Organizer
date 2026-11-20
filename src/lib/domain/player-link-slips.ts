import { isGuest } from "./entry-standing";
import { passRefusal } from "./player-link";

/**
 * PLAYER LINK SLIPS (J39/J40 PR 3; design §3.1, A10 to A12). A printed slip per
 * GUEST, handed over at the desk with the scorecard: their name large, the QR of
 * their own player link and its code grouped under it. Members get none: their
 * own way in is their email (D12).
 *
 * The rule of who gets a slip is HERE and nowhere else (`slipsFor`): the count on
 * the Print kit and the action that prints them both ask it, so the button can
 * never promise a number the sheet does not print. Whether a pass is still live
 * is not decided here either: it asks `passRefusal`, the link's one rule.
 *
 * Pure: no database, no clock. `today` is the CLUB's day, told by the caller.
 */

/** Eight to a page: two across, four down, on A4 and US Letter alike (95 × 62 mm each). */
export const SLIPS_PER_PAGE = 8;
export const SLIP_MM = { w: 95, h: 62 } as const;

/** One guest entry as the slip rule needs it, with its pass when one has been made. */
export interface SlipEntry {
  playerId: string;
  name: string;
  status: string;
  standing: string;
  pass: {
    revokedAt: Date | null;
    version: number;
    slipPrintedVersion: number | null;
    /** The club day its current code was made, for an event with no day at all (SF-4). */
    madeDay: string;
  } | null;
}

export interface SlipPlan {
  /** Who gets a slip on this press, in the order given (the caller sorts by name). */
  print: Array<{ playerId: string; name: string }>;
  /** Confirmed guests left out because their link is turned off (New link makes the next one). */
  turnedOff: number;
  /** Confirmed guests left out because their link has run its course (90 club days after the last round). */
  expired: number;
}

/** A slip printed for an older version of the link: New link was pressed since, so it no longer opens. */
export function slipOutOfDate(pass: { version: number; slipPrintedVersion: number | null }): boolean {
  return pass.slipPrintedVersion != null && pass.slipPrintedVersion < pass.version;
}

/** Not yet printed for the link as it is now: never printed, or printed before a New link. */
export function slipIsNew(pass: { version: number; slipPrintedVersion: number | null } | null): boolean {
  return !pass || pass.slipPrintedVersion == null || pass.slipPrintedVersion < pass.version;
}

/**
 * WHO GETS A SLIP. A CONFIRMED guest of this event (a waiting guest's link opens
 * only the waiting card, and a slip is handed over with the scorecard), whose link
 * is not turned off and would still open today. With `onlyNew`, only the guests
 * whose slip has not been printed for the link as it is now.
 */
export function slipsFor(entries: ReadonlyArray<SlipEntry>, opts: { today: string; lastDay: string; onlyNew: boolean }): SlipPlan {
  const plan: SlipPlan = { print: [], turnedOff: 0, expired: 0 };
  for (const e of entries) {
    if (!isGuest(e) || e.status !== "confirmed") continue;
    const refusal = passRefusal({
      revokedAt: e.pass?.revokedAt ?? null,
      version: e.pass?.version ?? 1,
      heldVersion: null,
      entryStatus: e.status,
      isGuest: true,
      lastDay: opts.lastDay,
      // A pass not made yet would be made today.
      madeDay: e.pass?.madeDay || opts.today,
      today: opts.today,
    });
    if (refusal === "revoked") {
      plan.turnedOff += 1;
      continue;
    }
    if (refusal) {
      plan.expired += 1;
      continue;
    }
    if (opts.onlyNew && !slipIsNew(e.pass)) continue;
    plan.print.push({ playerId: e.playerId, name: e.name });
  }
  return plan;
}

/** Slips in pages of eight. */
export function slipPages<T>(slips: ReadonlyArray<T>): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < slips.length; i += SLIPS_PER_PAGE) pages.push(slips.slice(i, i + SLIPS_PER_PAGE));
  return pages;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Every sentence the slips say, in one place (UX Writer: never "only", "just" or "limited" of a guest). */
export const SLIP_WORDS = {
  title: "Player link slips",
  lead: "One slip per guest: their own link to their tee time, card and the board, with no email or app. Hand each one over at the desk with the scorecard. Never post them or leave them lying about.",
  none: "No guests are confirmed in this event yet. A guest's slip appears here once they are in the field.",
  printAll: (n: number) => `Print slips (${n})`,
  onlyNew: (n: number) => `Only new slips (${n})`,
  allSlips: (n: number) => `All slips (${n})`,
  nothingNew: "Every guest's slip is printed for their link as it is now.",
  printing: "Getting the slips ready…",
  printAgain: "Print",
  done: "Done",
  skipped: (off: number, expired: number) =>
    [
      off > 0 ? `${plural(off, "guest's link is", "guests' links are")} turned off: press New link on Entries to make the next one.` : "",
      expired > 0 ? `${plural(expired, "guest's link has", "guests' links have")} run its course and get no slip.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  /** A lost sheet: one press for every printed slip (A12). */
  newForAll: (n: number) => `Make new links for all ${n}`,
  newForAllConfirm: (n: number) =>
    `Make new links for all ${n}? Every printed slip stops working, and each guest's new slip is waiting to print.`,
  newForAllDone: (n: number) => `${plural(n, "new link is", "new links are")} made. The old slips no longer open.`,
  printNew: "Print the new slips",
  /** On the slip itself. */
  keep: "Keep it to yourself.",
  scan: "Scan for your tee time, card and the board. No account or app needed.",
  typeAt: (address: string) => `Or go to ${address} and type:`,
  /** The organizer's panel, after New link: the printed slip no longer opens (A12). */
  panelOutOfDate: "Their printed slip no longer opens. Print a new one on Print kit, under Player link slips.",
  panelPrinted: (day: string) => `Slip printed${day ? ` on ${day}` : ""}.`,
  /** The guest's first screen after the tap (§3.1): a wrong slip is undone on the same screen. */
  notYou: (name: string, eventName: string) => `${name} · ${eventName}. Not you? Hand this back to the desk.`,
} as const;
