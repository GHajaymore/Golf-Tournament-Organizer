"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * A row of tabs that turns one phone's screen and the words beside it — the day board's seven
 * moments, and the money screen's five countries. Native buttons in a tablist; arrows, Home and
 * End move along it. Rendered on the server with the first tab chosen, so with no script the page
 * still shows a whole moment.
 */
export function BoardTabs({
  label,
  idBase,
  tabs,
  panes,
  screens,
  tabClass,
  listClass,
  layout,
  intro,
}: {
  label: string;
  idBase: string;
  tabs: ReactNode[];
  panes: ReactNode[];
  screens: ReactNode[];
  tabClass: string;
  listClass: string;
  layout: "day" | "money";
  /** The money layout's heading and words, drawn above its row of countries. */
  intro?: ReactNode;
}) {
  const [on, setOn] = useState(0);
  // A screen is drawn once its tab has been chosen (the first is drawn at once): a hidden picture
  // would otherwise be fetched by every visitor who never asks for it.
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const choose = (n: number) => {
    setOn(n);
    setSeen((s) => (s.has(n) ? s : new Set([...s, n])));
  };
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    choose(n);
    refs.current[n]?.focus();
  };
  const keys = (e: KeyboardEvent) => {
    const map: Record<string, number> = { ArrowRight: on + 1, ArrowDown: on + 1, ArrowLeft: on - 1, ArrowUp: on - 1, Home: 0, End: tabs.length - 1 };
    if (e.key in map) { e.preventDefault(); go(map[e.key]); }
  };

  const list = (
    <div className={listClass} role="tablist" aria-label={label} onKeyDown={keys}>
      {tabs.map((t, i) => (
        <button
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="tab"
          id={`${idBase}-t${i}`}
          aria-controls={`${idBase}-p${i}`}
          aria-selected={i === on}
          tabIndex={i === on ? 0 : -1}
          className={tabClass}
          onClick={() => choose(i)}
        >
          {t}
        </button>
      ))}
    </div>
  );
  const phone = (
    <div className="n-phone">
      <div className="n-phone-screen">
        {screens.map((s, i) => (
          <div key={i} className={i === on ? "n-frame" : "n-frame n-off"} aria-hidden={i === on ? undefined : true}>{seen.has(i) ? s : null}</div>
        ))}
      </div>
    </div>
  );
  const words = panes.map((p, i) => (
    <div key={i} className="n-day-pane" role="tabpanel" id={`${idBase}-p${i}`} aria-labelledby={`${idBase}-t${i}`} hidden={i !== on}>{p}</div>
  ));

  if (layout === "day") {
    return (
      <div className="n-day">
        <div>
          {list}
          <div className="n-day-say">{words}</div>
        </div>
        <div className="n-day-phone">{phone}</div>
      </div>
    );
  }
  return (
    <div className="n-money">
      <div>
        {intro}
        {list}
        <div className="n-money-say">{words}</div>
      </div>
      <div className="n-money-pic">{phone}</div>
    </div>
  );
}
