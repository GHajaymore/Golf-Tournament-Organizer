"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type StoryStep = {
  chapter: number;
  /** Set on the first moment of a chapter: the chapter's name, drawn above it. */
  chapterTitle?: string;
  day: string;
  when: string;
  what: string;
  who: string;
  h: string;
  p: string;
  /** Which device the moment is on: the committee's laptop (the console) or the member's phone. */
  device: "laptop" | "phone";
};

/**
 * THE DAY AS A SCROLL STORY (design C of the site rehaul, 2026-11-02).
 *
 * The moments of one competition, in order, down the left; one phone held in view on the right
 * whose REAL screen is the moment's own capture. The phone follows the reader, never the other
 * way round: the page scrolls as any page does, and the moment crossing the middle of the window
 * chooses the screen (an IntersectionObserver, nothing bound to the scroll position). The rail
 * of chapters beside the phone is plain links to each chapter.
 *
 * Below 768px there is no sticky phone at all: CSS hides it and shows the screen drawn under each
 * moment (`inline`), so a phone reads a simple sequence and needs no script. Rendered on the
 * server with the first moment chosen, so with no script the desktop still shows a whole screen.
 * Under reduced motion the screen changes without a fade.
 *
 * Design D (2026-11-02): the day is the committee's AND the member's. The pinned stage holds the
 * committee's laptop and a member's phone; each moment says which device it is on, that device is
 * lit and brought forward, and the other rests with the last screen it showed. Below 768px a
 * console moment shows a cropped detail of its capture (a window, never the whole screen shrunk).
 */
export function DayStory({
  steps,
  chapters,
  screens,
  inline,
}: {
  steps: StoryStep[];
  chapters: Array<{ n: number; title: string }>;
  /** One capture per moment, for the phone that stays in view. */
  screens: ReactNode[];
  /** The same captures again, drawn under each moment on a narrow screen. */
  inline: ReactNode[];
}) {
  const [on, setOn] = useState(0);
  const refs = useRef<Array<HTMLLIElement | null>>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    // A thin band across the middle of the window: the moment inside it is the one being read.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = refs.current.indexOf(e.target as HTMLLIElement);
          if (e.isIntersecting && i >= 0) setOn(i);
        }
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const chapterOn = steps[on].chapter;
  const progress = steps.length > 1 ? on / (steps.length - 1) : 1;
  // Each device keeps the last screen it was given: the laptop the committee's, the phone the member's.
  const lastOn = (device: StoryStep["device"]) => {
    for (let i = on; i >= 0; i--) if (steps[i].device === device) return i;
    return steps.findIndex((s) => s.device === device);
  };
  const deskOn = lastOn("laptop");
  const phoneOn = lastOn("phone");
  const active = steps[on].device;

  return (
    <div className="n-story">
      <ol className="n-steps">
        {steps.map((s, i) => (
          <li key={`${s.day}-${s.when}`} className="n-step" ref={(el) => { refs.current[i] = el; }}>
            {s.chapterTitle ? (
              <p className="n-ch" id={`chapter-${s.chapter}`}>
                <span className="n-ch-n n-num" aria-hidden="true">{String(s.chapter).padStart(2, "0")}</span>
                {s.chapterTitle}
              </p>
            ) : null}
            <p className="n-stamp"><span>{s.day}</span><b className="n-num">{s.when}</b><span>{s.what}</span></p>
            <span className="n-who">{s.who}</span>
            <h3>{s.h}</h3>
            <p className="n-say">{s.p}</p>
            {s.device === "laptop" ? (
              <div className="n-step-desk"><div className="n-win n-win-detail">{inline[i]}</div></div>
            ) : (
              <div className="n-step-phone">
                <div className="n-phone"><div className="n-phone-screen">{inline[i]}</div></div>
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="n-story-dev">
        <div className="n-story-pin">
          <nav aria-label="The day, by chapter">
            <ol className="n-rail" style={{ "--p": progress } as CSSProperties}>
              {chapters.map((c) => (
                <li key={c.n} className={c.n === chapterOn ? "n-on" : c.n < chapterOn ? "n-done" : undefined}>
                  <a href={`#chapter-${c.n}`} aria-current={c.n === chapterOn ? "step" : undefined}>
                    <span className="n-num">{String(c.n).padStart(2, "0")}</span>
                    <span>{c.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
          <div className="n-story-lit" data-active={active}>
            <div className="n-story-desk">
              <div className="n-lid">
                {/* a framed crop of the console, past its menu, so its rows read at this size */}
                <div className="n-lid-screen n-zoom n-zoom-story">
                  {screens.map((s, i) => steps[i].device === "laptop" ? (
                    <div key={i} className={i === deskOn ? "n-frame" : "n-frame n-off"} aria-hidden={i === on ? undefined : true}>{s}</div>
                  ) : null)}
                </div>
              </div>
              <div className="n-base" aria-hidden="true" />
            </div>
            <div className="n-phone">
              <div className="n-phone-screen">
                {screens.map((s, i) => steps[i].device === "phone" ? (
                  <div key={i} className={i === phoneOn ? "n-frame" : "n-frame n-off"} aria-hidden={i === on ? undefined : true}>{s}</div>
                ) : null)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
