import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  membershipFor,
  threadsFor,
  threadView,
  postToScope,
  staffBroadcast,
  openDirectThread,
  markRead,
  unreadTotal,
  messageableField,
  messagesOptOutFor,
  setMessagesOptOut,
  broadcastWithSms,
  planSmsBroadcast,
} from "@/lib/services/messaging";
import { scopeKey, teeGroupId } from "@/lib/domain/messaging";

/**
 * Messaging isolation, against a real database.
 *
 * The domain tests prove the rules; these prove the queries implement them.
 * That gap is where this kind of feature actually fails — a correct permission
 * function and a query that forgets to apply it look identical in a unit test.
 *
 * Everything here is written from the attacker's side: a player in flight A
 * holding a thread id from flight B, an outsider on the roster holding an
 * event thread id, a player holding the organizers' thread id.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MSG";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let eventId = "";
let orgId = "";
let stageId = "";
let otherStageId = "";
let flightA = "";
let flightB = "";
let matchId = "";
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.thread.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;

  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
    },
  });
  eventId = event.id;

  const [ga, gb] = await Promise.all([
    prisma.group.create({ data: { eventId, name: "A", position: 0 } }),
    prisma.group.create({ data: { eventId, name: "B", position: 1 } }),
  ]);
  flightA = ga.id;
  flightB = gb.id;

  const [s1, s2] = await Promise.all([
    prisma.stage.create({
      data: {
        eventId,
        position: 0,
        type: "Round Robin",
        format: "Match Play",
        holes: 18,
        teeSheet: JSON.stringify({
          savedAt: new Date().toISOString(),
          startType: "tee",
          groups: [{ name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [] }],
        }),
      },
    }),
    prisma.stage.create({ data: { eventId, position: 1, type: "Round Robin", format: "Match Play", holes: 18 } }),
  ]);
  stageId = s1.id;
  otherStageId = s2.id;

  // rita + sam in flight A, dev in flight B, olive on the roster only.
  for (const [i, who] of ["rita", "sam", "dev"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: at(who),
        seed: i + 1,
        status: "confirmed",
        groupId: who === "dev" ? flightB : flightA,
      },
    });
    player[who] = p.id;
    await prisma.member.create({
      data: { organizationId: orgId, name: `${TAG} ${who}`, email: at(who) },
    });
  }
  await prisma.member.create({
    data: { organizationId: orgId, name: `${TAG} olive`, email: at("olive") },
  });

  const m = await prisma.match.create({
    data: { eventId, stageId, groupId: flightA, round: 1, playerAId: player.rita, playerBId: player.sam, holes: "[]" },
  });
  matchId = m.id;

  // rita's four on round one.
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheet: JSON.stringify({
        savedAt: new Date().toISOString(),
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [player.rita, player.sam] },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [player.dev] },
        ],
      }),
    },
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const ctxFor = (who: string, role: "admin" | "assistant" | "player" = "player") =>
  membershipFor(eventId, at(who), role);

describe("membership is derived from the tournament", () => {
  it("puts a player in their own flight, round, match and four", async () => {
    const rita = (await ctxFor("rita"))!;
    expect(rita.groupIds).toEqual([flightA]);
    expect(rita.matchIds).toContain(matchId);
    expect(rita.stageIds).toContain(stageId);
    expect(rita.foursomeIds).toContain(teeGroupId(stageId, "Group 1"));
    expect(rita.foursomeIds).not.toContain(teeGroupId(stageId, "Group 2"));
  });

  it("leaves a roster member who is not entered out of the tournament", async () => {
    const olive = (await ctxFor("olive"))!;
    expect(olive.playerId).toBeNull();
    expect(olive.onRoster).toBe(true);
    expect(olive.groupIds).toEqual([]);
    expect(olive.stageIds).toEqual([]);
  });
});

describe("a thread id from somewhere else", () => {
  it("does not open another flight's conversation", async () => {
    // The attack this whole design is shaped around. dev posts in flight B,
    // rita has the id, and the id is worth nothing.
    const dev = (await ctxFor("dev"))!;
    const posted = await postToScope(dev, scopeKey("flight", flightB), "B only", "Dev");
    expect(posted.ok).toBe(true);

    const rita = (await ctxFor("rita"))!;
    expect(await threadView(rita, posted.threadId!)).toBeNull();

    // And it is absent from her list, not merely unopenable.
    const list = await threadsFor(rita);
    expect(list.map((t) => t.id)).not.toContain(posted.threadId);
  });

  it("does not open the organizers' conversation", async () => {
    const admin = (await ctxFor("rita", "admin"))!;
    const posted = await staffBroadcast(admin, scopeKey("staff"), "Back room", "Organizer");
    expect(posted.ok).toBe(true);

    const samAsPlayer = (await ctxFor("sam"))!;
    expect(await threadView(samAsPlayer, posted.threadId!)).toBeNull();
  });

  it("does not open a tournament thread for someone only on the roster", async () => {
    const admin = (await ctxFor("rita", "admin"))!;
    const posted = await staffBroadcast(admin, scopeKey("event"), "Tee times up", "Organizer");
    expect(posted.ok).toBe(true);

    const olive = (await ctxFor("olive"))!;
    expect(await threadView(olive, posted.threadId!)).toBeNull();
  });

  it("does not open a direct conversation between two other people", async () => {
    const rita = (await ctxFor("rita"))!;
    // The first message rides along with opening it. Two separate calls used
    // to fail here: the caller's context was built before the participant rows
    // existed, so it was told it could not post to the thread it had just
    // created. That is also why this assertion is on the post and not only on
    // the open — the original version of this test performed the post without
    // checking it, and missed a bug that made every direct message invisible.
    const opened = await openDirectThread(rita, [at("sam")], "Rita", "just us");
    expect(opened.ok, opened.error).toBe(true);

    const dev = (await ctxFor("dev"))!;
    expect(await threadView(dev, opened.threadId!)).toBeNull();

    // Sam, who is in it, does see it.
    const sam = (await ctxFor("sam"))!;
    expect(await threadView(sam, opened.threadId!)).not.toBeNull();
  });
});

describe("what a player may write", () => {
  it("cannot post to the whole tournament", async () => {
    const rita = (await ctxFor("rita"))!;
    const res = await postToScope(rita, scopeKey("event"), "everyone listen", "Rita");
    expect(res.ok).toBe(false);
  });

  it("cannot broadcast even by calling the staff path directly", async () => {
    // The endpoint exists and takes a scope; the role check has to be in the
    // service, not only in the UI that hides the button.
    const rita = (await ctxFor("rita"))!;
    const res = await staffBroadcast(rita, scopeKey("event"), "everyone listen", "Rita");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/organizer/i);
  });

  it("can post to their own four", async () => {
    const rita = (await ctxFor("rita"))!;
    const res = await postToScope(
      rita,
      scopeKey("foursome", teeGroupId(stageId, "Group 1")),
      "running 5 late",
      "Rita",
    );
    expect(res.ok).toBe(true);

    // Sam is in that four and sees it; dev is not and does not.
    const sam = (await ctxFor("sam"))!;
    expect((await threadView(sam, res.threadId!))?.messages[0].body).toBe("running 5 late");
    const dev = (await ctxFor("dev"))!;
    expect(await threadView(dev, res.threadId!)).toBeNull();
  });

  it("cannot post into a four they are not in, id or no id", async () => {
    const dev = (await ctxFor("dev"))!;
    const res = await postToScope(
      dev,
      scopeKey("foursome", teeGroupId(stageId, "Group 1")),
      "let me in",
      "Dev",
    );
    expect(res.ok).toBe(false);
  });
});

describe("an organizer broadcasting", () => {
  it("reaches a flight they are not personally in", async () => {
    const admin = (await ctxFor("rita", "admin"))!;
    const res = await staffBroadcast(admin, scopeKey("flight", flightB), "B tees at 9", "Organizer");
    expect(res.ok).toBe(true);
    const dev = (await ctxFor("dev"))!;
    expect((await threadView(dev, res.threadId!))?.messages.at(-1)?.body).toBe("B tees at 9");
  });

  it("cannot reach a flight in another tournament", async () => {
    // The cross-tenant hole the IDOR sweep exists for: staff of one event
    // naming another event's group id.
    const other = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} other`,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-other-${Date.now()}`,
      },
    });
    const foreign = await prisma.group.create({ data: { eventId: other.id, name: "X", position: 0 } });

    const admin = (await ctxFor("rita", "admin"))!;
    const res = await staffBroadcast(admin, scopeKey("flight", foreign.id), "hello", "Organizer");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/isn't in this tournament/i);

    await prisma.event.delete({ where: { id: other.id } });
  });

  it("cannot broadcast into a private four", async () => {
    // Bounded to structural scopes. An organizer posting to every flight is
    // the job; sitting inside a private group's conversation is not.
    const admin = (await ctxFor("rita", "admin"))!;
    const res = await staffBroadcast(
      admin,
      scopeKey("foursome", teeGroupId(stageId, "Group 2")),
      "listening in",
      "Organizer",
    );
    expect(res.ok).toBe(false);
  });
});

describe("unread", () => {
  it("counts somebody else's message and clears when read", async () => {
    const sam = (await ctxFor("sam"))!;
    const before = await unreadTotal(sam);

    const rita = (await ctxFor("rita"))!;
    const res = await postToScope(rita, scopeKey("match", matchId), "good luck", "Rita");
    expect(res.ok).toBe(true);

    expect(await unreadTotal(sam)).toBe(before + 1);
    await markRead(sam, res.threadId!);
    expect(await unreadTotal(sam)).toBe(before);
  });

  it("never counts your own", async () => {
    const rita = (await ctxFor("rita"))!;
    const before = await unreadTotal(rita);
    await postToScope(rita, scopeKey("match", matchId), "and again", "Rita");
    expect(await unreadTotal(rita)).toBe(before);
  });
});

describe("direct threads", () => {
  it("refuses somebody outside the tournament and names them", async () => {
    const rita = (await ctxFor("rita"))!;
    const res = await openDirectThread(rita, ["stranger@example.invalid"], "Rita");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("stranger@example.invalid");
  });

  it("gives both people the same thread whoever opens it", async () => {
    const rita = (await ctxFor("rita"))!;
    const sam = (await ctxFor("sam"))!;
    const a = await openDirectThread(rita, [at("sam")], "Rita");
    const b = await openDirectThread(sam, [at("rita")], "Sam");
    expect(a.threadId).toBe(b.threadId);
  });
});

describe("a round the player is not in", () => {
  it("is still visible, because being in the field is what a round thread is for", async () => {
    // Deliberate and worth pinning: a stroke-play round has no matches, so
    // membership of a round is membership of the field. If this ever narrows
    // to "has a match in it", the commonest format in the product loses its
    // round conversation silently.
    const rita = (await ctxFor("rita"))!;
    expect(rita.stageIds).toContain(otherStageId);
  });
});

describe("turning direct messages off", () => {
  it("stops another player starting a conversation, and says who", async () => {
    await prisma.member.updateMany({
      where: { organizationId: orgId, email: at("sam") },
      data: { messagesOptOut: true },
    });

    const rita = (await ctxFor("rita"))!;
    const res = await openDirectThread(rita, [at("sam")], "Rita", "hello");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/turned off direct messages/i);
  });

  it("takes them out of the list people pick from", async () => {
    // Enforced at the endpoint AND in the picker. An opt-out you can watch
    // being refused is not much of an opt-out.
    const rita = (await ctxFor("rita"))!;
    const book = await messageableField(rita);
    expect(book.map((p) => p.email)).not.toContain(at("sam"));
    expect(book.map((p) => p.email)).toContain(at("dev"));
  });

  it("does not silence the organizer", async () => {
    // The whole reason the switch is narrow. Somebody who opts out must still
    // find out their tee time, so tournament and flight threads are untouched.
    const admin = (await ctxFor("rita", "admin"))!;
    const res = await staffBroadcast(admin, scopeKey("event"), "Frost delay, 30 mins", "Organizer");
    expect(res.ok).toBe(true);

    const sam = (await ctxFor("sam"))!;
    const seen = await threadView(sam, res.threadId!);
    expect(seen?.messages.at(-1)?.body).toBe("Frost delay, 30 mins");
  });

  it("does not stop them reading or writing themselves", async () => {
    // Opting out of being contacted is not leaving. They keep their four, their
    // match and every conversation they were already in.
    const sam = (await ctxFor("sam"))!;
    const res = await postToScope(sam, scopeKey("match", matchId), "still here", "Sam");
    expect(res.ok, res.error).toBe(true);
  });

  it("is not something staff can override", async () => {
    // An organizer who needs this person has the tournament and flight
    // threads. A staff bypass on the private channel would make the setting
    // advisory, which is not what it says on the screen.
    const admin = (await ctxFor("rita", "admin"))!;
    const res = await openDirectThread(admin, [at("sam")], "Organizer", "quick word");
    expect(res.ok).toBe(false);
  });

  it("is set against the caller's own row and nobody else's", async () => {
    const sam = (await ctxFor("sam"))!;
    expect(await messagesOptOutFor(sam)).toBe(true);

    // Turning it back off is the caller's own row — there is no id to point
    // anywhere else, which is the point of the signature.
    expect(await setMessagesOptOut(sam, false)).toBe(true);
    expect(await messagesOptOutFor(sam)).toBe(false);
    expect(await messagesOptOutFor((await ctxFor("rita"))!)).toBe(false);
  });
});

describe("the SMS plan gate", () => {
  it("still delivers the message in the app when texting is off", async () => {
    // The ordering that matters: the in-app broadcast is written first and
    // unconditionally, so a club without texting still reaches everybody.
    // Losing the announcement because the paid feature is off would be the
    // worst possible trade.
    const admin = (await ctxFor("rita", "admin"))!;
    const res = await broadcastWithSms(
      admin,
      scopeKey("event"),
      "Tee times are up",
      "Organizer",
      `${TAG} club`,
    );
    expect(res.ok, res.error).toBe(true);
    expect(res.texted).toBe(0);

    const dev = (await ctxFor("dev"))!;
    expect((await threadView(dev, res.threadId!))?.messages.at(-1)?.body).toBe("Tee times are up");
  });

  it("texts nobody, however many have opted in", async () => {
    // The gate is in the service, not the screen, so reaching the endpoint
    // directly cannot spend the club's money.
    await prisma.member.updateMany({
      where: { organizationId: orgId },
      data: { smsOptIn: true, phone: "+447700900500" },
    });

    const admin = (await ctxFor("rita", "admin"))!;
    const res = await broadcastWithSms(
      admin,
      scopeKey("event"),
      "Frost delay",
      "Organizer",
      `${TAG} club`,
    );
    expect(res.texted).toBe(0);
    expect(res.failed).toBe(0);

    // And nothing was even attempted — no delivery rows, so no carrier call.
    const attempts = await prisma.smsDelivery.count({ where: { organizationId: orgId } });
    expect(attempts).toBe(0);
  });

  it("says it is the plan, not the carrier", async () => {
    // An organizer told "SMS isn't configured" goes looking for a setting.
    // The refusal has to name the real reason and say what still happens.
    const admin = (await ctxFor("rita", "admin"))!;
    const plan = await planSmsBroadcast(admin, scopeKey("event"), "Frost delay", `${TAG} club`);
    expect(plan.configured).toBe(false);
    expect(plan.recipients).toBe(0);
    expect(plan.problem).toMatch(/still reaches everyone in the app/i);
    expect(plan.problem).not.toMatch(/TWILIO|credentials/i);
  });
});
