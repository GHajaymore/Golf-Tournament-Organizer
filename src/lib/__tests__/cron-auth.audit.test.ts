import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * The one unauthenticated door in the app that DELETES, and what guards it.
 *
 * `GET /api/cron/expire-rounds` removes casual rounds whose time is up. It is
 * a GET because that is what Vercel Cron issues, it takes no session, and it
 * is reachable from the open internet — so the bearer check is the only thing
 * standing between a scheduler and anybody with the URL.
 *
 * THE CASE THIS FILE EXISTS FOR IS THE MISSING SECRET. "No secret configured,
 * so let it through" is the tempting reading — it makes the feature work in
 * development and reads like a sensible default — and it publishes a
 * delete-by-clock endpoint the first time somebody forgets an environment
 * variable. An unconfigured cron that never runs is a feature switched off; an
 * unauthenticated one is a way for anyone to force other people's rounds to be
 * swept.
 *
 * Verified by hand with curl when it was written, which is not a guard: the
 * next person to make the sweep "work locally" would flip it and nothing would
 * complain. Hence this.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CRON-AUTH";
const SECRET = "zz-audit-cron-secret";

const { GET } = await import("@/app/api/cron/expire-rounds/route");

let organizationId = "";
const original = process.env.CRON_SECRET;

async function scrub() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const ask = (headers: Record<string, string> = {}) =>
  GET(new Request("https://example.invalid/api/cron/expire-rounds", { headers }));

beforeAll(async () => {
  await scrub();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club` },
    select: { id: true },
  });
  organizationId = org.id;
});

afterAll(async () => {
  await scrub();
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
  await prisma.$disconnect();
});

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  process.env.CRON_SECRET = SECRET;
});

/** A casual round that expired long ago — the sweep's only legitimate target. */
async function expiredRound(name: string) {
  return prisma.event.create({
    data: {
      organizationId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      shareToken: `zz-cron-${Math.random().toString(36).slice(2)}`,
      status: "live",
      shape: "match",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    },
    select: { id: true },
  });
}

describe("who may run the sweep", () => {
  it("refuses a request with no authorization at all", async () => {
    const round = await expiredRound("no header");
    const res = await ask();

    expect(res.status).toBe(401);
    // AND NOTHING WAS DELETED. A 401 that still ran the sweep would be a
    // status code apologising for work it had already done.
    expect(await prisma.event.count({ where: { id: round.id } })).toBe(1);
  });

  it("refuses a wrong secret", async () => {
    const round = await expiredRound("wrong secret");
    const res = await ask({ authorization: "Bearer not-the-secret" });

    expect(res.status).toBe(401);
    expect(await prisma.event.count({ where: { id: round.id } })).toBe(1);
  });

  it("refuses the right secret sent the wrong way", async () => {
    // The scheme matters: a bare token is not `Bearer <token>`, and accepting
    // both is a wider door than the one Vercel Cron actually knocks on.
    const round = await expiredRound("bare token");
    const res = await ask({ authorization: SECRET });

    expect(res.status).toBe(401);
    expect(await prisma.event.count({ where: { id: round.id } })).toBe(1);
  });

  it("REFUSES EVERYTHING when no secret is configured", async () => {
    /**
     * The one that matters, and the one a future change is most likely to
     * "fix": with `CRON_SECRET` unset, a fallback that let requests through
     * would publish an unauthenticated delete endpoint.
     *
     * Both a bare request and one carrying the old secret are refused —
     * because with nothing configured there is no secret to be right.
     */
    delete process.env.CRON_SECRET;
    const round = await expiredRound("no secret configured");

    expect((await ask()).status).toBe(401);
    expect((await ask({ authorization: `Bearer ${SECRET}` })).status).toBe(401);
    expect(await prisma.event.count({ where: { id: round.id } })).toBe(1);
  });

  it("says nothing about WHICH of the two it was", async () => {
    // "No secret is configured" is a useful sentence for whoever deploys this
    // and a map for anybody else. The body is the same either way.
    delete process.env.CRON_SECRET;
    const unconfigured = await (await ask()).json();
    process.env.CRON_SECRET = SECRET;
    const wrong = await (await ask({ authorization: "Bearer nope" })).json();

    expect(unconfigured).toEqual(wrong);
  });

  it("lets the scheduler through, and actually sweeps", async () => {
    /**
     * THE ASSERTION THAT STOPS THE FIVE ABOVE BECOMING "REFUSE EVERYTHING".
     *
     * A route that always 401s passes every refusal test in this file and
     * silently switches the feature off. The two answers must differ.
     */
    const round = await expiredRound("swept");
    const res = await ask({ authorization: `Bearer ${SECRET}` });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.deleted).toBeGreaterThan(0);
    expect(await prisma.event.count({ where: { id: round.id } })).toBe(0);
  });

  it("returns a count and never a name", async () => {
    // This runs in production and its response reaches logs. A casual round is
    // named after the people playing it.
    await expiredRound("private name");
    const body = await (await ask({ authorization: `Bearer ${SECRET}` })).json();

    expect(JSON.stringify(body)).not.toContain(TAG);
    expect(typeof body.deleted).toBe("number");
  });
});
