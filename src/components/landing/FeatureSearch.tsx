"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Search over the feature list the server already rendered.
 *
 * Every feature is in the HTML for readers and crawlers alike; the chips above
 * the list filter it with CSS alone. This only adds typing: while there is a
 * query it marks the list as searching (which shows every group) and hides the
 * lines that do not match, and says so when nothing does.
 */
export function FeatureSearch({ total }: { total: number }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>(".fx");
    if (!root) return;
    const query = q.trim().toLowerCase();
    let shown = 0;
    root.querySelectorAll<HTMLElement>(".f").forEach((f) => {
      const hit = !query || (f.textContent ?? "").toLowerCase().includes(query);
      f.hidden = !hit;
      if (hit) shown++;
    });
    root.classList.toggle("searching", Boolean(query));
    root.classList.toggle("empty", Boolean(query) && shown === 0);
  }, [q]);

  return (
    <label className="fx-search" ref={ref}>
      <span className="sr">Search the features</span>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${total} features`} />
    </label>
  );
}
