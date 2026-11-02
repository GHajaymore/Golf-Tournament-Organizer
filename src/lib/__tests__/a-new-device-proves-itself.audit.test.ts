import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * A NEW DEVICE PROVES ITSELF (2026-10-21), against real rows.
 *
 * Club staff signing in with a password on a browser this account has not been
 * signed in on are asked for a code from the inbox first; anybody else is let
 * in and told by email. Walked as separate BROWSERS (cookie jars), because the
 * browser is what is known: the same person on a second browser is asked
 * again, and on the first one is not.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const browsers = vi.hoisted(() => ({ current: new Map<string, string>() }));
const went = vi.hoisted(() => ({ to: "" }));
const mail = vi.hoisted(() => ({
  codes: [] as Array<{ to: string; code: string; purpose: string }>,
  alerts: [] as Array<{ to: string; device: string; when: string }>,
}));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = browsers.current.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void browsers.current.set(name, value),
    delete: (name: string) => void browsers.current.delete(name),
  }),
  headers: async () => new Headers({ "user-agent": UA }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    went.to = to;
  },
}));
vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...real,
    sendEmailCodeEmail: async (to: string, code: string, purpose: string) => {
      mail.codes.push({ to, code, purpose });
      return { ok: true };
    },
    sendNewSignInEmail: async (to: string, device: string, when: string) => {
      mail.alerts.push({ to, device, when });
      return { ok: true };
    },
  };
});

import { hashPassword } from "@/lib/auth";
import { signInWithPassword, verifyEmailCode } from "@/app/actions/auth";
import { EMAIL_CODE_WORDS } from "@/lib/domain/email-code";

const prisma = new PrismaClient();
const STEM = "zz-device";
const MARK = `${STEM}-${process.pid}`;
const at = (who: string) => `${MARK}-${who}@example.invalid`;
const PASSWORD = "seven-Iron-into-the-wind";
const WHO = ["secretary", "event-admin", "member"];

const newBrowser = () => (browsers.current = new Map());
const use = (b: Map<string, string>) => (browsers.current = b);
const signedIn = () => browsers.current.get("ng_session") ?? "";
const codesTo = (to: string) => mail.codes.filter((m) => m.to === to);
const alertsTo = (to: string) => mail.alerts.filter((m) => m.to === to);
const notIt = (code: string) => code.slice(0, 5) + String((Number(code[5]) + 1) % 10);

let orgId = "";
let eventId = "";

async function sweep() {
  await prisma.event.deleteMany({ where: { name: { startsWith: STEM } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STEM } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: STEM } } });
}

beforeAll(async () => {
  await sweep();
  const org = await prisma.organization.create({ data: { name: `${MARK} Club`, kind: "club" } });
  orgId = org.id;
  const event = await prisma.event.create({
    data: { organizationId: orgId, name: `${MARK} Open`, dates: "", course: "", city: "", address: "", regDeadline: "", shareToken: `${MARK}-tok` },
  });
  eventId = event.id;
  const users = await Promise.all(
    WHO.map((w) => prisma.user.create({ data: { email: at(w), name: `Zz ${w}`, password: hashPassword(PASSWORD), emailVerifiedAt: new Date() } })),
  );
  // A club's secretary holds a seat at the club; the event admin only a role on one tournament; the member plays.
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: users[0].id, role: "admin" } });
  await prisma.account.create({ data: { eventId, email: at("event-admin"), name: "Zz event-admin", role: "admin" } });
  await prisma.account.create({ data: { eventId, email: at("member"), name: "Zz member", role: "player" } });
});

afterAll(async () => {
  try {
    for (const e of WHO.map(at)) {
      const k = createHash("sha256").update(e).digest("hex");
      await prisma.rateLimitHit.deleteMany({ where: { key: { contains: k } } }).catch(() => {});
    }
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await sweep();
  } finally {
    await prisma.$disconnect();
  }
});

describe("club staff on a browser never seen", () => {
  const EMAIL = at("secretary");
  let first = new Map<string, string>();

  it("the right password earns a code, not a session", async () => {
    first = newBrowser();
    went.to = "";
    const result = await signInWithPassword(EMAIL, PASSWORD);
    expect(result).toEqual({ ok: false, needsCode: true, codePurpose: "device" });
    expect(signedIn()).toBe("");
    expect(went.to).toBe("");
    expect(codesTo(EMAIL).map((m) => m.purpose)).toEqual(["device"]);
    expect(alertsTo(EMAIL)).toEqual([]);
  });

  it("CONTROL: a wrong password earns nothing at all", async () => {
    newBrowser();
    const result = await signInWithPassword(EMAIL, "not-the-Password-at-all");
    expect(result).toEqual({ ok: false, error: "Wrong email or password." });
    expect(codesTo(EMAIL)).toHaveLength(1);
  });

  it("a wrong code is refused; the right one signs in and the browser is remembered", async () => {
    use(first);
    const code = codesTo(EMAIL).at(-1)!.code;
    expect(await verifyEmailCode(EMAIL, notIt(code))).toEqual({ ok: false, error: EMAIL_CODE_WORDS.refusal.wrong });
    expect(signedIn()).toBe("");
    went.to = "";
    await verifyEmailCode(EMAIL, code);
    expect(signedIn()).not.toBe("");
    expect(went.to).toBe("/choose");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const devices = await prisma.knownDevice.findMany({ where: { userId: user.id } });
    expect(devices.map((d) => d.label)).toEqual(["Chrome on Windows"]);
    // The code WAS the email about this sign-in: nobody is told twice.
    expect(alertsTo(EMAIL)).toEqual([]);
  });

  it("the same browser next time goes straight in: no code, no email", async () => {
    use(first);
    browsers.current.delete("ng_session");
    went.to = "";
    await signInWithPassword(EMAIL, PASSWORD);
    expect(went.to).toBe("/choose");
    expect(signedIn()).not.toBe("");
    expect(codesTo(EMAIL)).toHaveLength(1);
    expect(alertsTo(EMAIL)).toEqual([]);
  });

  it("another browser is asked again: the browser is what is known, not the person", async () => {
    newBrowser();
    const result = await signInWithPassword(EMAIL, PASSWORD);
    expect(result.codePurpose).toBe("device");
    expect(signedIn()).toBe("");
  });

  it("the code that browser asked for does not work in any other", async () => {
    const codeForSecond = codesTo(EMAIL).at(-1)!.code;
    newBrowser();
    expect(await verifyEmailCode(EMAIL, codeForSecond)).toEqual({ ok: false, error: EMAIL_CODE_WORDS.refusal.expired });
    expect(signedIn()).toBe("");
  });
});

describe("an admin of one tournament is staff too", () => {
  it("is asked for a code on a new browser", async () => {
    newBrowser();
    const result = await signInWithPassword(at("event-admin"), PASSWORD);
    expect(result).toEqual({ ok: false, needsCode: true, codePurpose: "device" });
    expect(signedIn()).toBe("");
  });
});

describe("a member on a browser never seen", () => {
  const EMAIL = at("member");
  let phone = new Map<string, string>();

  it("is signed in straight away, and emailed that a new browser was used", async () => {
    phone = newBrowser();
    went.to = "";
    await signInWithPassword(EMAIL, PASSWORD);
    expect(signedIn()).not.toBe("");
    expect(codesTo(EMAIL)).toEqual([]);
    const alerts = alertsTo(EMAIL);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].device).toBe("Chrome on Windows");
    expect(alerts[0].when).toMatch(/UTC$/);
  });

  it("the same browser again sends no second email", async () => {
    use(phone);
    browsers.current.delete("ng_session");
    await signInWithPassword(EMAIL, PASSWORD);
    expect(signedIn()).not.toBe("");
    expect(alertsTo(EMAIL)).toHaveLength(1);
  });
});
