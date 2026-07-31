// Rasterize the Flights mark into the PNG icons a PWA needs (install + Apple).
// Run: node scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
mkdirSync(pub, { recursive: true });

// The mark at 512, scaled 16x from the 32-unit component viewBox.
const markPaths = `
  <path d="M64 408 H152" stroke="#e9e9ed" stroke-width="26" stroke-linecap="round" opacity="0.45"/>
  <path d="M112 400 Q224 96 416 136" stroke="#f2872e" stroke-width="34" stroke-linecap="round" stroke-dasharray="3.2 64" fill="none"/>
  <circle cx="416" cy="136" r="48" fill="#e9e9ed"/>`;

const tile = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#161826"/>${markPaths}
</svg>`;

// Maskable: full-bleed, mark inset to the ~66% safe zone.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#161826"/>
  <g transform="translate(87,87) scale(0.66)">${markPaths}</g>
</svg>`;

// Apple touch icon: square (iOS applies its own rounding), dark ground.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#161826"/>${markPaths}
</svg>`;

async function main() {
  await sharp(Buffer.from(tile)).resize(192, 192).png().toFile(join(pub, "icon-192.png"));
  await sharp(Buffer.from(tile)).resize(512, 512).png().toFile(join(pub, "icon-512.png"));
  await sharp(Buffer.from(maskable)).resize(512, 512).png().toFile(join(pub, "icon-maskable-512.png"));
  await sharp(Buffer.from(apple)).resize(180, 180).png().toFile(join(pub, "apple-touch-icon.png"));
  console.log("Generated PWA icons in public/.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
