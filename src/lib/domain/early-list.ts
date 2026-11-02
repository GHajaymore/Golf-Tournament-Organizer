/**
 * WHO IS OWED AN EARLY-LIST CODE, AND HOW MANY MAY GO TODAY (2026-10-23).
 *
 * While held, /interest promised "25% off the first term … For clubs that join the early list before
 * launch. One code per club, emailed at launch." The owner sends them with his own press on /owner
 * once live (`services/early-list.ts`); these are the rules that press keeps. Pure: no clock of its
 * own, no database.
 */

export interface InterestNote {
  email: string;
  name: string;
  createdAt: Date;
}

/**
 * One per address (whatever its case), under the name of its first note, oldest first; only notes
 * written before going live — after that /interest promised no code — and never an address already
 * sent one. `liveSince` null (live by the environment, with no press to date it): every note stood.
 */
export function owedCodes(notes: readonly InterestNote[], alreadySent: ReadonlySet<string>, liveSince: Date | null): Array<{ email: string; name: string }> {
  const first = new Map<string, { email: string; name: string; at: number }>();
  for (const n of notes) {
    if (liveSince && n.createdAt.getTime() >= liveSince.getTime()) continue;
    const email = n.email.trim().toLowerCase();
    if (!email || alreadySent.has(email)) continue;
    const at = n.createdAt.getTime();
    const had = first.get(email);
    if (!had || at < had.at) first.set(email, { email, name: n.name.trim(), at });
  }
  return [...first.values()].sort((a, b) => a.at - b.at).map(({ email, name }) => ({ email, name }));
}

/** Resend's free plan: 100 emails a day. */
export const DEFAULT_DAILY_LIMIT = 100;

/** The mail service's daily allowance: `RESEND_DAILY_LIMIT`, a whole number of one or more. */
export function resendDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.RESEND_DAILY_LIMIT ?? "").trim();
  return /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_DAILY_LIMIT;
}

const DAY = 24 * 3600_000;

/**
 * How many go on this press, how many wait, and when the next press can send more. The allowance is
 * counted over the last 24 hours of these sends; the rest of the app's mail draws on it too, which
 * the card says.
 */
export function earlyListBatch(input: {
  owed: number;
  sentInLastDay: number;
  oldestInLastDay: Date | null;
  limit: number;
  now: Date;
}): { now: number; later: number; nextAt: Date | null } {
  const room = Math.max(0, input.limit - input.sentInLastDay);
  const now = Math.min(input.owed, room);
  const later = input.owed - now;
  if (later === 0) return { now, later, nextAt: null };
  // The window frees when the oldest send inside it is a day old — or, if nothing is in it yet, a
  // day after the sends this press makes.
  const from = input.oldestInLastDay ?? input.now;
  return { now, later, nextAt: new Date(from.getTime() + DAY) };
}
