/**
 * PRODUCTION SMOKE — after every deploy, are the public doors open?
 *
 * Step 2 of docs/release-strategy.md (2026-10-19). The CI gate proves a build
 * before it ships; nothing proved the SHIPPED site afterwards — a missing
 * environment value, a migration that half-applied, a host-only fault all
 * reach members with every test green. This asks tourneyhq.club for its public
 * pages, the way a visitor's phone would, and fails on anything that is not
 * the page.
 *
 * READ-ONLY by construction: GET requests to pages anyone may open, no cookie,
 * no sign-in, nothing written. Production holds real members (CLAUDE.md hard
 * rule 1); a smoke test is not a reason to touch their data.
 *
 *   node scripts/prod-smoke.mjs                      # tourneyhq.club
 *   PROD_BASE_URL=https://… node scripts/prod-smoke.mjs
 */
const BASE = (process.env.PROD_BASE_URL ?? "https://tourneyhq.club").replace(/\/$/, "");

/** Each public door, and what it must answer. A page is a 200 with its own words on it. */
const DOORS = [
  { path: "/", status: 200, says: "TourneyHQ" },
  { path: "/faq", status: 200, says: "TourneyHQ" },
  { path: "/privacy", status: 200, says: "Privacy" },
  { path: "/terms", status: 200, says: "Terms" },
  // The round-code page every cup player opens from a printed sign.
  { path: "/play", status: 200, says: "round code" },
  // CONTROL: a page that does not exist is a 404, not a 500 and not a 200 —
  // a smoke test that passes on a dead site is not a test.
  { path: "/zz-no-such-page-smoke", status: 404, says: null },
];

/**
 * AND ONE PUBLIC BOARD, when one is named (2026-10-23, the hourly canary —
 * `.github/workflows/canary.yml`). `/live/<token>` is the page a club sends its
 * members and the one most likely to be open on a phone on a Saturday; it reads
 * the database, which the front door does not. The link is a secret
 * (`CANARY_BOARD_URL`) because a board's address is the club's to share, not
 * this public repository's. Still a GET with no cookie: nothing is written.
 */
const BOARD = process.env.PROD_BOARD_URL ?? "";
if (BOARD) DOORS.push({ url: BOARD, path: "the public board", status: 200, says: process.env.PROD_BOARD_SAYS || "TourneyHQ" });
else console.log("(no PROD_BOARD_URL given: the public board is not checked this time)");

async function ask(door) {
  // A cold function can be slow on the first request after a deploy: three tries.
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const target = door.url ? `${door.url}${door.url.includes("?") ? "&" : "?"}smoke=${Date.now()}` : `${BASE}${door.path}?smoke=${Date.now()}`;
      const res = await fetch(target, { redirect: "manual", headers: { "user-agent": "tourneyhq-prod-smoke" } });
      const body = res.status === 200 ? await res.text() : "";
      if (res.status !== door.status) {
        last = `answered ${res.status}, expected ${door.status}`;
      } else if (/Application error/i.test(body)) {
        // A 200 whose page is the framework's error screen is not the page.
        last = `answered ${res.status} with the app's error screen`;
      } else if (door.says && !body.toLowerCase().includes(door.says.toLowerCase())) {
        last = `answered ${res.status} without "${door.says}" on it`;
      } else {
        return null;
      }
    } catch (e) {
      last = `no answer (${e instanceof Error ? e.message : String(e)})`;
    }
    await new Promise((r) => setTimeout(r, 5_000 * attempt));
  }
  return last;
}

const failures = [];
for (const door of DOORS) {
  const fault = await ask(door);
  console.log(`${fault ? "FAIL" : "ok  "}  ${door.path}${fault ? ` — ${fault}` : ""}`);
  if (fault) failures.push(door.path);
}
if (failures.length) {
  console.log(`\nPRODUCTION SMOKE: ${failures.length} of ${DOORS.length} doors failed on ${BASE}: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`\nPRODUCTION SMOKE: all ${DOORS.length} doors answered as they should on ${BASE}.`);
