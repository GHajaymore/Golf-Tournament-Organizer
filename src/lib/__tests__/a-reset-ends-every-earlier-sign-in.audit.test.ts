import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * A PASSWORD RESET ENDS EVERY EARLIER SIGN-IN (2026-10-11).
 *
 * Against a real row, because the rule is a comparison between a cookie and a
 * column: the session cookie carries when it was issued, a reset moves the
 * person's `sessionsValidFrom` to now, and from then on a cookie issued before
 * it is nobody's session.
 *
 * It used to change the password and leave every existing session working —
 * the cookie was the signed user id and nothing else, so there was nothing to
 * compare. Whoever was in the account stayed in it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
const went = vi.hoisted(() => ({ to: "" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    went.to = to;
  },
}));

import { getSession, hashPassword, sign } from "@/lib/auth";
import { resetPassword, signInWithPassword } from "@/app/actions/auth";
import { SESSION_SECONDS, sessionValue } from "@/lib/domain/session-token";

const prisma = new PrismaClient();
const MARK = `zz-reset-${process.pid}`;
const EMAIL = `${MARK}@example.invalid`;
const OLD_PASSWORD = "the-old-Fairway-71-pass";
const NEW_PASSWORD = "a-new-Bunker-93-pass";

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
/** Who the app says this cookie is. */
const whoIs = async (cookie: string) => {
  jar.clear();
  jar.set("ng_session", cookie);
  return (await getSession())?.userId ?? null;
};

let userId = "";
/** A sign-in from two minutes ago, on some other device. */
let earlier = "";
const tokens = { used: randomBytes(16).toString("hex"), alsoOut: randomBytes(16).toString("hex") };

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { email: EMAIL, name: "Zz Reset", password: hashPassword(OLD_PASSWORD) },
  });
  userId = user.id;
  earlier = sign(sessionValue(userId, ago(120)));
  await prisma.passwordResetToken.createMany({
    data: [tokens.used, tokens.alsoOut].map((t) => ({
      userId,
      tokenHash: hashToken(t),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    })),
  });
});

afterAll(async () => {
  try {
    await prisma.rateLimitHit.deleteMany({ where: { key: { contains: EMAIL } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("a sign-in, before anything is reset", () => {
  it("CONTROL: the earlier sign-in is a good session", async () => {
    // Otherwise "it stopped working" below proves nothing about the reset.
    expect(await whoIs(earlier)).toBe(userId);
  });

  it("is refused once it is older than a sign-in lasts", async () => {
    expect(await whoIs(sign(sessionValue(userId, ago(SESSION_SECONDS + 60))))).toBeNull();
  });

  it("is refused when it is the bare user id an old cookie holds", async () => {
    // This value WAS the session until 2026-10-11, for ever, on every device.
    expect(await whoIs(sign(userId))).toBeNull();
  });

  it("is refused when the signature is somebody else's", async () => {
    const value = sessionValue(userId);
    expect(await whoIs(`${value}.${"A".repeat(43)}`)).toBeNull();
  });
});

describe("resetting the password", () => {
  let fresh = "";

  it("signs the person in with a new session", async () => {
    jar.clear();
    went.to = "";
    await resetPassword(tokens.used, NEW_PASSWORD);
    expect(went.to).toBe("/choose");
    fresh = jar.get("ng_session") ?? "";
    expect(fresh, "the reset did not start a session").not.toBe("");
    expect(await whoIs(fresh)).toBe(userId);
  });

  it("ENDS the sign-in that existed before it", async () => {
    expect(await whoIs(earlier), "a session from before the reset still works — whoever was in the account is still in it").toBeNull();
  });

  it("records the moment, on the person's own row", async () => {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { sessionsValidFrom: true } });
    expect(row?.sessionsValidFrom).toBeInstanceOf(Date);
    expect(Date.now() - row!.sessionsValidFrom!.getTime()).toBeLessThan(60_000);
  });

  it("voids the other reset link that was still out", async () => {
    jar.clear();
    const again = await resetPassword(tokens.alsoOut, "yet-another-Green-55-pass");
    expect(again).toEqual({ ok: false, error: "This reset link is invalid or has expired — request a new one." });
    // And it changed nothing: the password the first link set is still the password.
    jar.clear();
    went.to = "";
    await signInWithPassword(EMAIL, NEW_PASSWORD);
    expect(went.to, "the password the reset set no longer signs in").toBe("/choose");
  });

  it("the old password no longer signs in", async () => {
    jar.clear();
    const refused = await signInWithPassword(EMAIL, OLD_PASSWORD);
    expect(refused).toEqual({ ok: false, error: "Wrong email or password." });
    expect(jar.get("ng_session")).toBeUndefined();
  });

  it("CONTROL: somebody else's sessions are untouched by this person's reset", async () => {
    const other = await prisma.user.create({
      data: { email: `${MARK}-other@example.invalid`, name: "Zz Other", password: "x:unusable" },
    });
    expect(await whoIs(sign(sessionValue(other.id, ago(120))))).toBe(other.id);
  });
});
