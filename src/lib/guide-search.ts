import type { GuideBlock, GuideSection } from "./guide-steps";

/**
 * SEARCH OVER THE ORGANIZER'S GUIDE (Ajay, 2026-10-10).
 *
 * The guide is ten parts and several thousand words, read in the order an
 * organizer does things — which is the wrong order for somebody who has one
 * question on the morning of the event. Ajay chose this, and a written Help
 * page for players, over an AI help bot: it runs in the browser on text the
 * guide already holds, costs nothing, and cannot answer with something the
 * guide does not say.
 *
 * One entry per thing a reader could be looking for — a step, a tip, a table
 * row, a recipe, an FAQ answer — under the nearest heading above it, with the
 * anchor to jump to. Plain substring matching on every word of the query:
 * a secretary types "cut" or "waiting list", not a sentence.
 */

export interface GuideEntry {
  /** Where the result jumps: the heading's anchor, or the section's. */
  anchor: string;
  /** "Part 4 · Draw the field" */
  section: string;
  /** The heading it sits under, or "" at the top of a part. */
  heading: string;
  /** The text itself, with the guide's [[button]] and **bold** marks removed. */
  text: string;
}

/** The guide's marks, as plain words. */
export function plainGuideText(s: string): string {
  return s.replace(/\[\[(.+?)\]\]/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1");
}

/** The anchor a heading block is given on the page — one rule, read by both. */
export function headingAnchor(sectionId: string, blockIndex: number): string {
  return `${sectionId}-${blockIndex}`;
}

function textsOf(b: GuideBlock): string[] {
  switch (b.kind) {
    case "p":
    case "tip":
    case "warn":
    case "where":
      return [b.text];
    case "h":
      return [];
    case "steps":
    case "list":
      return b.items;
    case "table":
      return b.rows.map((r) => r.join(" — "));
    case "recipes":
      return b.items.map((r) => `${r.title}: ${r.for} ${r.steps.join(" ")}`);
    case "faq":
      return b.items.map((f) => `${f.q} ${f.a}`);
  }
}

export function guideIndex(sections: readonly GuideSection[]): GuideEntry[] {
  const out: GuideEntry[] = [];
  for (const s of sections) {
    const section = `${s.part} · ${s.title}`;
    let heading = "";
    let anchor = s.id;
    s.blocks.forEach((b, i) => {
      if (b.kind === "h") {
        heading = b.text;
        anchor = headingAnchor(s.id, i);
        // The heading itself is findable: "Flights", "Prizes".
        out.push({ anchor, section, heading, text: b.text });
        return;
      }
      for (const t of textsOf(b)) out.push({ anchor, section, heading, text: plainGuideText(t) });
    });
  }
  return out;
}

/**
 * THE SAME THING BY ANOTHER NAME. A literal search fails on the first word the
 * guide happens to spell differently: the guide writes "Waitlist" and the
 * app's own screens say "waiting list", so the obvious query found nothing —
 * caught by this file's test the day it was written. Each pair is tried both
 * ways. Kept short and literal on purpose: every entry is a phrase a secretary
 * really types for a word the guide really uses.
 */
const SAME: readonly (readonly [string, string])[] = [
  ["waiting list", "waitlist"],
  ["tee times", "tee sheet"],
  ["tee time", "tee sheet"],
  ["sign off", "approve"],
  ["scorecard", "card"],
  ["payout", "prizes"],
  ["play-off", "tie"],
  ["playoff", "tie"],
];

/** The query, and the query with each known phrase swapped for its twin. */
function variants(query: string): string[][] {
  const q = query.toLowerCase().replace(/\s+/g, " ").trim();
  const all = new Set([q]);
  for (const [a, b] of SAME) {
    if (q.includes(a)) all.add(q.replace(a, b));
    else if (q.includes(b)) all.add(q.replace(b, a));
  }
  return [...all].map((v) => v.split(" ").filter(Boolean));
}

/**
 * Entries holding every word of the query, headings first, at most `limit`.
 * Nothing for a query under two characters — one letter matches everything.
 */
export function searchGuide(index: readonly GuideEntry[], query: string, limit = 12): GuideEntry[] {
  const ways = variants(query);
  const wanted = ways[0];
  if (wanted.join("").length < 2) return [];
  const hits = index.filter((e) => {
    const hay = `${e.heading} ${e.text}`.toLowerCase();
    return ways.some((words) => words.every((w) => hay.includes(w)));
  });
  const inHeading = (e: GuideEntry) =>
    ways.some((words) => words.every((w) => e.heading.toLowerCase().includes(w)));
  const ranked = [...hits.filter(inHeading), ...hits.filter((e) => !inHeading(e))];
  // One result per place: three steps under one heading are one destination.
  const seen = new Set<string>();
  const out: GuideEntry[] = [];
  for (const e of ranked) {
    if (seen.has(e.anchor)) continue;
    seen.add(e.anchor);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
