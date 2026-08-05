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

export type Role = "admin" | "assistant" | "player";

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

export async function createSession(accountId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sign(accountId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
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
  jar.set(ACTIVE_COOKIE, sign(eventId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

/** Admin-only preview of another role's view: "assistant" | "player" (anything else clears it). */
export async function setPreviewRole(previewRole: string): Promise<void> {
  const jar = await cookies();
  if (previewRole === "assistant" || previewRole === "player") {
    jar.set(PREVIEW_COOKIE, previewRole, { httpOnly: true, sameSite: "lax", path: "/" });
  } else {
    jar.delete(PREVIEW_COOKIE);
  }
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const accountId = verify(jar.get(COOKIE)?.value);
  if (!accountId) return null;
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return null;

  // Resolve the active event. Organizers can switch between events they belong
  // to (matched by email); the account for that event carries the effective role.
  let effective = account;
  const activeEventId = verify(jar.get(ACTIVE_COOKIE)?.value);
  if (activeEventId && activeEventId !== account.eventId) {
    const match = await prisma.account.findFirst({
      where: { eventId: activeEventId, email: account.email },
    });
    if (match) effective = match;
  }

  const role: Role =
    effective.role === "admin" ? "admin" : effective.role === "assistant" ? "assistant" : "player";
  const preview = jar.get(PREVIEW_COOKIE)?.value;
  const viewRole: Role =
    role === "admin" && (preview === "assistant" || preview === "player") ? (preview as Role) : role;
  return {
    accountId: effective.id,
    eventId: effective.eventId,
    name: effective.name,
    email: effective.email,
    role,
    viewRole,
  };
}

/** Screens organizers can access; players are limited to these three. */
export const PLAYER_SCREENS = new Set(["dashboard", "leaderboard", "entry", "bracket"]);

/** Critical screens only the primary Organizer (admin) can open. */
export const ADMIN_ONLY_SCREENS = new Set(["event", "access"]);
