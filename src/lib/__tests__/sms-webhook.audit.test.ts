import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * The inbound SMS webhook is the most exposed endpoint in the app.
 *
 * It is public by necessity — a carrier has no session — and it changes a
 * consent flag by phone number alone. Without a verified signature anyone who
 * found the URL could post `From=<a member's number>&Body=STOP` and
 * unsubscribe them from their club's tee-time texts, silently.
 *
 * So these tests are written from the attacker's side: a forged post, a
 * replayed post with one parameter changed, and the case where the server has
 * no token to verify with at all.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const TOKEN = "ZZ-AUDIT-TWILIO-TOKEN";
const URL = "https://example.invalid/api/sms/inbound";

vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
vi.stubEnv("TWILIO_INBOUND_URL", URL);

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SMSHOOK";
const PHONE = "+447700900871";

let orgId = "";
let memberId = "";

/** Twilio's own scheme, so the test signs the way the carrier does. */
function sign(params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], URL);
  return createHmac("sha1", TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

async function post(params: Record<string, string>, signature: string | null) {
  const { POST } = await import("@/app/api/sms/inbound/route");
  const body = new FormData();
  for (const [k, v] of Object.entries(params)) body.set(k, v);
  return POST(
    new Request(URL, {
      method: "POST",
      body,
      headers: signature === null ? {} : { "x-twilio-signature": signature },
    }),
  );
}

async function cleanup() {
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  const m = await prisma.member.create({
    data: {
      organizationId: orgId,
      name: `${TAG} rita`,
      email: `${TAG}.rita@example.invalid`.toLowerCase(),
      // Stored the way a member typed it — national, with a space. The reply
      // will arrive in international form, which is the ordinary case.
      phone: "07700 900871",
      smsOptIn: true,
    },
  });
  memberId = m.id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const optedIn = async () =>
  (await prisma.member.findUniqueOrThrow({ where: { id: memberId } })).smsOptIn;

describe("a forged request", () => {
  it("is refused with no signature at all", async () => {
    const res = await post({ From: PHONE, Body: "STOP" }, null);
    expect(res.status).toBe(403);
    expect(await optedIn()).toBe(true);
  });

  it("is refused with a wrong signature", async () => {
    const res = await post({ From: PHONE, Body: "STOP" }, "not-a-real-signature");
    expect(res.status).toBe(403);
    expect(await optedIn()).toBe(true);
  });

  it("is refused when a valid signature is reused with a changed parameter", async () => {
    // The realistic attack: capture one legitimate callback, swap the number.
    // The signature covers every parameter, so it stops matching.
    const genuine = { From: "+447700900999", Body: "STOP" };
    const stolen = sign(genuine);
    const res = await post({ From: PHONE, Body: "STOP" }, stolen);
    expect(res.status).toBe(403);
    expect(await optedIn()).toBe(true);
  });

  it("says nothing about which part failed", async () => {
    const res = await post({ From: PHONE, Body: "STOP" }, "wrong");
    expect((await res.text()).toLowerCase()).not.toMatch(/signature|token|member|phone/);
  });
});

describe("a genuine STOP", () => {
  it("opts them out, matching a number stored in another format", async () => {
    const params = { From: PHONE, Body: "STOP" };
    const res = await post(params, sign(params));
    expect(res.status).toBe(200);
    expect(await optedIn()).toBe(false);
  });

  it("records when, because a boolean cannot answer a consent question", async () => {
    const row = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    expect(row.smsOptOutAt).not.toBeNull();
  });

  it("confirms in the reply without asking them to confirm again", async () => {
    // Somebody texting STOP has already decided. A "are you sure?" is another
    // text they did not want.
    const params = { From: PHONE, Body: "STOP" };
    const res = await post(params, sign(params));
    // The message itself, not the envelope — the XML declaration is full of
    // question marks and asserting on the whole body tests nothing.
    const said = (await res.text()).match(/<Message>([\s\S]*?)<\/Message>/)?.[1] ?? "";
    expect(said).toMatch(/won't get any more texts/i);
    expect(said).not.toContain("?");
  });
});

describe("START", () => {
  it("turns them back on and records when", async () => {
    const params = { From: PHONE, Body: "start" };
    const res = await post(params, sign(params));
    expect(res.status).toBe(200);
    const row = await prisma.member.findUniqueOrThrow({ where: { id: memberId } });
    expect(row.smsOptIn).toBe(true);
    expect(row.smsOptInAt).not.toBeNull();
  });
});

describe("an ordinary reply", () => {
  it("changes nothing and answers with nothing", async () => {
    // "we had to stop at the turn" must not unsubscribe anybody.
    const params = { From: PHONE, Body: "we had to stop at the turn" };
    const res = await post(params, sign(params));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(/<Message>/);
    expect(await optedIn()).toBe(true);
  });
});

describe("a number nobody on any roster has", () => {
  it("is answered with silence rather than a hint", async () => {
    const params = { From: "+447700900000", Body: "STOP" };
    const res = await post(params, sign(params));
    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(/<Message>/);
  });
});
