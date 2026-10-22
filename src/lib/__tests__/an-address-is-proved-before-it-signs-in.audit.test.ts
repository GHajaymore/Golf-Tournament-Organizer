import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * AN ADDRESS IS PROVED BEFORE IT SIGNS IN (2026-10-21), against real rows.
 *
 * The fault: `claimPassword` set the first password on any address a club had
 * invited and signed the caller in; `signUp` signed in anybody under any
 * address; and access follows the address. So whoever typed an invited address
 * first WAS that person — an Admin seat, a member's card.
 *
 * Every door here is walked as two BROWSERS (two cookie jars), because the
 * code belongs to the browser that asked for it: the stranger's request must
 * neither sign the stranger in nor let the owner's typing apply the
 * stranger's password. The emailed code is read where the app hands it to the
 * mailer, as only the inbox would see it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const browsers = vi.hoisted(() => ({ current: new Map<string, string>() }));
const went = vi.hoisted(() => ({ to: "" }));
const mail = vi.hoisted(() => ({ sent: [] as Array<{ to: string; code: string; purpose: string }> }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = browsers.current.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void browsers.current.set(name, value),
    delete: (name: string) => void browsers.current.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    went.to = to;
  },
}));
// The mailer: what the inbox would receive, and nothing else changed.
vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...real,
    sendEmailCodeEmail: async (to: string, code: string, purpose: string) => {
      mail.sent.push({ to, code, purpose });
      return { ok: true };
    },
  };
});

import { createSession, getSession, hashPassword } from "@/lib/auth";
import { claimPassword, resetPassword, signInWithPassword, signUp, verifyEmailCode } from "@/app/actions/auth";
import { hasAccess } from "@/lib/services/access";
import { EMAIL_CODE_WORDS } from "@/lib/domain/email-code";

const prisma = new PrismaClient();
/** Every row this file makes starts with this, so a killed run's rows are swept by the next. */
const STEM = "zz-proved";
const MARK = `${STEM}-${process.pid}`;
const at = (who: string) => `${MARK}-${who}@example.invalid`;
const refusal = EMAIL_CODE_WORDS.refusal;

/** A fresh browser: an empty cookie jar, now the one in use. */
function newBrowser(): Map<string, string> {
  browsers.current = new Map();
  return browsers.current;
}
function use(browser: Map<string, string>) {
  browsers.current = browser;
}
/** The newest code the inbox of `to` holds. */
function lastCode(to: string): string {
  const mine = mail.sent.filter((m) => m.to === to);
  expect(mine.length, `no code was emailed to ${to}`).toBeGreaterThan(0);
  return mine[mine.length - 1].code;
}
/** A code that is not the one sent (the sent one, off by one digit). */
const notIt = (code: string) => code.slice(0, 5) + String((Number(code[5]) + 1) % 10);

const signedIn = () => browsers.current.get("ng_session") ?? "";
const userOf = (email: string) => prisma.user.findUnique({ where: { email } });

let eventId = "";
let orgId = "";

/** Everything under the stem, this run's or a killed one's: the club and its
 *  event, the clubs proved sign-ups made (named after `${STEM} …` people), the
 *  accounts. */
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
  // The seat a stranger would take: an Admin a club invited, who never set a password.
  await prisma.account.create({ data: { eventId, email: at("invited-admin"), name: "Zz Invited Admin", role: "admin" } });
  await prisma.account.create({ data: { eventId, email: at("invited-member"), name: "Zz Invited Member", role: "player" } });
});

afterAll(async () => {
  try {
    const emails = ["signup", "expired", "tries", "invited-admin", "invited-member", "unproved", "closed-tab", "squatted"].map(at);
    const keys = emails.map((e) => createHash("sha256").update(e).digest("hex"));
    for (const k of keys) await prisma.rateLimitHit.deleteMany({ where: { key: { contains: k } } }).catch(() => {});
    // The clubs a proved sign-up made: found through their owners, so nothing
    // but this run's rows can be reached.
    const made = await prisma.organizationMember.findMany({
      where: { user: { email: { startsWith: MARK } } },
      select: { organizationId: true },
    });
    await prisma.event.deleteMany({ where: { id: eventId } });
    await prisma.organization.deleteMany({ where: { id: { in: [orgId, ...made.map((m) => m.organizationId)] } } });
    await sweep();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the sink", () => {
  it("createSession makes no session for an unproved user, and does for a proved one", async () => {
    const unproved = await prisma.user.create({ data: { email: at("sink-unproved"), name: "Zz", password: "x:unusable" } });
    const proved = await prisma.user.create({ data: { email: at("sink-proved"), name: "Zz", password: "x:unusable", emailVerifiedAt: new Date() } });
    newBrowser();
    expect(await createSession(unproved.id)).toBe(false);
    expect(signedIn()).toBe("");
    // CONTROL: the same call for a proved address does sign in — so the refusal is the rule, not a broken jar.
    expect(await createSession(proved.id)).toBe(true);
    expect((await getSession())?.userId).toBe(proved.id);
  });
});

describe("signing up", () => {
  const EMAIL = at("signup");
  const PASSWORD = "four-Putts-then-87-home";
  let theirs = new Map<string, string>();

  it("makes no session, no password, no club and no access before the code", async () => {
    theirs = newBrowser();
    went.to = "";
    const result = await signUp(`${STEM} Signer Upper`, EMAIL, PASSWORD, "club");
    expect(result).toEqual({ ok: false, needsCode: true });
    expect(signedIn()).toBe("");
    expect(went.to).toBe("");
    const user = await userOf(EMAIL);
    expect(user?.emailVerifiedAt).toBeNull();
    expect(user?.password, "the password took effect before the code").toBe("");
    expect(await prisma.organizationMember.count({ where: { userId: user!.id } })).toBe(0);
    expect(await hasAccess(EMAIL)).toBe(false);
    // And the password typed does not sign in yet — it asks for a code instead.
    const tryIn = await signInWithPassword(EMAIL, PASSWORD);
    expect(tryIn.needsCode).toBe(true);
    expect(signedIn()).toBe("");
  });

  it("a wrong code is refused, said in the panel's words, and counted", async () => {
    const before = await prisma.emailCode.findFirst({ where: { user: { email: EMAIL } }, orderBy: { createdAt: "desc" } });
    const result = await verifyEmailCode(EMAIL, notIt(lastCode(EMAIL)));
    expect(result).toEqual({ ok: false, error: refusal.wrong });
    expect(signedIn()).toBe("");
    const after = await prisma.emailCode.findUnique({ where: { id: before!.id } });
    expect(after!.attempts).toBe(before!.attempts + 1);
  });

  it("the right code proves the address, makes the club, and signs them in", async () => {
    went.to = "";
    await verifyEmailCode(EMAIL, lastCode(EMAIL));
    expect(went.to).toBe("/choose");
    const user = await userOf(EMAIL);
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user?.name).toBe(`${STEM} Signer Upper`);
    expect((await getSession())?.userId).toBe(user!.id);
    const owned = await prisma.organizationMember.findFirst({ where: { userId: user!.id }, include: { organization: true } });
    expect(owned?.role).toBe("owner");
    expect(owned?.organization.kind).toBe("club");
  });

  it("the code works once — the same code, in the same browser, a second time", async () => {
    use(theirs);
    browsers.current.delete("ng_session");
    expect(await verifyEmailCode(EMAIL, lastCode(EMAIL))).toEqual({ ok: false, error: refusal.expired });
    expect(signedIn()).toBe("");
  });

  it("and the password chosen is now the password", async () => {
    newBrowser();
    went.to = "";
    await signInWithPassword(EMAIL, PASSWORD);
    expect(went.to).toBe("/choose");
    expect(signedIn()).not.toBe("");
  });
});

describe("a code's limits", () => {
  it("an expired code is refused", async () => {
    const EMAIL = at("expired");
    newBrowser();
    await signUp("Zz Late", EMAIL, "slow-Walker-on-the-14th", "personal");
    const user = await userOf(EMAIL);
    await prisma.emailCode.updateMany({ where: { userId: user!.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyEmailCode(EMAIL, lastCode(EMAIL))).toEqual({ ok: false, error: refusal.expired });
    expect(signedIn()).toBe("");
    expect((await userOf(EMAIL))?.emailVerifiedAt).toBeNull();
  });

  it("five wrong tries spend the code — the right one after them is refused too", async () => {
    const EMAIL = at("tries");
    newBrowser();
    await signUp("Zz Guesser", EMAIL, "many-Guesses-at-the-9th", "personal");
    const code = lastCode(EMAIL);
    const answers = [];
    for (let i = 0; i < 5; i += 1) answers.push((await verifyEmailCode(EMAIL, notIt(code))).error);
    expect(answers).toEqual([refusal.wrong, refusal.wrong, refusal.wrong, refusal.wrong, refusal["too-many"]]);
    expect(await verifyEmailCode(EMAIL, code)).toEqual({ ok: false, error: refusal["too-many"] });
    expect(signedIn()).toBe("");
  });
});

describe("the takeover: a stranger claims an invited Admin's address", () => {
  const VICTIM = at("invited-admin");
  const STRANGER_PASSWORD = "i-am-not-Who-i-say-77";
  const OWNER_PASSWORD = "the-real-Admin-of-the-club-42";
  let stranger = new Map<string, string>();
  let owner = new Map<string, string>();

  it("CONTROL: the address IS an Admin seat — taking it would be worth something", async () => {
    expect(await hasAccess(VICTIM)).toBe(true);
  });

  it("the stranger's claim sets no password and signs nobody in", async () => {
    stranger = newBrowser();
    went.to = "";
    const result = await claimPassword(VICTIM, STRANGER_PASSWORD);
    expect(result).toEqual({ ok: false, needsCode: true });
    expect(signedIn()).toBe("");
    expect(went.to).toBe("");
    expect(await getSession()).toBeNull();
    expect((await userOf(VICTIM))?.password).toBe("");
    // Signing in with the password they chose gets nothing either.
    await signInWithPassword(VICTIM, STRANGER_PASSWORD);
    expect(signedIn()).toBe("");
  });

  it("guessing gets nothing", async () => {
    use(stranger);
    for (const guess of ["000000", "123456", "999999"]) {
      expect((await verifyEmailCode(VICTIM, guess)).ok).toBe(false);
    }
    expect(signedIn()).toBe("");
    expect((await userOf(VICTIM))?.emailVerifiedAt).toBeNull();
  });

  it("the owner, typing the code the STRANGER caused to be sent, does not set the stranger's password", async () => {
    const strangersCode = lastCode(VICTIM);
    owner = newBrowser();
    // The owner opens the newest email in their inbox — the stranger's — and types it.
    const typed = await verifyEmailCode(VICTIM, strangersCode);
    expect(typed.ok).toBe(false);
    expect(signedIn()).toBe("");
    expect((await userOf(VICTIM))?.password).toBe("");
  });

  it("the owner's own claim and code make it theirs, with their password", async () => {
    use(owner);
    expect(await claimPassword(VICTIM, OWNER_PASSWORD)).toEqual({ ok: false, needsCode: true });
    went.to = "";
    await verifyEmailCode(VICTIM, lastCode(VICTIM));
    expect(went.to).toBe("/choose");
    const session = await getSession();
    expect(session?.email).toBe(VICTIM);
    expect(session?.role).toBe("admin");
  });

  it("and the stranger's code, and password, are worth nothing afterwards", async () => {
    const strangersCode = mail.sent.filter((m) => m.to === VICTIM)[0].code;
    use(stranger);
    browsers.current.delete("ng_session");
    expect(await verifyEmailCode(VICTIM, strangersCode)).toEqual({ ok: false, error: refusal.expired });
    expect(await signInWithPassword(VICTIM, STRANGER_PASSWORD)).toEqual({ ok: false, error: "Wrong email or password." });
    expect(signedIn()).toBe("");
  });
});

describe("a stranger's unfinished sign-up does not hold your address", () => {
  it("you sign up over it, and only YOUR password and name come with your code", async () => {
    const EMAIL = at("squatted");
    newBrowser();
    await signUp("Zz Squatter", EMAIL, "squatting-on-Your-Name-1", "personal");
    const mine = newBrowser();
    expect(await signUp(`${STEM} Rightful`, EMAIL, "this-is-Really-mine-2", "personal")).toEqual({ ok: false, needsCode: true });
    use(mine);
    went.to = "";
    await verifyEmailCode(EMAIL, lastCode(EMAIL));
    expect(went.to).toBe("/choose");
    const user = await userOf(EMAIL);
    expect(user?.name).toBe(`${STEM} Rightful`);
    newBrowser();
    expect(await signInWithPassword(EMAIL, "squatting-on-Your-Name-1")).toEqual({ ok: false, error: "Wrong email or password." });
  });
});

describe("other ways to prove an address", () => {
  it("signed up, gone before the code: the password chosen earns a new code from another browser", async () => {
    const EMAIL = at("closed-tab");
    const PASSWORD = "closed-the-Tab-at-the-turn";
    newBrowser();
    await signUp(`${STEM} Closed Tab`, EMAIL, PASSWORD, "community");
    newBrowser();
    expect((await signInWithPassword(EMAIL, "not-what-i-Chose-at-all")).error).toBe("Wrong email or password.");
    expect(await signInWithPassword(EMAIL, PASSWORD)).toEqual({ ok: false, needsCode: true });
    went.to = "";
    await verifyEmailCode(EMAIL, lastCode(EMAIL));
    expect(went.to).toBe("/choose");
    const user = await userOf(EMAIL);
    expect(user?.name).toBe(`${STEM} Closed Tab`);
    const owned = await prisma.organizationMember.findFirst({ where: { userId: user!.id }, include: { organization: true } });
    expect(owned?.organization.kind).toBe("community");
  });

  it("a finished password reset proves the address", async () => {
    const EMAIL = at("unproved");
    const user = await prisma.user.create({ data: { email: EMAIL, name: "Zz Unproved", password: hashPassword("an-Old-unproved-pass-1") } });
    newBrowser();
    // Unproved, the right password asks for a code rather than signing in.
    expect(await signInWithPassword(EMAIL, "an-Old-unproved-pass-1")).toEqual({ ok: false, needsCode: true });
    expect(signedIn()).toBe("");
    const token = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600_000) },
    });
    newBrowser();
    went.to = "";
    await resetPassword(token, "a-Reset-from-the-inbox-9");
    expect(went.to).toBe("/choose");
    expect((await userOf(EMAIL))?.emailVerifiedAt).toBeInstanceOf(Date);
    expect((await getSession())?.userId).toBe(user.id);
  });

  it("an invited member's claim, proved, reaches their tournament", async () => {
    const EMAIL = at("invited-member");
    newBrowser();
    expect(await claimPassword(EMAIL, "member-of-the-Club-since-88")).toEqual({ ok: false, needsCode: true });
    expect(await getSession()).toBeNull();
    await verifyEmailCode(EMAIL, lastCode(EMAIL));
    const session = await getSession();
    expect(session?.eventId).toBe(eventId);
    expect(session?.role).toBe("player");
  });
});
