/**
 * PUT THE E2E FIXTURE IN FRONT OF YOUR EYES.
 *
 * Seeds the end-to-end fixture into the DEVELOPMENT database and prints the
 * cookies to paste into a browser, so the console can be WALKED with real rows
 * instead of read as source.
 *
 * This exists because reading is not enough, and the record says so. On
 * 2026-09-18 a single pass over six screens found two defects that 7,682 unit
 * tests, 1,194 audit tests, the smoke pass and Playwright all missed, for the
 * same reason in both cases: nothing compares two screens to each other.
 *
 *   - club settings showed "Staff 0" while the plan allowance on the SAME page
 *     counted two, so a club on the free plan is refused the next person it
 *     adds by a limit its own screen says it is nowhere near;
 *   - the league week read "4 of 4 in have returned a card" and printed
 *     "thru 9" for one of those players two lines below.
 *
 * Neither is expressible as a unit test of one function, and both are obvious
 * in about four seconds of looking.
 *
 *   node --env-file=.env scripts/look-at-screens.mjs
 *   node --env-file=.env scripts/look-at-screens.mjs --teardown
 *
 * Then start the dev server and paste the two `document.cookie` lines into the
 * console at http://localhost:3100.
 *
 * REMEMBER TO TEAR DOWN. The rows are marked `zz-e2e-<worktree>` and the e2e
 * suite deletes anything with that prefix when it runs, so leaving them costs
 * nothing permanent — but a fixture left in the database is a fixture somebody
 * later mistakes for real, which is the rule in CLAUDE.md.
 */
import { seed, teardown } from "../e2e/fixture.mjs";

/**
 * THE ONE THING THIS MUST NEVER DO IS WRITE TO PRODUCTION.
 *
 * Hard rule 1: never modify, seed into or test against an event holding real
 * people, and a seed pointed at one cannot be undone from here. The script
 * takes its database from the environment, so it refuses anything that is not
 * plainly local rather than trusting whoever set the variable.
 *
 * Checked on the host only. A password or a database name may contain the word
 * "localhost" and must not be what satisfies this.
 */
function refuseNonLocal() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("No DATABASE_URL — run with --env-file=.env");

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL is not a URL this script can read the host from. Refusing.");
  }

  const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!local) {
    throw new Error(
      `Refusing to touch a database at "${host}". This seeds and deletes rows and is for the ` +
        `development database only — see hard rule 1 in CLAUDE.md.`,
    );
  }
}

async function main() {
  refuseNonLocal();

  if (process.argv.includes("--teardown")) {
    await teardown();
    console.log("Fixture removed.");
    return;
  }

  const data = await seed();

  const lines = [
    "",
    "Paste these into the browser console at http://localhost:3100, then reload:",
    "",
    `  document.cookie='ng_session=${data.organizer.session}; path=/'`,
    `  document.cookie='ng_active_event=${data.organizer.event}; path=/'`,
    "",
    "The league secretary, for the interclub screens:",
    "",
    `  document.cookie='ng_session=${data.league.organizer.session}; path=/'`,
    `  document.cookie='ng_active_event=${data.league.organizer.event}; path=/'`,
    "",
    "Tear down with --teardown when you have finished looking.",
    "",
  ];
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exitCode = 1;
});
