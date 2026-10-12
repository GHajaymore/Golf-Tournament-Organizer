import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { clubDay, clubToday } from "../domain/club-clock";

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
export async function clubDayForEvent(eventId: string | null | undefined): Promise<Date> {
  return clubDay(await zoneOfEvent(eventId));
}
