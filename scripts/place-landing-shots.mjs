/**
 * Put a folder of captures on the front door, in every size a screen may ask for.
 *
 *     node scripts/place-landing-shots.mjs <folder of .png captures> [--only=id,id]
 *
 * (Normally run by `npm run landing:capture`, straight after `capture-demo.mjs --landing`.)
 *
 * WHAT GOES WHERE IS THE MANIFEST'S, `src/lib/landing/screens.ts` (2026-11-01): each screen's id,
 * its viewport, its look preset, its crop and the words that must be on it. This script holds no
 * list of its own. A capture is `<id>.png` in the folder, with its words in `text/<id>.txt`
 * (capture-demo writes both).
 *
 * IT REFUSES BEFORE IT WRITES. Every capture asked for is checked first, and if any one fails
 * nothing is written to `public/landing`:
 *   - its pixel size is not its viewport's (1179x2556 for a phone, 2880x1800 for the laptop);
 *   - its crop falls outside it;
 *   - a line of its `expect` is not in its words;
 *   - the hero's live moment was shot but its figures (`screen-facts.json`) do not add up.
 * A screen the manifest keeps (no `capture`) is left as last placed and said.
 *
 * WHY THE SMALLER COPIES (Ajay, 2026-09-30, and again 2026-10-11: "make the screenshots really
 * crisp and sharp"): a browser shrinking one large file three or four times over uses a fast
 * filter that greys thin strokes, so small text goes soft however sharp the file is. Each copy here
 * is reduced with Lanczos and given the preset's unsharp mask, and the page's `sizes` lets every
 * screen take the copy nearest its own need. ALWAYS DOWN from the capture, never up.
 *
 * A preset may sharpen and lift contrast a little. It never changes what a screen says.
 */
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { SCREENS, SCENES, PRESETS, VIEWPORTS, LIVE_MOMENT } from "../src/lib/landing/screens.ts";

const args = process.argv.slice(2);
const from = args.find((a) => !a.startsWith("--"));
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);

// THE SCENE BEHIND THE HERO: `--scene=<image>` places the manifest's scene from an exported image
// (cropped and sized as `SCENES` says) and does nothing else. No screen is ever part of a scene.
const sceneArg = args.find((a) => a.startsWith("--scene="));
if (sceneArg) {
  const src = sceneArg.slice(8);
  const widthsAll = JSON.parse(readFileSync(join("src", "lib", "landing", "shot-widths.json"), "utf8"));
  for (const sc of SCENES) {
    const meta = await sharp(src).metadata();
    const c = sc.crop;
    if (c.left + c.width > meta.width || c.top + c.height > meta.height) { console.error(`REFUSED — ${sc.id}: crop falls outside ${meta.width}x${meta.height}`); process.exit(1); }
    for (const w of sc.widths) await sharp(src).extract(c).resize({ width: w, kernel: "lanczos3" }).webp({ quality: sc.quality }).toFile(join("public", "landing", `${sc.id}.w${w}.webp`));
    const w = Math.max(...sc.widths);
    widthsAll[sc.id] = { w, h: Math.round((c.height * w) / c.width), v: sc.widths.filter((x) => x !== w), scene: true };
  }
  writeFileSync(join("src", "lib", "landing", "shot-widths.json"), JSON.stringify(Object.fromEntries(Object.keys(widthsAll).sort().map((k) => [k, widthsAll[k]])), null, 1) + "\n");
  console.log(`placed ${SCENES.map((s) => s.id).join(", ")}`);
  process.exit(0);
}
if (!from || !existsSync(from)) {
  console.error("usage: node scripts/place-landing-shots.mjs <folder of .png captures> [--only=id,id]");
  process.exit(2);
}
const OUT = join("public", "landing");
const WIDTHS_FILE = join("src", "lib", "landing", "shot-widths.json");
const FACTS_FILE = join("src", "lib", "landing", "screen-facts.json");

const asked = SCREENS.filter((s) => s.capture && (!ONLY.length || ONLY.includes(s.id)));
for (const s of SCREENS.filter((x) => !x.capture)) console.log(`kept  ${s.id} — ${s.kept}`);

// ── check everything first ──
const refusals = [];
const ready = [];
for (const s of asked) {
  const png = join(from, `${s.id}.png`);
  if (!existsSync(png)) { refusals.push(`${s.id}: no capture at ${png}`); continue; }
  const meta = await sharp(png).metadata();
  const v = VIEWPORTS[s.viewport];
  const want = [v.width * v.scale, v.height * v.scale];
  if (meta.width !== want[0] || meta.height !== want[1]) refusals.push(`${s.id}: ${meta.width}x${meta.height}, a ${s.viewport} capture is ${want[0]}x${want[1]}`);
  if (s.crop && (s.crop.top < 0 || s.crop.height <= 0 || s.crop.top + s.crop.height > v.height)) refusals.push(`${s.id}: crop ${s.crop.top}+${s.crop.height} falls outside ${v.height}`);
  const textFile = join(from, "text", `${s.id}.txt`);
  const words = existsSync(textFile) ? readFileSync(textFile, "utf8").toLowerCase() : null;
  if (s.expect.length && words === null) refusals.push(`${s.id}: no words at ${textFile} to check "${s.expect.join('", "')}" against`);
  for (const line of s.expect) if (words !== null && !words.includes(line.toLowerCase())) refusals.push(`${s.id}: "${line}" is not on the screen`);
  ready.push({ s, png, meta });
}

let facts = null;
const liveIds = new Set([...LIVE_MOMENT.before, ...LIVE_MOMENT.after]);
if (asked.some((s) => liveIds.has(s.id))) {
  const file = join(from, "screen-facts.json");
  if (!existsSync(file)) refusals.push("the live moment was asked for but screen-facts.json is missing");
  else {
    facts = JSON.parse(readFileSync(file, "utf8"));
    if (!(facts.field > 0)) refusals.push(`live moment: no field size (${facts.field})`);
    if (!(facts.holesAfter === facts.holesBefore + 1)) refusals.push(`live moment: holes in ${facts.holesBefore} -> ${facts.holesAfter}, not one more`);
    if (!facts.placeBefore || !facts.placeAfter || facts.placeBefore === facts.placeAfter) refusals.push(`live moment: the player did not move (${facts.placeBefore} -> ${facts.placeAfter})`);
    if (!facts.hole || !facts.score) refusals.push(`live moment: the hole (${facts.hole}) or the score pressed (${facts.score}) was not read`);
    if (!facts.toParAfter) refusals.push("live moment: no to-par read for the player after the score");
    if (facts.rows !== facts.field) refusals.push(`live moment: the leaderboard lists ${facts.rows} of a field of ${facts.field}`);
    for (const s of SCREENS.filter((x) => liveIds.has(x.id) && x.onPage)) {
      for (const m of s.measure ?? []) {
        const key = m === "press" ? "press" : "selfRow";
        if (!facts.rects?.[s.id]?.[key]) refusals.push(`live moment: ${s.id} has no measured ${m}`);
      }
    }
  }
}

if (refusals.length) {
  console.error(`REFUSED — nothing was written to ${OUT}:\n  ${refusals.join("\n  ")}`);
  process.exit(1);
}

// ── then write ──
const widths = JSON.parse(readFileSync(WIDTHS_FILE, "utf8"));
let files = 0, bytes = 0;
const placed = [];
for (const { s, png, meta } of ready) {
  if (!s.onPage) { console.log(`seen  ${s.id} — captured for its figures, not shown`); continue; }
  const preset = PRESETS[s.preset];
  const v = VIEWPORTS[s.viewport];
  const crop = s.crop ? { left: 0, top: s.crop.top * v.scale, width: meta.width, height: s.crop.height * v.scale } : null;
  const fullH = crop ? crop.height : meta.height;
  const base = () => {
    let img = sharp(png);
    if (crop) img = img.extract(crop);
    if (preset.grade) img = img.linear(preset.grade.a, preset.grade.b);
    return img;
  };
  const wanted = [...new Set([...v.widths, ...(s.extraWidths ?? [])])].sort((a, b) => a - b).filter((w) => w < meta.width);
  for (const w of wanted) {
    const out = join(OUT, `${s.id}.w${w}.webp`);
    await base().resize({ width: w, kernel: "lanczos3" }).sharpen(preset.sharpen).webp({ quality: preset.quality }).toFile(out);
    files += 1; bytes += statSync(out).size;
  }
  const full = join(OUT, `${s.id}.webp`);
  await base().webp({ quality: preset.fullQuality }).toFile(full);
  files += 1; bytes += statSync(full).size;
  widths[s.id] = { w: meta.width, h: fullH, v: wanted };
  placed.push(s.id);
}
const sorted = Object.fromEntries(Object.keys(widths).sort().map((k) => [k, widths[k]]));
writeFileSync(WIDTHS_FILE, JSON.stringify(sorted, null, 1) + "\n");
if (facts) writeFileSync(FACTS_FILE, JSON.stringify(facts, null, 1) + "\n");
console.log(JSON.stringify({ placed: placed.length, files, megabytes: +(bytes / 1048576).toFixed(2), facts: Boolean(facts) }));
