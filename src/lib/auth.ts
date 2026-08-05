import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
import { prisma } from "./db";

// Lightweight signed-cookie sessions plus scrypt password hashing (both
// Node built-ins, no external auth provider). Swap this module for
// Auth.js/OAuth in production without touching callers — the Session
// shape and createSession/getSession contract stay the same either way.

const COOKIE = "ng_session";
const PREVIEW_COOKIE = "ng_preview_player";
const ACTIVE_COOKIE = "ng_active_event";
const SECRET = process.env.AUTH_SECRET ?? "dev-secret";

// Session cookies must never travel over plain HTTP in production. Local dev
// runs on http://localhost, where `secure` cookies are rejected, so the flag
// is conditional rather than hard-coded.
const SECURE_COOKIES = process.env.NODE_ENV === "production";

/** Shared flags for every cookie this module sets. */
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: SECURE_COOKIES,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
} as const;

function sign(value: string): string {
  const mac = createHmac("sha256", SECRET).update(value).digest("base64url");
  return `${value}.${mac}`;
}

function verify(signed: string | undefined): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx < 0) return null;
  const value = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  const expected = createHmac("sha256", SECRET).update(value).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

/** scrypt password hash, stored as "salt:hash" (both hex). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64);
  let real: Buffer;
  try {
    real = Buffer.from(hash, "hex");
  } catch {
    return false;
  }
  return test.length === real.length && timingSafeEqual(test, real);
}

// Re-exported so existing callers can keep importing Role from here; the
// definition lives with the access map in ./roles.
export type { Role } from "./roles";
import type { Role } from "./roles";

export interface Session {
  accountId: string;
  eventId: string;
  name: string;
  email: string;
  /** The account's real role. */
  role: Role;
  /** Effective role after an optional admin "preview as player" toggle. */
  viewRole: Role;
}

/** Start a session for a person. Takes a User id — sessions are not tied to
 *  any one tournament, so signing up before creating one is possible. */
export async function createSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sign(userId), COOKIE_OPTS);
  jar.delete(PREVIEW_COOKIE);
  jar.delete(ACTIVE_COOKIE);
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(PREVIEW_COOKIE);
  jar.delete(ACTIVE_COOKIE);
}

/** Switch which tournament the organizer is managing (their events only). */
export async function setActiveEvent(eventId: string): Promise<void> {
  const jar = await cookies();
  jar.set(ACTIVE_COOKIE, sign(eventId), COOKIE_OPTS);
}

/** Admin-only preview of another role's view: "assistant" | "player" (anything else clears it). */
export async function setPreviewRole(previewRole: string): Promise<void> {
  const jar = await cookies();
  if (previewRole === "assistant" || previewRole === "player") {
    jar.set(PREVIEW_COOKIE, previewRole, { httpOnly: true, sameSite: "lax", secure: SECURE_COOKIES, path: "/" });
  } else {
    jar.delete(PREVIEW_COOKIE);
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const userId = verify(jar.get(COOKIE)?.value);
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;

  // A session belongs to a person, not to a tournament. Which tournament
  // they're currently working in is resolved separately — from the active-event
  // cookie if it's set, otherwise their most recently created one. Someone who
  // has signed up but has no tournaments yet gets a valid session with no
  // event; the app shell sends them to /choose to create or pick one.
  let account = null;
  const activeEventId = verify(jar.get(ACTIVE_COOKIE)?.value);
  if (activeEventId) {
    account = await prisma.account.findFirst({
      where: { eventId: activeEventId, email: user.email },
    });
  }
  if (!account) {
    const accounts = await prisma.account.findMany({
      where: { email: user.email },
      include: { event: { select: { createdAt: true } } },
    });
    accounts.sort((a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime());
    account = accounts[0] ?? null;
  }

  const role: Role = !account
    ? "player"
    : account.role === "admin"
      ? "admin"
      : account.role === "assistant"
        ? "assistant"
        : "player";
  const preview = jar.get(PREVIEW_COOKIE)?.value;
  const viewRole: Role =
    role === "admin" && (preview === "assistant" || preview === "player") ? (preview as Role) : role;

  return {
    accountId: account?.id ?? "",
    // Empty when this person has no tournaments yet.
    eventId: account?.eventId ?? "",
    name: account?.name || user.name,
    email: user.email,
    role,
    viewRole,
  };
}

// Screen-level permissions live in ./roles (SCREEN_ACCESS), shared by the
// sidebar and the server-side guards so the two can't drift apart.
