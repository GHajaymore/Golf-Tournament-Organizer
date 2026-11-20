import { describe, it, expect, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

/**
 * MATCH PLAY IS TAPPED, NOT DICTATED (Ajay, 2026-11-09).
 *
 * Who won a hole is one tap (A / Halved / B) and a match's result is a winner and a margin. The
 * spoken readers behind the two match mics were wrong three ways in turn — any halved word beat a
 * named winner; then "Sam and Jo halved" became Sam's win; and when both names were said the
 * LONGER one took the match, so "Jo beat Sam 3 and 2" went to Sam — and a tap cannot be misheard.
 * So the microphone came off every match-play entry, and the readers were deleted, not patched.
 *
 * What stays dictated: a player's STROKES (`parseStrokesTranscript`, stroke.ts) on a stroke card
 * and on a match kept by gross cards, and the player's spoken question (`VoiceAsk`). A card of
 * eighteen numbers is many presses, and "four, par, bogey" has no names in it to confuse.
 *
 * Three holds, each with a control that proves it can see what it refuses:
 *   1. match.ts exports no spoken-word reader (stroke.ts still does — the control);
 *   2. no match-only entry component opens a mic, and the files that do are exactly the known
 *      stroke and question ones (swept from disk, so a new mic anywhere is named here);
 *   3. the organizer's match entry, rendered for hole results, the final result and a casual
 *      match's hole card, draws no microphone (the gross-card mode of the SAME screen does — the
 *      control).
 */

// Server actions are "use server" modules that pull in Prisma; the screen only holds references
// to them until a press. Same stand-in as render.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
function actionModule() {
  return new Proxy(
    {},
    { get: (_t, key) => (typeof key === "string" && key !== "then" ? async () => ({ ok: true }) : undefined) },
  ) as Record<string, unknown>;
}
vi.mock("@/app/actions/tournament", actionModule);
vi.mock("@/app/actions/courses", actionModule);

import { ScoreEntryClient, type EntryMatch } from "@/components/ScoreEntryClient";
import { HoleResultCard } from "@/components/HoleResultCard";

/** The components that keep a match as who-won-each-hole or as a result, and nothing else. */
const MATCH_ONLY_ENTRY = ["src/components/HoleResultCard.tsx", "src/components/MatchKeeper.tsx"];

/** Every file that may open a mic: strokes, or the player's question. */
const MAY_DICTATE = [
  "src/components/HoleByHoleCard.tsx",
  "src/components/PlayerCard.tsx",
  "src/components/ScoreEntryClient.tsx",
  "src/components/StrokePlayEntry.tsx",
  "src/components/VoiceAsk.tsx",
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== "__tests__") sourceFiles(rel, out);
    } else if (/\.tsx?$/.test(e.name) && statSync(join(process.cwd(), rel)).isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/** What a rendered screen shows when it offers a mic: the icon, or the mic's own note. */
const drawsAMic = (html: string) => /microphone|Listens only while pressed/i.test(html);

describe("match.ts reads no spoken words", () => {
  const exportsAReader = (src: string) => /export\s+(?:function|const)\s+\w*(?:Transcript|HALVED_WORDS)\b/.test(src);

  it("exports no transcript reader and no halved-word list", () => {
    expect(exportsAReader(readSource("src/lib/domain/match.ts"))).toBe(false);
  });

  it("the control: stroke.ts still exports its strokes reader, and the check sees it", () => {
    expect(exportsAReader(readSource("src/lib/domain/stroke.ts"))).toBe(true);
  });
});

describe("no match-only entry opens a mic", () => {
  it("the match card and its keeper import no dictation, no mic note and no mic icon", () => {
    for (const f of MATCH_ONLY_ENTRY) {
      const src = readSource(f);
      expect(src, `${f} imports the dictation module`).not.toMatch(/lib\/dictation/);
      expect(src, `${f} renders the mic note`).not.toMatch(/MicNote/);
      expect(src, `${f} draws a microphone`).not.toMatch(/microphone/i);
    }
  });

  it("the files that open a mic are exactly the strokes and question ones, swept from disk", () => {
    const opens = [...sourceFiles("src/components"), ...sourceFiles("src/app")]
      .filter((f) => readSource(f).includes("startDictation("))
      .sort();
    // The control is the equality itself: the sweep must FIND the five known mics, so a sweep
    // that read nothing fails here rather than passing on an empty list.
    expect(opens).toEqual([...MAY_DICTATE].sort());
  });
});

describe("the organizer's match entry draws no mic for a hole or a result", () => {
  const match: EntryMatch = {
    id: "zz-m1",
    aId: "zz-a",
    bId: "zz-b",
    aName: "zz-Alex Vaughn",
    bName: "zz-Sam Okafor",
    aHandicap: 8,
    bHandicap: 12,
    groupName: "Flight 1",
    round: 1,
    label: "Flight 1 · Round 1",
    holes: new Array(18).fill(null),
    status: "pending",
    aStrokes: new Array(18).fill(null),
    bStrokes: new Array(18).fill(null),
  };
  const pars = new Array(18).fill(4);
  const si = Array.from({ length: 18 }, (_, i) => i + 1);
  const entry = (scoreInput: string, casual = false) =>
    renderToStaticMarkup(
      <ScoreEntryClient
        matches={[match]}
        format="Match Play"
        isStaff
        pars={pars}
        strokeIndex={si}
        scoreInput={scoreInput}
        casual={casual}
      />,
    );

  it("who won each hole: the grid", () => {
    const html = entry("hole-results");
    expect(html, "the hole-results grid is on screen").toContain("Halved");
    expect(drawsAMic(html)).toBe(false);
  });

  it("the final result: winner and margin", () => {
    const html = entry("match-result");
    expect(html, "the result box is on screen").toContain("Apply result");
    expect(drawsAMic(html)).toBe(false);
  });

  it("a casual match's hole card", () => {
    const html = entry("hole-results", true);
    expect(html, "the hole card's three answers are on screen").toContain('aria-label="Who won hole 1"');
    expect(drawsAMic(html)).toBe(false);
  });

  it("the match card on its own", () => {
    const html = renderToStaticMarkup(
      <HoleResultCard
        holes={new Array(18).fill(null)}
        aName="zz-Alex Vaughn"
        bName="zz-Sam Okafor"
        aLabel="Alex"
        bLabel="Sam"
        pars={pars}
        yards={[]}
        strokeIndex={si}
        onPick={() => {}}
      />,
    );
    expect(html).toContain("Halved");
    expect(drawsAMic(html)).toBe(false);
  });

  it("the control: the same screen keeping gross cards still offers the strokes mic, and the check sees it", () => {
    expect(drawsAMic(entry("gross-cards"))).toBe(true);
  });
});
