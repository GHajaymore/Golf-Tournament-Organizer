import type { CSSProperties } from "react";
import FACTS from "@/lib/landing/screen-facts.json";
import { plainShot } from "@/components/landing/shots";

/**
 * THE HERO'S STAGE (2026-11-01): a laptop in true 3D and the player's phone in front of it, on a lit
 * plinth, and ONE live moment — the member's card takes a score, and both boards move.
 *
 * Ajay, 1 Nov: "make it real impressive, keep up with the latest trend", "you are free to use AI but
 * screens should be real", "real screens enhanced to match the page". So:
 *
 *  - every screen is a real capture of the invented demo club, named in `screens.ts` and shot by
 *    `npm run landing:capture` — the before, the press and the after are one run of the real app;
 *  - the depth, the glass, the rim light, the plinth and the glow are LAYERS around the pictures
 *    (CSS, and one AI-made scene behind, `hero-scene`), never painted into them;
 *  - the phone a visitor READS is square to the eye and at rest (`e2e/landing-screens.spec.ts`): it
 *    arrives, then stands still. Only the laptop, which is scenery (`m-decor`, `aria-hidden`), is
 *    turned in 3D;
 *  - every figure said in words beside the pictures — the field, the holes in, the place moved — is
 *    read off those same captures (`screen-facts.json`, written by the capture), never typed here.
 *
 * Without script, and for a visitor who asks for less motion, the stage is drawn SETTLED: the board
 * after the score, and the figures after it. The page's script (`LandingHomeEffects`) plays the
 * moment once from the card, and then rests.
 */

const ORDINAL = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** A measured rectangle of a capture, as the four edges of a light laid over it. */
const at = (r: { x: number; y: number; w: number; h: number } | undefined): CSSProperties | undefined =>
  r && { left: `${(r.x * 100).toFixed(2)}%`, top: `${(r.y * 100).toFixed(2)}%`, width: `${(r.w * 100).toFixed(2)}%`, height: `${(r.h * 100).toFixed(2)}%` };

/** The phone is drawn up to 340px wide on a laptop and most of a phone's width on a phone (`.m-hand` in home-styles). */
const PHONE_SIZES = "(max-width: 899px) min(80vw, 330px), 340px";
/** The laptop's screen, before it is turned (`.m-lid`): never shown on a phone, so a phone asks for nothing. */
const DESK_SIZES = "(max-width: 899px) 1px, 760px";

export function HeroStage() {
  const f = FACTS;
  const rects = f.rects as Record<string, { press?: { x: number; y: number; w: number; h: number }; selfRow?: { x: number; y: number; w: number; h: number } }>;
  const moved = `${f.player}: ${f.score} on the ${ORDINAL(f.hole)}`;
  return (
    <div className="m-rig m-moved">
      <div className="m-scene m-decor" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- one pre-sized file; next/image would re-encode it */}
        <img src="/landing/hero-scene.w1100.webp" width={1100} height={728} alt="" loading="lazy" decoding="async" />
      </div>

      <div className="m-laptop m-decor" aria-hidden="true">
        <div className="m-lid">
          <div className="m-lid-screen" id="desk-loop">
            {plainShot({ name: "live-desk-after", alt: "", sizes: DESK_SIZES, className: "m-on" })}
            {plainShot({ name: "live-desk-before", alt: "", sizes: DESK_SIZES })}
            <i className="m-row-light" style={at(rects["live-desk-after"]?.selfRow)} />
            <i className="m-sheen" />
          </div>
        </div>
        <div className="m-deck" />
      </div>

      <div className="m-hand">
        <i className="m-keys" aria-hidden="true" />
        <div
          className="m-hand-screen"
          id="loop"
          role="img"
          aria-label={`A player's phone. ${f.player} enters a ${f.score} on the ${ORDINAL(f.hole)} on their card, and their board moves from ${f.placeBefore} to ${f.placeAfter}, ${f.toParAfter}.`}
        >
          {plainShot({ name: "live-board-after", alt: "", sizes: PHONE_SIZES, className: "m-on", priority: true })}
          {plainShot({ name: "live-card-before", alt: "", sizes: PHONE_SIZES, priority: true })}
          <i className="m-tap" aria-hidden="true" style={at(rects["live-card-before"]?.press)} />
          <i className="m-row-light" aria-hidden="true" style={at(rects["live-board-after"]?.selfRow)} />
        </div>
      </div>

      <div className="m-chip" aria-hidden="true">
        <span className="m-dot" />
        <span>
          <b>Live now</b> · {f.field} players ·{" "}
          <span className="m-count" id="live-count" data-before={f.holesBefore} data-after={f.holesAfter}>{f.holesAfter}</span> holes in
        </span>
      </div>
      <div className="m-toast" id="live-moved" aria-hidden="true">
        <span>{moved}</span>
        <b>
          {f.placeBefore} → {f.placeAfter}
        </b>
      </div>
    </div>
  );
}
