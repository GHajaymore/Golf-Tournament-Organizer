import "server-only";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SECURE_COOKIES } from "@/lib/secure-cookies";
import { sendEmailCodeEmail } from "@/lib/email";
import {
  EMAIL_CODE_DAILY_TRIES,
  EMAIL_CODE_MAX_TRIES,
  EMAIL_CODE_TTL_MS,
  EMAIL_CODE_WORDS,
  afterWrongGuess,
  codeFromTyped,
  codeUnusable,
  isEmailCodePurpose,
  type EmailCodePurpose,
} from "@/lib/domain/email-code";
import { hashBrowserValue, hashEmailCode, newBrowserValue, newEmailCode, sameCodeHash } from "@/lib/domain/email-code-hash";

/**
 * THE ROWS AND THE MAIL BEHIND PROVING AN ADDRESS — see `domain/email-code.ts`
 * for the rule and the words.
 *
 * Three things are deliberate here, and each closes a way in:
 *
 *  - WHAT THE PERSON CHOSE WAITS ON THE CODE. A sign-up's password, name and
 *    club, and a claim's password, are held on the code's row (`pending`, the
 *    password already hashed) and written to the User only when the code is
 *    right. Nothing anybody types before that is anybody's password.
 *  - A CODE BELONGS TO THE BROWSER THAT ASKED FOR IT (`browserHash`). Without
 *    that, a stranger asking for a code for your address a minute after you
 *    would put THEIR password on the newest email in your inbox, and the code
 *    you typed would set it. Each browser's newest code is the only one it can
 *    use; a stranger's request never replaces yours.
 *  - A TRY IS COUNTED BEFORE IT IS COMPARED, in one statement that refuses a
 *    sixth, so parallel guesses cannot each read four and all go through.
 */

const BROWSER_COOKIE = "ng_code_browser";
/** Longer than a code lives, so a code asked for in the last minute still works. */
const BROWSER_COOKIE_SECONDS = 60 * 60;

/** What takes effect when the code is right. Every field optional: a sign-in by
 *  somebody who already holds a password proves the address and changes nothing. */
export interface PendingProof {
  /** Already hashed (`hashPassword`). */
  passwordHash?: string;
  name?: string;
  kind?: string;
  discountCode?: string;
}

/** This browser's code value, hashed — made (and set) when asked to. */
async function browserHash(make: boolean): Promise<string | null> {
  const jar = await cookies();
  let value = jar.get(BROWSER_COOKIE)?.value;
  if (!value) {
    if (!make) return null;
    value = newBrowserValue();
    jar.set(BROWSER_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: SECURE_COOKIES,
      path: "/",
      maxAge: BROWSER_COOKIE_SECONDS,
    });
  }
  return hashBrowserValue(value);
}

function readPending(value: Prisma.JsonValue | null): PendingProof {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const text = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : undefined);
  return { passwordHash: text("passwordHash"), name: text("name"), kind: text("kind"), discountCode: text("discountCode") };
}

/**
 * Make a code, store its hash, email it. The caller has already counted the
 * send against the address (`checkRateLimit("email-code-send", …)`), before
 * looking anybody up.
 *
 * A send that fails takes its row with it, so the code before it — if this
 * browser had one — still works; one that succeeds retires this browser's
 * earlier codes, because the newest email is the one a person types from.
 */
export async function sendEmailCode(input: {
  userId: string;
  email: string;
  purpose: EmailCodePurpose;
  pending: PendingProof | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const browser = await browserHash(true);
  if (!browser) return { ok: false, error: EMAIL_CODE_WORDS.couldNotSend };
  const code = newEmailCode();
  const now = new Date();
  const row = await prisma.emailCode.create({
    data: {
      userId: input.userId,
      codeHash: hashEmailCode(input.userId, code),
      browserHash: browser,
      purpose: input.purpose,
      ...(input.pending ? { pending: input.pending as Prisma.InputJsonObject } : {}),
      expiresAt: new Date(now.getTime() + EMAIL_CODE_TTL_MS),
    },
    select: { id: true },
  });
  const sent = await sendEmailCodeEmail(input.email, code, input.purpose);
  if (!sent.ok) {
    await prisma.emailCode.deleteMany({ where: { id: row.id } });
    return { ok: false, error: EMAIL_CODE_WORDS.couldNotSend };
  }
  await prisma.emailCode.updateMany({
    where: { userId: input.userId, browserHash: browser, usedAt: null, id: { not: row.id } },
    data: { usedAt: now },
  });
  return { ok: true };
}

/**
 * This browser's newest code for this user, for sending a fresh one of the
 * same kind ("Send a new code"). Null when this browser never asked.
 */
export async function latestCodeHere(userId: string): Promise<{ purpose: EmailCodePurpose; pending: PendingProof } | null> {
  const browser = await browserHash(false);
  if (!browser) return null;
  const row = await prisma.emailCode.findFirst({
    where: { userId, browserHash: browser },
    orderBy: { createdAt: "desc" },
    select: { purpose: true, pending: true },
  });
  if (!row || !isEmailCodePurpose(row.purpose)) return null;
  return { purpose: row.purpose, pending: readPending(row.pending) };
}

/**
 * The newest sign-up this user asked for from ANY browser, within a day — for
 * the person who signed up, closed the tab before the code came, and now tries
 * to log in with the password they chose. Its password is only ever compared,
 * never applied: applying waits on a new code to the inbox.
 */
export async function latestSignupPending(userId: string): Promise<PendingProof | null> {
  const row = await prisma.emailCode.findFirst({
    where: { userId, purpose: "signup", createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    select: { pending: true },
  });
  return row ? readPending(row.pending) : null;
}

export type CheckedCode =
  | { ok: true; userId: string; purpose: EmailCodePurpose; pending: PendingProof }
  | { ok: false; error: string };

/**
 * Is this the code this browser was sent for this address? Right, it is spent
 * at once (single use) and what it was for is handed back; wrong, the try is
 * counted. Refusals are the panel's sentences, said under the box.
 */
export async function checkEmailCode(email: string, typed: unknown): Promise<CheckedCode> {
  const refusal = EMAIL_CODE_WORDS.refusal;
  const code = codeFromTyped(typed);
  if (!code) return { ok: false, error: refusal.wrong };

  const browser = await browserHash(false);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  const row =
    user && browser
      ? await prisma.emailCode.findFirst({ where: { userId: user.id, browserHash: browser }, orderBy: { createdAt: "desc" } })
      : null;
  const now = new Date();
  const unusable = codeUnusable(row, now);
  if (unusable || !row || !user) return { ok: false, error: refusal[unusable ?? "expired"] };

  // Every try on this address in the last day, from every browser — see
  // EMAIL_CODE_DAILY_TRIES. Read before this try is counted, so the twenty-first
  // is refused without being compared.
  const today = await prisma.emailCode.aggregate({
    where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    _sum: { attempts: true },
  });
  if ((today._sum.attempts ?? 0) >= EMAIL_CODE_DAILY_TRIES) return { ok: false, error: refusal.today };

  const counted = await prisma.emailCode.updateMany({
    where: { id: row.id, usedAt: null, attempts: { lt: EMAIL_CODE_MAX_TRIES } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count === 0) return { ok: false, error: refusal["too-many"] };

  if (!sameCodeHash(row.codeHash, hashEmailCode(user.id, code))) {
    return { ok: false, error: refusal[afterWrongGuess(row.attempts + 1)] };
  }

  const spent = await prisma.emailCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (spent.count === 0 || !isEmailCodePurpose(row.purpose)) return { ok: false, error: refusal.expired };
  return { ok: true, userId: user.id, purpose: row.purpose, pending: readPending(row.pending) };
}

/**
 * The address is proved: mark it, and let what was waiting on the code take
 * effect. Every other code still out for this user — from any browser — stops
 * working, since there is nothing left for one to prove.
 */
export async function proveAddress(checked: { userId: string; purpose: EmailCodePurpose; pending: PendingProof }): Promise<void> {
  const now = new Date();
  const { pending } = checked;
  await prisma.user.update({
    where: { id: checked.userId },
    data: {
      emailVerifiedAt: now,
      ...(pending.passwordHash ? { password: pending.passwordHash } : {}),
      ...(checked.purpose === "signup" && pending.name ? { name: pending.name } : {}),
    },
  });
  await prisma.emailCode.updateMany({ where: { userId: checked.userId, usedAt: null }, data: { usedAt: now } });
}
