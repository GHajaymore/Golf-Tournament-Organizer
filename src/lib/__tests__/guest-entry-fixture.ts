import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { generateShareToken } from "@/lib/codes";

/**
 * THE FIXTURE OF THE GUEST SELF-ENTRY AUDIT TESTS (J39/J40 PR 3B). Not a test: the club, the event with its sign-up link,
 * the staff member, and the browsers a stranger arrives in. Every row is marked `zz-guest-entry…`, uses invented names and
 * `@example.invalid` addresses, and is deleted by `dropClub` in the test's `finally`.
 */
export const MARK = "zz-guest-entry";

export interface Club {
  orgId: string;
  eventId: string;
  token: string;
  staffUserId: string;
  staffEmail: string;
}

export async function makeClub(
  prisma: PrismaClient,
  mark: string,
  opts: { capacity?: number; guestOpen?: boolean; regDeadline?: string; override?: boolean | null; scoringBasis?: string; withCode?: string } = {},
): Promise<Club> {
  const org = await prisma.organization.create({ data: { name: `${mark} Larkfield Golf Society`, kind: "club", timeZone: "UTC" }, select: { id: true } });
  const token = generateShareToken();
  const ev = await prisma.event.create({
    data: {
      name: `${mark} Spring Outing`,
      organizationId: org.id,
      status: "draft",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: opts.regDeadline ?? "",
      shareToken: `${mark}-${Date.now()}-${randomBytes(3).toString("hex")}`,
      registrationToken: token,
      registrationOpen: true,
      registrationOverride: opts.override ?? null,
      guestEntryOpen: opts.guestOpen ?? true,
      registrationCode: opts.withCode ?? "",
      capacity: opts.capacity ?? 64,
    },
    select: { id: true },
  });
  await prisma.stage.create({
    data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: opts.scoringBasis ?? "gross" },
  });
  const staffEmail = `${mark}-staff@example.invalid`;
  const staff = await prisma.user.create({ data: { email: staffEmail, name: "Corin Abernethy", password: "x:unusable", emailVerifiedAt: new Date() } });
  await prisma.account.create({ data: { eventId: ev.id, name: "Corin Abernethy", email: staffEmail, role: "admin" } });
  return { orgId: org.id, eventId: ev.id, token, staffUserId: staff.id, staffEmail };
}

export async function dropClub(prisma: PrismaClient, mark: string): Promise<void> {
  await prisma.organization.deleteMany({ where: { name: { startsWith: mark } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: mark } } });
}

const r = () => Math.floor(Math.random() * 250) + 1;
/** A fresh network address in 10/8, so a counting window that outlives one run cannot leak between cases. */
export function randomAddress(): string {
  return `10.${r()}.${r()}.${r()}`;
}

/** A device value as `newBrowserValue` makes it. */
export function deviceValue(): string {
  return randomBytes(32).toString("base64url");
}

/** A nonce as the form makes it (24 random bytes, base64url). */
export function newNonce(): string {
  return randomBytes(24).toString("base64url");
}

/** A browser arriving: an empty jar, a device cookie (unless told not to), on this address. */
export function arrive(jar: Map<string, string>, head: Map<string, string>, opts: { address: string; device?: boolean | string }): void {
  jar.clear();
  head.set("x-forwarded-for", opts.address);
  if (opts.device !== false) jar.set("ng_device", typeof opts.device === "string" ? opts.device : deviceValue());
}
