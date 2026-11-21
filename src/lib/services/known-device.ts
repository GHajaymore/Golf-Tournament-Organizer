import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { SECURE_COOKIES } from "@/lib/secure-cookies";
import { hashBrowserValue, newBrowserValue } from "@/lib/domain/email-code-hash";
import { deviceLabel } from "@/lib/domain/device-words";
import { isOwner } from "@/lib/owner";
import { sign, verify } from "@/lib/auth";

/**
 * THE BROWSERS A PERSON HAS SIGNED IN ON (2026-10-21; Ajay: "go with your
 * recommendations" — a code on a new device for organizers, and an email when
 * anybody signs in on one, before launch).
 *
 * A browser keeps a random value in a year-long HttpOnly cookie; `KnownDevice`
 * holds its hash against the person. A browser becomes known only when the
 * person has shown they hold the inbox (a code typed back, a reset finished
 * from its link) or has signed in on it with their password: never because a
 * page asked.
 *
 * Who is asked for a code on an unknown browser: CLUB STAFF (`isClubStaff`) —
 * the people who hold members' details and the money records. Players are not
 * asked, so that a member signing in on a friend's phone on the first tee is
 * not stopped; they are sent the "new sign-in" email instead.
 */

const DEVICE_COOKIE = "ng_device";
const DEVICE_COOKIE_SECONDS = 400 * 24 * 60 * 60;

/** This browser's device value, hashed — made (and set) when asked to. */
async function deviceHashHere(make: boolean): Promise<string | null> {
  const value = await deviceValueHere(make);
  return value ? hashBrowserValue(value) : null;
}

/**
 * This browser's raw device value — made (and set) when asked to. Exported for
 * the guest player link (2026-11-13), which hashes it under its OWN key
 * (`services/player-link.ts`), so a `PlayerPassDevice` row can never be joined
 * to a `KnownDevice` row through the shared cookie.
 */
export async function deviceValueHere(make: boolean): Promise<string | null> {
  const jar = await cookies();
  const held = jar.get(DEVICE_COOKIE)?.value;
  if (held) return verify(held) ?? held; // a signed value gives its raw part; an older unsigned one is kept as it was
  if (!make) return null;
  return setSignedDevice(jar);
}

type Jar = Awaited<ReturnType<typeof cookies>>;

/** Make a device value, set it SIGNED (B96), and return its raw part. */
function setSignedDevice(jar: Jar): string {
  const value = newBrowserValue();
  jar.set(DEVICE_COOKIE, sign(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIES,
    path: "/",
    maxAge: DEVICE_COOKIE_SECONDS,
  });
  return value;
}

/** A device value as `newBrowserValue` makes it (32 random bytes, base64url). Anything else is not one we set. */
const DEVICE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/**
 * THIS BROWSER'S DEVICE VALUE FOR THE GUEST DOOR (B96): the raw value only when the cookie carries OUR signature
 * (an HMAC under the app secret). An unsigned value, a forged one or none is `null` — a new device, which the guest
 * door counts. Older unsigned cookies stay good for the staff known-device check (`deviceValueHere`) and are not
 * good here.
 */
export async function signedDeviceHere(): Promise<string | null> {
  const jar = await cookies();
  const held = jar.get(DEVICE_COOKIE)?.value;
  const raw = held ? verify(held) : null;
  return raw && DEVICE_SHAPE.test(raw) ? raw : null;
}

/** Set a NEW signed device cookie, replacing whatever the browser held (a forged or unsigned value included). */
export async function mintSignedDevice(): Promise<void> {
  setSignedDevice(await cookies());
}

/** Has this person signed in on this browser before? */
export async function isKnownDevice(userId: string): Promise<boolean> {
  const hash = await deviceHashHere(false);
  if (!hash) return false;
  const row = await prisma.knownDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash: hash } }, select: { id: true } });
  return !!row;
}

/** Remember this browser for this person; answers its description in words. */
export async function rememberDevice(userId: string): Promise<string> {
  const hash = (await deviceHashHere(true))!;
  // Words for a person to recognise, and nothing decides on them: a request
  // with no headers to read (a test harness, a server-side call) is described
  // as unrecognised rather than refused.
  let userAgent = "";
  try {
    userAgent = (await headers()).get("user-agent") ?? "";
  } catch {
    userAgent = "";
  }
  const label = deviceLabel(userAgent);
  const now = new Date();
  await prisma.knownDevice.upsert({
    where: { userId_deviceHash: { userId, deviceHash: hash } },
    create: { userId, deviceHash: hash, label },
    update: { lastSeenAt: now, label },
  });
  return label;
}

/**
 * Who is asked for a code on a browser not seen before: the PLATFORM OWNERS
 * (`OWNER_EMAILS`, 2026-11-13) and club staff. The owner's password alone used
 * to open launch, every club's plan, prices and discount codes on any browser,
 * and an owner may hold no club seat at all, so the staff test below never
 * named them. Owners are the most valuable account, not the least asked.
 *
 * Club staff: a seat at a club (every `OrganizationMember` is staff — players
 * are never members, see the schema), or an admin or assistant on any
 * tournament. Asked by address as well as by user, because an event seat is
 * keyed on the address.
 */
export async function isClubStaff(userId: string, email: string): Promise<boolean> {
  if (isOwner(email)) return true;
  const seat = await prisma.organizationMember.findFirst({ where: { userId }, select: { id: true } });
  if (seat) return true;
  const event = await prisma.account.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, role: { in: ["admin", "assistant"] } },
    select: { id: true },
  });
  return !!event;
}
