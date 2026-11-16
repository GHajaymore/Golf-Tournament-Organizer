import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { membershipFor, threadsFor, threadView, postToScope, markRead } from "@/lib/services/messaging";
import { scopeKey, directKeyFor } from "@/lib/domain/messaging";

/**
 * EVERY THREAD WRITTEN BEFORE THE WHO-KEY READS THE SAME AFTER IT (J39/J40
 * PR 2; the test plan's A14, against real rows).
 *
 * The rename is Prisma `@map` only: `authorKey`, `createdByKey` and `whoKey`
 * are the old `authorEmail`, `createdByEmail` and `email` COLUMNS. So rows are
 * written here the way the deployed app wrote them — raw SQL naming the old
 * columns — and then read through the renamed fields: a direct thread is still
 * its two people's, a read mark still clears the badge, a message is still
 * "mine" to its author, and a thread's id (a hash of its scope) is unchanged,
 * so a post after the rename lands in the SAME thread, not a second one.
 *
 * Fixtures: `zz-keep-threads`, invented names, `@example.invalid`, deleted in `finally`.
 */

const prisma = new PrismaClient();
const MARK = "zz-keep-threads";
const RITA = `${MARK}-rita@example.invalid`;
const SAM = `${MARK}-sam@example.invalid`;
let orgId = "";
let eventId = "";
let directId = "";
let roundId = "";
let stageId = "";

/** The deployed app's own derivation of a thread id (`threadIdFor`, services/messaging.ts), worked here independently. */
const idFor = (org: string, ev: string | null, key: string) => `th_${createHash("sha256").update(`${org}|${ev ?? ""}|${key}`).digest("hex").slice(0, 24)}`;

async function cleanUp() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
}

describe("threads written before the who-key read the same after it", () => {
  beforeAll(async () => {
    await cleanUp();
    orgId = (await prisma.organization.create({ data: { name: `${MARK} Larkfield`, kind: "club", timeZone: "UTC" }, select: { id: true } })).id;
    eventId = (
      await prisma.event.create({
        data: { name: `${MARK} Medal`, organizationId: orgId, status: "live", shape: "single", format: "stroke", dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${MARK}-${Date.now()}` },
        select: { id: true },
      })
    ).id;
    stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 }, select: { id: true } })).id;
    for (const [i, e] of [RITA, SAM].entries()) {
      await prisma.player.create({ data: { eventId, name: e.split("@")[0], email: e, status: "confirmed", seed: i + 1 } });
    }
    // Written as the deployed app wrote them: the OLD column names, raw.
    const dKey = scopeKey("direct", directKeyFor([RITA, SAM]));
    directId = idFor(orgId, eventId, dKey);
    roundId = idFor(orgId, eventId, scopeKey("round", stageId));
    for (const [id, key] of [[directId, dKey], [roundId, scopeKey("round", stageId)]]) {
      await prisma.$executeRaw`INSERT INTO "Thread" ("id", "organizationId", "eventId", "scopeKey", "title", "createdByEmail", "createdByName", "lastMessageAt") VALUES (${id}, ${orgId}, ${eventId}, ${key}, '', ${RITA}, 'Rita', now())`;
    }
    for (const e of [RITA, SAM]) {
      await prisma.$executeRaw`INSERT INTO "ThreadParticipant" ("id", "threadId", "email") VALUES (${`${MARK}-${e}`}, ${directId}, ${e})`;
    }
    await prisma.$executeRaw`INSERT INTO "Message" ("id", "threadId", "authorEmail", "authorName", "body", "createdAt") VALUES (${`${MARK}-m1`}, ${directId}, ${RITA}, 'Rita', 'zz before the rename', now() - interval '1 hour')`;
    await prisma.$executeRaw`INSERT INTO "Message" ("id", "threadId", "authorEmail", "authorName", "body", "createdAt") VALUES (${`${MARK}-m2`}, ${roundId}, ${SAM}, 'Sam', 'zz round note', now() - interval '1 hour')`;
    await prisma.$executeRaw`INSERT INTO "ThreadRead" ("id", "threadId", "email", "lastReadAt") VALUES (${`${MARK}-r1`}, ${roundId}, ${RITA}, now())`;
  });

  afterAll(async () => {
    try {
      await cleanUp();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("the renamed fields read the old columns", async () => {
    const m = await prisma.message.findUniqueOrThrow({ where: { id: `${MARK}-m1` } });
    expect(m.authorKey).toBe(RITA);
    expect((await prisma.thread.findUniqueOrThrow({ where: { id: directId } })).createdByKey).toBe(RITA);
    expect(await prisma.threadParticipant.count({ where: { threadId: directId, whoKey: { in: [RITA, SAM] } } })).toBe(2);
    expect(await prisma.threadRead.findUnique({ where: { threadId_whoKey: { threadId: roundId, whoKey: RITA } } })).not.toBeNull();
  });

  it("a direct thread is still its two people's, and the message still the author's own", async () => {
    const rita = (await membershipFor({ email: RITA, role: "player" }, eventId))!;
    const view = await threadView(rita, directId);
    expect(view?.messages.map((m) => [m.body, m.mine])).toEqual([["zz before the rename", true]]);
    const sam = (await membershipFor({ email: SAM, role: "player" }, eventId))!;
    expect((await threadView(sam, directId))?.messages[0].mine).toBe(false);
  });

  it("a read mark still clears the badge, and the unread still counts for the other", async () => {
    const rita = (await membershipFor({ email: RITA, role: "player" }, eventId))!;
    expect((await threadsFor(rita)).find((t) => t.id === roundId)?.unread).toBe(0);
    const sam = (await membershipFor({ email: SAM, role: "player" }, eventId))!;
    expect((await threadsFor(sam)).find((t) => t.id === directId)?.unread).toBe(1);
    await markRead(sam, directId);
    expect((await threadsFor(sam)).find((t) => t.id === directId)?.unread).toBe(0);
  });

  it("a post after the rename lands in the SAME thread (its id is a hash of its scope)", async () => {
    const sam = (await membershipFor({ email: SAM, role: "player" }, eventId))!;
    const res = await postToScope(sam, scopeKey("round", stageId), "zz after the rename", "Sam");
    expect(res.threadId).toBe(roundId);
    expect(await prisma.thread.count({ where: { organizationId: orgId } })).toBe(2);
  });
});
