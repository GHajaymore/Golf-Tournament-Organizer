"use client";
import { useEffect } from "react";

/**
 * Progressive enhancement for the landing page, kept out of the server
 * component so the page itself stays a plain async server render.
 *
 * Everything here is decoration that must never gate content: the scoped
 * animation CSS only bites once this adds `thq-js`, so with JavaScript off the
 * page renders fully visible rather than a stack of empty, opacity-0 sections.
 */
export function LandingEffects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".thq");
    if (root) root.classList.add("thq-js");

    // The hero's staggered rise plays once, on the first frame.
    const hero = document.getElementById("thq-hero");
    if (hero) requestAnimationFrame(() => hero.classList.add("in"));

    const nav = document.querySelector<HTMLElement>(".thq .nav");
    const onScroll = () => {
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 24);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const els = Array.from(document.querySelectorAll<HTMLElement>(".thq .reveal"));
    let io: IntersectionObserver | null = null;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach((e) => e.classList.add("seen"));
    } else {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.add("seen");
              io?.unobserve(en.target);
            }
          });
        },
        { threshold: 0.12 },
      );
      els.forEach((e) => io!.observe(e));
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      io?.disconnect();
    };
  }, []);

  return null;
}
