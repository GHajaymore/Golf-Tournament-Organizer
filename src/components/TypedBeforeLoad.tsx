import { TypedBeforeLoadSync } from "./TypedBeforeLoadSync";

/**
 * WHAT SOMEBODY TYPES BEFORE THE PAGE HAS LOADED IS NOT LOST (2026-10-11).
 *
 * A screen is on the phone before its script is. On the course, on one bar of
 * signal, that gap is seconds: long enough to type a round code, or a name and
 * an address. The box showed every letter — and the page's own record of the
 * box stayed empty, because the letters arrived before anything was listening.
 * So Continue stayed grey over a code that was plainly there, and sign-up said
 * "Enter your name" under a name. Measured with the script held back three
 * seconds, on Chromium and on WebKit alike.
 *
 * TWO HALVES, and it has to be two:
 *
 *   1. This tiny script runs the moment the browser reads it — long before the
 *      app's own — and only REMEMBERS which boxes were typed in while nothing
 *      was listening. It changes nothing.
 *   2. `TypedBeforeLoadSync`, once the page is live, tells the page about each
 *      of those boxes, exactly as if the letters had just been typed.
 *
 * WHY REMEMBER, rather than look for boxes whose contents differ from what the
 * server drew: a browser puts back what was in a form when a page is reloaded,
 * and several boxes in this app SAVE as they change (a round's deadline). A
 * value the browser restored is not something anybody typed, and announcing it
 * would save a stale date over a newer one. A restored value fires no input
 * event; a typed, pasted or password-manager-filled one does.
 *
 * Text boxes only. A tick-box or a dropdown changed that early is left as it
 * is: most of those save the moment they change, and saving on somebody's
 * behalf a second after the page loads is a worse surprise than a switch that
 * has to be flipped again.
 *
 * There is no Content-Security-Policy yet (`next.config.mjs` says why). The
 * day there is, this inline script needs its nonce like the theme styles do.
 */
const REMEMBER = `(function(){var k="__thqTyped";if(window[k])return;var seen=window[k]=new Set();document.addEventListener("input",function(e){var t=e.target;if(!t||!t.tagName)return;var keys=Object.keys(t);for(var i=0;i<keys.length;i++){if(keys[i].indexOf("__reactFiber$")===0||keys[i].indexOf("__reactProps$")===0)return;}seen.add(t);},true);})();`;

export function TypedBeforeLoad() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: REMEMBER }} />
      <TypedBeforeLoadSync />
    </>
  );
}
