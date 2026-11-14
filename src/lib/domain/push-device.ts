/**
 * WHAT THE ALERTS TOGGLE SAYS ON THIS DEVICE, AND FOR WHOM (2026-11-14,
 * safety sweep G-3 and G-4). Pure, so the rules are tested without a browser.
 *
 * The toggle used to take the browser's word: a subscription in the browser
 * meant "alerts are on". On a phone that changed hands that subscription was
 * the FIRST person's, so the second was told "alerts are on" and got nothing.
 * Now the page is given fingerprints of the signed-in person's own devices
 * (`pushFingerprintsFor`), and "on" means this browser's subscription is one
 * of them.
 *
 * And it hid itself without a word where push cannot work, which on an iPhone
 * in Safari is always: Apple allows web push only to a site added to the Home
 * Screen. A player there was never told that a locked phone would hear nothing
 * when play was suspended, nor what still works.
 */

/** SHA-256 of a push endpoint, in hex. The same on the server and in the browser (Web Crypto in both). */
export async function endpointFingerprint(endpoint: string): Promise<string> {
  const bytes = new TextEncoder().encode(endpoint);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * "on" only when the browser holds a subscription AND it is the signed-in
 * person's. Somebody else's subscription on this phone is "off" for them —
 * pressing Turn on then moves it to them (`savePushSubscription` re-stamps it).
 */
export function pushToggleState(here: { browserFingerprint: string | null; mine: readonly string[] }): "on" | "off" {
  return here.browserFingerprint !== null && here.mine.includes(here.browserFingerprint) ? "on" : "off";
}

export interface ThisDevice {
  /** An iPhone or iPad (an iPad says it is a Mac, with touch). */
  iOS: boolean;
  /** Opened from the Home Screen rather than in Safari. */
  installed: boolean;
}

export function deviceFrom(nav: { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean }, standaloneDisplay: boolean): ThisDevice {
  const iOS = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  return { iOS, installed: standaloneDisplay || nav.standalone === true };
}

/**
 * Why alerts cannot be turned on here, and what still works — or null where
 * there is nothing useful to tell (a desktop browser without push, a server
 * with push not set up): there the toggle still says nothing. Every sentence
 * is under twelve words, as the player app is (`e2e/player-words.spec.ts`).
 */
export function pushUnavailableWords(device: ThisDevice): { title: string; lines: string[] } | null {
  if (!device.iOS) return null;
  /**
   * What still works, promised no further than an iPhone keeps it (the
   * Tournament Director's review of #1134): the screen turning red. Not the
   * siren — a page's sound follows the ring/silent switch, and most golfers
   * play with the phone on silent — and not a buzz, which iOS gives a page
   * none of. "On screen", not "open": a tab open behind a locked screen is
   * told nothing.
   */
  const stillWorks = "Keep this page on screen. It turns red if play stops.";
  const notTold = "A locked phone, or one in your pocket, is not told.";
  if (device.installed) {
    // On the Home Screen already, so the iPhone is older than iOS 16.4, the first that allows it.
    return {
      title: "Alerts can't reach this iPhone yet.",
      lines: [stillWorks, notTold, "Alerts need iOS 16.4 or later. Update in Settings, General, Software Update."],
    };
  }
  // "From the browser", not "in Safari": Chrome on an iPhone is the same WebKit, and the same answer.
  return {
    title: "Alerts can't reach this iPhone from the browser.",
    lines: [stillWorks, notTold, "To be told: tap Share, then Add to Home Screen.", "Open TourneyHQ from there and turn alerts on."],
  };
}
