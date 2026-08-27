// Rasterize the TourneyHQ mark into every icon the web app and the two
// store builds need. Run: node scripts/gen-icons.mjs
//
// This file used to draw a different logo entirely — a dashed ball-flight arc
// rising to a circle, from when the product was called Flights. The mark was
// redrawn as a flagstick over a green precisely because the arc read as an
// airline, and Logo.tsx still says so; but nothing regenerated the icons, so
// the PWA, the Android launcher and the iOS home screen all kept shipping the
// rejected one. The paths below are the component's, scaled — if the mark
// changes again, change it here and re-run, and everything follows.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");
const androidRes = join(root, "android/app/src/main/res");
const iosIcons = join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset");

// Brand colours, resolved. The component uses CSS custom properties, which an
// SVG rasterizer cannot see, so the values are written out here.
const GROUND = "#16181a"; // --color-bg
// Orange flag, green ball — matching Logo.tsx's --logo-flag / --logo-ball
// defaults. These two were the other way round, and the ball was orange here
// while the component drew it in currentColor: the home-screen icon did not
// match the app it opened.
const FLAG = "#f2862e"; // --color-accent, as the ramp actually resolves it
const STICK = "#e9e9ed"; // --color-text on the dark ground: the T is lettering,
//                          not accent, so it matches the wordmark beside it
const BALL = "#5fb484"; // --color-accent-2-400: lifted one step off the in-app
//                         green, which goes muddy at 48px
const EDGE = "#55605a"; // the cup's rim, brightened for small sizes

/**
 * The mark on a 512 grid — Logo.tsx's 32-unit viewBox scaled 16x.
 * Flagstick and flag top-right, putting surface below, ball on the green.
 *
 * Nudged down 24 units, which is Logo.tsx's 1.5 at this scale, and for the
 * same reason: the drawing spans y 49.6 (flagstick cap) to 414 (cup with its
 * stroke), an optical centre of ~232 against a box centre of 256. Left alone
 * it sits high in every tile.
 * *
 * THE SHIFT IS GONE, because the mark no longer needs one. The pin monogram
 * is drawn centred in its own box — see the viewBox note in Logo.tsx — so
 * there is nothing here to keep in step, which is a better answer than two
 * files each remembering the same correction.
 */
const mark = `<g>
  <path d="M115.2 67.2 V444.8" stroke="${STICK}" stroke-width="51.2" stroke-linecap="round"/>
  <path d="M150.4 105.6 h275.2 l-64 65.6 l64 65.6 H150.4 z" fill="${FLAG}"/>
  <rect x="150.4" y="281.6" width="198.4" height="57.6" rx="28.8" fill="${STICK}"/>
  <rect x="150.4" y="384" width="121.6" height="57.6" rx="28.8" fill="${BALL}"/></g>`;

const svg = (body, size = 512) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${body}</svg>`;

/** Rounded tile — the PWA install icon and the Android legacy launcher. */
const tile = svg(`<rect width="512" height="512" rx="112" fill="${GROUND}"/>${mark}`);
/** Square, because iOS applies its own corner radius and dislikes alpha. */
const square = svg(`<rect width="512" height="512" fill="${GROUND}"/>${mark}`);
/** Circular, for Android's round launcher. */
const round = svg(`<circle cx="256" cy="256" r="256" fill="${GROUND}"/>${mark}`);
/** Full bleed with the mark inside the ~66% safe zone every mask respects. */
const maskable = svg(
  `<rect width="512" height="512" fill="${GROUND}"/><g transform="translate(87,87) scale(0.66)">${mark}</g>`,
);
/** Android adaptive foreground: transparent, same safe zone, its own layer. */
const adaptiveFg = svg(`<g transform="translate(87,87) scale(0.66)">${mark}</g>`);

/** The favicon, at the component's own scale so it stays crisp at 16px. */
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${GROUND}"/>
  <path d="M7.2 4.2 V27.8" stroke="${STICK}" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M9.4 6.6 h17.2 l-4 4.1 l4 4.1 H9.4 z" fill="${FLAG}"/>
  <rect x="9.4" y="17.6" width="12.4" height="3.6" rx="1.8" fill="${STICK}"/>
  <rect x="9.4" y="24" width="7.6" height="3.6" rx="1.8" fill="${BALL}"/>
</svg>
`;

const png = (source, size, out) =>
  sharp(Buffer.from(source)).resize(size, size).png().toFile(out);

// Android launcher densities, as the platform names them.
const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

async function main() {
  mkdirSync(pub, { recursive: true });

  // Web / PWA
  await png(tile, 192, join(pub, "icon-192.png"));
  await png(tile, 512, join(pub, "icon-512.png"));
  await png(maskable, 512, join(pub, "icon-maskable-512.png"));
  await png(square, 180, join(pub, "apple-touch-icon.png"));
  writeFileSync(join(root, "src/app/icon.svg"), favicon, "utf8");

  // Android — legacy, round and adaptive foreground at every density.
  for (const [density, size] of Object.entries(DENSITIES)) {
    const dir = join(androidRes, `mipmap-${density}`);
    mkdirSync(dir, { recursive: true });
    await png(tile, size, join(dir, "ic_launcher.png"));
    await png(round, size, join(dir, "ic_launcher_round.png"));
    // The foreground layer is drawn larger: the system crops it to the mask.
    await png(adaptiveFg, Math.round(size * 1.5), join(dir, "ic_launcher_foreground.png"));
  }

  // iOS wants one 1024 square with no alpha.
  mkdirSync(iosIcons, { recursive: true });
  await sharp(Buffer.from(square))
    .resize(1024, 1024)
    .flatten({ background: GROUND })
    .png()
    .toFile(join(iosIcons, "AppIcon-512@2x.png"));

  console.log("Generated: PWA icons, favicon, Android mipmaps, iOS AppIcon.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
