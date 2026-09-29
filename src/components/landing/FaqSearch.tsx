"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Search, and opening a topic when it is jumped to — the two things `/faq`
 * needs a script for.
 *
 * The questions themselves are server-rendered <details>, grouped in
 * collapsed <details> by topic (Ajay: "get these collapsed"), so the page reads
 * and works without JavaScript. This only filters what is already there: a
 * search hides the questions that do not match, opens every topic that still
 * has one, and says how many are left.
 */
export function FaqSearch({ total }: { total: number }) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(total);
  const opened = useRef(new Set<HTMLDetailsElement>());

  useEffect(() => {
    const groups = Array.from(document.querySelectorAll<HTMLDetailsElement>(".thq details.fq-group"));
    const t = query.trim().toLowerCase();
    let count = 0;
    for (const group of groups) {
      let hits = 0;
      for (const q of Array.from(group.querySelectorAll<HTMLDetailsElement>("details.q"))) {
        const hit = !t || (q.textContent ?? "").toLowerCase().includes(t);
        q.hidden = !hit;
        if (hit) hits++;
      }
      count += hits;
      group.hidden = hits === 0;
      if (t) {
        // Open what matches, and remember we did, so clearing the search can
        // close exactly those again and leave the reader's own choices alone.
        if (hits && !group.open) {
          group.open = true;
          opened.current.add(group);
        }
      } else if (opened.current.has(group)) {
        group.open = false;
        opened.current.delete(group);
      }
    }
    setShown(count);
  }, [query]);

  // A topic link, or a link from elsewhere to /faq#money, opens that topic.
  useEffect(() => {
    const open = () => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (!target) return;
      // A question lives inside its topic: open both, or a link to one
      // question (the landing's store buttons) lands on a closed topic.
      for (let el: Element | null = target; el; el = el.parentElement?.closest("details") ?? null) {
        if (el instanceof HTMLDetailsElement) el.open = true;
      }
      target.scrollIntoView({ block: "start" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);

  return (
    <>
      <label className="search">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <span className="sr">Search the questions</span>
        <input
          type="search"
          placeholder="Search — handicaps, league, money, voice…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>
      <span className="fq-count" aria-live="polite">
        {query.trim() ? `${shown} of ${total} questions` : `${total} questions`}
      </span>
      {query.trim() && shown === 0 ? (
        <p className="fq-empty" role="status">Nothing matches that. Try another word, or ask us instead.</p>
      ) : null}
    </>
  );
}
