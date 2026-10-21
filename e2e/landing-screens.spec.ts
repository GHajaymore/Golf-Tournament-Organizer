import { expect, test } from "./coverage";
import { landingSettled } from "./landing-settled";

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
  // The whole page: its height is asked once its script has made it as tall as it gets.
  const height = await landingSettled(page);
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
        for (let el: Element | null = img; el && el !== document.body; el = el.parentElement) {
          // …AND IT HAS LANDED. "The same place twice running" was not enough either: on Safari's engine a
          // screen in the last frames of arriving gave the same reading twice, 100ms apart, at 0.09 of a
          // degree from flat, and was reported turned (round 6 on the second batch, once in about twenty
          // runs). A part that has been told to arrive (`m-in`) is at rest when it is where arriving ends —
          // not turned at all. One that never gets there runs out the wait below and is reported, as before.
          busy = busy || arriving(el) || (el.classList.contains("m-in") && turned(getComputedStyle(el).transform));
        }
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
  // WITH ITS MOTION ON THE BANDS SWAY, and this file runs with motion on. The sample points sit a
  // sixteenth apart and so do the three boundaries, so four times in every sway all three boundaries
  // stand on sample points at once — and a point on the edge of two clipped pictures is on neither.
  // One reading, taken at a random instant, was therefore "nothing" about one run in nine (seen on
  // GitHub, 2026-10-13, on code identical to a run that passed; worked out by the session trimming
  // the fonts). A boundary is on a point for an instant; a band with no picture in it stays empty.
  // So it is asked until a reading has no gap, and a real gap still fails.
  let rest = await onTop();
  expect(rest.width, "the frame is too narrow to show four bands").toBeGreaterThan(200);
  await expect.poll(async () => (rest = await onTop()).tops, { message: "part of the frame shows no capture at all", timeout: 10_000 }).not.toContain("nothing");
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
 * THE PUTT UNDER "RECOGNITION." ENDS IN THE CUP (2026-10-21).
 *
 * Ajay: "the worm is not finishing". The line is drawn by a dash, and its stroke does not scale,
 * so the dash has to be as long as the line is ON SCREEN — which is as long as the word is wide.
 * It was a typed 220: 100% of the line on a phone, 62% at 1280 and 59% at 1440, the hole left
 * sitting on its own. And it was laid out before the club's typeface arrived and never again, so
 * on a slow phone it ran under a word in the fallback face. Measured here at three widths, one of
 * them with the fonts held back, after the draw has finished.
 */
test("the putt under the headline is drawn to the hole at every width, even when the typeface is late", async ({ page }) => {
  const measure = () =>
    page.evaluate(() => {
      const svg = document.querySelector("#putt")!;
      const path = svg.querySelector("path") as SVGPathElement;
      const ctm = path.getScreenCTM()!;
      const total = path.getTotalLength();
      let len = 0;
      let prev: DOMPoint | null = null;
      for (let k = 0; k <= 96; k++) {
        const p = path.getPointAtLength((total * k) / 96).matrixTransform(ctm);
        if (prev) len += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }
      const cs = getComputedStyle(path);
      const word = document.querySelector("#hero-word")!.getBoundingClientRect();
      const box = svg.getBoundingClientRect();
      return { len, dash: cs.strokeDasharray, offset: parseFloat(cs.strokeDashoffset) || 0, ends: [box.left - word.left, box.right - word.right] };
    });
  for (const [width, late] of [[393, true], [1024, false], [1440, false]] as const) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (late) await page.route(/\.woff2?(\?|$)/, async (r) => { await new Promise((x) => setTimeout(x, 2500)); await r.continue().catch(() => {}); });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?putt=${width}`);
    await landingSettled(page);
    await page.evaluate(() => document.fonts.ready);
    // The draw starts 1.5s in and takes 1.1s.
    await expect.poll(async () => (await measure()).offset, { message: `the putt never finished drawing at ${width}px`, timeout: 10_000 }).toBeLessThan(1);
    const m = await measure();
    const dash = parseFloat(m.dash);
    expect(Number.isFinite(dash) ? dash : Infinity, `at ${width}px the dash (${m.dash}) is shorter than the ${Math.round(m.len)}px line, so the line stops short of the hole`).toBeGreaterThanOrEqual(m.len - 1);
    for (const end of m.ends) expect(Math.abs(end), `at ${width}px${late ? " with the typeface late" : ""} the putt is not under the word (${m.ends.map(Math.round).join(", ")}px out)`).toBeLessThan(3);
  }
});

/**
 * ON A PHONE THE COLOURS BOARD IS SCROLLED PAST, NOT DRAGGED (2026-10-21).
 *
 * Ajay: "there is a reload around the colors". The slider covered the board, so under a finger it
 * took every touch: a swipe up the page that began on the board snapped the bands to where the
 * swipe began, a quarter of the board in one frame, and the sway took over again three seconds
 * later. Now only the visible knob drags, and by how far the finger moves. The bands sway on their
 * own, gently, so this reads the slider every frame and refuses a JUMP between two of them — the
 * old one was forty-odd steps; the sway moves about one.
 */
test.describe("the colours board under a finger", () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  test("a swipe or a tap on the board moves the page, not the bands; the knob drags them", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "NOT WALKED on this engine: touches are sent through Chromium's own protocol");
    await page.goto("/?board=touch");
    await landingSettled(page);
    const frame = page.locator("#themes");
    await page.evaluate(() => document.querySelector("#themes")!.scrollIntoView({ block: "center" }));
    await expect(frame).toBeInViewport();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    // Every frame's slider value, from now until `stopWatch`.
    const watch = () =>
      page.evaluate(() => {
        const w = window as unknown as { __vals: number[]; __on: boolean };
        w.__vals = [];
        w.__on = true;
        const range = document.querySelector<HTMLInputElement>("#themes-range")!;
        const tick = () => { w.__vals.push(Number(range.value)); if (w.__on) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
    const biggestJump = () =>
      page.evaluate(() => {
        const w = window as unknown as { __vals: number[]; __on: boolean };
        w.__on = false;
        let most = 0;
        for (let k = 1; k < w.__vals.length; k++) most = Math.max(most, Math.abs(w.__vals[k] - w.__vals[k - 1]));
        return { most, first: w.__vals[0], last: w.__vals[w.__vals.length - 1], frames: w.__vals.length };
      });

    const box = (await frame.boundingBox())!;
    const scrolled = await page.evaluate(() => scrollY);
    await watch();
    await touch("touchStart", box.x + 12, box.y + box.height * 0.7);
    for (let k = 1; k <= 10; k++) { await touch("touchMove", box.x + 12, box.y + box.height * (0.7 - 0.04 * k)); await page.waitForTimeout(16); }
    await touch("touchEnd");
    await page.waitForTimeout(150);
    const swipe = await biggestJump();
    expect(await page.evaluate(() => scrollY), "the swipe did not scroll the page").toBeGreaterThan(scrolled + 50);
    expect(swipe.most, `a swipe up the board jumped the bands ${swipe.most.toFixed(1)} steps in one frame`).toBeLessThan(3);

    await page.evaluate(() => document.querySelector("#themes")!.scrollIntoView({ block: "center" }));
    const at = (await frame.boundingBox())!;
    await watch();
    await touch("touchStart", at.x + 6, at.y + at.height / 2);
    await touch("touchEnd");
    await page.waitForTimeout(150);
    const tap = await biggestJump();
    expect(tap.most, `a tap on the board's edge jumped the bands ${tap.most.toFixed(1)} steps in one frame`).toBeLessThan(3);

    // The knob is the handle a finger takes, and the bands follow it.
    const knob = (await frame.locator(".m-knob").boundingBox())!;
    const kx = knob.x + knob.width / 2;
    const ky = knob.y + knob.height / 2;
    const from = await page.evaluate(() => Number(document.querySelector<HTMLInputElement>("#themes-range")!.value));
    await touch("touchStart", kx, ky);
    for (let k = 1; k <= 10; k++) { await touch("touchMove", kx - 3 * k, ky); await page.waitForTimeout(16); }
    await touch("touchEnd");
    const to = await page.evaluate(() => Number(document.querySelector<HTMLInputElement>("#themes-range")!.value));
    expect(to, "dragging the knob left did not move the bands").toBeLessThan(from - 10);
    // And once somebody has moved them, the bands stay where they were put.
    await page.waitForTimeout(4500);
    const still = await page.evaluate(() => Number(document.querySelector<HTMLInputElement>("#themes-range")!.value));
    expect(Math.abs(still - to), "the bands swayed off where the visitor left them").toBeLessThan(0.5);
  });
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
  /**
   * AND WHERE TO JUMP TO IS ASKED AT THE MOMENT OF THE JUMP. This read the page's height and the
   * form's place once, on arrival, and scrolled to them afterwards — and the page is two and a half
   * thousand pixels taller a second after it loads than when it loads (`landing-settled.ts`). It
   * scrolled to where the form had been, landed in the pricing section with the bar rightly up, and
   * reported the bar up "at the sign-up form". So each place is a question put to the page as it is.
   */
  type Place = "top" | "middle" | "form" | "end";
  const at = async (place: Place, what: string, want: { shown: boolean; reachable: boolean }) => {
    const jump = () =>
      page.evaluate((to) => {
        const whole = document.documentElement.scrollHeight;
        const form = document.querySelector("#start")!.getBoundingClientRect().top + window.scrollY;
        const top = to === "top" ? 0 : to === "middle" ? Math.round(whole * 0.45) : to === "form" ? Math.round(form) : whole;
        window.scrollTo({ top, behavior: "instant" });
      }, place);
    await jump();
    await expect
      .poll(async () => {
        await jump();
        return state();
      }, { message: what, timeout: 8_000 })
      .toEqual(want);
  };
  await landingSettled(page);

  await at("top", "at the top, beside the hero's own buttons", { shown: false, reachable: false });
  await at("middle", "mid-page", { shown: true, reachable: true });
  await at("form", "at the sign-up form", { shown: false, reachable: false });
  await at("end", "at the footer", { shown: false, reachable: false });
});

/**
 * WHOEVER IS ALREADY AT THE SIGN-UP FORM IS STILL AT IT WHEN THE PAGE'S SCRIPT STARTS.
 *
 * The page is drawn before its script arrives — half a second before, next
 * door to the server; several seconds, on a phone with one bar. "Run an event"
 * is a link to the form at the bottom, and it works at once. When the script
 * then starts, the story of a round becomes a track two and a half to three
 * and a half thousand pixels taller, ABOVE the form.
 *
 * A browser is supposed to keep a reader's place when a page grows above
 * them, and the form's place in the DOCUMENT moves a long way — 11,903 to
 * 14,441 on Safari's engine, measured 2026-10-13. Whether its place on the
 * SCREEN moves was assumed the same day, wrongly, to be "yes, on Safari": this
 * test was written to prove that fault and found none. On Chrome's engine and
 * on Safari's the form stays where it was to the pixel, at three sizes.
 *
 * It is kept because that is the browser's doing and not the page's: nothing in
 * the page holds the place, so a change that stops the browser doing it (an
 * `overflow-anchor`, a form moved inside the part that grows) would leave
 * somebody who tapped "Run an event" and began typing looking at the pricing.
 * WHAT IT CANNOT SEE: an older iPhone, whose Safari may not keep the place at
 * all. That is a check on a real phone, and is on the list owed.
 *
 * So the script is held back, the form is gone to, and when the script has run:
 *
 *   the script really was late      → the story was not yet a track (control)
 *   the page really did grow        → by more than a thousand pixels, on a phone
 *                                      (control: nothing moved is no test)
 *   the form                        → is where it was on the screen
 */
test("a visitor already at the sign-up form is still at it once the page's script has started", async ({ page }) => {
  test.setTimeout(60_000);
  const hold = 2_500;
  await page.route("**/_next/static/**/*.js", async (route) => {
    await new Promise((r) => setTimeout(r, hold));
    await route.continue().catch(() => {});
  });
  // The page as it is drawn, not as it is once its script has loaded.
  await page.goto(`/?bust=${Date.now()}`, { waitUntil: "commit" });
  await page.waitForSelector("#start", { state: "attached" });
  const read = () =>
    page.evaluate(() => ({
      live: !!document.querySelector("#story.m-live"),
      page: document.documentElement.scrollHeight,
      formOnScreen: Math.round(document.querySelector("#start")!.getBoundingClientRect().top),
    }));
  // What the "Run an event" link does: go to the form.
  await page.evaluate(() => document.querySelector("#start")!.scrollIntoView({ block: "start", behavior: "instant" }));
  const before = await read();
  expect(before.live, "CONTROL: the page's script had already started, so nothing was being held back").toBe(false);

  await page.waitForFunction(() => !!document.querySelector("#story.m-live"), null, { timeout: 30_000 });
  await landingSettled(page);
  const after = await read();
  const phone = (page.viewportSize()?.width ?? 0) < 900;
  if (phone) expect(after.page - before.page, "CONTROL: the page did not grow when its script started, so this measured nothing").toBeGreaterThan(1_000);
  expect(Math.abs(after.formOnScreen - before.formOnScreen), `the sign-up form moved ${after.formOnScreen - before.formOnScreen}px on the screen when the page's script started (the page grew ${after.page - before.page}px above it)`).toBeLessThanOrEqual(4);
});

/**
 * WITH ITS MOTION ON, EVERYTHING THAT WAITS TO ARRIVE DOES ARRIVE (2026-10-13).
 *
 * The front door holds a section back — dimmed to a sixth, shifted or tilted —
 * until it is scrolled to, then lets it settle. That is the page nearly every
 * visitor gets, and until tonight no test had ever looked at it: the suite asks
 * for reduced motion, where nothing is held back at all.
 *
 * What can go wrong with that is not subtle and is not caught by anything
 * else. A part is released when 18% of it is on screen. A part too tall for
 * 18% of it ever to fit a small phone's window is never released — and stays
 * at a sixth of its ink for good, on the phones with the least room. The
 * readability scan cannot see it (it photographs the page twice and needs it
 * still), and reduced motion never arms anything.
 *
 * So the page is walked the way a thumb walks it, and then every part that was
 * armed must have been let go and be at full ink. Run with `E2E_MOTION=full`
 * this is the test; without it nothing is armed, and it says so rather than
 * passing on nothing.
 */
test("with its motion on, every part of the front door that waits to arrive does arrive", async ({ page }) => {
  test.skip(process.env.E2E_MOTION !== "full", "nothing is held back when a visitor asks for less motion: run with E2E_MOTION=full");
  test.setTimeout(120_000);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".thq h1")).toHaveCount(1);
  // CONTROL: the motion really is on, and parts really are being held back.
  const armed = await page.locator(".m-armed").count();
  expect(armed, "nothing on the page is waiting to arrive — is the motion on?").toBeGreaterThan(5);

  // A thumb's walk: a third of a screen at a time, with a breath at each stop.
  const height = await landingSettled(page);
  const screen = await page.evaluate(() => window.innerHeight);
  for (let y = 0; y <= height; y += Math.round(screen / 3)) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(120);
  }

  const held = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll(".m-armed:not(.m-in)")).filter((el) => el.getClientRects().length > 0).map((el) => {
        const box = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} — ${Math.round(box.height)}px tall in a ${window.innerHeight}px window`;
      }),
    );
  await expect.poll(held, { message: "parts of the page were scrolled past and never let go", timeout: 10_000 }).toEqual([]);

  // Let go is not arrived: each must finish, and finish at full ink and square.
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity),
    null,
    { timeout: 10_000 },
  ).catch(() => {});
  const faint = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".m-armed"))
      .filter((el) => el.getClientRects().length > 0 && Number(getComputedStyle(el).opacity) < 0.99)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 2).join(".")} at ${getComputedStyle(el).opacity}`),
  );
  expect(faint, "parts of the page that arrived and are still faint").toEqual([]);
});
