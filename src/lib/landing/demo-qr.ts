import "server-only";
import { qrModules, qrPath, type QrEncoder } from "@/lib/qr";

/**
 * THE FRONT DOOR'S QR CODE (2026-10-24): for a visitor on a laptop to open a
 * player's card of the demo club on their own phone — the address
 * `/demo/card`, which opens the "playing now" medal's round code the way a
 * printed sign does.
 *
 * Drawn on the SERVER, as one SVG path (`lib/qr.ts`), so the encoder is in no
 * page's download at all; it is loaded here, lazily, only when the front door
 * is rendered (`round-code-sign.test.ts` lists who loads it).
 */
export async function demoCardQr(origin: string): Promise<{ d: string; size: number; url: string }> {
  const url = `${origin.replace(/\/$/, "")}/demo/card`;
  const encode = (await import("qrcode-generator")).default as unknown as QrEncoder;
  return { ...qrPath(qrModules(encode, url)), url };
}
