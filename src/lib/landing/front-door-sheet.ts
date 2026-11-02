import { createHash } from "node:crypto";
import { LANDING_CSS } from "@/lib/landing/styles";
import { HOME_CSS } from "@/lib/landing/home-styles";

/**
 * THE FRONT DOOR'S STYLESHEET, AS A FILE (2026-11-01).
 *
 * The two sheets used to be written into the page as two `<style>` elements.
 * A server component's props travel twice — once as HTML and once more in the
 * page's React payload, which the browser needs to hydrate — so the 145 KB of
 * CSS was sent as about 300 KB on every visit, and never cached: of the 671 KB
 * the page weighed, nearly half was its own stylesheet, twice.
 *
 * Now it is one file, `/landing.css` (`src/app/landing.css/route.ts`), linked
 * once and kept by the browser. The text is exactly the two sheets, in the
 * order the two `<style>` elements stood, so the cascade is the same; React
 * puts the link in the head and holds the page's first paint until it has
 * arrived, as the inline sheet did. The `v` in the address is the text's own
 * fingerprint, so a changed sheet is a new address and a kept copy can never
 * be a stale one.
 */
export const FRONT_DOOR_CSS = `${LANDING_CSS}\n${HOME_CSS}`;

export const FRONT_DOOR_CSS_VERSION = createHash("sha256").update(FRONT_DOOR_CSS).digest("hex").slice(0, 12);

export const FRONT_DOOR_CSS_HREF = `/landing.css?v=${FRONT_DOOR_CSS_VERSION}`;
