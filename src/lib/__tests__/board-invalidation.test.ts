import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Anything that moves a standing must retire the cached board.
 *
 * The public board is an `unstable_cache` entry keyed per event — one
 * computation shared by every spectator, which took it from 20.7 database
 * queries per request to 1.86. The price of that is a second obligation on
 * every writer: say when it stops being true.
 *
 * `revalidatePath` does NOT do this. It clears the router cache and leaves the
 * board entry alone, so a score written without `boardChanged` sits behind the
 * cache until its sixty-second backstop expires — a spectator watching a group
 * come up the 18th, seeing nothing happen. That backstop is a safety net, not
 * the mechanism, and a net nobody notices is a net that slowly becomes the
 * mechanism.
 *
 * This is a source-reading guard rather than a behavioural one because the
 * failure is invisible: everything works, the board is just wrong for a
 * minute, and nobody files that as a bug. A future action writing scores with
 * no idea this cache exists is the entire risk, and it is the ordinary case
 * rather than a careless one.
 */

const ACTIONS = join(process.cwd(), "src", "app", "actions");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * The models the public board is computed from.
 *
 * Scores and matches are obvious. The others are not, and each has bitten in a
 * different way: a PLAYER's handicap changes every net score; a STAGE's tees
 * change the pars every score is measured against; a GROUP is what a team
 * round is scored by.
 */
const BOARD_MODELS = ["scorecard", "matchCard", "teamScorecard", "match", "player", "stage", "group"];
const WRITES = ["create", "update", "upsert", "delete", "createMany", "updateMany", "deleteMany"];

const writeRe = new RegExp(
  `prisma\\.(${BOARD_MODELS.join("|")})\\.(${WRITES.join("|")})\\b`,
);

const files = readdirSync(ACTIONS).filter((f) => f.endsWith(".ts"));

describe("every writer of a standing retires the board", () => {
  it("finds the action files, so this cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const src = strip(readFileSync(join(ACTIONS, file), "utf8"));
    if (!writeRe.test(src)) continue;

    it(`${file} — writes a standing, so it must call boardChanged`, () => {
      expect(
        src.includes("boardChanged"),
        `${file} writes ${BOARD_MODELS.join("/")} but never retires the cached board. ` +
          `Call boardChanged(eventId) — usually by routing through this file's refresh() helper.`,
      ).toBe(true);
    });
  }

  it("composes the tag nowhere but its owner", () => {
    // `revalidateTag("board:" + id)` spelled out in an action is a second
    // author on a contract between the writer and the reader.
    for (const file of files) {
      const src = strip(readFileSync(join(ACTIONS, file), "utf8"));
      expect(src, `${file} composes the board tag by hand`).not.toMatch(/["'`]board:/);
    }
  });

  it("does not mistake revalidatePath for retiring the board", () => {
    /**
     * The confusion this guard exists for. Every one of these files already
     * called `revalidatePath("/", "layout")` and looked, to any reasonable
     * reader, like it was invalidating everything — which is exactly why the
     * board went uninvalidated in ten files at once.
     */
    for (const file of files) {
      const src = strip(readFileSync(join(ACTIONS, file), "utf8"));
      if (!writeRe.test(src)) continue;
      if (!src.includes("revalidatePath")) continue;
      expect(
        src.includes("boardChanged"),
        `${file} calls revalidatePath but not boardChanged — those are different caches`,
      ).toBe(true);
    }
  });
});
