import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * THE SIGN-IN DOORS HOLD UP (2026-11-13, security sweep M1, M2, M3, M5), against real rows.
 *
 *   M1  the platform owner is asked for a code on a browser not seen before, though they hold no club seat
 *   M2  the doors answer an address that is nobody, invited, or proved with the SAME shape
 *   M3  one client spraying many addresses is stopped; a stranger hammering one address cannot lock the
 *       person out of a browser they already use
 *   M5  the public entry link enters nobody until the address is proved, and says the same to every address
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const browsers = vi.hoisted(() => ({ current: new Map<string, string>(), ip: "" }));
const went = vi.hoisted(() => ({ to: "" }));
const mail = vi.hoisted(() => ({ codes: [] as Array<{ to: string; code: string; purpose: string; eventName?: string }> }));
const hashes = vi.hoisted(() => ({ checks: 0 }));
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
  headers: async () => new Headers({ "user-agent": UA, ...(browsers.ip ? { "x-forwarded-for": browsers.ip } : {}) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => void (went.to = to) }));
vi.mock("@/lib/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...real,
    sendEmailCodeEmail: async (to: string, code: string, purpose: string, eventName?: string) => {
      mail.codes.push({ to, code, purpose, eventName });
      return { ok: true };
    },
    sendNewSignInEmail: async () => ({ ok: true }),
    sendRegistrationEmail: async () => {},
  };
});

vi.mock("@/lib/auth", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...real,
    verifyPasswordHash: (password: string, stored: string) => {
      hashes.checks += 1;
      return real.verifyPasswordHash(password, stored);
    },
  };
});

import { hashPassword } from "@/lib/auth";
import { EMAIL_CODE_WORDS } from "@/lib/domain/email-code";
import { readSource } from "./source";
import { claimPassword, signInWithPassword, signUp, verifyEmailCode } from "@/app/actions/auth";
import { confirmEntryCode, registerForEvent } from "@/app/actions/register";
import { RATE_LIMITS } from "@/lib/domain/rate-limit";

const prisma = new PrismaClient();
const STEM = "zz-doors";
const MARK = `${STEM}-${process.pid}`;
const at = (who: string) => `${MARK}-${who}@example.invalid`;
const PASSWORD = "seven-Iron-into-the-wind";
const codesTo = (to: string) => mail.codes.filter((m) => m.to === to);
const newBrowser = (ip = "") => {
  browsers.current = new Map();
  browsers.ip = ip;
  return browsers.current;
};
const signedIn = () => browsers.current.get("ng_session") ?? "";

let orgId = "";
let eventId = "";
let token = "";

async function sweep() {
  await prisma.event.deleteMany({ where: { name: { startsWith: STEM } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: STEM } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: STEM } } });
}

beforeAll(async () => {
  await sweep();
  process.env.OWNER_EMAILS = at("owner");
  const org = await prisma.organization.create({ data: { name: `${MARK} Club`, kind: "club" } });
  orgId = org.id;
  token = randomBytes(6).toString("hex");
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${MARK} Open`,
      status: "registration",
      shape: "single",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 40,
      registrationOpen: true,
      registrationApproval: "auto",
      registrationToken: token,
      shareToken: `${MARK}-tok`,
    },
  });
  eventId = event.id;
  const proved = (who: string) =>
    prisma.user.create({ data: { email: at(who), name: `Zz ${who}`, password: hashPassword(PASSWORD), emailVerifiedAt: new Date() } });
  // The platform owner holds NO seat at any club: only the address on OWNER_EMAILS.
  await proved("owner");
  await proved("proved");
  await proved("player");
  await proved("victim");
  // Invited to the event: an Account, and no User at all.
  await prisma.account.create({ data: { eventId, email: at("invited"), name: "Zz invited", role: "player" } });
  // Somebody already entered, who is not the entrant of the cases below.
  await prisma.player.create({ data: { eventId, name: "Zz Entered", email: at("entered"), handicap: 10, seed: 1, status: "confirmed" } });
});

afterAll(async () => {
  try {
    delete process.env.OWNER_EMAILS;
    for (const who of ["owner", "invited", "proved", "player", "victim", "nobody", "fresh", "entrant", "entered"]) {
      const k = createHash("sha256").update(at(who)).digest("hex");
      await prisma.rateLimitHit.deleteMany({ where: { key: { contains: k } } }).catch(() => {});
    }
    await sweep();
  } finally {
    await prisma.$disconnect();
  }
});

describe("M1: the platform owner is asked for a code on a browser never seen", () => {
  it("the right password earns a code, not a session, though the owner holds no club seat", async () => {
    newBrowser();
    expect(await prisma.organizationMember.count({ where: { user: { email: at("owner") } } })).toBe(0);
    expect(await signInWithPassword(at("owner"), PASSWORD)).toEqual({ ok: false, needsCode: true, codePurpose: "device" });
    expect(signedIn()).toBe("");
    expect(codesTo(at("owner")).map((m) => m.purpose)).toEqual(["device"]);
  });

  it("CONTROL: an ordinary player on the same kind of browser is signed in straight away", async () => {
    newBrowser();
    went.to = "";
    await signInWithPassword(at("player"), PASSWORD);
    expect(went.to).toBe("/choose");
    expect(codesTo(at("player"))).toEqual([]);
  });

  it("the code signs the owner in and the browser is then known: next time no code", async () => {
    const browser = newBrowser();
    await signInWithPassword(at("owner"), PASSWORD);
    await verifyEmailCode(at("owner"), codesTo(at("owner")).at(-1)!.code);
    expect(signedIn()).not.toBe("");
    browser.delete("ng_session");
    went.to = "";
    await signInWithPassword(at("owner"), PASSWORD);
    expect(went.to).toBe("/choose");
  });
});

describe("M2: the same answer for an address that is nobody, invited, or proved", () => {
  it("signing in: an unknown address, an invited one and a wrong password read the same", async () => {
    newBrowser();
    const nobody = await signInWithPassword(at("nobody"), PASSWORD);
    const invited = await signInWithPassword(at("invited"), PASSWORD);
    const wrong = await signInWithPassword(at("proved"), "not-the-Password-at-all-1");
    expect(nobody).toEqual({ ok: false, error: "Wrong email or password." });
    expect(invited).toEqual(nobody);
    expect(wrong).toEqual(nobody);
  });

  it("claiming a password: nobody, invited and already-has-one all say 'check your inbox'; only the invited one is mailed", async () => {
    newBrowser();
    const results = [];
    for (const who of ["nobody", "invited", "proved"]) results.push(await claimPassword(at(who), "Chosen-Pass-77-golf"));
    expect(results[0]).toEqual({ ok: false, needsCode: true });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(codesTo(at("nobody"))).toEqual([]);
    expect(codesTo(at("proved"))).toEqual([]);
    expect(codesTo(at("invited")).map((m) => m.purpose)).toEqual(["claim"]);
  });

  it("signing up: a new address, an invited one and an account that exists all say 'check your inbox'", async () => {
    newBrowser();
    const shape = (who: string) => signUp("Zz Person", at(who), "Chosen-Pass-77-golf", "club");
    const fresh = await shape("fresh");
    const invited = await shape("invited");
    const proved = await shape("proved");
    expect(fresh).toEqual({ ok: false, needsCode: true });
    expect(invited).toEqual(fresh);
    expect(proved).toEqual(fresh);
    // Whoever already has an account is NOT given a second club, and no password of theirs changes.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: at("proved") } });
    expect(await prisma.organizationMember.count({ where: { userId: user.id } })).toBe(0);
    // Said as what it is: somebody asked from a new browser, no password was checked.
    expect(codesTo(at("proved")).map((m) => m.purpose)).toEqual(["asked"]);
  });
});

describe("M3: a client spraying many addresses is stopped; a stranger cannot lock a person out of their own browser", () => {
  it("the 21st failed sign-in from one connection is refused, whatever the address; another connection is not", async () => {
    newBrowser("203.0.113.7");
    const { limit } = RATE_LIMITS["signin-client"];
    let last: { ok: boolean; error?: string } = { ok: false };
    for (let i = 0; i <= limit; i++) last = await signInWithPassword(at(`spray-${i}`), "Common-Password-1");
    expect(last.error, "the 21st guess was still answered as a wrong password").toMatch(/Too many failed sign-ins/);
    newBrowser("203.0.113.8");
    expect((await signInWithPassword(at("spray-0"), "Common-Password-1")).error).toBe("Wrong email or password.");
  });

  it("a right password gives its attempt back: many sign-ins from one wifi address are never refused", async () => {
    for (let i = 0; i < RATE_LIMITS["signin-client"].limit + 5; i++) {
      newBrowser("203.0.113.9");
      went.to = "";
      await signInWithPassword(at("player"), PASSWORD);
      expect(went.to, `sign-in ${i} was refused`).toBe("/choose");
    }
  });

  it("six wrong tries on an address lock a NEW browser out, but not the one the person already uses", async () => {
    const mine = newBrowser("198.51.100.1");
    await signInWithPassword(at("victim"), PASSWORD); // this browser is known from now on
    expect(signedIn()).not.toBe("");
    const known = new Map(mine);
    // A stranger, from several connections, burns the address's allowance.
    for (let i = 0; i <= RATE_LIMITS.signin.limit; i++) {
      newBrowser(`198.51.100.${20 + i}`);
      await signInWithPassword(at("victim"), `wrong-Guess-number-${i}-of-many`);
    }
    // The stranger's browser: even the RIGHT password is refused while locked.
    newBrowser("198.51.100.99");
    expect((await signInWithPassword(at("victim"), PASSWORD)).error).toMatch(/Too many sign-in attempts/);
    expect(signedIn()).toBe("");
    // A WRONG password from the known browser is refused as well: no free guesses while locked.
    browsers.current = new Map(known);
    browsers.current.delete("ng_session");
    browsers.ip = "198.51.100.1";
    expect((await signInWithPassword(at("victim"), "wrong-again-Guess-5")).error).toMatch(/Too many sign-in attempts/);
    // ...and the right password from the browser they already use gets in.
    went.to = "";
    await signInWithPassword(at("victim"), PASSWORD);
    expect(went.to).toBe("/choose");
  });
});

describe("M5: the public entry link enters nobody until the address is proved", () => {
  const form = (who: string) => ({ name: `Zz ${who}`, email: at(who), handicap: "12", handicapType: "18", phone: "15551234567" });
  const entered = (who: string) => prisma.player.count({ where: { eventId, email: at(who) } });
  const account = (who: string) => prisma.account.count({ where: { eventId, email: at(who) } });

  it("a stranger is sent a code; no place is taken and no Account is made", async () => {
    newBrowser();
    const result = await registerForEvent(token, form("entrant"));
    expect(result).toMatchObject({ ok: true, needsCode: true });
    expect(result.status).toBeUndefined();
    expect(await entered("entrant")).toBe(0);
    expect(await account("entrant")).toBe(0);
    expect(codesTo(at("entrant")).map((m) => m.purpose)).toEqual(["entry"]);
  });

  it("an address already in the field gets the same answer, and is told nothing about the field", async () => {
    newBrowser();
    const fresh = await registerForEvent(token, form("entrant"));
    const again = await registerForEvent(token, form("entered"));
    expect(Object.keys(again).sort()).toEqual(Object.keys(fresh).sort());
    expect(again.already).toBeUndefined();
    expect(await prisma.player.count({ where: { eventId, email: at("entered") } })).toBe(1);
  });

  it("a wrong code enters nobody; the right one, from the browser that asked, enters them once", async () => {
    newBrowser();
    await registerForEvent(token, form("entrant"));
    const code = codesTo(at("entrant")).at(-1)!.code;
    const notIt = code.slice(0, 5) + String((Number(code[5]) + 1) % 10);
    expect((await confirmEntryCode(token, at("entrant"), notIt)).ok).toBe(false);
    expect(await entered("entrant")).toBe(0);
    const done = await confirmEntryCode(token, at("entrant"), code);
    expect(done).toMatchObject({ ok: true, status: "confirmed" });
    expect(await entered("entrant")).toBe(1);
    expect(await account("entrant")).toBe(1);
    // The code is single-use: nothing is entered twice.
    expect((await confirmEntryCode(token, at("entrant"), code)).ok).toBe(false);
    expect(await entered("entrant")).toBe(1);
  });

  it("the code works from no other browser, and a sign-in cannot spend it", async () => {
    newBrowser();
    await registerForEvent(token, form("victim"));
    const code = codesTo(at("victim")).at(-1)!.code;
    newBrowser();
    expect((await confirmEntryCode(token, at("victim"), code)).ok).toBe(false);
    // A code made for an entry is spent on an entry, never on a session.
    newBrowser();
    await registerForEvent(token, form("victim"));
    const second = codesTo(at("victim")).at(-1)!.code;
    expect((await verifyEmailCode(at("victim"), second)).ok).toBe(false);
    expect(signedIn()).toBe("");
    expect(await entered("victim")).toBe(0);
  });

  it("CONTROL: somebody signed in AS the address is entered at once, as before", async () => {
    newBrowser("192.0.2.5");
    await signInWithPassword(at("proved"), PASSWORD);
    expect(signedIn()).not.toBe("");
    const done = await registerForEvent(token, form("proved"));
    expect(done).toMatchObject({ ok: true, status: "confirmed" });
    expect(done.needsCode).toBeUndefined();
  });
});

describe("review fixes (2026-11-13)", () => {
  const form = (who: string) => ({ name: `Zz ${who}`, email: at(who), handicap: "12", handicapType: "18", phone: "15551234567" });

  it("1. a claim counts the code budget on BOTH paths: nobody and invited are refused alike, and the non-invited one takes about as long as a send", async () => {
    await prisma.account.create({ data: { eventId, email: at("invited3"), name: "Zz invited3", role: "player" } });
    newBrowser();
    const times: number[] = [];
    const answers: Array<{ ok: boolean; error?: string; needsCode?: boolean }> = [];
    for (const who of ["nobody3", "invited3"]) {
      for (let i = 0; i < 4; i++) {
        const t = Date.now();
        answers.push(await claimPassword(at(who), "Chosen-Pass-77-golf"));
        if (who === "nobody3") times.push(Date.now() - t);
      }
    }
    // Three go through, the fourth is told to wait, with the same words, on either address.
    expect(answers.slice(0, 3).every((a) => a.needsCode)).toBe(true);
    expect(answers[3].error).toMatch(/sent three codes/i);
    expect(answers.slice(4, 7).every((a) => a.needsCode)).toBe(true);
    expect(answers[7].error).toMatch(/sent three codes/i);
    expect(Math.min(...times.slice(0, 3)), "a claim that mails nothing returned faster than one that does").toBeGreaterThanOrEqual(280);
  });

  it("2. the emails say what happened: 'asked' carries no 'whoever tried knows it'; an entry code names the tournament", async () => {
    expect(EMAIL_CODE_WORDS.email.askedIgnore).not.toMatch(/knows it|reset your password/i);
    expect(EMAIL_CODE_WORDS.email.askedIntro).toMatch(/Someone asked to sign in/);
    const src = readSource("src", "lib", "email.ts");
    expect(src).toMatch(/purpose === "asked" \? words\.askedIgnore/);
    expect(EMAIL_CODE_WORDS.email.entryIntro("Zz Open")).toBe("This address was used to enter Zz Open on TourneyHQ. Here's the code to confirm it was you:");
    newBrowser();
    await registerForEvent(token, form("fresh-entry"));
    expect(codesTo(at("fresh-entry")).at(-1)).toMatchObject({ purpose: "entry", eventName: `${MARK} Open` });
  });

  it("3. wrong tries on entry and sign-up codes cannot spend the day's tries of a staff member's new-browser code", async () => {
    const staff = await prisma.user.create({ data: { email: at("staff"), name: "Zz staff", password: hashPassword(PASSWORD), emailVerifiedAt: new Date() } });
    await prisma.organizationMember.create({ data: { organizationId: orgId, userId: staff.id, role: "admin" } });
    // The staff member asks for their code on their own browser.
    const mine = newBrowser();
    expect(await signInWithPassword(at("staff"), PASSWORD)).toMatchObject({ needsCode: true, codePurpose: "device" });
    const deviceCode = codesTo(at("staff")).at(-1)!.code;
    const keep = new Map(mine);
    // An attacker's browser: more than twenty wrong tries on entry codes, and on a sign-up code.
    newBrowser();
    for (let round = 0; round < 5; round++) {
      await registerForEvent(token, form("staff"));
      const real = codesTo(at("staff")).at(-1)!.code;
      const wrong = real.slice(0, 5) + String((Number(real[5]) + 1) % 10);
      for (let t = 0; t < 5; t++) await confirmEntryCode(token, at("staff"), wrong);
    }
    await signUp("Zz Staff", at("staff"), "Chosen-Pass-77-golf", "club");
    const asked = codesTo(at("staff")).at(-1)!.code;
    expect(codesTo(at("staff")).at(-1)!.purpose).toBe("asked");
    for (let t = 0; t < 5; t++) await verifyEmailCode(at("staff"), asked.slice(0, 5) + String((Number(asked[5]) + 1) % 10));
    // The staff member types the code they were sent: it is not refused for "too many tries today".
    browsers.current = keep;
    browsers.ip = "";
    went.to = "";
    const done = await verifyEmailCode(at("staff"), deviceCode);
    expect(done?.error).toBeUndefined();
    expect(went.to).toBe("/choose");
  });

  it("3b. one connection cannot make more than sixty codes go out, to anybody", async () => {
    newBrowser("192.0.2.77");
    const { limit } = RATE_LIMITS["code-send-client"];
    let last: { ok: boolean; error?: string; needsCode?: boolean } = { ok: false };
    for (let i = 0; i <= limit; i++) last = await signUp("Zz Burst", at(`burst-${i}`), "Chosen-Pass-77-golf", "club");
    expect(last.error).toMatch(/several codes from this connection/);
    newBrowser("192.0.2.78");
    expect((await signUp("Zz Burst", at("burst-0"), "Chosen-Pass-77-golf", "club")).needsCode).toBe(true);
  });

  it("4. every sign-in answer for an address that cannot sign in costs one password check, a half-finished sign-up included", async () => {
    newBrowser();
    await signUp("Zz Half", at("half"), "Half-Done-Pass-55-golf", "club"); // a sign-up nobody finished
    const checksFor = async (who: string, password: string) => {
      hashes.checks = 0;
      await signInWithPassword(at(who), password);
      return hashes.checks;
    };
    expect(await checksFor("nobody", "Another-Pass-66-golf")).toBe(1);
    expect(await checksFor("invited", "Another-Pass-66-golf")).toBe(1);
    expect(await checksFor("half", "Another-Pass-66-golf")).toBe(1);
    expect(await checksFor("proved", "Another-Pass-66-golf")).toBe(1);
  });

  it("6. an entry nobody confirmed leaves no User behind once it is stale; seats and recent rows are kept", async () => {
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.user.create({ data: { email: at("stray-old"), name: "", createdAt: old } });
    await prisma.user.create({ data: { email: at("stray-new"), name: "" } });
    const seated = await prisma.user.create({ data: { email: at("seated-old"), name: "", createdAt: old } });
    await prisma.organizationMember.create({ data: { organizationId: orgId, userId: seated.id, role: "admin" } });
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      newBrowser();
      await registerForEvent(token, form("sweeper"));
    } finally {
      random.mockRestore();
    }
    expect(await prisma.user.count({ where: { email: at("stray-old") } })).toBe(0);
    expect(await prisma.user.count({ where: { email: at("stray-new") } })).toBe(1);
    expect(await prisma.user.count({ where: { email: at("seated-old") } })).toBe(1);
    expect(await prisma.user.count({ where: { email: at("sweeper") } })).toBe(1);
  });
});
