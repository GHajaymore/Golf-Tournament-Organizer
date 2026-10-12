/**
 * Put a folder of captures on the front door, in every size a screen may ask for.
 *
 *     node scripts/place-landing-shots.mjs <folder of .png captures>
 *
 * The landing's pictures are unedited captures of the app running the demo
 * club: phones at 393x852 and three device pixels to one (1179 wide), the
 * laptop at 1440x900 and two to one (2880 wide). This writes each one to
 * `public/landing/` as the capture itself plus smaller copies, and records the
 * copies in `src/lib/landing/shot-widths.json`, which is what `srcSetFor`
 * reads to build each <img srcset>.
 *
 * WHY THE SMALLER COPIES (Ajay, 2026-09-30, and again 2026-10-11: "make the
 * screenshots really crisp and sharp"): a browser shrinking one large file
 * three or four times over uses a fast filter that greys thin strokes, so
 * small text goes soft however sharp the file is. Each copy here is reduced
 * with Lanczos and given a light unsharp mask, and the page's `sizes` lets
 * every screen take the copy nearest its own need. ALWAYS DOWN from the
 * capture, never up: a width the capture does not have is skipped.
 *
 * It only reads the folder it is given and only writes the two places named
 * above. A capture it is not told about (NAMES below) is left alone and said.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const from = process.argv[2];
if (!from || !existsSync(from)) {
  console.error("usage: node scripts/place-landing-shots.mjs <folder of .png captures>");
  process.exit(2);
}
const OUT = join("public", "landing");
const WIDTHS_FILE = join("src", "lib", "landing", "shot-widths.json");
const PHONE = [420, 640, 860];
const DESK = [1080, 1620, 2160];

/** capture file → the name the page uses. A name says what the screen IS, not where it was shot. */
const NAMES = {
  "p-today": "club-today",
  "p-card": "club-card",
  "p-board": "club-board",
  "p-money": "club-money",
  "p-enter": "club-enter",
  "end-board": "club-final",
  "o-teesheet": "org-teesheet",
  "o-dashboard": "org-dashboard",
  "live-champs": "public-final",
  "live-twilight": "public-stableford",
  "live-team": "public-pairs",
  "live-cup": "public-cup",
  "world-gbp-money": "world-gbp-money",
  "world-eur-money": "world-eur-money",
  "world-zar-money": "world-zar-money",
  "world-inr-money": "world-inr-money",
  "world-gbp-board": "world-gbp-board",
  "world-inr-board": "world-inr-board",
  "look-tournament-light": "look-tournament-light",
  "look-championship-dark": "look-championship-dark",
  "look-coastal-light": "look-coastal-light",
  "look-midnight-dark": "look-midnight-dark",
  "d-dashboard": "desk-dashboard",
  "d-leaderboard": "desk-leaderboard",
  // A club match play of 128 in eight flights of sixteen (2026-10-12): the organizer's bracket
  // screen on a laptop, and the draw a member opens on a phone without signing in.
  "d-matchplay-flights": "desk-matchplay",
  "live-matchplay": "public-matchplay",
};

const widths = JSON.parse(readFileSync(WIDTHS_FILE, "utf8"));
const present = readdirSync(from).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
let files = 0, bytes = 0;
const placed = [], missing = [];
for (const [capture, name] of Object.entries(NAMES)) {
  const src = join(from, capture + ".png");
  if (!existsSync(src)) { missing.push(capture); continue; }
  const meta = await sharp(src).metadata();
  const wanted = (meta.width > 2000 ? DESK : PHONE).filter((w) => w < meta.width);
  for (const w of wanted) {
    const out = join(OUT, `${name}.w${w}.webp`);
    await sharp(src).resize({ width: w, kernel: "lanczos3" }).sharpen({ sigma: 0.6, m1: 0.6, m2: 1.4 }).webp({ quality: 92 }).toFile(out);
    files += 1; bytes += statSync(out).size;
  }
  const full = join(OUT, `${name}.webp`);
  await sharp(src).webp({ quality: 96 }).toFile(full);
  files += 1; bytes += statSync(full).size;
  widths[name] = { w: meta.width, h: meta.height, v: wanted };
  placed.push(name);
}
const sorted = Object.fromEntries(Object.keys(widths).sort().map((k) => [k, widths[k]]));
writeFileSync(WIDTHS_FILE, JSON.stringify(sorted, null, 1) + "\n");
console.log(JSON.stringify({ placed: placed.length, files, megabytes: +(bytes / 1048576).toFixed(2), missing, notNamed: present.filter((p) => !(p in NAMES)).length }));
