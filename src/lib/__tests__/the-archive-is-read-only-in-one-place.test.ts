import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource } from "./source";
import {
  ARCHIVE_REFUSED_EVENTS,
  ARCHIVE_WRITABLE_SCREENS,
  archiveLeavesLive,
  archiveLocksScreen,
  type ControlFacts,
} from "@/lib/domain/archive-read-only";

/**
 * AN ARCHIVED TOURNAMENT'S CONSOLE IS READ-ONLY IN ONE PLACE (2026-11-09; the
 * tournament director and the UX designer on the panel).
 *
 * The console's layout wraps EVERY screen in `ArchiveReadOnly`, fed by the same
 * archive question the banner is (`archiveRefusalFor`), and that component
 * disables each control that writes. Remove the wrapper, or let the screens be
 * drawn beside it, and every staff button of an archived tournament is live
 * again — and ~140 actions throw their refusal into "This screen didn't load".
 * So this holds:
 *
 *   1. the layout draws its children ONLY inside the wrapper, and feeds it the archive;
 *   2. the wrapper asks the rule (`domain/archive-read-only.ts`), keeps asking as the
 *      screen changes, and refuses a form and a drag;
 *   3. the rule: which screens it locks, and which controls stay live — only those
 *      that change the view;
 *   4. every `data-reads` mark (the opt-out) is listed here with what it reads, so a
 *      new one is a reviewed decision and never a way round the lock.
 *
 * Read through `readSource` (comments stripped): the layout's comment names the
 * wrapper in prose, and prose must not satisfy the rule.
 */

const LAYOUT = ["src", "app", "(app)", "layout.tsx"];
const WRAPPER = ["src", "components", "ArchiveReadOnly.tsx"];

/** Does this layout draw its screens only inside the read-only wrapper, fed by the archive? */
function screensWrappedReadOnly(src: string): boolean {
  const flat = src.replace(/\s+/g, " ");
  const wrapped = /<ArchiveReadOnly archived=\{archived !== null\}> ?\{children\} ?<\/ArchiveReadOnly>/.test(flat);
  const childrenOnce = (flat.match(/\{children\}/g) ?? []).length === 1;
  const fedByTheArchive = /const archived = [^;]*archiveRefusalFor\(/.test(flat);
  return wrapped && childrenOnce && fedByTheArchive;
}

describe("the console is read-only in one place for an archived tournament", () => {
  it("the layout draws every screen inside ArchiveReadOnly, fed by the archive question", () => {
    expect(screensWrappedReadOnly(readSource(...LAYOUT))).toBe(true);
  });

  it("CONTROL: a layout drawing its screens bare, or beside the wrapper, or unfed, is seen", () => {
    const good = `const archived = session.eventId ? await archiveRefusalFor(session.eventId, "organizer") : null;
      <main><ArchiveBanner sentence={archived} />
        <ArchiveReadOnly archived={archived !== null}>{children}</ArchiveReadOnly></main>`;
    expect(screensWrappedReadOnly(good)).toBe(true);
    expect(screensWrappedReadOnly(good.replace("<ArchiveReadOnly archived={archived !== null}>{children}</ArchiveReadOnly>", "{children}"))).toBe(false);
    expect(screensWrappedReadOnly(good.replace("</main>", "{children}</main>"))).toBe(false);
    expect(screensWrappedReadOnly(good.replace("archiveRefusalFor(", "somethingElse("))).toBe(false);
    expect(screensWrappedReadOnly(good.replace("archived={archived !== null}", "archived={false}"))).toBe(false);
  });

  it("the wrapper asks the rule, keeps the lock as the screen changes, and refuses a form and a drag", () => {
    const src = readSource(...WRAPPER);
    expect(src).toMatch(/archived && archiveLocksScreen\(pathname\)/);
    expect(src).toMatch(/archiveLeavesLive\(/);
    expect(src).toMatch(/if \(!live\) el\.disabled = true/);
    // Kept: a control drawn later, or re-enabled by its own component, is locked again.
    expect(src).toMatch(/new MutationObserver\(/);
    expect(src).toMatch(/childList: true/);
    expect(src).toMatch(/attributeFilter: \["disabled"\]/);
    expect(src).toMatch(/for \(const type of ARCHIVE_REFUSED_EVENTS\) root\.addEventListener\(type, refuse, true\)/);
    expect([...ARCHIVE_REFUSED_EVENTS].sort()).toEqual(["dragstart", "drop", "submit"]);
  });
});

describe("the rule: which screens, which controls", () => {
  it("locks every screen of the tournament, and leaves the club's settings, the tournament list and the guide", () => {
    for (const s of ["/dashboard", "/stages", "/registration", "/foursomes", "/entry", "/event", "/prizes", "/access", "/scoring", "/series", "/leaderboard", "/reports", "/print"]) {
      expect(archiveLocksScreen(s), s).toBe(true);
    }
    for (const s of ["/organization", "/tournaments", "/guide", "/guide/steps"]) expect(archiveLocksScreen(s), s).toBe(false);
    // A screen whose name merely starts the same is not exempt.
    expect(archiveLocksScreen("/organizations-x")).toBe(true);
    expect([...ARCHIVE_WRITABLE_SCREENS]).toEqual(["/organization", "/tournaments", "/guide"]);
  });

  const control = (over: Partial<ControlFacts>): ControlFacts => ({ tag: "button", type: "", role: "", expands: false, reads: false, ...over });

  it("disables every control that writes", () => {
    for (const c of [
      control({}),
      control({ type: "submit" }),
      control({ tag: "input", type: "text" }),
      control({ tag: "input", type: "radio" }),
      control({ tag: "input", type: "checkbox" }),
      control({ tag: "input", type: "date" }),
      control({ tag: "input", type: "file" }),
      control({ tag: "input", type: "range" }),
      control({ tag: "select" }),
      control({ tag: "textarea" }),
      // A combobox that picks a course writes when an option is chosen: aria-expanded keeps only a BUTTON live.
      control({ tag: "input", type: "text", expands: true }),
      control({ role: "switch" }),
    ]) {
      expect(archiveLeavesLive(c), JSON.stringify(c)).toBe(false);
    }
  });

  it("leaves live only what changes the view: a disclosure, a tab, a search box, a data-reads mark", () => {
    expect(archiveLeavesLive(control({ expands: true }))).toBe(true);
    expect(archiveLeavesLive(control({ role: "tab" }))).toBe(true);
    expect(archiveLeavesLive(control({ tag: "input", type: "search" }))).toBe(true);
    expect(archiveLeavesLive(control({ tag: "select", reads: true }))).toBe(true);
    expect(archiveLeavesLive(control({ reads: true }))).toBe(true);
  });
});

/**
 * THE OPT-OUT, EVERY USE OF IT. `data-reads` says "this changes the view, never
 * a record", and the archive leaves what carries it live. A control that writes
 * must never carry it — so each file that marks one is named with what it reads.
 */
const READS_MARKS: Record<string, string> = {
  "src/components/RoundPicker.tsx": "which round a board shows (a navigation)",
  "src/components/WeekClient.tsx": "which week the sheet shows (a navigation)",
  "src/components/ReportsClient.tsx": "the whole exports screen: open, export CSV, print — it imports no action",
  "src/components/PrintReportButton.tsx": "print the final report",
  "src/components/SignUpPoster.tsx": "print the sign-up poster",
  "src/components/RegistrationClient.tsx": "download the entry-list template",
  "src/components/BracketClient.tsx": "print the draw, show a found player's path, clear it",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The files under `src` that mark a control `data-reads`. */
function marksIn(files: Array<{ file: string; src: string }>): string[] {
  return files.filter((f) => /data-reads=/.test(f.src)).map((f) => f.file).sort();
}

describe("every data-reads mark is a reviewed decision", () => {
  const files = sourceFiles(join(process.cwd(), "src")).map((p) => {
    const file = relative(process.cwd(), p).split(sep).join("/");
    return { file, src: readSource(file) };
  });

  it("the files that mark a control data-reads are exactly the ones listed, each with what it reads", () => {
    expect(marksIn(files)).toEqual(Object.keys(READS_MARKS).sort());
  });

  it("a screen marked data-reads as a whole imports no action", () => {
    expect(readSource("src", "components", "ReportsClient.tsx")).not.toMatch(/from "@\/app\/actions/);
  });

  it("CONTROL: a new mark is seen", () => {
    expect(marksIn([{ file: "x.tsx", src: '<button data-reads="" onClick={save}>' }, { file: "y.tsx", src: "<button>" }])).toEqual(["x.tsx"]);
  });
});
