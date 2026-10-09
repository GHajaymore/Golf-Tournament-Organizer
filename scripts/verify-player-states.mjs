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
    /**
     * AWAITING APPROVAL IS NOT A WAITING LIST (2026-09-28). A club that approves
     * entries puts every one in front of a person, with the field wide open —
     * and the card told them "You're on the waiting list", a queue they were
     * never in. They are told what is actually happening, and never the other.
     */
    if (expect.awaiting && path !== "/me/board") {
      if (text.includes("waiting list")) fail(where, "told somebody awaiting approval they are on a waiting list");
      if (!text.includes("approv")) fail(where, "somebody awaiting approval is not told so");
    }
    /**
     * DISQUALIFIED (2026-10-08). They have a row, so the first rule holds for
     * them — and they are told the RULING, not offered the door back in: an
     * Enter button there would undo the committee's decision with one tap.
     */
    if (expect.disqualified && path !== "/me/board") {
      if (!text.includes("disqualified")) fail(where, "a disqualified player is not told so");
      if (text.includes("Enter this tournament")) fail(where, "offered a disqualified player the way back in");
    }
    // WITHDREW (2026-10-08): they were entered, so they are told what they did.
    if (expect.withdrew && path !== "/me/board" && !text.includes("You withdrew")) {
      fail(where, "a player who withdrew is not told so");
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

  // An approve-mode tournament with room to spare: the entry waits on a person,
  // not on a place.
  const vetted = await makeEvent(org.id, "entries approved by the committee", { registrationApproval: "approve" });
  const applicant = await makeMember(org.id, "applicant");
  await enter(vetted.id, applicant, "pending");
  await walk("approval/pending", applicant, vetted.id, { entered: true, rowStatus: "pending", awaiting: true, noRound: true });

  await walk("playing/confirmed", confirmed, playing.id, { entered: true, rowStatus: "confirmed" });
  await walk("playing/waiting", waitlisted, playing.id, {
    entered: true,
    rowStatus: "waitlisted",
    waiting: true,
  });
  await walk("playing/stranger", stranger, playing.id, { entered: false, mustSayNotEntered: true });

  // Ruled out by the committee mid-tournament, with a card already returned.
  const ruledOut = await makeMember(org.id, "ruledout");
  const dq = await enter(playing.id, ruledOut, "disqualified");
  await prisma.scorecard.create({
    data: { eventId: playing.id, stageId: stage.id, playerId: dq.id, strokes: JSON.stringify(PARS) },
  });
  await walk("playing/disqualified", ruledOut, playing.id, {
    entered: true,
    rowStatus: "disqualified",
    disqualified: true,
  });

  // Withdrew mid-tournament with a card already returned, so the row is kept
  // (2026-10-08, grid cell T45: Today said "You aren't entered").
  const leaver = await makeMember(org.id, "leaver");
  const wd = await enter(playing.id, leaver, "withdrawn");
  await prisma.scorecard.create({
    data: { eventId: playing.id, stageId: stage.id, playerId: wd.id, strokes: JSON.stringify(PARS) },
  });
  await walk("playing/withdrawn", leaver, playing.id, {
    entered: true,
    rowStatus: "withdrawn",
    withdrew: true,
  });

  /**
   * NO TOURNAMENT AT ALL — the state every new club's members are in first.
   *
   * Walked 2026-09-28: a member of a society with nothing published was greeted
   * on /choose as a stranger ("If an organizer has invited you …"), with their
   * club unnamed. The rule: a member is told WHICH club they are in. The
   * CONTROL is somebody in no club, who must still get the stranger's sentence
   * and must not be told about a club they do not have.
   */
  const quietOrg = await prisma.organization.create({
    data: { name: `${MARK} quiet society`, kind: "community", country: "GB" },
    select: { id: true },
  });
  const quietMember = await makeMember(quietOrg.id, "quiet");
  const loner = await prisma.user.create({
    data: { email: `${MARK}-loner@example.invalid`, name: `${MARK} loner` },
    select: { id: true },
  });
  const clubName = `${MARK} quiet society`;
  for (const [label, user, inClub] of [["no-events/member", quietMember, true], ["no-events/no-club", loner, false]]) {
    const cookie = `ng_session=${sign(user.id)}`;
    for (const path of ["/choose", "/me/events"]) {
      const where = `${label} ${path}`;
      const { status, text } = await get(path, cookie);
      if (status !== 200) {
        fail(where, `expected 200, got ${status}`);
        continue;
      }
      if (inClub && !text.includes(clubName)) fail(where, "a member of a club is not told which club");
      if (!inClub && text.includes("Your club")) fail(where, "told somebody in no club about 'your club'");
    }
    const choose = (await get("/choose", cookie)).text;
    const strangerLine = choose.includes("If an organizer has invited you");
    if (inClub && strangerLine) fail(`${label} /choose`, "greeted a club member as a stranger");
    if (!inClub && !strangerLine) fail(`${label} /choose`, "the stranger's sentence is missing — the rule above proves nothing");
  }

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
