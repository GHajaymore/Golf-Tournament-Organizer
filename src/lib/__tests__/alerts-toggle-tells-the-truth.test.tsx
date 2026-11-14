import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { readSource } from "./source";
import { deviceFrom, endpointFingerprint, pushToggleState, pushUnavailableWords } from "@/lib/domain/push-device";
import { PushUnavailableNote } from "@/components/PushToggleClient";
import { PLAYER_HELP_TOPICS } from "@/lib/player-help";

/**
 * THE ALERTS TOGGLE TELLS THE TRUTH, ON A SHARED PHONE AND ON AN IPHONE
 * (2026-11-14, safety sweep G-3 and G-4).
 *
 *   G-4  it read "on" from the browser, so the second person on a handed-on
 *        phone was told "Tee-time alerts are on." and got nothing: now "on"
 *        means the browser's subscription is the signed-in person's own
 *   G-3  on an iPhone in Safari it vanished without a word; now it says why
 *        alerts cannot reach the phone and what still works
 */

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

describe("on a phone that changed hands (G-4)", () => {
  it("is on only when the browser's subscription is the signed-in person's", async () => {
    const first = await endpointFingerprint("https://push.example.invalid/zz-first-person");
    const second = await endpointFingerprint("https://push.example.invalid/zz-second-phone");
    // The first person turned alerts on; the phone passed to somebody whose own alerts are elsewhere.
    expect(pushToggleState({ browserFingerprint: first, mine: [second] }), "told the second person alerts are on").toBe("off");
    expect(pushToggleState({ browserFingerprint: first, mine: [] })).toBe("off");
    expect(pushToggleState({ browserFingerprint: null, mine: [second] })).toBe("off");
  });

  it("CONTROL: the person whose subscription it is sees it on", async () => {
    const mine = await endpointFingerprint("https://push.example.invalid/zz-mine");
    expect(pushToggleState({ browserFingerprint: mine, mine: ["other", mine] })).toBe("on");
  });

  it("a fingerprint is the endpoint's SHA-256, never the endpoint", async () => {
    const e = "https://push.example.invalid/zz-secret-device-address";
    const f = await endpointFingerprint(e);
    expect(f).toMatch(/^[0-9a-f]{64}$/);
    expect(f).toBe(await endpointFingerprint(e));
    expect(f).not.toContain("zz-secret");
    // Worked by another route: Node's own hash of the same bytes.
    const { createHash } = await import("node:crypto");
    expect(f).toBe(createHash("sha256").update(e).digest("hex"));
  });

  it("the toggle asks that rule, given the server's list, never the browser alone", () => {
    const client = readSource("src", "components", "PushToggleClient.tsx");
    expect(client, "the toggle no longer asks whose subscription it is").toContain("pushToggleState(");
    expect(client, "the toggle believes the browser again").not.toMatch(/setState\(\s*sub\s*\?\s*"on"/);
    const server = readSource("src", "components", "PushToggle.tsx");
    expect(server).toContain("pushFingerprintsFor(session?.email)");
  });
});

describe("every Sign out sends this device, so its alerts leave with the person (G-4)", () => {
  // Every screen or component that offers Sign out.
  const tsx = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "__tests__" ? [] : tsx(`${dir}/${e.name}`)) : e.name.endsWith(".tsx") ? [`${dir}/${e.name}`] : [],
    );
  const files = tsx("src").filter((f) => readFileSync(f, "utf8").includes("signOutAction"));
  /** A press: the button's call, or a plain form's action. */
  const doors = (src: string) => [...src.matchAll(/signOutAction\(([^)]*)\)|<form action=\{signOutAction\}>[\s\S]*?<\/form>/g)].map((m) => m[0]);

  it("CONTROL: the sign-out doors are found — four buttons and forms across the app", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.flatMap((f) => doors(readSource(...f.split("/")))).length).toBeGreaterThanOrEqual(5);
    // A door that sends nothing is seen.
    expect(doors("onClick={() => startTransition(() => signOutAction())}")).toEqual(["signOutAction()"]);
  });

  it("a button sends the endpoint it let go of; a form carries the hidden field", () => {
    const bare = files.flatMap((f) =>
      doors(readSource(...f.split("/")))
        .filter((d) => !d.includes("releaseThisDevicesPush()") && !d.includes("<PushEndpointField />"))
        .map((d) => `${f}: ${d.slice(0, 60)}`),
    );
    expect(bare, "a Sign out that leaves this phone's alerts with the person signing out").toEqual([]);
  });
});

describe("on an iPhone (G-3)", () => {
  it("knows an iPhone, and an iPad that says it is a Mac", () => {
    expect(deviceFrom({ userAgent: IPHONE_SAFARI }, false)).toEqual({ iOS: true, installed: false });
    expect(deviceFrom({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 5 }, false).iOS).toBe(true);
    expect(deviceFrom({ userAgent: IPHONE_SAFARI, standalone: true }, false).installed).toBe(true);
    expect(deviceFrom({ userAgent: IPHONE_SAFARI }, true).installed).toBe(true);
    // CONTROL: neither a Mac nor an Android phone is an iPhone.
    expect(deviceFrom({ userAgent: MAC_SAFARI, platform: "MacIntel", maxTouchPoints: 0 }, false).iOS).toBe(false);
    expect(deviceFrom({ userAgent: ANDROID_CHROME }, false).iOS).toBe(false);
  });

  it("in the browser, says alerts cannot reach it, what still works, and how to get them", () => {
    const w = pushUnavailableWords({ iOS: true, installed: false });
    expect(w, "an iPhone in the browser is told nothing").not.toBeNull();
    const all = [w!.title, ...w!.lines].join(" ");
    expect(all).toMatch(/can't reach this iPhone from the browser/);
    expect(all, "does not say what still works").toMatch(/Keep this page on screen\. It turns red if play stops\./);
    expect(all, "does not say a pocketed phone hears nothing").toMatch(/A locked phone, or one in your pocket, is not told\./);
    expect(all, "does not say how to get alerts").toMatch(/Add to Home Screen/);
  });

  it("promises nothing an iPhone does not keep: no siren on silent, no buzz, no 'open' tab", () => {
    for (const installed of [false, true]) {
      const all = [pushUnavailableWords({ iOS: true, installed })!.title, ...pushUnavailableWords({ iOS: true, installed })!.lines].join(" ");
      expect(all, "promises a siren a phone on silent may not make").not.toMatch(/siren|sound/i);
      expect(all, "promises a buzz iOS gives a page none of").not.toMatch(/buzz|vibrat/i);
      expect(all, "'open' reads as a tab behind a locked screen").not.toMatch(/page open|app open/i);
      expect(all, "Chrome on an iPhone is not Safari").not.toMatch(/in Safari\./);
    }
  });

  it("the player's Help says the same: a pocket with alerts off is not told, and how to turn them on", () => {
    const topic = PLAYER_HELP_TOPICS.find((t) => t.id === "suspended");
    expect(topic, "the Help has no topic on play suspended").toBeTruthy();
    const all = topic!.steps.join(" ");
    expect(all).toMatch(/Phone in your pocket with alerts off\? You are not told\./);
    expect(all).toMatch(/open Today and find Get tee-time alerts/);
    expect(all).toMatch(/Tap Turn on/);
    expect(all, "the Help promises a siren on every phone").not.toMatch(/With the app open, a siren/);
    expect(all, "the siren is said for Android only").toMatch(/On Android, a siren sounds/);
  });

  it("on the Home Screen but too old, says to update, and that a pocket is not told", () => {
    const w = pushUnavailableWords({ iOS: true, installed: true });
    const all = [w!.title, ...w!.lines].join(" ");
    expect(all).toMatch(/iOS 16\.4/);
    expect(all).toMatch(/is not told/);
  });

  it("CONTROL: elsewhere there is nothing useful to say, so nothing is said", () => {
    expect(pushUnavailableWords({ iOS: false, installed: false })).toBeNull();
  });

  it("every sentence is under twelve words, as the player app is", () => {
    for (const installed of [false, true]) {
      const w = pushUnavailableWords({ iOS: true, installed })!;
      for (const sentence of [w.title, ...w.lines].flatMap((l) => l.split(/(?<=[.!?])\s+/))) {
        const words = sentence.split(" ").filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
        expect(words, sentence).toBeLessThan(12);
      }
    }
  });

  it("the note is drawn, and the toggle draws it where it used to draw nothing", () => {
    const html = renderToStaticMarkup(<PushUnavailableNote words={pushUnavailableWords({ iOS: true, installed: false })!} />);
    expect(html).toContain('role="note"');
    expect(html).toContain("Alerts can&#x27;t reach this iPhone from the browser.");
    expect(html).toContain("Add to Home Screen");
    const client = readSource("src", "components", "PushToggleClient.tsx");
    expect(client, "the toggle vanishes on an iPhone again").toMatch(/state === "unavailable" && why\) return <PushUnavailableNote/);
    expect(client).toContain("setWhy(pushUnavailableWords(deviceFrom(");
  });
});
