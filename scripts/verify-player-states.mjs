/**
 * The PLAYER's screens, in every state a member can be in.
 *
 * `verify-lifecycle.mjs` is this script's other half: it walks the console at
 * each stage a tournament passes through, and it exists because `/entry`
 * returned 500 on a tournament with no rounds — the state every club is in for
 * their first ten minutes. Nothing did the same for the player.
 *
 * So the player app had been walked many times, always in ONE state:
 * confirmed, in a tournament with a round under way. On 2026-09-20 the other
 * states were walked for the first time and two of them were wrong:
 *
 *     confirmed, round live     correct — the state everybody walks
 *     on the waiting list       "You aren't entered in this tournament"
 *     entered, no round yet     "You aren't entered", plus an opponent who
 *                               does not exist and a ranking of nothing
 *     not entered at all        correct
 *
 * Both were the same collapse. `entered` means CONFIRMED — the rule every card
 * guard uses, and rightly, since a card must never reach somebody without a
 * place — so `!entered` swept the APPLICANT in with the STRANGER, and
 * `!me.round` swept "nothing to play yet" in with "not entered".
 *
 * WHAT IT ASSERTS is a RULE rather than four sentences:
 *
 *   - nobody with a Player row in this event is ever told they are not in it;
 *   - somebody on the waiting list is told that, in those words;
 *   - a tournament with no round promises no hole and names no opponent;
 *   - and the CONTROL: somebody with no Player row IS told they are not
 *     entered. Without it the first rule is satisfied perfectly by deleting
 *     the sentence, which is the failure this file is here to prevent.
 *
 * Plus what every walk here asserts: a 200 rather than a redirect (a 307 to
 * sign-in is a success and reads like the app working), one <h1>, and no NaN,
 * undefined, Infinity or [object Object] in the rendered text.
 *
 * Everything it creates is named for the mark and deleted in a finally.
 */
import { runMark } from "./run-mark.mjs";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3100";
const MARK = runMark("zz-verify-player");
const prisma = new PrismaClient();
const secret = process.env.AUTH_SECRET ?? "dev-secret";
const sign = (v) => v + "." + createHmac("sha256", secret).update(v).digest("base64url");

let failures = 0;
const fail = (where, why) => {
  failures += 1;
  console.log(`  FAIL ${where}: ${why}`);
};

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

/**
 * The rendered page's own content.
 *
 * The right single quote is normalised to an apostrophe because the app emits
 * U+2019 and every sentence checked below is written with U+0027. A check that
 * cannot match the string it is looking for reports every page clean, which is
 * how the first draft of this walk passed while the screens were still wrong.
 */
function readable(html) {
  const open = html.indexOf("<main");
  const close = html.indexOf("</main>");
  const body = open >= 0 && close > open ? html.slice(open, close) : html;
  return body
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&rsquo;|&#x27;|&#8217;|’/g, "'")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function get(path, cookie) {
  const res = await fetch(`${BASE}${path}?bust=${Date.now()}`, {
    headers: { cookie },
    redirect: "manual",
    cache: "no-store",
  });
  const html = res.status === 200 ? await res.text() : "";
  return { status: res.status, html, text: readable(html) };
}

async function makeMember(org, who) {
  const email = `${MARK}-${who}@example.invalid`;
  const user = await prisma.user.create({
    data: { email, name: `${MARK} ${who}` },
    select: { id: true, email: true },
  });
  await prisma.organizationMember.create({
    data: { organizationId: org, userId: user.id, role: "member" },
  });
  return user;
}

async function makeEvent(org, name, extra = {}) {
  return prisma.event.create({
    data: {
      organizationId: org,
      name: `${MARK} ${name}`,
      status: "registration",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: `${MARK} Course`,
      city: `${MARK} Town`,
      address: "",
      regDeadline: "",
      capacity: 40,
      registrationOpen: true,
      registrationToken: randomBytes(6).toString("hex"),
      shareToken: randomBytes(10).toString("hex"),
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
      leaderboardVisibility: "participants",
      ...extra,
    },
    select: { id: true },
  });
}

async function enter(eventId, user, status) {
  return prisma.player.create({
    data: {
      eventId,
      name: user.name ?? `${MARK} entrant`,
      email: user.email,
      handicap: 12,
      seed: 1,
      status,
    },
    select: { id: true },
  });
}

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
}

const SCREENS = ["/me", "/me/card", "/me/board"];

/** One person, one tournament, every screen — and the rules that hold there. */
async function walk(label, user, eventId, expect) {
  const cookie = `ng_session=${sign(user.id)}; ng_active_event=${sign(eventId)}`;
  for (const path of SCREENS) {
    const where = `${label} ${path}`;
    const { status, html, text } = await get(path, cookie);
    if (status !== 200) {
      fail(where, `expected 200, got ${status} — a redirect is a success and looks like the app working`);
      continue;
    }
    const h1s = (html.match(/<h1[\s>]/g) ?? []).length;
    if (h1s !== 1) fail(where, `expected one <h1>, found ${h1s}`);
    for (const junk of ["NaN", "undefined", "Infinity", "[object Object]"]) {
      if (text.includes(junk)) fail(where, `rendered "${junk}"`);
    }

    const saysNotEntered = text.includes("aren't entered");
    if (expect.entered && saysNotEntered) {
      fail(where, `told somebody with a ${expect.rowStatus} entry that they are not entered`);
    }
    if (!expect.entered && expect.mustSayNotEntered && path !== "/me/board" && !saysNotEntered) {
      // THE CONTROL. Without it "nobody is wrongly told they aren't entered"
      // is satisfied by a build that never says it to anybody.
      fail(where, "the sentence a stranger SHOULD see is missing — the rule above proves nothing");
    }
    if (expect.waiting && path !== "/me/board" && !text.includes("on the waiting list")) {
      fail(where, "somebody on the waiting list is not told so");
    }
    if (expect.noRound) {
      if (text.includes("first hole goes in")) fail(where, "promised a hole in a tournament with no round");
      if (text.includes("against your opponent")) fail(where, "named an opponent in a tournament with no round");
    }
  }
}

async function main() {
  console.log(`Walking the player's states against ${BASE}`);
  await cleanup();

  const org = await prisma.organization.create({
    data: { name: `${MARK} club`, kind: "club" },
    select: { id: true },
  });

  const confirmed = await makeMember(org.id, "confirmed");
  const waitlisted = await makeMember(org.id, "waitlisted");
  const stranger = await makeMember(org.id, "stranger");

  // A tournament whose club has taken entries and not yet added a round.
  const bare = await makeEvent(org.id, "entries in, format to follow");
  await enter(bare.id, confirmed, "confirmed");
  await enter(bare.id, waitlisted, "waitlisted");

  // And one being played, so each state is walked against a real round too.
  const playing = await makeEvent(org.id, "under way", { status: "live" });
  const stage = await prisma.stage.create({
    data: {
      eventId: playing.id,
      position: 0,
      description: "Round 1",
      type: "Stroke Play Round",
      format: "Stroke Play",
      scoringBasis: "net",
      holes: 18,
    },
    select: { id: true },
  });
  const inPlay = await enter(playing.id, confirmed, "confirmed");
  await enter(playing.id, waitlisted, "waitlisted");
  await prisma.scorecard.create({
    data: {
      eventId: playing.id,
      stageId: stage.id,
      playerId: inPlay.id,
      strokes: JSON.stringify(PARS),
    },
  });

  await walk("no-round/confirmed", confirmed, bare.id, { entered: true, rowStatus: "confirmed", noRound: true });
  await walk("no-round/waiting", waitlisted, bare.id, {
    entered: true,
    rowStatus: "waitlisted",
    waiting: true,
    noRound: true,
  });
  await walk("no-round/stranger", stranger, bare.id, { entered: false, mustSayNotEntered: true, noRound: true });

  await walk("playing/confirmed", confirmed, playing.id, { entered: true, rowStatus: "confirmed" });
  await walk("playing/waiting", waitlisted, playing.id, {
    entered: true,
    rowStatus: "waitlisted",
    waiting: true,
  });
  await walk("playing/stranger", stranger, playing.id, { entered: false, mustSayNotEntered: true });

  console.log(failures === 0 ? "Every player state reads correctly." : `${failures} problem(s).`);
}

try {
  await main();
} catch (err) {
  failures += 1;
  console.log("FAIL (threw):", err?.message ?? err);
} finally {
  await cleanup();
  await prisma.$disconnect();
}

process.exit(failures === 0 ? 0 : 1);
