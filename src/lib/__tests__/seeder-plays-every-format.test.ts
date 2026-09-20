import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { PLAYABLE_FORMAT_NAMES, findFormat, sideSizeRange } from "../formats";

/**
 * THE PLAYGROUND PLAYS EVERY FORMAT THE APP OFFERS.
 *
 * `scripts/seed-club.mjs` is the club-sized fixture that gets walked by eye,
 * and on 2026-09-20 walking it found one cause showing up as four separate
 * lies on four screens — all of them about a TEAM round, because a side files
 * `TeamScorecard` and every reader asked `Scorecard`.
 *
 * The club played two team formats that day. The app has nine. Nothing was
 * special about the two: the other seven had never been rendered by any screen
 * at all, which is not a smaller version of the same risk — it is the same
 * defect with nobody looking.
 *
 * So the seeder now runs a round of everything, and this keeps it that way. A
 * format added to the catalogue next month fails here on the day it is added,
 * which is the cheapest moment to seed it.
 *
 * It is also the CONTROL for the seeder's hand-written table. That table
 * carries each format's side size and whether the side shares a ball — copied
 * out of a file that changes — and a stale copy would seed rounds that cannot
 * be scored while looking exactly like coverage. See the CLAUDE.md note that a
 * sweep which finds nothing may simply be broken.
 */

const SEEDER = "scripts/seed-club.mjs";

/** The formats the nine club fixtures already play, named where they are. */
const ALREADY_PLAYED = ["Stroke Play", "Match Play", "Stableford", "Four-Ball", "Foursomes"];

/** One row of the seeder's tour table, parsed back out of the script. */
interface TourRow {
  format: string;
  side: number;
  ball: string;
}

function tourRows(src: string): TourRow[] {
  const start = src.indexOf("const TOUR = [");
  expect(start, "the seeder's format tour is gone").toBeGreaterThan(-1);
  const end = src.indexOf("];", start);
  const body = src.slice(start, end);
  // Parsed with indexOf and split rather than a regex: the CLAUDE.md shell
  // note is about escapes being eaten, and a sweep built without them cannot
  // be silently disarmed.
  return body
    .split("{ format:")
    .slice(1)
    .map((chunk) => {
      const quote = chunk.indexOf('"');
      const format = chunk.slice(quote + 1, chunk.indexOf('"', quote + 1));
      const side = Number(chunk.slice(chunk.indexOf("side:") + 5, chunk.indexOf(",", chunk.indexOf("side:"))));
      const ballAt = chunk.indexOf('ball: "');
      const ball = chunk.slice(ballAt + 7, chunk.indexOf('"', ballAt + 7));
      return { format, side, ball };
    });
}

describe("the seeded club", () => {
  const src = readSource(SEEDER);
  const rows = tourRows(src);

  it("parses its own tour table", () => {
    // The control on the parser. A reader that silently returns nothing would
    // make every assertion below vacuously true.
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.map((r) => r.format)).toContain("Scramble");
    expect(rows.find((r) => r.format === "Scramble")!.ball).toBe("single");
  });

  it("plays every format the app offers", () => {
    const playable = PLAYABLE_FORMAT_NAMES;
    const seeded = new Set([...ALREADY_PLAYED, ...rows.map((r) => r.format)]);
    const missing = playable.filter((name) => !seeded.has(name));
    expect(
      missing,
      `no seeded round is ever played as: ${missing.join(", ")}. Add one to the ` +
        `tour in ${SEEDER} — a format nothing renders is a format nothing has checked.`,
    ).toEqual([]);
  });

  it("names formats the app actually has", () => {
    // The other direction: a typo in the table seeds a round the app cannot
    // score, and `findFormat` falls back rather than throwing, so nothing else
    // would say so.
    for (const row of rows) {
      expect(findFormat(row.format).name, `"${row.format}" is not a format`).toBe(row.format);
    }
    for (const name of ALREADY_PLAYED) {
      expect(findFormat(name).name).toBe(name);
    }
  });

  it("gives each side the size and the ball the catalogue says", () => {
    for (const row of rows) {
      const f = findFormat(row.format);
      expect(row.ball, `${row.format} carries the wrong ball`).toBe(f.ball);
      const range = sideSizeRange(row.format);
      expect(row.side, `${row.format} is seeded ${row.side} a side`).toBeGreaterThanOrEqual(range.min);
      expect(row.side, `${row.format} is seeded ${row.side} a side`).toBeLessThanOrEqual(range.max);
    }
  });

  it("plays at least one round away from its event's course", () => {
    /**
     * THE AXIS THE FORMAT SWEEP DOES NOT COVER, and the one that hid two
     * whole classes of defect.
     *
     * Measured against the seeded database on 2026-09-20: ten events, two
     * courses, and NOT ONE stage whose `courseId` differed from its own
     * event's. "Twilight Nine at Ardmore" looks like the exception and is not
     * — it is an Ardmore event end to end, row and stage both.
     *
     * So event-level and per-round course resolution agreed everywhere here,
     * and a question answered two different ways across ten call sites looked
     * right on every screen. Both the read consolidation and the two
     * stored-gross write paths had to be found by reading source, because the
     * club could not express the state that shows them.
     *
     * A round with its own `courseId` is ordinary in the world. This asserts
     * the fixture keeps one, for the same reason the format sweep above
     * exists: sampling finds this for ever, covering it closes it.
     */
    const src = readSource(SEEDER);
    const away = src.indexOf("Evening nine at Ardmore");
    expect(away, "the seeded club no longer plays a round away from its event's course").toBeGreaterThan(-1);

    // Its own venue, not the tournament's — the whole point of the round.
    const round = src.slice(away, away + 2200);
    expect(round, "the away round does not name its own courseId").toMatch(/courseId:\s*away\.id/);
    // And nine holes off the nine-hole card, so it is a second axis too.
    expect(round).toMatch(/holes:\s*9/);
    expect(round).toMatch(/PARS_9/);
  });

  it("files a single-ball side's card with no player on it", () => {
    /**
     * The distinction the whole sweep turns on. A shared ball files ONE row
     * for the side with `playerId` empty; a side playing its own balls files
     * one row per member. Seeding the wrong one produces a round that scores
     * as zero and reads as unplayed — which is the bug this exists to catch,
     * arriving through the fixture instead.
     */
    const tour = src.slice(src.indexOf("const TOUR = ["));
    expect(tour).toMatch(/ball === "single"/);
    expect(tour).toMatch(/playerId: ""/);
  });
});
