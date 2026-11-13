import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { derivedKey } from "@/lib/auth";
import { generateLinkCode } from "@/lib/codes";
import { isGuest } from "@/lib/domain/entry-standing";
import { lastPlayDay, passRefusal, type PassRefusal, type PassStatus } from "@/lib/domain/player-link";
import { dayAtClubForEvent, todayForEvent } from "@/lib/services/club-clock";

/**
 * A GUEST'S PLAYER LINK, STORED (J39/J40 PR 1; design §2.3). The one place a
 * `PlayerPass` row is made, read, rotated or turned off.
 *
 * THE CODE IS NEVER STORED. Two derived keys, one job each (`derivedKey`):
 *   - `lookup`: HMAC-SHA256 of the normalised code. The only way a typed code
 *     finds its row; a database dump alone is no oracle without the app secret.
 *   - `sealed`: AES-256-GCM of the code, a fresh 96-bit nonce each time, bound
 *     to `passId:version` as associated data, so the organizer can show the
 *     SAME link again (D3: re-sending is not rotating) and a sealed value
 *     copied onto another row, or kept from before a rotation, does not open.
 * A browser that opens a link is recorded by a third key's hash of its
 * `ng_device` value, so `PlayerPassDevice` cannot be joined to `KnownDevice`.
 *
 * The code leaves the server ONLY as the answer to a staff member's press
 * (`showPlayerLink`, a server action: a POST, never cached, never in a
 * rendered page — S7).
 */

const LOOKUP_KEY = "player-link-lookup";
const SEAL_KEY = "player-link-seal";
const DEVICE_KEY = "player-link-device";

/** The row a code finds, by its keyed hash. Exported for the tests. */
export function lookupOf(code: string): string {
  return createHmac("sha256", derivedKey(LOOKUP_KEY)).update(`player-link:${code}`).digest("hex");
}

/** A browser's `ng_device` value, hashed under the link's own key. */
export function deviceHashOf(deviceValue: string): string {
  return createHmac("sha256", derivedKey(DEVICE_KEY)).update(deviceValue).digest("hex");
}

/** Seal a code to one pass at one version. Exported for the tests. */
export function sealCode(code: string, passId: string, version: number): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey(SEAL_KEY), iv);
  cipher.setAAD(Buffer.from(`${passId}:${version}`));
  const body = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The code back out of a sealed value, or null when it is not this pass's at this version. */
export function unsealCode(sealed: string, passId: string, version: number): string | null {
  try {
    const raw = Buffer.from(sealed, "base64url");
    if (raw.length < 12 + 16 + 1) return null;
    const decipher = createDecipheriv("aes-256-gcm", derivedKey(SEAL_KEY), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${passId}:${version}`));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** A pass id of our own making, so the code can be sealed to it before the row exists. */
function newPassId(): string {
  return `pl${randomBytes(11).toString("hex")}`;
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** What a guest entry is, for the rules: its status, its standing, its event. */
const ENTRY = { id: true, eventId: true, name: true, status: true, standing: true } as const;

/**
 * Why this pass does not open today, or null — `passRefusal` told the CLUB's
 * day (`todayForEvent`) and the event's last day of golf.
 */
async function refusalFor(
  pass: { revokedAt: Date | null; version: number; eventId: string },
  entry: { status: string; standing: string },
  heldVersion: number | null,
): Promise<PassRefusal | null> {
  const [event, stages, today] = await Promise.all([
    prisma.event.findUnique({ where: { id: pass.eventId }, select: { startOn: true, endOn: true } }),
    prisma.stage.findMany({ where: { eventId: pass.eventId }, select: { playedOn: true } }),
    todayForEvent(pass.eventId),
  ]);
  if (!event) return "left";
  return passRefusal({
    revokedAt: pass.revokedAt,
    version: pass.version,
    heldVersion,
    entryStatus: entry.status,
    isGuest: isGuest(entry),
    lastDay: lastPlayDay(event, stages),
    today,
  });
}

/** One guest entry of this event, or null — a member, or another event's entry, is never given a link (D12). */
async function guestEntry(eventId: string, playerId: string) {
  const entry = await prisma.player.findFirst({ where: { id: playerId, eventId }, select: ENTRY });
  return entry && isGuest(entry) ? entry : null;
}

export type ShownPass = { ok: true; code: string } | { ok: false; reason: "not-a-guest" | "turned-off" };

/**
 * THE LINK FOR THIS GUEST, made on first use (D13: nothing secret exists for a
 * guest nobody asks a link for). The same code every time after that, until
 * the organizer presses New link (D3). A turned-off link is not shown again:
 * New link makes the next one.
 */
export async function ensurePass(eventId: string, playerId: string, by: string): Promise<ShownPass> {
  const entry = await guestEntry(eventId, playerId);
  if (!entry) return { ok: false, reason: "not-a-guest" };
  const existing = await prisma.playerPass.findUnique({ where: { playerId } });
  if (existing) {
    if (existing.eventId !== eventId) return { ok: false, reason: "not-a-guest" };
    if (existing.revokedAt) return { ok: false, reason: "turned-off" };
    const code = unsealCode(existing.sealed, existing.id, existing.version);
    // A seal that no longer opens (the app secret was rotated): the old code is
    // dead anyway (its lookup is under the old key too), so a fresh one.
    if (code) return { ok: true, code };
    return rotatePass(eventId, playerId, by);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = newPassId();
    const code = generateLinkCode();
    try {
      await prisma.playerPass.create({
        data: { id, playerId, eventId, lookup: lookupOf(code), sealed: sealCode(code, id, 1), version: 1, createdBy: by },
      });
      return { ok: true, code };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // Two presses at once made it already: show that one.
      const made = await prisma.playerPass.findUnique({ where: { playerId } });
      if (made) return ensurePass(eventId, playerId, by);
      // Otherwise a lookup collision (one in 2^60 per live link): draw again.
    }
  }
  throw new Error("Couldn't make a player link just now. Try again.");
}

/**
 * NEW LINK (the organizer's press, with a confirm): a new code and the version
 * one higher, so every phone holding the old cookie is out on its next request
 * and the old code finds nothing. The browsers the old link was opened on are
 * forgotten with it. Also turns a turned-off link back on, as a new one.
 */
export async function rotatePass(eventId: string, playerId: string, by: string): Promise<ShownPass> {
  const entry = await guestEntry(eventId, playerId);
  if (!entry) return { ok: false, reason: "not-a-guest" };
  const existing = await prisma.playerPass.findUnique({ where: { playerId }, select: { id: true, eventId: true, version: true } });
  if (!existing) return ensurePass(eventId, playerId, by);
  if (existing.eventId !== eventId) return { ok: false, reason: "not-a-guest" };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateLinkCode();
    const version = existing.version + 1;
    try {
      await prisma.$transaction([
        prisma.playerPass.update({
          where: { id: existing.id },
          data: { lookup: lookupOf(code), sealed: sealCode(code, existing.id, version), version, rotatedAt: new Date(), revokedAt: null, revokedBy: "", lastOpenedAt: null },
        }),
        prisma.playerPassDevice.deleteMany({ where: { passId: existing.id } }),
      ]);
      return { ok: true, code };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new Error("Couldn't make a new player link just now. Try again.");
}

/** TURN OFF LINK: it stops opening on every phone. The guest still scores on the day from the round code. */
export async function revokePass(eventId: string, playerId: string, by: string): Promise<boolean> {
  const done = await prisma.playerPass.updateMany({
    where: { playerId, eventId, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: by },
  });
  return done.count > 0;
}

/** The panel's status (never the code): made, turned off, how many browsers, when last opened. */
export async function passStatusFor(eventId: string, playerId: string): Promise<PassStatus | null> {
  const entry = await guestEntry(eventId, playerId);
  if (!entry) return null;
  const pass = await prisma.playerPass.findUnique({
    where: { playerId },
    select: { eventId: true, revokedAt: true, lastOpenedAt: true, _count: { select: { devices: true } } },
  });
  if (!pass || pass.eventId !== eventId) return { made: false, revoked: false, browsers: 0, lastOpened: "" };
  const dayOf = await dayAtClubForEvent(eventId);
  return {
    made: true,
    revoked: !!pass.revokedAt,
    browsers: pass._count.devices,
    lastOpened: pass.lastOpenedAt ? dayOf(pass.lastOpenedAt) : "",
  };
}

/** What a live pass speaks for: one entry in one event. Nothing else is ever read from a link. */
export interface LivePass {
  passId: string;
  version: number;
  playerId: string;
  eventId: string;
  name: string;
  /** The entry's status today. Writes need "confirmed" (S5, `mayPlayThroughLink`). */
  status: string;
}

/** A typed or tapped code's live pass, or null — unknown and dead read the same to the caller. */
export async function passForCode(code: string): Promise<LivePass | null> {
  const pass = await prisma.playerPass.findUnique({
    where: { lookup: lookupOf(code) },
    select: { id: true, version: true, revokedAt: true, eventId: true, player: { select: ENTRY } },
  });
  if (!pass || pass.player.eventId !== pass.eventId) return null;
  if (await refusalFor(pass, pass.player, null)) return null;
  return { passId: pass.id, version: pass.version, playerId: pass.player.id, eventId: pass.eventId, name: pass.player.name, status: pass.player.status };
}

/**
 * The pass a cookie names, re-checked against the database on EVERY request
 * (as `getPlaySession` does): turned off, rotated, the entry withdrawn or made
 * a member, or past its 90th club day — and the cookie is nothing.
 */
export async function livePass(passId: string, heldVersion: number): Promise<LivePass | null> {
  const pass = await prisma.playerPass.findUnique({
    where: { id: passId },
    select: { id: true, version: true, revokedAt: true, eventId: true, player: { select: ENTRY } },
  });
  if (!pass || pass.player.eventId !== pass.eventId) return null;
  if (await refusalFor(pass, pass.player, heldVersion)) return null;
  return { passId: pass.id, version: pass.version, playerId: pass.player.id, eventId: pass.eventId, name: pass.player.name, status: pass.player.status };
}

/**
 * A TAP OPENED THE LINK ON THIS BROWSER (S1: only ever a tap, never a page
 * load). Remembers the browser and when; answers whether it is new to this
 * pass, for the audit line and the other phone's notice.
 */
export async function recordOpen(passId: string, deviceValue: string | null): Promise<{ newBrowser: boolean }> {
  const now = new Date();
  let newBrowser = false;
  if (deviceValue) {
    const deviceHash = deviceHashOf(deviceValue);
    const seen = await prisma.playerPassDevice.findUnique({ where: { passId_deviceHash: { passId, deviceHash } }, select: { id: true } });
    if (seen) await prisma.playerPassDevice.update({ where: { id: seen.id }, data: { lastSeenAt: now } });
    else {
      newBrowser = true;
      try {
        await prisma.playerPassDevice.create({ data: { passId, deviceHash, firstSeenAt: now, lastSeenAt: now } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }
  await prisma.playerPass.update({ where: { id: passId }, data: { lastOpenedAt: now } });
  return { newBrowser };
}

/**
 * When ANOTHER browser first opened this link after this one did, or null
 * (design §2.7: "Your link was opened on another phone"). The latest such.
 */
export async function openedElsewhereSince(passId: string, deviceValue: string | null): Promise<Date | null> {
  if (!deviceValue) return null;
  const mine = await prisma.playerPassDevice.findUnique({
    where: { passId_deviceHash: { passId, deviceHash: deviceHashOf(deviceValue) } },
    select: { firstSeenAt: true },
  });
  if (!mine) return null;
  const other = await prisma.playerPassDevice.findFirst({
    where: { passId, firstSeenAt: { gt: mine.firstSeenAt } },
    orderBy: { firstSeenAt: "desc" },
    select: { firstSeenAt: true },
  });
  return other?.firstSeenAt ?? null;
}
