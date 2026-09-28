"use client";
import { useEffect, useState } from "react";

type Screens = "dark" | "light";

const KEY = "thq-screens";
/** Tells every other switch on the page, so the hero's and the players' agree. */
const EVENT = "thq-screens";

function stored(): Screens {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function apply(value: Screens) {
  document.querySelector<HTMLElement>(".thq")?.setAttribute("data-screens", value);
}

/**
 * Dark or light screenshots, page-wide.
 *
 * Every capture on the page exists in both of the app's appearances, and dark
 * is the default (Ajay, 2026-09-27: "make the darker image screen as default").
 * This flips `data-screens` on the page; the stylesheet shows the matching
 * twin of every image, and the other is display:none and lazy, so it is not
 * downloaded until someone asks for it. Remembered on this device only.
 *
 * Hidden until JavaScript runs (`.thq:not(.thq-js)`), because without it the
 * buttons could do nothing — the dark screens show either way.
 */
export function ScreensToggle() {
  const [screens, setScreens] = useState<Screens>("dark");

  useEffect(() => {
    const initial = stored();
    setScreens(initial);
    apply(initial);
    const onChange = (e: Event) => setScreens((e as CustomEvent<Screens>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const choose = (value: Screens) => {
    apply(value);
    try {
      localStorage.setItem(KEY, value);
    } catch {
      // Private mode or storage off: the choice holds for this page view only.
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
  };

  return (
    <div className="screens-toggle" role="group" aria-label="Show the screenshots in">
      <button type="button" aria-pressed={screens === "dark"} onClick={() => choose("dark")}>
        <svg className="i" aria-hidden="true"><use href="#i-moon" /></svg>
        Dark
      </button>
      <button type="button" aria-pressed={screens === "light"} onClick={() => choose("light")}>
        <svg className="i" aria-hidden="true"><use href="#i-sun" /></svg>
        Light
      </button>
    </div>
  );
}
