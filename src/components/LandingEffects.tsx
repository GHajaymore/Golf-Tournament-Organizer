"use client";
import { useEffect } from "react";

/**
 * Progressive enhancement for the front door, kept out of the server component
 * so the page itself stays a plain server render.
 *
 * Everything here is decoration that must never gate content: the animation
 * CSS only bites once this adds `thq-js`, so with JavaScript off every section
 * is visible, every step of "The round" is readable and each carries its own
 * screen inline.
 */
export function LandingEffects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".thq");
    if (root) root.classList.add("thq-js");

    // The header draws its rule once the page has moved under it.
    const hdr = document.querySelector<HTMLElement>(".thq .hdr");
    const onScroll = () => hdr?.classList.toggle("scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observers: IntersectionObserver[] = [];

    // Sections rise into place once, as they arrive.
    const reveals = Array.from(document.querySelectorAll<HTMLElement>(".thq .reveal"));
    if (reduce || !("IntersectionObserver" in window)) {
      reveals.forEach((e) => e.classList.add("seen"));
    } else {
      const io = new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.add("seen");
              io.unobserve(en.target);
            }
          }),
        { threshold: 0.12 },
      );
      reveals.forEach((e) => io.observe(e));
      observers.push(io);
    }

    // "The round": the pinned phone shows the screen of the step at the middle
    // of the window, and the clock marks how far through the day it is.
    document.querySelectorAll<HTMLElement>(".thq .round").forEach((round) => {
      const steps = Array.from(round.querySelectorAll<HTMLElement>(".step"));
      const imgs = Array.from(round.querySelectorAll<HTMLElement>(".pin .scr img"));
      const ticks = Array.from(round.querySelectorAll<HTMLElement>(".clock i"));
      const cap = round.querySelector<HTMLElement>(".pin .cap");
      const show = (i: number) => {
        steps.forEach((s, j) => s.classList.toggle("on", j === i));
        imgs.forEach((im, j) => im.classList.toggle("on", j === i));
        ticks.forEach((t, j) => t.classList.toggle("on", j <= i));
        if (cap) cap.textContent = steps[i]?.dataset.cap ?? "";
      };
      show(0);
      if (!("IntersectionObserver" in window)) return;
      const io = new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (en.isIntersecting) show(steps.indexOf(en.target as HTMLElement));
          }),
        { rootMargin: "-45% 0px -45% 0px" },
      );
      steps.forEach((s) => io.observe(s));
      observers.push(io);
    });

    // The menus are native <details>. Choosing a link, or clicking anywhere
    // else, closes them — or they sit open over the section just asked for.
    const menus = Array.from(document.querySelectorAll<HTMLDetailsElement>(".thq .dd, .thq .nav-menu"));
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      menus.forEach((m) => {
        if (!m.open) return;
        if (!m.contains(t) || t.closest("a")) m.open = false;
      });
    };
    document.addEventListener("click", onClick);

    // The comparison slider's divider: the range input sits over the two
    // captures; dragging it moves where one gives way to the other. The input
    // is native, so it works by keyboard and screen reader too.
    const ranges = Array.from(document.querySelectorAll<HTMLInputElement>(".thq .cmp-range"));
    const onRange = (e: Event) => {
      const input = e.currentTarget as HTMLInputElement;
      input.parentElement?.style.setProperty("--pos", `${input.value}%`);
    };
    ranges.forEach((r) => r.addEventListener("input", onRange));

    return () => {
      window.removeEventListener("scroll", onScroll);
      observers.forEach((o) => o.disconnect());
      document.removeEventListener("click", onClick);
      ranges.forEach((r) => r.removeEventListener("input", onRange));
    };
  }, []);

  return null;
}
