import { describe, it, expect, afterEach, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { startDictation, canDictate } from "../dictation";

/**
 * TAKING DICTATION, IN ONE PLACE.
 *
 * Three components did it by hand — the match-result entry, the stroke-play
 * card, and the player's spoken question — and the duplicated part was never
 * the interesting part: the vendor-prefix lookup for Safari, the three config
 * lines, digging the words out of `e.results[0][0].transcript`, and remembering
 * that `onend` fires whether or not anything was heard.
 *
 * That last one is the trap. A component that un-presses its button only in
 * `onresult` leaves the mic lit for ever when nothing is said — and each of the
 * three had to know it separately.
 */

type Handler = () => void;
let made: Array<Record<string, unknown>> = [];

/**
 * Stand in for the browser's recogniser, and record what was set on it.
 *
 * A `window` is stubbed onto `globalThis` rather than a DOM environment being
 * added: `vitest.config.ts` says the node environment is deliberate ("the
 * render tests use react-dom/server and so need no DOM"), and pulling in jsdom
 * to test four property assignments would be out of proportion. The helper
 * touches nothing else on `window`.
 */
function installFakeRecogniser(opts: { vendor?: "standard" | "webkit" | "none" } = {}) {
  made = [];
  class Fake {
    lang = "";
    interimResults = true;
    maxAlternatives = 0;
    onresult: ((e: { results: { 0: { 0: { transcript: string } } } }) => void) | null = null;
    onerror: Handler | null = null;
    onend: Handler | null = null;
    started = false;
    stopped = false;
    constructor() {
      made.push(this as unknown as Record<string, unknown>);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
    }
  }
  const win: Record<string, unknown> = {};
  if (opts.vendor === "webkit") win.webkitSpeechRecognition = Fake;
  else if (opts.vendor !== "none") win.SpeechRecognition = Fake;
  (globalThis as unknown as Record<string, unknown>).window = win;
  return Fake;
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).window;
});

describe("starting dictation", () => {
  it("configures the recogniser for one answer, not a running transcript", () => {
    // A scorer says a result and expects the button to finish. Interim results
    // would have the hint rewriting itself mid-sentence.
    installFakeRecogniser();
    startDictation({ onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
    const rec = made[0] as unknown as { lang: string; interimResults: boolean; maxAlternatives: number; started: boolean };
    expect(rec.lang).toBe("en-US");
    expect(rec.interimResults).toBe(false);
    expect(rec.maxAlternatives).toBe(1);
    expect(rec.started, "the recogniser was built but never started").toBe(true);
  });

  it("finds Safari's prefixed constructor too", () => {
    /**
     * The whole reason the four lines of casting existed in three files.
     * Safari exposes `webkitSpeechRecognition` and nothing else, and it is the
     * browser most of this app's phones are running.
     */
    installFakeRecogniser({ vendor: "webkit" });
    expect(canDictate()).toBe(true);
    expect(startDictation({ onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })).not.toBeNull();
  });

  it("hands back null when the browser cannot, rather than throwing", () => {
    // The CALLER words this: "type the scores instead" and "voice isn't
    // supported" are different sentences about different screens, so the
    // helper refuses to choose one.
    installFakeRecogniser({ vendor: "none" });
    expect(canDictate()).toBe(false);
    expect(startDictation({ onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })).toBeNull();
  });

  it("says no on the server, where there is no window at all", () => {
    // These components render on the server too — they are "use client", which
    // means they render in BOTH places. Reaching for `window` during that
    // render is a crash, not a missing feature.
    expect(canDictate()).toBe(false);
    expect(startDictation({ onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })).toBeNull();
  });

  it("passes the words through, and only the words", () => {
    installFakeRecogniser();
    const onTranscript = vi.fn();
    startDictation({ onTranscript, onError: vi.fn(), onEnd: vi.fn() });
    const rec = made[0] as unknown as {
      onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
    };
    rec.onresult({ results: { 0: { 0: { transcript: "four par birdie" } } } });
    expect(onTranscript).toHaveBeenCalledWith("four par birdie");
  });

  it("reports the end separately from the result", () => {
    /**
     * THE ONE EACH COPY HAD TO REMEMBER. `onend` fires whether or not anything
     * was heard — a scorer who taps the mic and says nothing gets `onend` and
     * no `onresult` — so a component that un-presses its button only on a
     * result leaves the mic lit for ever.
     */
    installFakeRecogniser();
    const onEnd = vi.fn();
    const onError = vi.fn();
    startDictation({ onTranscript: vi.fn(), onError, onEnd });
    const rec = made[0] as unknown as { onend: Handler; onerror: Handler };
    rec.onend();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError, "silence is not an error").not.toHaveBeenCalled();
  });

  it("can be stopped by the caller that started it", () => {
    installFakeRecogniser();
    const handle = startDictation({ onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() })!;
    handle.stop();
    expect((made[0] as unknown as { stopped: boolean }).stopped).toBe(true);
  });
});

describe("nobody builds a recogniser by hand", () => {
  it("is asked for through startDictation and nowhere else", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__") continue;
          walk(rel);
        } else if (/\.tsx?$/.test(entry.name) && statSync(join(process.cwd(), rel)).isFile()) {
          files.push(rel);
        }
      }
    };
    walk("src");
    const offenders = files.filter(
      (f) => !f.endsWith(join("lib", "dictation.ts")) && /webkitSpeechRecognition/.test(readSource(f)),
    );
    expect(
      offenders,
      `use startDictation() rather than reaching for the browser API: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
