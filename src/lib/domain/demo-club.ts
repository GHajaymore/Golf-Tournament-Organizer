/**
 * THE DEMO CLUB (2026-10-24) — what it is, as data. Pure: no database, no clock
 * of its own. The writer is `services/demo-club.ts`; the why is
 * `docs/claude/demo-club.md`.
 *
 * Approved by Ajay on 2026-10-24 to the panel's design: an INVENTED club with
 * INVENTED players, live in production, so a visitor can watch a club's day —
 * the board, the event page, the clubhouse screen and a finished tournament's
 * report — without anybody's real name on it. Two tournaments:
 *
 *   finished   a two-round championship, completed four days ago, with its
 *              final report and its event page in the "afterwards" state
 *   today      a one-round medal "playing now", whose holes appear through the
 *              day by the club's own clock, and which starts again each morning
 *
 * EVERY NAME HERE IS INVENTED. The club is not a real club (searched before it
 * was chosen), not the seeded development club and not a test tournament's
 * name; the players are made-up people; every address is on
 * `demo.example.invalid`, which can never deliver (RFC 2606).
 */

import { fieldsAt } from "./date-words";

/** The words on every demo page (board, event page, clubhouse screen, report). */
export const DEMO_LABEL = "Demo club, invented players";

/** The one line under it: why it is there. */
export const DEMO_LABEL_NOTE = "A club TourneyHQ made up to show the app. Nobody here is a real person.";

/**
 * THE ONE LINE for the event page and the clubhouse TV, under the "everyone can
 * watch" idea — on the landing's demo button and on the demo's own page.
 */
export const DEMO_WATCH_LINE = "Everyone can watch: the event page on any phone, the clubhouse screen on the TV in the bar.";

/** The doors `/demo/<door>` opens, each to the demo's page of that name. */
export const DEMO_DOORS = ["board", "event", "clubhouse", "finished", "report", "card"] as const;
export type DemoDoor = (typeof DEMO_DOORS)[number];

/**
 * The domain every demo address is on. Reserved, so nothing sent there can
 * arrive — and a send to it is refused before it is tried (`isDemoAddress`).
 */
export const DEMO_EMAIL_DOMAIN = "demo.example.invalid";

export const DEMO_CLUB = {
  name: "Quillstone Golf Club",
  shortName: "Quillstone",
  city: "Quillstone",
  region: "Ohio",
  country: "US",
  // An east-coast club's clock: the replay plays its day by this zone.
  timeZone: "America/New_York",
  locale: "en-US",
  currency: "USD",
  currencySymbol: "$",
} as const;

/**
 * The club's name with a test's mark in front, or the bare name in production.
 * A test builds its own demo under its own mark, so it can never refresh — or
 * tear down — the real one.
 */
export function demoClubName(mark: string): string {
  return mark ? `${mark} ${DEMO_CLUB.name}` : DEMO_CLUB.name;
}

/** An address for a demo row, on the demo's domain. */
export function demoAddress(mark: string, local: string): string {
  return `${mark ? `${mark}-` : ""}${local}@${DEMO_EMAIL_DOMAIN}`;
}

/** Whether an address belongs to the demo — and so may never be sent anything. */
export function isDemoAddress(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

/**
 * THE TWO BOARDS' ADDRESSES, the same after every refresh — so a link somebody
 * kept, the landing's buttons and the QR all still go somewhere the next day.
 */
export function demoShareTokens(mark: string): { today: string; finished: string } {
  const stem = mark ? `${mark}-quillstone-demo` : "quillstone-demo";
  return { today: `${stem}-today`, finished: `${stem}-championship` };
}

export const DEMO_EVENTS = {
  today: "Quillstone Club Medal",
  finished: "Quillstone Autumn Championship",
} as const;

/** The course: an ordinary parkland par 72, two par 3s and two par 5s a side. */
export const DEMO_COURSE = {
  name: "Quillstone — North Course",
  pars: [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 5, 4, 3, 4, 4, 3, 5, 4],
  strokeIndex: [7, 1, 15, 11, 5, 3, 17, 9, 13, 8, 12, 2, 16, 6, 4, 18, 10, 14],
  yards: [392, 431, 168, 512, 404, 418, 151, 387, 534, 401, 521, 446, 174, 409, 428, 159, 548, 395],
  tees: [
    { name: "White", gender: "male", courseRating: 71.2, slopeRating: 128, par: 72 },
    { name: "Red", gender: "female", courseRating: 72.6, slopeRating: 124, par: 72 },
  ],
} as const;

/** Twenty-four invented players: a name, a Handicap Index and which set of tees is theirs. */
export const DEMO_FIELD: ReadonlyArray<readonly [name: string, index: number, gender: "male" | "female"]> = [
  ["Avery Langford", 4.2, "male"],
  ["Mina Okafor", 11.8, "female"],
  ["Theo Brandt", 15.3, "male"],
  ["Lucia Ferraro", 7.9, "female"],
  ["Jonah Whitcombe", 2.6, "male"],
  ["Sanne de Vries", 19.4, "female"],
  ["Rory Castellan", 12.1, "male"],
  ["Imogen Hartley", 23.7, "female"],
  ["Dev Raman", 9.4, "male"],
  ["Clara Moreau", 14.6, "female"],
  ["Felix Arkwright", 18.2, "male"],
  ["Yuki Hanamura", 6.3, "female"],
  ["Marcus Eldridge", 0.8, "male"],
  ["Nadia Petrova", 16.9, "female"],
  ["Owen Treacher", 21.5, "male"],
  ["Esme Calloway", 10.2, "female"],
  ["Kofi Mensah", 8.7, "male"],
  ["Hollis Brightwater", 13.4, "male"],
  ["Greer Atwell", 25.8, "female"],
  ["Silas Penhallow", 5.5, "male"],
  ["Tamsin Royle", 17.6, "female"],
  ["Ibrahim Saleh", 11.1, "male"],
  ["Philippa Strand", 20.3, "female"],
  ["Callum Draycott", 3.9, "male"],
];

/** Threes, half an hour apart from eight o'clock: the last group is off at half past eleven. */
export const DEMO_FIRST_TEE = 8 * 60;
export const DEMO_GROUP_GAP = 30;
export const DEMO_GROUP_SIZE = 3;
/** A three-ball's hole, walking: about fourteen minutes, so a round is a little over four hours. */
export const DEMO_MINUTES_PER_HOLE = 14;

export interface DemoGroup {
  name: string;
  /** Minutes after the club's midnight. */
  teeMinute: number;
  /** "08:30", as a tee sheet stores it. */
  time: string;
  /** Indexes into DEMO_FIELD. */
  players: number[];
}

const two = (n: number) => String(n).padStart(2, "0");

/** The draw: the field in threes, in entry order, half an hour apart. */
export function demoGroups(fieldSize: number = DEMO_FIELD.length): DemoGroup[] {
  const groups: DemoGroup[] = [];
  for (let i = 0; i < fieldSize; i += DEMO_GROUP_SIZE) {
    const teeMinute = DEMO_FIRST_TEE + (i / DEMO_GROUP_SIZE) * DEMO_GROUP_GAP;
    groups.push({
      name: `Group ${groups.length + 1}`,
      teeMinute,
      time: `${two(Math.floor(teeMinute / 60))}:${two(teeMinute % 60)}`,
      players: Array.from({ length: Math.min(DEMO_GROUP_SIZE, fieldSize - i) }, (_, k) => i + k),
    });
  }
  return groups;
}

/**
 * HOW MANY HOLES A GROUP HAS FINISHED at a minute of the club's day: none
 * before its tee time, one more every fourteen minutes, all eighteen after.
 * The replay writes up to this and no further, so the board at 9:40 and the
 * board at 1:15 are two different boards — and a tick that was missed is made
 * up by the next one, because the answer depends on the clock, not on how many
 * ticks there have been.
 */
export function holesDueAt(teeMinute: number, nowMinute: number, holes = 18): number {
  if (nowMinute < teeMinute) return 0;
  return Math.min(holes, Math.floor((nowMinute - teeMinute) / DEMO_MINUTES_PER_HOLE));
}

/** Minutes since midnight on the club's wall clock at an instant, or null for a zone the platform refuses. */
export function minuteAtClub(timeZone: string, at: Date): number | null {
  const f = fieldsAt(at, timeZone);
  return f ? f.hour * 60 + f.minute : null;
}

/** A yyyy-mm-dd some days from another, by the calendar (no clock, no zone). */
export function dayFrom(day: string, offset: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + offset, 12));
  return `${t.getUTCFullYear()}-${two(t.getUTCMonth() + 1)}-${two(t.getUTCDate())}`;
}

/** A seeded generator: the same day gives the same round, so a refresh at noon draws the board it replaced. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A whole number from a string, for seeding. */
function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * One player's gross card for one round, the whole of it decided in advance.
 *
 * Built to a total — about the player's handicap plus two over, a few shots
 * either way — the way `scripts/seed-club.mjs` builds its club's cards, so the
 * net board is led a stroke or two under and nobody shoots a fantasy. Seeded by the round's key and the player, so each day's medal is a
 * new story and the same day's is always the same one.
 */
export function demoCard(roundKey: string, playerIndex: number, handicapIndex: number, pars: readonly number[] = DEMO_COURSE.pars): number[] {
  const rand = rng(hashOf(`${roundKey}:${playerIndex}`));
  const spread = Math.round((rand() + rand() + rand() - 1.5) * 4);
  const target = Math.round(handicapIndex * 1.1 + 2 + spread);
  const birdies = Math.max(
    target < 0 ? -target : 0,
    handicapIndex < 5 ? 2 + Math.floor(rand() * 2) : handicapIndex < 12 ? Math.floor(rand() * 2) : rand() < 0.25 ? 1 : 0,
  );
  const swings = pars.map(() => 0);
  for (let b = 0; b < birdies; b += 1) {
    const h = Math.floor(rand() * pars.length);
    if (swings[h] === 0) swings[h] = -1;
  }
  let owed = target - swings.reduce((a, s) => a + s, 0);
  let guard = 0;
  while (owed > 0 && guard < 2000) {
    guard += 1;
    const h = Math.floor(rand() * pars.length);
    if (swings[h] >= 0 && swings[h] < 3) {
      swings[h] += 1;
      owed -= 1;
    }
  }
  return pars.map((par, h) => Math.max(2, par + swings[h]));
}

/**
 * The card as the replay has it at a moment: the scripted score on every hole
 * the group has played (`due`), and whatever the card already holds after
 * that. So a visitor's tap on a hole not yet reached stands until the group
 * gets there, and a tap on a played hole is put back to the club's day.
 */
export function demoStrokesDue(script: readonly number[], due: number, stored: ReadonlyArray<number | null>): (number | null)[] {
  return script.map((s, h) => (h < due ? s : (stored[h] ?? null)));
}
