import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * "SIGN OUT EVERYWHERE" ENDS EVERY SIGN-IN, AND "SIGN OUT" ENDS ONE (2026-10-11).
 *
 * Ajay, 2026-10-11: "yes do it." Until now the only way to end a sign-in on a
 * phone somebody no longer holds was to reset the password — a thing nobody
 * thinks of when the worry is "I left myself signed in at the pro shop".
 *
 * Against a real row, for the same reason as the reset's own test: the rule is
 * a comparison between a cookie and a column. Signing out everywhere moves the
 * person's `sessionsValidFrom` to now; every cookie issued before that moment
 * is then nobody's session, on every device. The ordinary Sign out removes the
 * cookie from THIS browser and touches no row, so a second device stays in —
 * which is what somebody signing out of a shared laptop expects.
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
import { signInWithPassword, signOutAction, signOutEverywhereAction } from "@/app/actions/auth";
import { sessionValue } from "@/lib/domain/session-token";

const prisma = new PrismaClient();
const MARK = `zz-everywhere-${process.pid}`;
const EMAIL = `${MARK}@example.invalid`;
const PASSWORD = "a-long-Fairway-71-pass";

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
/** Who the app says this cookie is. */
const whoIs = async (cookie: string) => {
  jar.clear();
  jar.set("ng_session", cookie);
  return (await getSession())?.userId ?? null;
};
/** Act as the holder of this cookie. */
const holding = (cookie: string) => {
  jar.clear();
  jar.set("ng_session", cookie);
  went.to = "";
};

let userId = "";
let otherId = "";
/** Two sign-ins from earlier today: this phone, and one left at the pro shop. */
let thisPhone = "";
let proShop = "";
let somebodyElse = "";

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: EMAIL, name: "Zz Everywhere", password: hashPassword(PASSWORD) } });
  const other = await prisma.user.create({ data: { email: `${MARK}-other@example.invalid`, name: "Zz Other", password: "x:unusable" } });
  userId = user.id;
  otherId = other.id;
  thisPhone = sign(sessionValue(userId, ago(300)));
  proShop = sign(sessionValue(userId, ago(7200)));
  somebodyElse = sign(sessionValue(otherId, ago(300)));
});

afterAll(async () => {
  try {
    await prisma.rateLimitHit.deleteMany({ where: { key: { contains: MARK } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe("the ordinary Sign out", () => {
  it("CONTROL: both sign-ins are good sessions to begin with", async () => {
    expect(await whoIs(thisPhone)).toBe(userId);
    expect(await whoIs(proShop)).toBe(userId);
  });

  it("takes the cookie off this browser and leaves the other device signed in", async () => {
    holding(thisPhone);
    await signOutAction();
    expect(jar.get("ng_session"), "the cookie is still in this browser").toBeUndefined();
    expect(went.to).toBe("/");
    expect(await whoIs(proShop), "an ordinary sign-out ended a sign-in on another device").toBe(userId);
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { sessionsValidFrom: true } });
    expect(row?.sessionsValidFrom, "an ordinary sign-out moved the person's sessions line").toBeNull();
  });
});

describe("Sign out everywhere", () => {
  it("ends the sign-in it was pressed from, and sends the person to the front door", async () => {
    holding(thisPhone);
    await signOutEverywhereAction();
    expect(jar.get("ng_session"), "the cookie is still in this browser").toBeUndefined();
    expect(went.to).toBe("/");
    expect(await whoIs(thisPhone), "the cookie it was pressed from still signs in if it is put back").toBeNull();
  });

  it("ENDS the sign-in on the other device", async () => {
    expect(await whoIs(proShop), "the sign-in left at the pro shop still works").toBeNull();
  });

  it("records the moment, on the person's own row", async () => {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { sessionsValidFrom: true } });
    expect(row?.sessionsValidFrom).toBeInstanceOf(Date);
    expect(Date.now() - row!.sessionsValidFrom!.getTime()).toBeLessThan(60_000);
  });

  it("leaves the password alone: the person signs straight back in, and that sign-in holds", async () => {
    jar.clear();
    went.to = "";
    await signInWithPassword(EMAIL, PASSWORD);
    expect(went.to, "the password no longer signs in").toBe("/choose");
    const fresh = jar.get("ng_session") ?? "";
    expect(await whoIs(fresh), "the sign-in made after signing out everywhere was refused").toBe(userId);
  });

  it("CONTROL: nobody else's sign-in is touched", async () => {
    expect(await whoIs(somebodyElse)).toBe(otherId);
  });

  it("does nothing at all for somebody who is not signed in", async () => {
    jar.clear();
    went.to = "";
    const before = await prisma.user.findUnique({ where: { id: otherId }, select: { sessionsValidFrom: true } });
    await signOutEverywhereAction();
    expect(went.to).toBe("/");
    const after = await prisma.user.findUnique({ where: { id: otherId }, select: { sessionsValidFrom: true } });
    expect(after?.sessionsValidFrom ?? null).toEqual(before?.sessionsValidFrom ?? null);
  });
});
