/**
 * A SATURDAY SHOTGUN, AS LOAD (the testing panel, 2026-10-23, item F3).
 *
 * 144 players go out at once on a nine-hole round scored by round code, each
 * saving their card after every hole, while 300 people watch the public board.
 * That is the busiest ten minutes the app is built for, and nothing in the
 * test suite comes near it: every browser test is one person, next door to
 * the server.
 *
 *   players   one virtual player per entrant in the seeded field. Each arrives at
 *             the first tee within SPREAD_S seconds of the horn, claims their
 *             place with the round code (`claimPlayerSlot`, the same server
 *             action the /play screen calls), then saves the card after every
 *             hole (`savePlayCard`), HOLE_MIN_S to HOLE_MAX_S apart — a round
 *             squeezed from two hours into a few minutes, which is the point.
 *   viewers   300 phones on /live/<token>, each reloading every VIEW_MIN_S to
 *             VIEW_MAX_S seconds, for as long as the round takes.
 *
 * WHAT IT IS NOT ALLOWED NEAR: PRODUCTION. It writes cards, and production
 * holds real members (CLAUDE.md, hard rule 1). Run it against a PREVIEW
 * deployment whose database is a copy the size of production's, seeded by
 * `seed-shotgun.mjs` — see README.md beside this file. The seeder refuses a
 * database it has not been told the name of.
 *
 *     k6 run -e BASE_URL=https://<preview>.vercel.app scripts/load/shotgun-144.js
 *     node scripts/load/k6-lite.mjs scripts/load/shotgun-144.js       # the same script without k6, for a small local run
 *
 * The server actions are called the way the browser calls them: a POST to the
 * page with a `Next-Action` header naming the action and its arguments as
 * JSON. Their ids belong to ONE build, so `setup()` reads them off the /play
 * page's own scripts, by name, before anybody tees off.
 */
import http from "k6/http";
import { check, sleep, fail } from "k6";
import exec from "k6/execution";
import { Trend, Rate, Counter } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "http://localhost:3101").replace(/\/$/, "");
/**
 * Written by seed-shotgun.mjs: the round code, the board's token, the field and the pars. Under
 * `.qa/`, which git ignores — it is invented names, but it is nobody's business to commit.
 * k6 reads a relative path from this file's folder.
 */
const PLAN = JSON.parse(open(__ENV.PLAN || "../../.qa/load/shotgun-plan.json"));
const PLAYERS = Math.min(Number(__ENV.PLAYERS || PLAN.players.length), PLAN.players.length);
const VIEWERS = Number(__ENV.VIEWERS || 300);
const SPREAD_S = Number(__ENV.SPREAD_S || 30);
const HOLE_MIN_S = Number(__ENV.HOLE_MIN_S || 10);
const HOLE_MAX_S = Number(__ENV.HOLE_MAX_S || 20);
const VIEW_MIN_S = Number(__ENV.VIEW_MIN_S || 15);
const VIEW_MAX_S = Number(__ENV.VIEW_MAX_S || 30);
const HOLES = PLAN.holes;
/** Long enough for the last player out to walk in: the spread, every hole at its slowest, and a minute. */
const ROUND_S = SPREAD_S + HOLES * HOLE_MAX_S + 60;

const claimMs = new Trend("claim_ms", true);
const saveMs = new Trend("save_card_ms", true);
const boardMs = new Trend("board_ms", true);
const saved = new Rate("card_saved");
const refused = new Counter("cards_refused");

export const options = {
  scenarios: {
    players: { executor: "per-vu-iterations", vus: PLAYERS, iterations: 1, maxDuration: `${ROUND_S + 120}s`, exec: "player" },
    ...(VIEWERS > 0 ? { viewers: { executor: "constant-vus", vus: VIEWERS, duration: `${ROUND_S}s`, exec: "viewer" } } : {}),
  },
  thresholds: {
    // A card that does not save is a player re-typing on the green. One in a thousand is the most allowed.
    card_saved: ["rate>0.999"],
    // The figures a phone on a course bar would notice.
    save_card_ms: ["p(95)<1500"],
    claim_ms: ["p(95)<2000"],
    board_ms: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
  },
};

const between = (lo, hi) => lo + Math.random() * (hi - lo);

/** The action ids of THIS build, read off the /play page's scripts by name. */
export function setup() {
  const ids = { claimPlayerSlot: __ENV.CLAIM_ACTION_ID || "", savePlayCard: __ENV.SAVE_ACTION_ID || "" };
  if (!ids.claimPlayerSlot || !ids.savePlayCard) {
    const page = http.get(`${BASE}/play`, { tags: { name: "setup" } });
    if (page.status !== 200) fail(`GET /play answered ${page.status}`);
    const scripts = [...new Set((page.body.match(/\/_next\/static\/chunks\/[^"'\s]+\.js/g) || []))];
    for (const src of scripts) {
      const js = http.get(`${BASE}${src}`, { tags: { name: "setup" } }).body || "";
      for (const m of js.matchAll(/createServerReference\)\("([0-9a-f]{40,})",[^)]*?"(claimPlayerSlot|savePlayCard)"\)/g)) ids[m[2]] = ids[m[2]] || m[1];
    }
  }
  if (!ids.claimPlayerSlot || !ids.savePlayCard) fail(`could not find the server actions on ${BASE}/play: ${JSON.stringify(ids)}`);
  // CONTROL: the board answers before 300 people are pointed at it.
  const board = http.get(`${BASE}/live/${PLAN.shareToken}`, { tags: { name: "setup" } });
  if (board.status !== 200) fail(`the board /live/${PLAN.shareToken} answered ${board.status} — is its leaderboard public?`);
  return ids;
}

/** A server action, called the way React calls one. */
function action(id, args, name) {
  return http.post(`${BASE}/play`, JSON.stringify(args), {
    headers: { "Next-Action": id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: BASE },
    tags: { name },
  });
}
const ok = (res) => res.status === 200 && /"ok":true/.test(res.body || "");

export function player(ids) {
  const me = PLAN.players[exec.scenario.iterationInTest % PLAN.players.length];
  sleep(between(0, SPREAD_S));

  const claim = action(ids.claimPlayerSlot, [PLAN.code, me.id], "claimPlayerSlot");
  claimMs.add(claim.timings.duration);
  if (!check(claim, { "the round code lets the player in": ok })) {
    refused.add(1);
    return;
  }

  const strokes = new Array(HOLES).fill(null);
  for (let h = 0; h < HOLES; h += 1) {
    sleep(between(HOLE_MIN_S, HOLE_MAX_S));
    // A plausible score: a par, a bogey, now and then a birdie or a double.
    strokes[h] = PLAN.pars[h] + [-1, 0, 0, 1, 1, 2][Math.floor(Math.random() * 6)];
    const res = action(ids.savePlayCard, [strokes], "savePlayCard");
    saveMs.add(res.timings.duration);
    const good = ok(res);
    saved.add(good);
    check(res, { "the card is saved": () => good });
    if (!good) refused.add(1);
  }
}

export function viewer() {
  // Phones do not all reload in the same second: each first look falls somewhere in the first
  // reload interval. (Without this, every viewer asks at t=0 and the run measures that one instant.)
  if (exec.vu.iterationInScenario === 0) sleep(between(0, VIEW_MAX_S));
  const res = http.get(`${BASE}/live/${PLAN.shareToken}`, { tags: { name: "board" } });
  boardMs.add(res.timings.duration);
  check(res, { "the board answers": (r) => r.status === 200 });
  sleep(between(VIEW_MIN_S, VIEW_MAX_S));
}
