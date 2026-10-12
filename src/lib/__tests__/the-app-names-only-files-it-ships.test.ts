import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY FILE THE APP NAMES BY ADDRESS IS A FILE IT SHIPS (2026-10-11).
 *
 * The home-screen icon, the icon a notification carries and the logo handed to
 * search engines are not imported — they are ADDRESSES, written as strings in
 * the manifest, the service worker and the structured data. Nothing compiles
 * against them, so nothing notices when one stops existing.
 *
 * It happened during a counted across-the-board round: `public/icon-512.png`
 * was renamed in the file explorer to be used somewhere else. The whole round
 * — 910 browser tests, every screen, every control, Safari's engine, eleven
 * tournaments — finished CLEAN with the installed app's icon and the search
 * logo both answering 404. The round was honest; nothing in it asks.
 *
 * So: every quoted address ending in a file type, in the files that hand
 * addresses to a phone or a crawler, must be a file in `public/` — or one of
 * the few that Next makes from a file in `src/app`, each named below with the
 * file it comes from, which must exist too.
 *
 * What this does NOT see: an address built from pieces at run time, and the
 * landing's pictures (`public/landing`), which are imported and have their own
 * checks.
 */

/** The files that hand an address to a phone, a browser or a crawler. */
const NAMING = [
  "src/app/manifest.ts",
  "src/app/layout.tsx",
  "public/sw.js",
  "src/lib/domain/structured-data.ts",
  "src/lib/services/push.ts",
];

/** Addresses Next serves from a file in `src/app`, not from `public/`. */
const MADE_BY_NEXT: Record<string, string> = {
  "/manifest.webmanifest": "src/app/manifest.ts",
  "/icon.svg": "src/app/icon.svg",
  "/favicon.ico": "src/app/favicon.ico",
};

const ADDRESS = /["'`}](\/[A-Za-z0-9_.\/-]+\.(?:png|svg|ico|webmanifest|jpe?g|webp|pdf))["'`]/g;

function addressesIn(src: string): string[] {
  return [...new Set([...src.matchAll(ADDRESS)].map((m) => m[1]))];
}

function missing(addresses: string[]): string[] {
  return addresses.filter((address) => {
    const made = MADE_BY_NEXT[address];
    const file = made ?? `public${address}`;
    return !existsSync(join(process.cwd(), ...file.split("/")));
  });
}

describe("a file the app names by address", () => {
  it("exists — in public/, or as the file Next makes it from", () => {
    const wrong = NAMING.flatMap((file) =>
      missing(addressesIn(readSource(...file.split("/")))).map((address) => `${file} names ${address}, which is not shipped`),
    );
    expect(wrong).toEqual([]);
  });

  it("CONTROL: the addresses are found, in each of the places that broke", () => {
    // If the reader found nothing there would be nothing to miss.
    expect(addressesIn(readSource("src", "app", "manifest.ts"))).toEqual(
      expect.arrayContaining(["/icon-192.png", "/icon-512.png", "/icon-maskable-512.png"]),
    );
    expect(addressesIn(readSource("public", "sw.js"))).toEqual(expect.arrayContaining(["/icon-192.png", "/icon-512.png"]));
    // Built with the site's origin in front — the shape a bare quote would miss.
    expect(addressesIn(readSource("src", "lib", "domain", "structured-data.ts"))).toContain("/icon-512.png");
    expect(addressesIn(readSource("src", "app", "layout.tsx"))).toContain("/apple-touch-icon.png");
  });

  it("CONTROL: a file that is not there is reported, and one that is, is not", () => {
    expect(missing(["/icon-512.png", "/zz-no-such-icon.png"])).toEqual(["/zz-no-such-icon.png"]);
    expect(missing(["/manifest.webmanifest"])).toEqual([]);
  });
});
