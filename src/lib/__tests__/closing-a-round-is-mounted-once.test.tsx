import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";
import type { ScreenKey } from "@/lib/domain/console-merges";

vi.mock("@/app/actions/tournament", () => ({
  setEventStatus: async () => ({ ok: true }),
  launchTournament: async () => ({ ok: true }),
}));
vi.mock("@/app/actions/auth", () => ({ enterTournament: vi.fn(async () => {}) }));

const { LifecycleBar } = await import("@/components/LifecycleBar");
const { WhatsNext } = await import("@/components/NeedsYouNow");
const { statusCardOf, tournamentStatus } = await import("@/lib/domain/tournament-status");
const { tournamentJob, whatsNext } = await import("@/lib/domain/needs-you-now");
const { shortDate } = await import("@/lib/domain/round-dates");
const { facts, round, launched } = await import("@/lib/domain/__tests__/tournament-facts-fixtures");
import type { TournamentJobFacts } from "@/lib/domain/needs-you-now";

/**
 * THE DOOR TO "CLOSE ROUND n" IS MOUNTED ONCE PER SHOWN STATE (B106, from the PE re-check of R12). A round is closed in one room at
 * a time (`closing-a-round-has-one-home.test.tsx`), and the two doors that lead there (the dashboard card's "Close Round 1" and
 * What's next's) must lead to that SAME room: Rounds & formats while Score entry is not shown, Score entry while it is, each one's
 * preview kept. Neither door holds its own condition; both ask `relocate` (console-merges.ts), and a render cannot see a page, so
 * the second half holds the dashboard page to passing what the request shows.
 */

const TODAY = "2026-11-28";
const summary = { name: "zz-b106 Medal", dates: "Nov 28", course: "zz Links", format: "Stroke Play", overall: "Stroke play", players: 24, flights: 0, rounds: 1 };
const f = launched(facts({ startOn: TODAY, endOn: TODAY, confirmed: 24, groups: 0, rounds: [round({ id: "r1", position: 0, hasResult: true })] }));
const status = tournamentStatus(f);
const t: TournamentJobFacts = {
  eventId: "e1", name: "zz-b106 Medal", awaitingApproval: 0, entriesClose: "", nextSheet: null,
  board: { roundId: "r1", round: "Round 1", day: TODAY, closed: false, unit: "cards", started: 24, certified: 24, total: 24 },
  startOn: f.startOn, endOn: f.endOn, status,
};
const day = (iso: string) => shortDate(iso, "en-GB");
const job = tournamentJob(t, TODAY, day)!;
const club = whatsNext({ tournaments: [t], today: TODAY, locale: "en-GB" });

const decode = (s: string) => s.replace(/&amp;/g, "&");
const hrefOf = (html: string, name: RegExp) => decode([...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => name.test(m[2]))?.[1] ?? "");
const pathOf = (href: string) => href.split("?")[0];

const card = (shown?: ReadonlySet<ScreenKey>, previewMode?: "build" | "preview" | null) =>
  hrefOf(renderToStaticMarkup(<LifecycleBar status={statusCardOf(f, status)} job={job} isAdmin summary={summary} shown={shown} previewMode={previewMode} />), /Close Round 1/);
const next = (shown?: ReadonlySet<ScreenKey>, previewMode?: "build" | "preview" | null) =>
  hrefOf(renderToStaticMarkup(<WhatsNext jobs={club} mayAct openEventId="e1" shown={shown} previewMode={previewMode} />), /Close Round 1/);

const STATES: { name: string; shown: ReadonlySet<ScreenKey>; mode: "build" | "preview" | null; room: string }[] = [
  { name: "nothing shown (the switch off)", shown: new Set(), mode: null, room: "/stages" },
  { name: "Score entry not shown, other screens are", shown: new Set<ScreenKey>(["teeTimes", "rounds"]), mode: "preview", room: "/stages" },
  { name: "Score entry shown in a preview", shown: new Set<ScreenKey>(["scoreEntry"]), mode: "preview", room: "/entry" },
  { name: "Score entry shown in the building preview", shown: new Set<ScreenKey>(["scoreEntry"]), mode: "build", room: "/entry" },
  { name: "Score entry on for everyone", shown: new Set<ScreenKey>(["scoreEntry", "teeTimes"]), mode: null, room: "/entry" },
];

describe("the card's and What's next's Close Round 1 lead to one room, the one that holds closing", () => {
  it("CONTROL: both doors are found, with the old address, with the screen off", () => {
    expect(card()).toBe("/stages?round=r1");
    expect(next()).toBe("/stages?round=r1");
  });

  for (const s of STATES) {
    it(`${s.name}: both doors lead to ${s.room}, the same round, the preview kept`, () => {
      const a = card(s.shown, s.mode);
      const b = next(s.shown, s.mode);
      expect(pathOf(a), "the card").toBe(s.room);
      expect(pathOf(b), "what's next").toBe(s.room);
      expect(a, "the two doors disagree").toBe(b);
      expect(new URL(a, "http://x").searchParams.get("round")).toBe("r1");
      const q = new URL(a, "http://x").searchParams;
      // A moved door keeps the preview it was pressed in; an unmoved one is today's address untouched.
      if (s.room === "/entry" && s.mode) expect(q.get("stepper")).toBe("1");
      if (s.room === "/entry" && s.mode === "build") expect(q.get("build")).toBe("1");
      if (s.room === "/entry" && !s.mode) expect(q.get("stepper")).toBeNull();
    });
  }

  it("exactly one screen holds the close press for every state: the doors name /entry iff Score entry is shown, never both, never neither", () => {
    for (const s of STATES) {
      const rooms = new Set([pathOf(card(s.shown, s.mode)), pathOf(next(s.shown, s.mode))]);
      expect([...rooms], s.name).toEqual([s.shown.has("scoreEntry") ? "/entry" : "/stages"]);
    }
  });
});

describe("the dashboard hands both doors what the request shows", () => {
  const page = readSource("src", "app", "(app)", "dashboard", "page.tsx");
  const bar = readSource("src", "components", "LifecycleBar.tsx");
  it("passes shown and previewMode to the card and to What's next", () => {
    expect(page).toMatch(/const shown = await screensShownFor\(session\)/);
    expect(page).toMatch(/const previewMode = await previewModeNow\(\)/);
    expect(page).toMatch(/<WhatsNext [^>]*shown=\{shown\} previewMode=\{previewMode\}/);
    expect(page).toMatch(/job=\{job\}\s+shown=\{shown\}\s+previewMode=\{previewMode\}/);
  });
  it("the card asks relocate, and holds no screen condition of its own", () => {
    expect(bar).toMatch(/relocate\(\{ href, job: job\.key/);
    expect(bar).not.toMatch(/shown\??\.has\(/);
  });
});
