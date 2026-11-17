import "server-only";
import { prisma } from "@/lib/db";
import { clubToday } from "@/lib/domain/club-clock";
import { lastPlayDay } from "@/lib/domain/player-link";
import { slipIsNew, slipOutOfDate, slipsFor, type SlipEntry } from "@/lib/domain/player-link-slips";
import { isGuest } from "@/lib/domain/entry-standing";
import { dayAtClubForEvent, zoneOfEvent } from "@/lib/services/club-clock";
import { ensurePass, rotatePass, unsealCode } from "@/lib/services/player-link";

/**
 * PLAYER LINK SLIPS, STORED (J39/J40 PR 3; design §3.1). Built on the link's own
 * service (`services/player-link.ts`): a slip is that guest's ONE link, made on
 * first use exactly as Show QR makes it (D13) and replaced exactly as New link
 * replaces it. Nothing here makes a second kind of code.
 *
 * A code leaves this file only as the answer to a staff member's press, and is
 * never written anywhere: the stamp on the pass is WHEN and FOR WHICH VERSION
 * the slip was printed, so `slipPrintedVersion < version` says the paper in the
 * guest's pocket no longer opens.
 */

const PASS = { id: true, revokedAt: true, version: true, slipPrintedAt: true, slipPrintedVersion: true, createdAt: true, rotatedAt: true } as const;

/** The event's guests in the field, by name, and what the slip rule needs of each. */
async function slipEntries(eventId: string) {
  const [event, stages, zone, players] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, select: { name: true, startOn: true, endOn: true } }),
    prisma.stage.findMany({ where: { eventId }, select: { playedOn: true } }),
    zoneOfEvent(eventId),
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true, status: true, standing: true, pass: { select: { ...PASS, eventId: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);
  const guests = players.filter((p) => isGuest(p));
  const entries: SlipEntry[] = guests.map((p) => {
    // A pass is only ever this event's; one that is not is read as none (it is never shown here).
    const pass = p.pass && p.pass.eventId === eventId ? p.pass : null;
    return {
      playerId: p.id,
      name: p.name,
      status: p.status,
      standing: p.standing,
      pass: pass
        ? { revokedAt: pass.revokedAt, version: pass.version, slipPrintedVersion: pass.slipPrintedVersion, madeDay: clubToday(zone, pass.rotatedAt ?? pass.createdAt) }
        : null,
    };
  });
  return {
    eventName: event?.name ?? "",
    today: clubToday(zone),
    lastDay: event ? lastPlayDay(event, stages) : "",
    entries,
    passes: new Map(guests.flatMap((p) => (p.pass && p.pass.eventId === eventId ? [[p.id, p.pass] as const] : []))),
  };
}

export interface SlipSummary {
  /** Slips "All slips" would print. */
  all: number;
  /** Slips "Only new slips" would print. */
  fresh: number;
  /** Has any slip been printed in this event yet: then "Only new slips" is offered first (A10). */
  printedAny: boolean;
  /** The guests whose slip for the link as it is now is out there on paper: the lost-sheet press (A12). */
  printedIds: string[];
}

/** What the Print kit's slip card offers. Counts and ids only: never a code. */
export async function slipSummary(eventId: string): Promise<SlipSummary> {
  const { entries, today, lastDay, passes } = await slipEntries(eventId);
  const all = slipsFor(entries, { today, lastDay, onlyNew: false }).print;
  const fresh = slipsFor(entries, { today, lastDay, onlyNew: true }).print;
  return {
    all: all.length,
    fresh: fresh.length,
    printedAny: [...passes.values()].some((p) => p.slipPrintedAt != null),
    printedIds: all.filter((s) => {
      const pass = passes.get(s.playerId);
      return !!pass && !slipIsNew(pass);
    }).map((s) => s.playerId),
  };
}

export interface PrintedSlips {
  eventName: string;
  slips: Array<{ name: string; code: string }>;
  turnedOff: number;
  expired: number;
}

/**
 * PRINT THE SLIPS: each guest's link made if it has none (D13), its code read
 * back from the seal at the version it is stamped with, so the paper and the
 * stamp can never disagree. `by` is the staff member, for the pass's maker.
 */
export async function printSlips(eventId: string, by: string, onlyNew: boolean): Promise<PrintedSlips> {
  const { eventName, entries, today, lastDay } = await slipEntries(eventId);
  const plan = slipsFor(entries, { today, lastDay, onlyNew });
  const slips: PrintedSlips["slips"] = [];
  const now = new Date();
  for (const s of plan.print) {
    const shown = await ensurePass(eventId, s.playerId, by);
    if (!shown.ok) continue;
    const pass = await prisma.playerPass.findFirst({ where: { playerId: s.playerId, eventId }, select: { id: true, version: true, sealed: true } });
    const code = pass ? unsealCode(pass.sealed, pass.id, pass.version) : null;
    if (!pass || !code) continue;
    // Stamped only at the version the code belongs to: a New link pressed in between stamps nothing.
    const stamped = await prisma.playerPass.updateMany({ where: { id: pass.id, version: pass.version }, data: { slipPrintedAt: now, slipPrintedVersion: pass.version } });
    if (stamped.count === 0) continue;
    slips.push({ name: s.name, code });
  }
  return { eventName, slips, turnedOff: plan.turnedOff, expired: plan.expired };
}

/**
 * A LOST SHEET (A12): a new link for each of these guests, one press. Each id is
 * resolved inside the event as one of its GUEST entries by `rotatePass` itself,
 * so a member's id or another event's id makes nothing. The count made.
 */
export async function newLinksFor(eventId: string, playerIds: ReadonlyArray<string>, by: string): Promise<number> {
  let made = 0;
  for (const id of playerIds) {
    const r = await rotatePass(eventId, id, by);
    if (r.ok) made += 1;
  }
  return made;
}

export interface SlipState {
  printed: boolean;
  outOfDate: boolean;
  /** The club day it was printed, "" when never. */
  printedDay: string;
}

/** The organizer panel's slip line for one guest of this event, or null for anybody else. */
export async function slipStateFor(eventId: string, playerId: string): Promise<SlipState | null> {
  const entry = await prisma.player.findFirst({ where: { id: playerId, eventId }, select: { standing: true } });
  if (!entry || !isGuest(entry)) return null;
  const pass = await prisma.playerPass.findFirst({ where: { playerId, eventId }, select: { version: true, slipPrintedAt: true, slipPrintedVersion: true } });
  if (!pass || !pass.slipPrintedAt) return { printed: false, outOfDate: false, printedDay: "" };
  const dayOf = await dayAtClubForEvent(eventId);
  return { printed: true, outOfDate: slipOutOfDate(pass), printedDay: dayOf(pass.slipPrintedAt) };
}
