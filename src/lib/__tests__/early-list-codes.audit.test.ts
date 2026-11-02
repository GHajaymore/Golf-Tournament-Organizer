import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * SENDING THE EARLY-LIST CODES, AGAINST REAL ROWS (2026-10-23).
 *
 * The owner's message going out, so it is held to the rows: nothing while held; once live, one
 * code per address on the early list, each its own single-use 25% code, recorded; never more in a
 * day than RESEND_DAILY_LIMIT, the rest said and left for the next press; never twice; a send that
 * fails records nothing and switches its code off; and nobody but an owner can press it.
 *
 * NO MAIL LEAVES: the sender is replaced, and every address is @example.invalid. It REFUSES TO RUN
 * if the database holds a note of interest that is not this test's — the action reads the whole
 * list, and a test must not make a code for, or record a send to, anybody real.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const MARK = "zz-early-list";
const OWNER = `${MARK}-owner@example.invalid`;
const NO_USER = "zz-early-list-no-such-user";
let session: { email: string; userId: string } | null = { email: OWNER, userId: NO_USER };
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth", () => ({ getSession: async () => session }));

const mail: Array<{ to: string; code: string; name: string }> = [];
let mailFails = false;
vi.mock("@/lib/email", () => ({
  sendEarlyListCodeEmail: async (to: string, name: string, code: string) => {
    if (mailFails) return { ok: false, error: "zz: the mail service refused" };
    mail.push({ to, code, name });
    return { ok: true };
  },
}));

const { sendEarlyListCodes } = await import("@/app/actions/owner");
const { SIGNINS_KEY } = await import("@/lib/services/signins-switch");
const { EARLY_LIST } = await import("@/lib/go-live");
const started = new Date(Date.now() - 1000);

const saved: Record<string, string | undefined> = {};
let switchWas: string | null = null;
let foreign = 0;
const madeCodes = new Set<string>();

const setSwitch = async (value: string | null) => {
  if (value === null) await prisma.platformSetting.deleteMany({ where: { key: SIGNINS_KEY } });
  else await prisma.platformSetting.upsert({ where: { key: SIGNINS_KEY }, update: { value }, create: { key: SIGNINS_KEY, value } });
};

async function cleanup() {
  const sends = await prisma.earlyListSend.findMany({ where: { email: { startsWith: MARK } } });
  for (const s of sends) if (s.code) madeCodes.add(s.code);
  for (const m of mail) madeCodes.add(m.code);
  for (const c of await prisma.discountCode.findMany({ where: { label: EARLY_LIST.codeLabel, createdAt: { gte: started } } })) madeCodes.add(c.code);
  await prisma.earlyListSend.deleteMany({ where: { email: { startsWith: MARK } } });
  if (madeCodes.size) await prisma.discountCode.deleteMany({ where: { code: { in: [...madeCodes] } } });
  await prisma.interestRequest.deleteMany({ where: { email: { startsWith: MARK } } });
}

beforeAll(async () => {
  foreign = await prisma.interestRequest.count({ where: { NOT: { email: { startsWith: "zz-" } } } });
  switchWas = (await prisma.platformSetting.findUnique({ where: { key: SIGNINS_KEY } }))?.value ?? null;
  for (const k of ["VERCEL_ENV", "OWNER_EMAILS", "SIGNINS", "SIGNIN_ALLOW_EMAILS", "RESEND_DAILY_LIMIT"]) saved[k] = process.env[k];
  process.env.VERCEL_ENV = "production";
  process.env.OWNER_EMAILS = OWNER;
  delete process.env.SIGNINS;
  delete process.env.SIGNIN_ALLOW_EMAILS;
  process.env.RESEND_DAILY_LIMIT = "2";
  await cleanup();
});

afterAll(async () => {
  try {
    await cleanup();
    await setSwitch(switchWas);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await prisma.$disconnect();
  }
});

describe("sending the early-list codes", () => {
  it("runs only where every note of interest is a fixture", () => {
    expect(foreign, "the database holds notes of interest that are not fixtures — this test would make codes for them").toBe(0);
  });

  it("does nothing while held — the codes are for launch", async () => {
    await setSwitch(null);
    await prisma.interestRequest.create({ data: { name: "Zz Ann", email: `${MARK}-a@example.invalid`, club: "Zz Club", role: "secretary" } });
    const res = await sendEarlyListCodes();
    expect(res.ok).toBe(false);
    expect(mail).toEqual([]);
    expect(await prisma.earlyListSend.count({ where: { email: { startsWith: MARK } } })).toBe(0);
  });

  it("nobody but an owner can press it", async () => {
    await setSwitch("open");
    session = { email: `${MARK}-stranger@example.invalid`, userId: NO_USER };
    try {
      expect((await sendEarlyListCodes()).ok).toBe(false);
      expect(mail).toEqual([]);
    } finally {
      session = { email: OWNER, userId: NO_USER };
    }
  });

  it("once live: one code per address, two today (the limit), the rest said and left for the next press", async () => {
    await setSwitch("held");
    // Written while held: Ann twice, Bo, Cy. Then live; then Late writes, and was promised nothing.
    await prisma.interestRequest.create({ data: { name: "Zz Ann again", email: `${MARK}-A@example.invalid`, club: "Zz Club", role: "secretary" } });
    await prisma.interestRequest.create({ data: { name: "Zz Bo", email: `${MARK}-b@example.invalid`, club: "Zz Club", role: "society" } });
    await prisma.interestRequest.create({ data: { name: "Zz Cy", email: `${MARK}-c@example.invalid`, club: "Zz Club", role: "committee" } });
    await new Promise((r) => setTimeout(r, 20));
    await setSwitch("open");
    await new Promise((r) => setTimeout(r, 20));
    await prisma.interestRequest.create({ data: { name: "Zz Late", email: `${MARK}-late@example.invalid`, club: "Zz Club", role: "secretary" } });

    const first = await sendEarlyListCodes();
    expect(first).toMatchObject({ ok: true, sent: 2, later: 1 });
    expect(first.nextAt, "the card is not told when the rest can go").toBeTruthy();
    expect(mail.map((m) => m.to)).toEqual([`${MARK}-a@example.invalid`, `${MARK}-b@example.invalid`]);
    expect(mail[0].name).toBe("Zz Ann");

    // Recorded: who was sent what — and each code is its own, single-use, 25% off.
    const rows = await prisma.earlyListSend.findMany({ where: { email: { startsWith: MARK } }, orderBy: { sentAt: "asc" } });
    expect(rows.map((r) => [r.email, r.code, r.status])).toEqual(mail.map((m) => [m.to, m.code, "sent"]));
    expect(new Set(mail.map((m) => m.code)).size).toBe(2);
    for (const m of mail) {
      expect(await prisma.discountCode.findUnique({ where: { code: m.code } })).toMatchObject({ percentOff: 25, maxRedemptions: 1, active: true });
    }

    // The same day: the limit is spent, so nothing goes; the one left is still owed.
    const again = await sendEarlyListCodes();
    expect(again).toMatchObject({ ok: true, sent: 0, later: 1 });
    expect(mail).toHaveLength(2);
    expect(mail.map((m) => m.to)).not.toContain(`${MARK}-late@example.invalid`);
  });

  it("never twice, and a send that fails records nothing and switches its code off", async () => {
    // Make room in the day, as tomorrow would.
    await prisma.earlyListSend.updateMany({ where: { email: { startsWith: MARK } }, data: { sentAt: new Date(Date.now() - 25 * 3600_000) } });
    mailFails = true;
    try {
      const res = await sendEarlyListCodes();
      expect(res).toMatchObject({ ok: false, sent: 0 });
    } finally {
      mailFails = false;
    }
    expect(await prisma.earlyListSend.count({ where: { email: `${MARK}-c@example.invalid` } }), "a failed send was recorded as sent").toBe(0);
    const orphans = await prisma.discountCode.findMany({ where: { label: EARLY_LIST.codeLabel, createdAt: { gte: started }, code: { notIn: mail.map((m) => m.code) } } });
    for (const o of orphans) madeCodes.add(o.code);
    expect(orphans.length, "no code was made for the failed send — the failure was not reached").toBeGreaterThan(0);
    expect(orphans.filter((o) => o.active), "a code made for a failed send is still switched on").toEqual([]);

    const last = await sendEarlyListCodes();
    expect(last).toMatchObject({ ok: true, sent: 1, later: 0 });
    expect(mail.map((m) => m.to)).toEqual([`${MARK}-a@example.invalid`, `${MARK}-b@example.invalid`, `${MARK}-c@example.invalid`]);
    expect((await sendEarlyListCodes()).sent, "somebody was sent a second code").toBe(0);
  });
});
