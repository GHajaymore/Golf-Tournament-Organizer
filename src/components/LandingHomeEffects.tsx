"use client";
import { useEffect } from "react";

/**
 * THE FRONT DOOR'S MOTION (2026-10-11), for the page in `app/page.tsx` and the
 * styles in `lib/landing/home-styles.ts`.
 *
 * Everything on the page is there without this: the markup is whole, every
 * picture is in it, and nothing is hidden until this script has said it can
 * watch for it to come into view (`m-armed`, added here and only when the
 * browser has an IntersectionObserver and the visitor has not asked for less
 * motion). So a visitor with no script, or one whose script fails, reads a
 * still page — never a blank one.
 *
 * What it does, in the order a visitor meets it:
 *   - the round-code box demonstrates itself until somebody takes it;
 *   - the week is told by scrolling: on a laptop the phone stays beside the
 *     hours as they pass; on a narrow screen the phone is pinned and the track
 *     behind it decides the moment (`m-pin-story`);
 *   - sections arrive as they are reached, the dashboard's four points light
 *     in turn, the price bars count up, the theme slider sways until touched.
 *
 * A READABLE SCREEN IS NEVER MOVED BY THIS FILE. The only things it turns or
 * drifts are decorative layers (the wall of screens, the pointer's ball). See
 * the note on screens in `home-styles.ts`.
 *
 * Every listener is tied to one AbortController and every observer and timer
 * is collected, so leaving the page takes all of it down.
 */
export function LandingHomeEffects() {
  useEffect(() => {
    const home = document.querySelector<HTMLElement>("main.m-home");
    if (!home) return;
    const $ = <T extends HTMLElement = HTMLElement>(sel: string) => home.querySelector<T>(sel);
    const $$ = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(home.querySelectorAll<T>(sel));
    const media = (q: string) => typeof window.matchMedia === "function" && window.matchMedia(q).matches;

    const calm = media("(prefers-reduced-motion: reduce)");
    const canWatch = "IntersectionObserver" in window;
    const wide = () => media("(min-width: 900px)");
    const stop = new AbortController();
    const on = { signal: stop.signal };
    const passive = { signal: stop.signal, passive: true };
    const observers: Array<{ disconnect(): void }> = [];
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const intervals = new Set<ReturnType<typeof setInterval>>();
    let alive = true;
    const wait = (fn: () => void, ms: number) => {
      const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms);
      timers.add(id);
      return id;
    };
    const frameLoop = (fn: (now: number) => void) => requestAnimationFrame((now) => { if (alive) fn(now); });

    // ── the live strip runs as one loop: its own content twice, moved by half its width ──
    const track = $("#ticker-track");
    if (track && !track.dataset.doubled) {
      track.dataset.doubled = "1";
      Array.from(track.children).forEach((c) => {
        const copy = c.cloneNode(true) as HTMLElement;
        copy.setAttribute("aria-hidden", "true");
        track.appendChild(copy);
      });
    }

    // ── below the first screen, things arrive as they are reached ──
    const momentTime = $("#moment-time");
    // These are another company's US-dollar prices, written the way that company writes them: thousands by comma.
    const grouped = (n: number) => {
      const digits = String(n);
      let out = "";
      for (let i = 0; i < digits.length; i += 1) out += (i > 0 && (digits.length - i) % 3 === 0 ? "," : "") + digits[i];
      return out;
    };
    const countUp = (list: Element) => {
      Array.from(list.querySelectorAll<HTMLElement>(".m-amount")).forEach((el, i) => {
        const to = Number(el.dataset.to);
        if (!Number.isFinite(to)) return;
        // The server wrote the figure in full ("$4,775", or "US$4,775" abroad): keep whatever stands before the digits.
        const shown = el.textContent ?? "";
        const firstDigit = shown.search(/[0-9]/);
        const lead = firstDigit > 0 ? shown.slice(0, firstDigit) : "";
        const took = i === 2 ? 450 : 1000;
        wait(() => {
          let began: number | null = null;
          const tick = (now: number) => {
            if (began === null) began = now;
            const t = Math.min(1, (now - began) / took);
            el.textContent = lead + grouped(Math.round(to * (1 - Math.pow(1 - t, 3))));
            if (t < 1) frameLoop(tick); else el.textContent = shown;
          };
          frameLoop(tick);
        }, [300, 550, 1250][i] ?? 0);
      });
    };
    if (!calm && canWatch) {
      const arriving = new IntersectionObserver(
        (entries) =>
          entries.forEach((e) => {
            if (!e.isIntersecting) return;
            arriving.unobserve(e.target);
            e.target.classList.add("m-in");
            if (e.target.classList.contains("m-moment") && momentTime) wait(() => { momentTime.textContent = "11:42."; }, 420);
            if (e.target.classList.contains("m-bars")) countUp(e.target);
          }),
        { threshold: 0.18 },
      );
      observers.push(arriving);
      if (momentTime) momentTime.textContent = "11:41.";
      $$(".m-moment, .m-wide .m-screen, .m-card, .m-colours, .m-plan, .m-bars, .m-close, .m-chapter .m-head, .m-world").forEach((el) => {
        // Something already in sight is not dimmed to be brought back: somebody reading it when the
        // script starts saw it blink out and in again (the colours board, 2026-10-21).
        const r = el.getBoundingClientRect();
        if (r.bottom > 0 && r.top < window.innerHeight) {
          if (el.classList.contains("m-bars")) countUp(el);
          if (el.classList.contains("m-moment") && momentTime) momentTime.textContent = "11:42.";
          return;
        }
        el.classList.add("m-armed");
        arriving.observe(el);
      });
    }

    // ── the week, told by scrolling ──
    home.classList.add("m-pin-story");
    const story = $("#story");
    const beatEls = story ? Array.from(story.querySelectorAll<HTMLElement>(".m-beat")) : [];
    const stageImgs = story ? Array.from(story.querySelectorAll<HTMLElement>(".m-stage img")) : [];
    const stageEl = story?.querySelector<HTMLElement>(".m-stage") ?? null;
    const tabs = $$<HTMLButtonElement>(".m-times button");
    const turn = (list: HTMLElement[], i: number) =>
      list.forEach((im, n) => {
        im.classList.toggle("m-was", im.classList.contains("m-on") && n !== i);
        im.classList.toggle("m-on", n === i);
      });

    let lastBurst = 0;
    const burst = (from: Element) => {
      const now = performance.now();
      if (now - lastBurst < 5000) return;
      lastBurst = now;
      const box = from.getBoundingClientRect();
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.className = "m-burst";
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      home.appendChild(canvas);
      // The page's own colours, read off it rather than written again here.
      const style = getComputedStyle(home);
      const colours = ["--brass-ui", "--ink", "--brass-hi", "--flag", "--brass"].map((v) => style.getPropertyValue(v).trim() || "white");
      // A small generator seeded off the frame time: the scatter only has to look thrown, not be unguessable.
      let seed = Math.floor(now * 1000) % 2147483647 || 1;
      const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
      const bits = Array.from({ length: 90 }, (_, n) => {
        const angle = -Math.PI / 2 + (rand() - 0.5) * 2.4;
        const speed = 5 + rand() * 9;
        return {
          x: box.left + box.width / 2 + (rand() - 0.5) * box.width * 0.6,
          y: box.top + box.height * 0.3,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          w: 5 + rand() * 6, h: 3 + rand() * 5,
          turn: rand() * 6, spin: (rand() - 0.5) * 0.4,
          colour: colours[n % colours.length],
        };
      });
      const step = (at: number) => {
        const age = (at - now) / 2200;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const b of bits) {
          b.vy += 0.28; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.turn += b.spin;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - age);
          ctx.translate(b.x, b.y);
          ctx.rotate(b.turn);
          ctx.fillStyle = b.colour;
          ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
          ctx.restore();
        }
        if (age < 1 && alive) requestAnimationFrame(step); else canvas.remove();
      };
      requestAnimationFrame(step);
    };

    const beat = (i: number) => {
      if (!beatEls[i] || !stageImgs[i]) return;
      if (beatEls[i].classList.contains("m-on") && stageImgs[i].classList.contains("m-on")) return;
      beatEls.forEach((b, n) => b.classList.toggle("m-on", n === i));
      turn(stageImgs, i);
      if (stageEl) {
        stageEl.classList.remove("m-flare");
        void stageEl.offsetWidth;
        stageEl.classList.add("m-flare");
      }
      const phone = story?.querySelector(".m-stage .m-phone");
      if (i === beatEls.length - 1 && !calm && phone) burst(phone);
      if (wide()) tabs.forEach((tb, n) => tb.setAttribute("aria-selected", n === i ? "true" : "false"));
    };
    if (story && canWatch) {
      story.classList.add("m-live");
      const middle = new IntersectionObserver(
        (entries) => {
          if (!wide()) return;
          entries.forEach((e) => { if (e.isIntersecting) beat(beatEls.indexOf(e.target as HTMLElement)); });
        },
        { rootMargin: "-50% 0px -50% 0px", threshold: 0 },
      );
      observers.push(middle);
      beatEls.forEach((b) => middle.observe(b));
    }

    // ── scrolling moves the line at the top and the story ──
    // (The very large running tagline is gone: on a wide screen it ran off both edges, cut mid-word,
    // over a second running line, and said the headline again. Ajay, 2026-10-21: "fix this … the
    // banner". The week's steps are one still row at every width now.)
    const rail = $("#rail");
    const header = () => document.querySelector<HTMLElement>(".thq .hdr")?.offsetHeight ?? 58;
    let queued = false;
    const onScroll = () => {
      queued = false;
      const y = window.scrollY;
      const room = document.documentElement.scrollHeight - window.innerHeight;
      home.style.setProperty("--m-p", room > 0 ? (y / room).toFixed(4) : "0");
      if (story && rail && !wide()) {
        // Narrow: the story is a tall track with one pinned frame; where the track is decides the moment.
        const t = story.getBoundingClientRect();
        const span = t.height - window.innerHeight;
        if (span > 0 && t.top < window.innerHeight && t.bottom > 0) {
          const gone = Math.max(0, Math.min(0.9999, (header() - t.top) / span));
          beat(Math.floor(gone * beatEls.length));
          rail.style.setProperty("--m-roll", gone.toFixed(4));
          rail.classList.toggle("m-in", gone > 0.94);
        }
      }
      if (calm) return;
      home.style.setProperty("--m-sy", String(Math.min(y, 900)));
      if (rail && wide()) {
        // The ball: how far the middle of the screen has travelled down the story.
        const box = rail.getBoundingClientRect();
        if (box.height > 0) {
          const roll = Math.max(0, Math.min(1, (window.innerHeight * 0.5 - box.top) / box.height));
          rail.style.setProperty("--m-roll", roll.toFixed(4));
          rail.classList.toggle("m-in", roll > 0.985);
        }
      }
    };
    window.addEventListener("scroll", () => { if (!queued) { queued = true; frameLoop(onScroll); } }, passive);
    onScroll();

    // ── the four points on the organizer's screen light up in turn while it is on screen ──
    const spotsEl = $("#spots");
    const spots = $$("#spots .m-spot");
    if (!calm && canWatch && spotsEl && spots.length) {
      let at = 0;
      let held = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      spots.forEach((s) => {
        s.addEventListener("pointerenter", () => { held = true; }, on);
        s.addEventListener("pointerleave", () => { held = false; }, on);
      });
      const io = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && !timer) {
            timer = setInterval(() => {
              if (held) return;
              at = (at + 1) % spots.length;
              spots.forEach((s, n) => s.classList.toggle("m-on", n === at));
            }, 2600);
            intervals.add(timer);
          } else if (!entries[0].isIntersecting && timer) {
            clearInterval(timer);
            intervals.delete(timer);
            timer = null;
          }
        },
        { threshold: 0.4 },
      );
      observers.push(io);
      io.observe(spotsEl);
    }

    // ── a light follows the pointer across each card (the card itself stays square: its screen is read) ──
    if (!calm && media("(hover: hover)")) {
      $$(".m-card").forEach((card) => {
        card.addEventListener("pointermove", (e) => {
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          card.style.setProperty("--m-gx", `${(x * 100).toFixed(1)}%`);
          card.style.setProperty("--m-gy", `${(y * 100).toFixed(1)}%`);
        }, on);
      });
    }

    // ── the putt is laid under "Recognition." wherever the headline has put it ──
    const putt = $("#putt");
    const word = $("#hero-word");
    const heading = $("#hero-h");
    // The line is drawn by a dash as long as the line. Its stroke does not scale, so that length is
    // measured on SCREEN, where it is as long as the word is wide: a typed 220 drew 62% of it on a
    // laptop and left the hole on its own (2026-10-21).
    const puttPath = putt?.querySelector("path") ?? null;
    const layPutt = () => {
      if (!putt || !word || !heading) return;
      const w = word.getBoundingClientRect();
      const h = heading.getBoundingClientRect();
      putt.style.left = `${w.left - h.left}px`;
      putt.style.top = `${w.bottom - h.top - w.height * 0.06}px`;
      putt.style.width = `${w.width}px`;
      const ctm = puttPath instanceof SVGGeometryElement ? puttPath.getScreenCTM() : null;
      if (!(puttPath instanceof SVGGeometryElement) || !ctm) return;
      const total = puttPath.getTotalLength();
      let len = 0;
      let prev: DOMPoint | null = null;
      for (let k = 0; k <= 48; k++) {
        const p = puttPath.getPointAtLength((total * k) / 48).matrixTransform(ctm);
        if (prev) len += Math.hypot(p.x - prev.x, p.y - prev.y);
        prev = p;
      }
      if (len > 0) putt.style.setProperty("--m-putt-len", `${Math.ceil(len + 4)}`);
    };
    const fit = () => {
      home.style.setProperty("--m-hdr", `${header()}px`);
      layPutt();
    };
    // Laid once the headline has finished rising (measured where it rests, not mid-flight), again when
    // the club's typeface arrives — on a slow phone the word changes width after the first measure —
    // and whenever the word itself changes size.
    fit();
    wait(layPutt, 1380);
    window.addEventListener("resize", fit, on);
    document.fonts?.ready.then(() => { if (alive) layPutt(); });
    if (word && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => layPutt());
      ro.observe(word);
      observers.push(ro);
    }

    // A link to something inside a closed panel (the comparison, every feature) opens that panel.
    const openTarget = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      const panel = target instanceof HTMLDetailsElement ? target : target?.closest("details");
      if (panel && home.contains(panel)) panel.open = true;
    };
    openTarget();
    window.addEventListener("hashchange", openTarget, on);

    // ── decorative only: the wall turns toward the pointer ──
    // (The ball that followed the pointer is gone, at Ajay's word, 2026-10-21: "remove the special
    // cursor". The pointer is the visitor's own again.)
    if (!calm && media("(hover: hover) and (pointer: fine)")) {
      const momentEl = $(".m-moment");
      const wallEl = $(".m-wall");
      if (momentEl && wallEl) {
        momentEl.addEventListener("pointermove", (e) => {
          const r = momentEl.getBoundingClientRect();
          wallEl.style.setProperty("--m-wx", ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
          wallEl.style.setProperty("--m-wy", (0.5 - (e.clientY - r.top) / r.height).toFixed(3));
        }, on);
        momentEl.addEventListener("pointerleave", () => {
          wallEl.style.setProperty("--m-wx", "0");
          wallEl.style.setProperty("--m-wy", "0");
        }, on);
      }
    }

    // ── the first screen is lit from wherever the pointer is ──
    const heroEl = $(".m-hero");
    if (heroEl && !calm && media("(hover: hover)")) {
      heroEl.addEventListener("pointermove", (e) => {
        const r = heroEl.getBoundingClientRect();
        heroEl.style.setProperty("--m-mx", ((e.clientX - r.left) / r.width).toFixed(3));
        heroEl.style.setProperty("--m-my", ((e.clientY - r.top) / r.height).toFixed(3));
        heroEl.classList.add("m-lit");
      }, on);
      heroEl.addEventListener("pointerleave", () => {
        heroEl.style.setProperty("--m-mx", "0.5");
        heroEl.style.setProperty("--m-my", "0.5");
        heroEl.classList.remove("m-lit");
      }, on);
    }

    // ── THE LIVE MOMENT (2026-11-01, hero-stage.tsx): the demo code is typed, the member's card takes a score,
    // and the phone's board and the organizer's leaderboard both move — ONCE, and then it rests. The stage is
    // drawn settled (the board after the score); this sets it back to the card only to play the moment, and
    // never for a visitor who asks for less motion. Every picture is a real before or after capture. ──
    const BOARD = 0;
    const CARD = 1;
    const rig = $(".m-rig");
    const frames = $$("#loop img"); // [the board after, the card before]
    const desk = $$("#desk-loop img"); // [the leaderboard after, before]
    const count = $("#live-count");
    const codeBox = $<HTMLInputElement>("#hero-code");
    const codeSay = $("#hero-code-say");
    const strip = $(".m-ticker");
    let shownFrame = BOARD;
    const frame = (i: number) => {
      if (!frames[i] || shownFrame === i) return;
      shownFrame = i;
      turn(frames, i);
      turn(desk, i);
      rig?.classList.toggle("m-moved", i === BOARD);
      if (count) {
        count.textContent = (i === BOARD ? count.dataset.after : count.dataset.before) ?? count.textContent;
        count.classList.remove("m-bump");
        if (i === BOARD && !calm) { void count.offsetWidth; count.classList.add("m-bump"); }
      }
    };
    /** The press on the card, then the boards move, and the moved line is told for a few seconds. */
    const play = (after: () => void) => {
      frame(CARD);
      wait(() => {
        rig?.classList.add("m-tapping", "m-playing");
        wait(() => {
          rig?.classList.remove("m-tapping");
          frame(BOARD);
          rig?.classList.add("m-told");
          if (strip) { strip.classList.remove("m-flash"); void strip.offsetWidth; strip.classList.add("m-flash"); }
          wait(() => rig?.classList.remove("m-told"), 4200);
          after();
        }, 650);
      }, 900);
    };
    if (rig && !calm) {
      // The loops on the stage (the laptop's sheen, the live dot) rest while it is out of sight.
      if (canWatch) {
        const resting = new IntersectionObserver((entries) => entries.forEach((e) => rig.classList.toggle("m-asleep", !e.isIntersecting)), { rootMargin: "200px 0px" });
        observers.push(resting);
        resting.observe(rig);
      }
    }
    if (codeBox && codeSay) {
      const REST = codeBox.placeholder;
      const DEMO = "K7M4PQ2X";
      const DEMO_SHOWN = "K7M4-PQ2X";
      let demoOn = !calm;
      const later = (fn: () => void, ms: number) => wait(() => { if (demoOn) fn(); }, ms);
      // It runs only while the first screen is in sight: off screen it would be changing a picture nobody is looking at.
      let heroSeen = true;
      let running = false;
      const selfDemo = () => {
        let typed = 0;
        codeBox.classList.add("m-typing");
        const key = () => {
          codeBox.placeholder = DEMO_SHOWN.slice(0, typed) + (typed < DEMO_SHOWN.length ? "_" : "");
          typed += 1;
          if (typed <= DEMO_SHOWN.length) { later(key, 150); return; }
          codeSay.textContent = "On their card. No account, no password.";
          play(() => {
            codeSay.textContent = "A score goes in, and the board moves.";
            // Once. Then the stage rests on the moved board, and the box is the visitor's.
            later(() => {
              codeBox.classList.remove("m-typing");
              codeBox.placeholder = REST;
              codeSay.textContent = "";
              demoOn = false;
            }, 3600);
          });
        };
        key();
      };
      const stopDemo = () => {
        if (!demoOn) return;
        demoOn = false;
        codeBox.classList.remove("m-typing");
        codeBox.placeholder = REST;
        codeSay.textContent = "";
      };
      const begin = () => { if (demoOn && heroSeen && !running) { running = true; later(selfDemo, 1600); } };
      if (heroEl && canWatch) {
        const io = new IntersectionObserver((entries) => {
          heroSeen = entries[0].isIntersecting;
          if (heroSeen) begin();
        }, { threshold: 0.2 });
        observers.push(io);
        io.observe(heroEl);
      } else begin();
      codeBox.addEventListener("focus", () => { stopDemo(); frame(BOARD); }, on);
      codeBox.addEventListener("input", () => {
        const raw = codeBox.value.toUpperCase().split("").filter((c) => (c >= "A" && c <= "Z") || (c >= "0" && c <= "9")).join("").slice(0, 8);
        codeBox.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
        if (raw.length < 8) { codeSay.textContent = ""; frame(BOARD); return; }
        if (raw !== DEMO) {
          // This box is a demonstration. A real code is entered at the real door, which the line beneath it names.
          codeSay.textContent = `This box only shows how it works, with ${DEMO_SHOWN}. A real round code goes in at “Enter your round code”, just below.`;
          return;
        }
        codeSay.textContent = "You are on your card. No account, no password.";
        play(() => {
          codeSay.textContent = "A score goes in and the board moves. That is all a player does.";
        });
      }, on);
    }

    // ── four club themes on one board: the bands move together, and sway until touched ──
    const range = $<HTMLInputElement>("#themes-range");
    const compare = $("#themes");
    if (range && compare) {
      const bands = $$("#themes .m-band");
      const edges = $$("#themes .m-handle");
      const hues = $$("#hues i");
      // v runs 0 to 100. In the middle the bands are equal; either side, the edges slide together by up to
      // a fifth of the screen, so no band ever closes.
      const divide = (v: number) => {
        const shift = (v - 50) * 0.4;
        const n = bands.length;
        const cut = Array.from({ length: n + 1 }, (_, k) => (k === 0 ? 0 : k === n ? 100 : (100 / n) * k + shift));
        bands.forEach((img, k) => { img.style.clipPath = `inset(0 ${(100 - cut[k + 1]).toFixed(2)}% 0 ${cut[k].toFixed(2)}%)`; });
        edges.forEach((edge, k) => { edge.style.left = `${cut[k + 1].toFixed(2)}%`; });
        hues.forEach((hue, k) => { hue.style.left = `${cut[k].toFixed(2)}%`; hue.style.width = `${(cut[k + 1] - cut[k]).toFixed(2)}%`; });
      };
      let lastTouch = -1e9;
      let holding = false;
      // Once somebody has moved the bands, they stay where that person put them.
      let touched = false;
      const took = () => { touched = true; lastTouch = performance.now(); };
      range.addEventListener("input", () => { took(); divide(Number(range.value)); }, on);
      range.addEventListener("pointerdown", () => { holding = true; took(); }, on);
      window.addEventListener("pointerup", () => { if (holding) { holding = false; lastTouch = performance.now(); } }, on);
      range.addEventListener("keydown", took, on);

      // ON A PHONE THE BOARD IS SCROLLED PAST, NOT DRAGGED. The range covers the board for a mouse;
      // under a finger it took every touch, so a swipe up the page snapped the bands to wherever the
      // swipe began — about sixty pixels at once, which read as the board reloading (2026-10-21).
      // There the range takes no touches (the stylesheet says so) and only the visible knob drags,
      // by how far the finger has moved, so the bands follow it and never jump. The range stays
      // the keyboard's way in.
      const knob = compare.querySelector<HTMLElement>(".m-knob");
      if (knob) {
        let fromX = 0;
        let fromV = 50;
        let dragging: number | null = null;
        knob.addEventListener("pointerdown", (e) => {
          dragging = e.pointerId;
          fromX = e.clientX;
          fromV = Number(range.value);
          holding = true;
          took();
          knob.setPointerCapture?.(e.pointerId);
          e.preventDefault();
        }, on);
        knob.addEventListener("pointermove", (e) => {
          if (dragging !== e.pointerId) return;
          const width = compare.getBoundingClientRect().width || 1;
          // divide() moves the edges by 0.4% of the board per step, so a finger's pixels are steps / 0.4.
          const v = Math.max(0, Math.min(100, fromV + ((e.clientX - fromX) / width) * 100 / 0.4));
          range.value = String(v);
          lastTouch = performance.now();
          divide(v);
        }, on);
        const letGo = (e: PointerEvent) => {
          if (dragging !== e.pointerId) return;
          dragging = null;
          holding = false;
          lastTouch = performance.now();
        };
        knob.addEventListener("pointerup", letGo, on);
        knob.addEventListener("pointercancel", letGo, on);
      }

      // The four bands are one picture: fetch them together, well before the board is reached, so
      // they never arrive one band at a time (Safari's lazy margin is a few hundred pixels).
      if (canWatch) {
        const early = new IntersectionObserver((entries) => {
          if (!entries[0].isIntersecting) return;
          early.disconnect();
          bands.forEach((img) => { if (img instanceof HTMLImageElement) img.loading = "eager"; });
        }, { rootMargin: "1600px 0px" });
        observers.push(early);
        early.observe(compare);
      }

      divide(50);
      if (!calm && canWatch) {
        let onScreen = false;
        let swaying = false;
        let at = 50;
        const sway = (now: number) => {
          if (!onScreen || !alive || touched) { swaying = false; return; }
          if (!holding && now - lastTouch > 3200) {
            const want = 50 + Math.sin((now / 1000) * ((Math.PI * 2) / 5.5)) * 21;
            at += (want - at) * 0.05;
            range.value = String(at);
            divide(at);
          } else {
            at = Number(range.value);
          }
          requestAnimationFrame(sway);
        };
        const io = new IntersectionObserver(
          (entries) => {
            onScreen = entries[0].isIntersecting;
            if (onScreen && !swaying) { swaying = true; at = Number(range.value); requestAnimationFrame(sway); }
          },
          { threshold: 0.3 },
        );
        observers.push(io);
        io.observe(compare);
      }
    }

    // ── the hours as tabs (laptop), and the same moments as a row of cards where there is no script-driven pin ──
    const panels = $$("#steps .m-step");
    const stepsEl = $("#steps");
    const timesEl = $("#round .m-times");
    const show = (i: number) => {
      tabs.forEach((t, n) => t.setAttribute("aria-selected", n === i ? "true" : "false"));
      if (wide() || !stepsEl || !timesEl || !panels[i]) return;
      const how: ScrollBehavior = calm ? "auto" : "smooth";
      stepsEl.scrollTo({ left: panels[i].offsetLeft - (stepsEl.clientWidth - panels[i].offsetWidth) / 2, behavior: how });
      timesEl.scrollTo({ left: Math.max(0, tabs[i].offsetLeft - 16), behavior: how });
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => {
        if (wide()) { beatEls[i]?.scrollIntoView({ block: "center" }); return; }
        show(i);
      }, on);
      t.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = (i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
        if (wide()) beatEls[next]?.scrollIntoView({ block: "center" }); else show(next);
        tabs[next].focus();
      }, on);
    });

    // ── the two doors stay within reach on a phone once the hero's have scrolled away, and step aside at the end ──
    const dock = $("#dock");
    const heroDoorsEl = $(".m-hero .m-cta-row");
    const startEl = $("#start");
    // The footer is outside <main>, and it is the last thing on the page: the bar must not sit on its last line.
    const footerEl = document.querySelector<HTMLElement>(".thq .ftr");
    if (dock && heroDoorsEl && startEl && canWatch) {
      let heroDoors = false;
      let endDoors = false;
      let footer = false;
      const doors = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.target === startEl) endDoors = e.isIntersecting;
            else if (e.target === footerEl) footer = e.isIntersecting;
            else heroDoors = e.isIntersecting;
          });
          dock.classList.toggle("m-up", !heroDoors && !endDoors && !footer);
        },
        { threshold: 0.05 },
      );
      observers.push(doors);
      doors.observe(heroDoorsEl);
      doors.observe(startEl);
      if (footerEl) doors.observe(footerEl);
    }

    return () => {
      alive = false;
      stop.abort();
      observers.forEach((o) => o.disconnect());
      timers.forEach((t) => clearTimeout(t));
      intervals.forEach((t) => clearInterval(t));
      home.querySelectorAll(".m-burst").forEach((c) => c.remove());
      home.classList.remove("m-pin-story");
    };
  }, []);

  return null;
}
