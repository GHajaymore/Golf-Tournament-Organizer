import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { importedNames } from "./imported-names";

/**
 * THE COURSE DAY TIMELINE READS THE MACHINE, AND NOTHING ELSE (state machine PR 5c, J16).
 *
 * Owner ruling, 3 Nov: "no switch goes on until it reads the machine." Rounds & formats' redesign
 * (`?view=timeline`) says where a tournament is three ways — its chip, the "Needs you" strip led by
 * the one next thing, each round's chip — and until PR 5c it worked each out for itself: #972's
 * stepper read `PRE_LAUNCH_STATUSES` against the stored status, `roundNeeds` had its own rules for a
 * course, a date and tee times (D7), and a round's chip read its date against today and the launch
 * (D8). Now `courseDayOf(tournamentStatus(facts))` is the only answer the timeline draws.
 *
 * This is a WALL, not a ratchet: on the timeline's files a second reading of the step is refused
 * outright. BAN THE SHAPE, not one spelling of it (CLAUDE.md, "One rule, one place"):
 *
 *   - an old reader of the lifecycle, the pre-launch list, or the launch facts imported;
 *   - the stored status read off a tournament at all, or compared by hand with any of its words;
 *   - a date compared with today — the "under way because its day has come" reading (D8);
 *   - `roundNeeds`, the deleted twin of the machine's `rounds[i].needs`, anywhere in `src`.
 *
 * Each shape has a CONTROL below: a line from the timeline as it was, planted, and seen.
 */

/** Files that are the timeline and nothing else: swept whole. */
export const TIMELINE_FILES: readonly string[] = [
  "src/lib/domain/timeline-step.ts",
  "src/lib/rounds-timeline.ts",
  "src/components/RoundsTimeline.tsx",
];

/** The lifecycle stepper (B03) and its stylesheet's component: held to the same wall. */
export const STEPPER_FILES: readonly string[] = ["src/lib/domain/lifecycle-track.ts", "src/components/LifecycleStepper.tsx"];

/** What the timeline may never ask for itself: the lifecycle, the pre-launch list, the launch facts. */
const NOT_THE_MACHINE = [
  // the stored status and its lists
  "PRE_LAUNCH_STATUSES",
  "EVENT_STATUSES",
  "LEGACY_OPEN_STATUSES",
  "STATUS_META",
  "isLaunched",
  "isFinished",
  "isSetupLocked",
  // the old readers of where a tournament is
  "nextLifecycleAction",
  "tournamentPhase",
  "lifecycleMismatch",
  "datesPassedUnlaunched",
  "playOverOf",
  "setupChecklist",
  "isUnstarted",
  // the launch facts and the setup flow beneath the machine
  "launchCheck",
  "launchCheckFor",
  "launchFactsFrom",
  "launchRefusal",
  "setupFlow",
  "setupFlowFor",
  "setupFactsOf",
  "roundIsScheduled",
  "roundsMissingCards",
  "missingCardsRefusal",
  "roundCloseCheck",
  // the twin this PR deleted
  "roundNeeds",
] as const;

/** A tournament's stored status, read at all. Never another thing's (`p.status`, `card.status`). */
const STORED_STATUS = /\b(?:state\.)?(?:event|ev|tournament)\??\.status\b|\beventStatus\b/;
/** A stored status word compared by hand, on any receiver and either way round. */
const STORED_WORD = `["'](?:draft|registration|ready|live|completed)["']`;
const STATUS_COMPARED = new RegExp(
  String.raw`\bstatus\s*[!=]==?\s*${STORED_WORD}|${STORED_WORD}\s*[!=]==?\s*[\w$.?()[\]\s]*\bstatus\b|${STORED_WORD}[^\]]*\]\s*\.includes\(`,
);
/** A day compared with today, either way round (`playedOn <= today`, `today >= r.deadline`). */
const AGAINST_TODAY = /\btoday\b\s*[<>]=?|[<>]=?\s*\btoday\b/;
/** The D8 reader by its names. */
const UNDER_WAY_BY_DATE = /\b(?:dayHasCome|underWay)\b/;

/** What a timeline file does that only the machine may. */
export function timelineStrays(src: string): string[] {
  const found: string[] = importedNames(src).filter((n) => (NOT_THE_MACHINE as readonly string[]).includes(n));
  if (STORED_STATUS.test(src)) found.push("(the stored status read)");
  if (STATUS_COMPARED.test(src)) found.push("(a stored status compared by hand)");
  if (AGAINST_TODAY.test(src)) found.push("(a date compared with today)");
  if (UNDER_WAY_BY_DATE.test(src)) found.push("(under way by its date)");
  return [...new Set(found)];
}

/** The page's timeline reader — `courseDayFor`, the golf facts it hands the timeline — cut out of the page. */
function courseDayForSource(): string {
  const page = readSource("src/app/(app)/stages/page.tsx");
  const start = page.indexOf("async function courseDayFor(");
  const end = page.indexOf("function formatsThatSuit(", start);
  return start >= 0 && end > start ? page.slice(start, end) : "";
}

function allSource(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(p);
      } else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p.replace(/\\/g, "/"));
    }
  };
  walk("src");
  return out;
}

describe("the Course day timeline reads the machine (PR 5c, J16)", () => {
  it("CONTROL: the matcher sees each shape as the timeline used to spell it", () => {
    // #972's stepper, stages/page.tsx at e933a3b5 line 464:
    expect(timelineStrays(`launched={!PRE_LAUNCH_STATUSES.includes(state.event.status)}`)).toEqual(["(the stored status read)"]);
    expect(timelineStrays(`import { PRE_LAUNCH_STATUSES } from "@/lib/domain/lifecycle-state";`)).toEqual(["PRE_LAUNCH_STATUSES"]);
    // The deleted twin, imported or defined:
    expect(timelineStrays(`import { parsPlayed, roundNeeds, sheetFacts } from "@/lib/rounds-timeline";`)).toEqual(["roundNeeds"]);
    // D8, StagesClient.tsx before PR 5c:
    expect(timelineStrays(`const dayHasCome = !stage.playedOn || !today || stage.playedOn <= today;`)).toEqual(["(a date compared with today)", "(under way by its date)"]);
    expect(timelineStrays(`data-standing={asPanel ? (underWay ? standing : "setup") : undefined}`)).toEqual(["(under way by its date)"]);
    // Either way round, any receiver:
    expect(timelineStrays(`if (today >= r.deadline) return "Played";`)).toEqual(["(a date compared with today)"]);
    expect(timelineStrays(`const early = ev.status === "draft";`)).toEqual(["(the stored status read)", "(a stored status compared by hand)"]);
    expect(timelineStrays(`if ("live" === row.status) chip = "In play";`)).toEqual(["(a stored status compared by hand)"]);
    expect(timelineStrays(`const early = ["draft", "ready"].includes(s);`)).toEqual(["(a stored status compared by hand)"]);
    // The launch facts, imported:
    expect(timelineStrays(`import {\n  launchCheckFor,\n  stepOf,\n} from "@/lib/services/setup-flow";`)).toEqual(["launchCheckFor"]);
    expect(timelineStrays(`import { missingCardsRefusal as cards } from "@/lib/domain/round-card-status";`)).toEqual(["missingCardsRefusal"]);
    // NOT strays: the machine, another thing's status, the machine's step, a round's own facts.
    expect(timelineStrays(`import { stepOf, type TournamentStep } from "./tournament-step";`)).toEqual([]);
    expect(timelineStrays(`import type { RoundNeed, TournamentStatus } from "./tournament-status";`)).toEqual([]);
    expect(timelineStrays(`const mine = field.filter((p) => p.status === "confirmed");`)).toEqual([]);
    expect(timelineStrays(`if (st.step === "setting-up") return { chip: "Set up" };`)).toEqual([]);
    expect(timelineStrays(`const days = playing.map((s) => cleanIsoDate(s.playedOn ?? "")).sort();`)).toEqual([]);
  });

  it("CONTROL: every swept file exists, and the page's timeline reader was found", () => {
    for (const f of TIMELINE_FILES) expect(readSource(f).length, `${f} is empty or missing`).toBeGreaterThan(0);
    expect(courseDayForSource(), "courseDayFor was not found in stages/page.tsx — the sweep is reading nothing").toMatch(/roundCardLines\(/);
  });

  it("no timeline file reads the step a second way", () => {
    const found = TIMELINE_FILES.map((f) => [f, timelineStrays(readSource(f))] as const)
      .filter(([, s]) => s.length > 0)
      .map(([f, s]) => `${f}: ${s.join(", ")}`);
    expect(found, "read it from tournamentStatus through courseDayOf (domain/timeline-step.ts) instead").toEqual([]);
  });

  it("the page's golf facts for the timeline decide nothing about where the tournament is", () => {
    expect(timelineStrays(courseDayForSource())).toEqual([]);
  });

  it("the page draws the timeline from the machine's answer, and the switch stays off", () => {
    const page = readSource("src/app/(app)/stages/page.tsx");
    expect(page).toMatch(/courseDayOf\(told\.status\)/);
    expect(page).toMatch(/const told = await tournamentStatusFor\(session\.eventId, state\.today\);/);
    expect(page).toMatch(/courseDay=\{courseDay\}/);
    // Ajay previews "Course day" before it is switched on: the default view is today's screen.
    expect(page).toMatch(/const timeline = sp\.view === "timeline";/);
  });

  it("each round's chip and spine shape are the machine's, never the card's own reading", () => {
    const client = readSource("src/components/StagesClient.tsx");
    const standing = client.match(/data-standing=\{([^}]*)\}/);
    expect(standing, "the timeline's data-standing was not found").not.toBeNull();
    expect(standing![1]).toMatch(/roundStep/);
    expect(timelineStrays(standing![1])).toEqual([]);
    expect(client).toMatch(/<RoundChip step=\{roundStep\} \/>/);
    expect(client).toMatch(/<NeedsYou guide=\{courseDay\}/);
  });

  it("the lifecycle stepper (B03) reads the machine too: the same wall on its files", () => {
    // Owner ruling, 3 Nov (J16): the stepper is never a second source of truth. It reads
    // `tournamentStatus` and the one job (`tournamentJob`), and nothing on this wall.
    for (const f of STEPPER_FILES) expect(readSource(f).length, `${f} is empty or missing`).toBeGreaterThan(0);
    const found = STEPPER_FILES.map((f) => [f, timelineStrays(readSource(f))] as const)
      .filter(([, s]) => s.length > 0)
      .map(([f, s]) => `${f}: ${s.join(", ")}`);
    expect(found, "read it from tournamentStatus and tournamentJob through lifecycleTrack instead").toEqual([]);
  });

  it("roundNeeds, the strip's second source, is gone from src", () => {
    const left = allSource().filter((f) => /\broundNeeds\b/.test(readSource(f)));
    expect(left).toEqual([]);
    // CONTROL: the walk reads src — the machine's own module is in it.
    expect(allSource()).toContain("src/lib/domain/tournament-status.ts");
  });
});
