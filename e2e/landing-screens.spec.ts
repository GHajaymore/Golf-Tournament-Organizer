import { expect, test } from "./coverage";

/**
 * EVERY SCREENSHOT ON THE FRONT DOOR IS SHARP, WHOLE AND STILL.
 *
 * The landing's pictures are unedited captures of the app, and three kinds of
 * fault made them look worse than the app itself — each found by Ajay's eye
 * before any test (2026-09-29), which is what this file is here to end:
 *
 *  - SOFT: a capture exported at 600px drawn 302px wide on a 2x laptop has too
 *    few pixels, and the browser stretches it. Every image must give the
 *    screen at least its own pixel ratio, and — since the pre-sharpened
 *    srcset copies of 2026-09-30 let a 1x screen take a smaller file — offer
 *    a copy with at least two device pixels per CSS pixel for retina laptops.
 *  - CUT or STRETCHED: an image shown at a different shape from the capture is
 *    either cropped by its box or distorted. Shown and natural aspect must agree.
 *  - BLURRED BY MOTION: a screenshot turned in 3D, or floated by an animation,
 *    is resampled by the browser every frame and its text goes soft. No image
 *    may sit under a rotating/3D transform or a running animation.
 *
 * Measured signed out (the front door is what a visitor sees) and with motion
 * ALLOWED, because the project default of reduced motion would hide exactly the
 * animation this is looking for. Every lazy image is scrolled into view first.
 *
 * ONE EXEMPTION, AND IT IS NAMED (2026-10-11). The rebuilt page has layers that
 * are scenery: the dashboard plane lying behind the hero's phone, the second
 * phone behind it, the wall of small screens. They are tilted, dimmed and
 * small ON PURPOSE and nobody is asked to read one, so they are not held to a
 * rule about reading. A layer is scenery only when it says so twice — the
 * `m-decor` class AND `aria-hidden="true"`, so a screen reader is not offered a
 * picture the eye is not either. The exemption cannot swallow the page: the
 * count of pictures that ARE read has a floor below, and it is the number the
 * page really has, not a comfortable one.
 */

/** The fewest pictures that must be measured. The page has 19 to 22 that are read, by width. */
const READ_AT_LEAST = 15;
test.use({ storageState: { cookies: [], origins: [] }, contextOptions: { reducedMotion: "no-preference" } });

async function sharpWholeStill(page: import("@playwright/test").Page) {
  // Waiting for each picture to come to rest is real time: a second or more for one that arrives with a flourish.
  test.setTimeout(120_000);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".thq h1")).toHaveCount(1);

  // EVERY PICTURE IS ASKED FOR NOW, NOT WHEN IT IS SCROLLED TO. A picture not yet loaded is passed over
  // below, not measured — and the walk down the page gives each sixty milliseconds, which is long enough
  // for Chromium to fetch a lazy picture and not for Safari's engine: its first run (2026-10-13) measured
  // fourteen of fifteen, and said so only because the count is held. Whether a picture is lazy is not
  // what this spec is about; whether it is sharp, whole and still is.
  await page.evaluate(() => document.querySelectorAll<HTMLImageElement>(".thq img").forEach((img) => (img.loading = "eager")));

  // Rise every section and walk the page so lazy images load.
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("seen")));
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(60);
  }
  await page.waitForLoadState("networkidle");
  // Arrived, or failed to: `complete` is true of both, and a picture that failed has no width and is counted out.
  await page.waitForFunction(() => Array.from(document.querySelectorAll<HTMLImageElement>(".thq img")).every((img) => img.complete), null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);

  const { faults, read, scenery } = await page.evaluate(async () => {
    const dpr = window.devicePixelRatio;
    let read = 0;
    let scenery = 0;
    /**
     * The FILE's pixels. With a srcset, an <img>'s naturalWidth is not the file's
     * width: the browser divides it by the density it picked, so a 1170px copy
     * chosen for a 330px slot reports 330 — and a guard reading it measures its
     * own `sizes`, not the picture (the first run of the srcset read "1.18x" for
     * a 3.5x image). A bare Image of the chosen file reports what is really there.
     */
    const fileSize = (src: string) =>
      new Promise<[number, number]>((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve([probe.naturalWidth, probe.naturalHeight]);
        probe.onerror = () => resolve([0, 0]);
        probe.src = src;
      });
    const out: string[] = [];
    const moving = (el: Element) => el.getAnimations().some((a) => a.playState === "running");
    const turned = (t: string) => {
      if (!t || t === "none") return false;
      if (t.startsWith("matrix3d")) return true; // perspective / rotateX|Y
      const m = t.match(/^matrix\(([^)]+)\)$/);
      if (!m) return false;
      const [a, b, c, d] = m[1].split(",").map(Number);
      return Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || Math.abs(a - 1) > 1e-3 || Math.abs(d - 1) > 1e-3;
    };
    /**
     * BROUGHT ON SCREEN, AND GIVEN TIME TO ARRIVE (2026-10-13). A section of this page waits, tilted and
     * dimmed, until it is scrolled to, and then settles over a second or so. This spec measured every
     * picture where it stood after one quick walk down the page — which is "at rest" only if nothing on
     * the page moves. Nothing did, because the suite asks for reduced motion; Safari's engine on Linux
     * does not honour that request, and the first round there measured the organizer's laptop screen
     * still tilted, a second into arriving. Nearly everybody sees this page WITH its motion.
     *
     * So each picture is put in the middle of the screen and waited for: until nothing above it is still
     * arriving. A picture that never arrives runs out the wait and is reported turned, as it should be.
     * Motion that never ends (the hero's slow float) is not waited for, and is reported if it is on a
     * picture meant to be read.
     */
    const arriving = (el: Element) =>
      (el.classList.contains("m-armed") && !el.classList.contains("m-in")) ||
      el.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity);
    /**
     * Where the picture is and how it is turned, as one string. A browser's own list of what is animating
     * is not enough: Safari's engine drops a transition from that list a few frames before the element has
     * actually reached the end of it, and the organizer's laptop screen was measured a quarter of a degree
     * from flat. At rest means it has STOPPED — the same place twice running.
     */
    const pose = (img: HTMLImageElement) => {
      const box = img.getBoundingClientRect();
      let s = `${box.width.toFixed(2)}x${box.height.toFixed(2)}`;
      for (let el: Element | null = img; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        s += `|${cs.transform}|${cs.opacity}`;
      }
      return s;
    };
    const settle = async (img: HTMLImageElement) => {
      img.scrollIntoView({ block: "center", behavior: "instant" });
      let was = "";
      for (let tick = 0; tick < 60; tick += 1) {
        await new Promise((r) => setTimeout(r, 100));
        let busy = false;
        for (let el: Element | null = img; el && el !== document.body; el = el.parentElement) busy = busy || arriving(el);
        const now = pose(img);
        if (!busy && now === was && tick >= 2) return;
        was = now;
      }
    };
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(".thq img"))) {
      if (img.getBoundingClientRect().width < 80 || !img.naturalWidth) continue; // hidden tabs, icons, not yet loaded
      const name = (img.currentSrc || img.src).split("/").pop();
      // Scenery, said twice — see the head of this file. Half a claim is a fault, not an excuse.
      const layer = img.closest(".m-decor");
      if (layer) {
        if (layer.getAttribute("aria-hidden") === "true") { scenery += 1; continue; }
        out.push(`${name}: in a layer marked m-decor that a screen reader is still offered — scenery is aria-hidden`);
      }
      read += 1;
      const [fileW, fileH] = await fileSize(img.currentSrc || img.src);
      const [srcW] = await fileSize(img.src);
      // Only what is meant to be READ is waited for: scenery may move for ever, and nobody measures it.
      // And it is waited for LAST, with nothing awaited between the wait and the looking: some screens take
      // turns (a loop that fades to the next every few seconds), and a picture found still, then measured a
      // moment later, was caught mid-fade — reported "animated" for a fade that is over in half a second.
      await settle(img);
      const box = img.getBoundingClientRect();
      const density = fileW / box.width;
      if (density < dpr - 0.05) out.push(`${name}: soft — ${density.toFixed(2)} px per CSS px, needs ${dpr}`);
      // What a retina laptop would be given (2026-09-30): a srcset lets a 1x screen take a
      // smaller copy, so the largest copy on offer must still carry 2x at this width.
      const offered = Math.max(srcW, ...(img.srcset || "").split(",").map((c) => parseInt(c.trim().split(/\s+/)[1] || "0", 10)).filter((n) => n > 0));
      if (offered / box.width < 1.95) out.push(`${name}: no 2x copy — largest ${offered}px for ${Math.round(box.width)} CSS px`);
      const natural = fileH / fileW;
      const shown = box.height / box.width;
      if (Math.abs(natural - shown) / natural > 0.02) out.push(`${name}: cut or stretched — shown ${shown.toFixed(3)}, capture ${natural.toFixed(3)}`);
      for (let el: Element | null = img; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
        if (turned(cs.transform) || (cs.rotate !== "none" && cs.rotate !== "0deg") || cs.perspective !== "none") out.push(`${name}: turned by ${label} (${cs.transform})`);
        if (moving(el)) out.push(`${name}: animated by ${label}`);
      }
    }
    return { faults: Array.from(new Set(out)), read, scenery };
  });

  expect(read, `only ${read} pictures were measured (${scenery} passed over as scenery) — the page shows more than that to be read`).toBeGreaterThanOrEqual(READ_AT_LEAST);
  expect(faults, faults.join("\n")).toEqual([]);
}

test("every screenshot on the front door is sharp, whole and still", async ({ page }) => {
  await sharpWholeStill(page);
});

/**
 * And on a tablet, measured separately: an iPad sits between the phone and
 * desktop layouts, so a section can stack to one column and stretch a
 * phone-width capture past its natural size — the prizes card did, to 1.72x
 * on an iPad at 2x, while the three projects above all passed (2026-09-30).
 */
test.describe("on an iPad", () => {
  test.use({ viewport: { width: 810, height: 1080 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  test("every screenshot on the front door is sharp, whole and still", async ({ page }) => {
    await sharpWholeStill(page);
  });
});

/**
 * THE THEME SLIDER SHOWS FOUR THEMES, NOT ONE (2026-10-11).
 *
 * Its ancestor showed one screen in light and in dark, and for a day in
 * September showed neither: the frame's reveal waited on a tab that had been
 * removed, and every check above skips a picture that is hidden. The rebuilt
 * slider lays ONE board in four club themes side by side, and the first draft of
 * it had the same kind of fault in a new form — Ajay, on the prototype: "this is
 * not showing multiple themes". Four captures were there; one was on top.
 *
 * So this asks the screen what is actually showing: across the frame, at
 * sixteen points, which capture is on top. All four must have a band, two of
 * them light and two dark; and moving the slider must move a boundary, or it is
 * a picture with a handle drawn on it.
 */
test("the theme slider shows one board in four themes, and dragging moves the bands", async ({ page }) => {
  await page.goto("/");
  const frame = page.locator("#themes");
  await frame.scrollIntoViewIfNeeded();
  await expect(frame).toBeVisible();

  const onTop = () =>
    frame.evaluate(async (f) => {
      const imgs = [...f.querySelectorAll("img")];
      await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
      const box = f.getBoundingClientRect();
      const tops: string[] = [];
      for (let i = 0; i < 16; i++) {
        const x = box.left + ((i + 0.5) / 16) * box.width;
        const top = document.elementsFromPoint(x, box.top + box.height / 2).find((e) => e.tagName === "IMG") as HTMLImageElement | undefined;
        tops.push(top ? (top.currentSrc || top.src).split("/").pop()!.split(".")[0] : "nothing");
      }
      return { tops, loaded: imgs.map((i) => i.complete && i.naturalWidth > 0), width: Math.round(box.width) };
    });

  // The four captures are lazy: they start loading as the frame comes into view, so they are
  // asked for until they are there. The first run of this test asked once, at once, and failed
  // on a slider that was working (2026-10-12).
  await expect.poll(async () => (await onTop()).loaded, { message: "a theme's capture did not load", timeout: 15_000 }).toEqual([true, true, true, true]);
  const rest = await onTop();
  expect(rest.width, "the frame is too narrow to show four bands").toBeGreaterThan(200);
  expect(rest.tops, "part of the frame shows no capture at all").not.toContain("nothing");
  const themes = [...new Set(rest.tops)];
  expect(themes.length, `the frame shows ${themes.join(", ")}`).toBe(4);
  expect(themes.filter((t) => t.endsWith("-light")).length, "two of the four are light").toBe(2);
  expect(themes.filter((t) => t.endsWith("-dark")).length, "two of the four are dark").toBe(2);

  // The handle is a real control: a range input over the frame, reachable by keyboard.
  const range = frame.locator('input[type="range"]');
  await expect(range).toBeVisible();
  await range.fill("20");
  await expect.poll(async () => (await onTop()).tops.join(" "), { message: "moving the slider moved no band" }).not.toBe(rest.tops.join(" "));
  const moved = await onTop();
  expect(new Set(moved.tops).size, "a theme vanished when the slider moved").toBe(4);
});

/**
 * THE PAGE ENDS WHERE ITS FOOTER ENDS (2026-10-12).
 *
 * The closing section has a glow that reaches below it on purpose, and that
 * reach was scrollable: the page ran some 250px past the footer into nothing,
 * at every width. Nothing asked how tall the page was against what it holds —
 * a sideways check exists for the width (`layout.spec`), and this is its twin
 * for the length. Found by a measurement written for something else, which
 * printed the footer's last line ending two thirds of the way down the screen.
 */
test("the page ends where its footer ends", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  /**
   * Measured in the DOCUMENT, not on the screen. The first version compared the
   * footer with `innerHeight` after scrolling to the end, and on a WebKit phone
   * that read 10px short on a page that was right: there the visual viewport is
   * 10px less than `innerHeight`, so the last scroll position stops early. How
   * far the page runs past its footer is the same question with no screen in it.
   */
  const end = await page.evaluate(() => {
    const footer = document.querySelector(".thq .ftr");
    return {
      footer: footer ? Math.round(footer.getBoundingClientRect().bottom + window.scrollY) : -1,
      page: document.documentElement.scrollHeight,
    };
  });
  expect(end.footer, "no footer was found").toBeGreaterThan(0);
  expect(end.page - end.footer, `the page runs ${end.page - end.footer}px past the end of its footer`).toBeLessThanOrEqual(2);
});

/**
 * THE BAR OF TWO BUTTONS ON A PHONE: UP MID-PAGE, AND GONE MEANS GONE.
 *
 * A phone keeps "Run an event" and "Enter a code" within reach in a bar at the
 * bottom once the hero's own buttons have scrolled away. Until 2026-10-12 a bar
 * that was "down" had only been slid off the screen: it still took keyboard
 * focus, and at the very end of the page it came back up over the footer's
 * last line. Down now means not painted and not focusable, and it stays down
 * wherever the page already offers those buttons, and at the footer.
 */
test("a phone's bottom bar is up only mid-page, and unreachable when it is down", async ({ page }) => {
  const dock = page.locator("#dock");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  test.skip((page.viewportSize()?.width ?? 0) >= 900, "the bar is a phone's; a laptop keeps the header's buttons");

  const state = () =>
    dock.evaluate((d) => {
      const cs = getComputedStyle(d);
      const box = d.getBoundingClientRect();
      return { shown: cs.visibility === "visible" && box.top < window.innerHeight - 4, reachable: cs.visibility === "visible" };
    });
  /**
   * The bar answers an observer and slides, so it is ASKED UNTIL it says what it should, not asked once
   * after a fixed pause. It was asked after 700ms, with the page left to scroll at its own pace — and
   * with the page's motion on, a scroll to the sign-up form is itself still under way at 700ms on a slow
   * machine. Safari's engine on Linux runs with the motion on whatever the suite asks (see
   * `sharpWholeStill`), and failed here for that. The jump is made at once; the wait is for the bar.
   */
  const at = async (y: number, what: string, want: { shown: boolean; reachable: boolean }) => {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await expect.poll(state, { message: what, timeout: 8_000 }).toEqual(want);
  };
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  const startTop = await page.evaluate(() => Math.round(document.querySelector("#start")!.getBoundingClientRect().top + window.scrollY));

  await at(0, "at the top, beside the hero's own buttons", { shown: false, reachable: false });
  await at(Math.round(height * 0.45), "mid-page", { shown: true, reachable: true });
  await at(startTop, "at the sign-up form", { shown: false, reachable: false });
  await at(height, "at the footer", { shown: false, reachable: false });
});
