import "server-only";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { SECURE_COOKIES } from "@/lib/secure-cookies";
import { hashBrowserValue, newBrowserValue } from "@/lib/domain/email-code-hash";
import { deviceLabel } from "@/lib/domain/device-words";

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
  const jar = await cookies();
  let value = jar.get(DEVICE_COOKIE)?.value;
  if (!value) {
    if (!make) return null;
    value = newBrowserValue();
    jar.set(DEVICE_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: SECURE_COOKIES,
      path: "/",
      maxAge: DEVICE_COOKIE_SECONDS,
    });
  }
  return hashBrowserValue(value);
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
 * Club staff: a seat at a club (every `OrganizationMember` is staff — players
 * are never members, see the schema), or an admin or assistant on any
 * tournament. Asked by address as well as by user, because an event seat is
 * keyed on the address.
 */
export async function isClubStaff(userId: string, email: string): Promise<boolean> {
  const seat = await prisma.organizationMember.findFirst({ where: { userId }, select: { id: true } });
  if (seat) return true;
  const event = await prisma.account.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, role: { in: ["admin", "assistant"] } },
    select: { id: true },
  });
  return !!event;
}
