import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { clubDay, clubDayInWords, clubToday } from "../domain/club-clock";
import { formatDay } from "../domain/locale";
import { formattingForEvent } from "./organization";

/**
 * WHOSE DAY IT IS — the club's, read once per request.
 *
 * `domain/club-clock.ts` is the rule; this is where a server screen or action
 * gets the zone to ask it of. Every "what day is it" on the server goes
 * through here, and `the-server-asks-the-club-what-day-it-is.test.ts` refuses
 * a file that asks its own clock instead.
 */

/** The club's zone, or "" when it has not said (then the server's day stands). */
export const zoneOfOrganization = cache(async (organizationId: string | null | undefined): Promise<string> => {
  if (!organizationId) return "";
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timeZone: true },
  });
  return org?.timeZone ?? "";
});

/** The zone of the club this tournament belongs to. */
export const zoneOfEvent = cache(async (eventId: string | null | undefined): Promise<string> => {
  if (!eventId) return "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organization: { select: { timeZone: true } } },
  });
  return event?.organization?.timeZone ?? "";
});

/** Today at this tournament's club, yyyy-mm-dd. */
export async function todayForEvent(eventId: string | null | undefined): Promise<string> {
  return clubToday(await zoneOfEvent(eventId));
}

/**
 * The club's day as a `Date`, for the helpers that take one and ask it what
 * day it is. A DAY, not the present instant — see `clubDay`.
 */
/**
 * THE DAY AN INSTANT FELL ON AT THIS TOURNAMENT'S CLUB, WRITTEN THE CLUB'S WAY
 * (2026-10-13). For a timestamp somebody is going to READ as a date: when a
 * handover was recorded, when a course card was checked, when a tournament
 * closes.
 *
 * Four screens each took the first ten characters of the timestamp's ISO form
 * — the day by the server's clock, UTC — and printed it either bare
 * ("2026-10-13") or through `formatDay` with no locale, which is American for
 * every club. So the day was wrong for a club on the other side of midnight
 * and the notation was nobody's choice. `shown-days-are-the-clubs.test.ts`
 * refuses that spelling outside a short list. Returns a formatter, so one
 * question of the database words a whole list.
 */
export async function dayAtClubForEvent(eventId: string | null | undefined): Promise<(at: Date) => string> {
  const [zone, locale] = await Promise.all([zoneOfEvent(eventId), eventId ? formattingForEvent(eventId).then((f) => f.locale) : undefined]);
  return (at: Date) => clubDayInWords(zone, locale, at);
}

/**
 * A day somebody TYPED ("2026-10-17", an expense's date), in the club's words. It is already a
 * day, so no clock and no zone come into it — only the club's way of writing one.
 */
export async function typedDayInWordsForEvent(eventId: string | null | undefined): Promise<(iso: string) => string> {
  const locale = eventId ? (await formattingForEvent(eventId)).locale : undefined;
  return (iso: string) => (iso ? formatDay(iso, locale || undefined) : "");
}

export async function clubDayForEvent(eventId: string | null | undefined): Promise<Date> {
  return clubDay(await zoneOfEvent(eventId));
}
