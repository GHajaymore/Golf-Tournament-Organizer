import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A FORGOTTEN PASSWORD IS TOLD THE TRUTH ABOUT THE EMAIL (2026-10-11).
 *
 * Ajay, 2026-10-11: "yes for now." With no mail provider the reset request
 * made a token, failed to send it, answered `{ ok: true }`, and the screen
 * said "a reset link is on its way" — to somebody who would wait for a message
 * that could not come. Found by a walk of the front door, not by a test: the
 * browser suite's server has no mail key, and `front-door.spec` had pinned the
 * false sentence.
 *
 * Two rules, and they pull against each other, which is why both are here:
 *
 *   - where the site cannot send mail, the answer says so (`sent: false`) and
 *     NO token is made — a working credential that nobody can ever be handed;
 *   - the answer never depends on the ADDRESS. A registered address and a
 *     made-up one get the same object in both states, or the form becomes a
 *     way to ask "does this person have an account?".
 *
 * Against real rows because "no token was made" is a statement about a table.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const mail = vi.hoisted(() => ({ configured: true, sent: [] as string[] }));

vi.mock("@/lib/email", () => ({
  emailConfig: () => ({ configured: mail.configured, sandboxSender: false, problem: null }),
  sendPasswordResetEmail: async (to: string) => {
    mail.sent.push(to);
    return { ok: true };
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));

import { hashPassword } from "@/lib/auth";
import { requestPasswordReset } from "@/app/actions/auth";
import { clearRateLimit } from "@/lib/rate-limit";

const prisma = new PrismaClient();
const MARK = `zz-forgot-${process.pid}`;
const REAL = `${MARK}@example.invalid`;
const NOBODY = `${MARK}-nobody@example.invalid`;
let userId = "";

const tokens = () => prisma.passwordResetToken.count({ where: { userId } });
/**
 * Each case asks afresh. The limit on reset requests (five an hour for an
 * address) is not what is being tested, and it is KEYED BY A HASH of the
 * address — so deleting rows whose key "contains" the address deletes nothing.
 * The first draft did exactly that, and its control then passed on the sixth
 * call being refused rather than on the two states differing.
 */
const afresh = async () => {
  await clearRateLimit("password-reset", REAL);
  await clearRateLimit("password-reset", NOBODY);
};

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: REAL, name: "Zz Forgot", password: hashPassword("a-long-Fairway-71-pass") } });
  userId = user.id;
});

beforeEach(async () => {
  mail.sent.length = 0;
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await afresh();
});

afterAll(async () => {
  try {
    await afresh();
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("asking for a reset link where the site can send mail", () => {
  it("makes one link for a real account, sends it, and says it was sent", async () => {
    mail.configured = true;
    expect(await requestPasswordReset(REAL)).toEqual({ ok: true, sent: true });
    expect(await tokens()).toBe(1);
    expect(mail.sent).toEqual([REAL]);
  });

  it("says exactly the same for an address nobody has, and sends nothing", async () => {
    mail.configured = true;
    const forReal = await requestPasswordReset(REAL);
    const forNobody = await requestPasswordReset(NOBODY);
    expect(forNobody, "the answer tells a registered address from an unregistered one").toEqual(forReal);
    expect(mail.sent).toEqual([REAL]);
  });
});

describe("asking for a reset link where the site has no way to send mail", () => {
  it("says no link was sent, and makes none", async () => {
    mail.configured = false;
    expect(await requestPasswordReset(REAL)).toEqual({ ok: true, sent: false });
    expect(await tokens(), "a reset link was made that nobody can ever be sent").toBe(0);
    expect(mail.sent).toEqual([]);
  });

  it("says exactly the same for an address nobody has", async () => {
    mail.configured = false;
    const forReal = await requestPasswordReset(REAL);
    const forNobody = await requestPasswordReset(NOBODY);
    expect(forNobody, "the answer tells a registered address from an unregistered one").toEqual(forReal);
  });

  it("CONTROL: the two states really differ, so the screen has something to be honest about", async () => {
    mail.configured = true;
    const can = await requestPasswordReset(REAL);
    mail.configured = false;
    const cannot = await requestPasswordReset(REAL);
    expect(can).toEqual({ ok: true, sent: true });
    expect(cannot).toEqual({ ok: true, sent: false });
  });

  it("still refuses something that is not an address, before anything else", async () => {
    mail.configured = false;
    expect(await requestPasswordReset("not an address")).toEqual({ ok: false, error: "Enter a valid email address." });
  });
});
