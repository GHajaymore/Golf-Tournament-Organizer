import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource } from "./source";
import {
  ARCHIVE_REFUSED_EVENTS,
  ARCHIVE_WRITABLE_SCREENS,
  THIS_TOURNAMENT_ATTRIBUTE,
  archiveLeavesLive,
  archiveLocksControl,
  archiveLocksScreen,
  type ControlFacts,
} from "@/lib/domain/archive-read-only";
import { DOORS, actionsReachedBy, consoleScreens, isClubScreen, openScreens, type Door } from "./archive-doors";

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
 *   4. every `data-reads` and `data-new-tournament` mark (the opt-outs) is listed here
 *      with what it does, so a new one is a reviewed decision and never a way round the
 *      lock — and the two that ride on an action (the print kit, Copy last event) are
 *      held to it: `recordPrinted` writes nothing in an archive, `cloneEvent` does not
 *      refuse an archived source.
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
    expect(src).toMatch(/archiveLocksControl\(screenLocked, \{/);
    expect(src).toMatch(/thisTournament: el\.closest\(`\[\$\{THIS_TOURNAMENT_ATTRIBUTE\}\]`\) !== null/);
    expect(src).toMatch(/if \(locks\) el\.disabled = true/);
    // Runs on every screen of an archived tournament — an open screen still locks the tournament's part.
    expect(src).toMatch(/if \(!archived \|\| !root\) return;/);
    // Kept: a control drawn later, or re-enabled by its own component, is locked again — once a frame.
    expect(src).toMatch(/new MutationObserver\(/);
    expect(src).toMatch(/requestAnimationFrame\(\(\) => \{\s*frame = 0;\s*lockControls\(root, locked\);/);
    expect(src).toMatch(/childList: true/);
    expect(src).toMatch(/attributeFilter: \["disabled"\]/);
    expect(src).toMatch(/for \(const type of ARCHIVE_REFUSED_EVENTS\) root\.addEventListener\(type, refuse, true\)/);
    expect([...ARCHIVE_REFUSED_EVENTS].sort()).toEqual(["dragstart", "drop", "submit"]);
  });
});

describe("the rule: which screens, which controls", () => {
  it("locks every screen of the tournament, and leaves the club's screens open", () => {
    for (const s of ["/dashboard", "/stages", "/registration", "/foursomes", "/entry", "/event", "/prizes", "/leaderboard", "/bracket", "/print"]) {
      expect(archiveLocksScreen(s), s).toBe(true);
    }
    for (const s of ["/organization", "/tournaments", "/guide", "/guide/steps", "/roster", "/series"]) expect(archiveLocksScreen(s), s).toBe(false);
    // A screen whose name merely starts the same is not exempt.
    expect(archiveLocksScreen("/organizations-x")).toBe(true);
  });

  /**
   * THE OPEN SCREENS ARE DERIVED, NOT CHOSEN (the Opus re-check, 2026-11-10: /roster
   * and /series were locked although their actions are the club's). Each console
   * screen's actions are followed through its imports; a screen is the club's when
   * every one is not a door into a tournament (`NOT_A_DOOR`, the archive sweep's
   * own list) or a door that answers an archive in words, and it calls a club action
   * — or it writes nothing in a tournament at all. Actions imported by a part marked
   * `data-this-tournament` are left out: that part is locked even on an open screen.
   */
  it("the screens left open are exactly the ones the club's actions and the sweep's list say", () => {
    expect([...ARCHIVE_WRITABLE_SCREENS].sort()).toEqual(openScreens(THIS_TOURNAMENT_ATTRIBUTE));
  });

  it("CONTROL: the walk finds a screen's actions, and the derivation tells a club screen from a tournament one", () => {
    // The walk reaches through a screen's components to the actions they import.
    expect(consoleScreens().map((s) => s.path)).toEqual(expect.arrayContaining(["/stages", "/roster", "/organization"]));
    expect(actionsReachedBy("src/app/(app)/stages/page.tsx")).toEqual(expect.arrayContaining(["tournament.ts:setStageFormat", "tournament.ts:addStage"]));
    expect(actionsReachedBy("src/app/(app)/roster/page.tsx")).toEqual(expect.arrayContaining(["roster.ts:addMember", "roster.ts:addMembersToEvent"]));
    // Without the marked parts left out, Club settings reaches the tournament's own staff and money.
    const unmarked = actionsReachedBy("src/app/(app)/organization/page.tsx");
    const marked = actionsReachedBy("src/app/(app)/organization/page.tsx", THIS_TOURNAMENT_ATTRIBUTE);
    expect(unmarked).toEqual(expect.arrayContaining(["money-setup.ts:setEventMoneyMode", "tournament.ts:addAccount"]));
    expect(marked).not.toContain("money-setup.ts:setEventMoneyMode");
    expect(marked).not.toContain("tournament.ts:addAccount");
    expect(marked).toEqual(expect.arrayContaining(["organization.ts:saveOrganizationTheme"]));
    // The judgement, on invented doors.
    const doors = new Map<string, Door>([
      ["c.ts:club", { id: "c.ts:club", notADoor: "club", answersInWords: false }],
      ["t.ts:says", { id: "t.ts:says", notADoor: null, answersInWords: true }],
      ["t.ts:throws", { id: "t.ts:throws", notADoor: null, answersInWords: false }],
      ["n.ts:new", { id: "n.ts:new", notADoor: "new", answersInWords: false }],
    ]);
    expect(isClubScreen([], doors)).toBe(true);
    expect(isClubScreen(["n.ts:new"], doors)).toBe(true);
    expect(isClubScreen(["c.ts:club", "t.ts:says"], doors)).toBe(true);
    expect(isClubScreen(["c.ts:club", "t.ts:throws"], doors)).toBe(false);
    // A tournament screen whose doors all say words is still the tournament's: it calls no club action.
    expect(isClubScreen(["t.ts:says"], doors)).toBe(false);
    expect(isClubScreen(["x.ts:unknown"], doors)).toBe(false);
    // And the real list: the doors the two club screens reach that write the tournament answer in words.
    expect(DOORS.get("roster.ts:addMembersToEvent")?.answersInWords).toBe(true);
    expect(DOORS.get("series.ts:setEventSeries")?.answersInWords).toBe(true);
    expect(DOORS.get("money-setup.ts:setEventMoneyMode")?.answersInWords).toBe(false);
  });

  const control = (over: Partial<ControlFacts>): ControlFacts => ({
    tag: "button", type: "", role: "", expands: false, reads: false, makesNew: false, thisTournament: false, ...over,
  });

  it("on a screen the archive leaves open, locks only the tournament's own part — and there too leaves the view", () => {
    expect(archiveLocksControl(false, control({}))).toBe(false);
    expect(archiveLocksControl(false, control({ tag: "select" }))).toBe(false);
    expect(archiveLocksControl(false, control({ thisTournament: true }))).toBe(true);
    expect(archiveLocksControl(false, control({ thisTournament: true, expands: true }))).toBe(false);
    expect(archiveLocksControl(true, control({}))).toBe(true);
    expect(archiveLocksControl(true, control({ reads: true }))).toBe(false);
  });

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

  it("and what writes only a NEW tournament: a data-new-tournament mark (Copy last event)", () => {
    expect(archiveLeavesLive(control({ makesNew: true }))).toBe(true);
    expect(archiveLeavesLive(control({ tag: "input", type: "date", makesNew: true }))).toBe(true);
  });
});

/**
 * THE OPT-OUTS, EVERY USE OF THEM. `data-reads` says "this changes the view,
 * never a record"; `data-new-tournament` says "this writes a new tournament,
 * never this one". The archive leaves what carries either live, so a control
 * that writes this tournament must never carry one — each file that marks one
 * is named here with what it does.
 */
const READS_MARKS: Record<string, string> = {
  "src/components/RoundPicker.tsx": "which round a board shows (a navigation)",
  "src/components/WeekClient.tsx": "which week the sheet shows (a navigation)",
  "src/components/ReportsClient.tsx": "the whole exports screen: open, export CSV, print — it imports no action",
  "src/components/PrintReportButton.tsx": "print the final report",
  "src/components/SignUpPoster.tsx": "print the sign-up poster",
  "src/components/RegistrationClient.tsx": "download the entry-list template",
  "src/components/BracketClient.tsx": "print the draw, show a found player's path, clear it",
  "src/components/print/PrintKitClient.tsx": "the print kit: choose sheets and print — `recordPrinted` records nothing in an archive",
  "src/components/LeaderboardBoard.tsx": "Overall or by flight (the board's view)",
  "src/components/RoundAvailability.tsx": "calendar or list (the view)",
  "src/components/ScoreEntryClient.tsx": "the match list's search box and status chips (a filter)",
};
const NEW_TOURNAMENT_MARKS: Record<string, string> = {
  "src/components/CopyLastEvent.tsx": "Copy last event — `cloneEvent` reads the source and writes only the copy",
};
/** The opposite mark: the tournament's own part, locked even on a screen the archive leaves open. */
const THIS_TOURNAMENT_MARKS: Record<string, string> = {
  "src/components/AccessClient.tsx": "the tournament's staff (addAccount, setAccountRole, removeAccount)",
  "src/components/MoneySetup.tsx": "Money in this tournament (setEventMoneyMode, setExpenseEntry); the club's own mode on Club settings is unmarked",
  "src/components/PlaySettings.tsx": "the tournament's Players & scoring (in tournament mode only; the club's house defaults stay open)",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The files under `src` that mark a control with `attribute`. */
function marksIn(files: Array<{ file: string; src: string }>, attribute: string): string[] {
  return files.filter((f) => f.src.includes(`${attribute}=`)).map((f) => f.file).sort();
}

/** The body of one exported action, from its declaration to the next export. */
function actionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

/** Does an action refuse because ITS OWN tournament is archived — the gate, or the archive asked directly? */
function refusesAnArchivedSource(body: string): boolean {
  return /assertEventWritable\(|archiveRefusalFor\(|requireStaffEvent\(|requireAdminEvent\(|staffEventOrRefusal\(|adminEventOrRefusal\(/.test(body);
}

/** Does `recordPrinted` answer an archive with a print and NO write, before anything is saved? */
function printsAnArchiveWithoutWriting(body: string): boolean {
  const asked = body.indexOf("archiveRefusalFor(");
  const answered = body.search(/if \(archived\) return \{ ok: true, stamps: \{\}, recorded: false \}/);
  const saved = body.indexOf("savePrintLog(");
  return asked >= 0 && answered > asked && saved > answered;
}

describe("every opt-out mark is a reviewed decision", () => {
  const files = sourceFiles(join(process.cwd(), "src")).map((p) => {
    const file = relative(process.cwd(), p).split(sep).join("/");
    return { file, src: readSource(file) };
  });

  it("the files that mark a control data-reads are exactly the ones listed, each with what it reads", () => {
    expect(marksIn(files, "data-reads")).toEqual(Object.keys(READS_MARKS).sort());
  });

  it("the files that mark a control data-new-tournament are exactly the ones listed", () => {
    expect(marksIn(files, "data-new-tournament")).toEqual(Object.keys(NEW_TOURNAMENT_MARKS).sort());
  });

  it("the files that mark the tournament's own part data-this-tournament are exactly the ones listed", () => {
    expect(marksIn(files, THIS_TOURNAMENT_ATTRIBUTE)).toEqual(Object.keys(THIS_TOURNAMENT_MARKS).sort());
  });

  it("the views found locked by the re-check are marked where they are drawn: the board's flights, a knockout's flight", () => {
    // Inside the marked element, not merely somewhere in the file.
    const board = readSource("src", "components", "LeaderboardBoard.tsx").replace(/\s+/g, " ");
    expect(board).toMatch(/<div className="seg" data-reads=""[^>]*> <label className="seg-opt"> <input type="radio" name="lbview"/);
    const bracket = readSource("src", "components", "BracketClient.tsx").replace(/\s+/g, " ");
    expect(bracket).toMatch(/<div className="seg" data-reads=""[^>]*> \{list\.map\(\(d, i\) => \( <label className="seg-opt" key=\{d\.label\}> <input type="radio" name="brk"/);
  });

  it("a screen marked data-reads as a whole imports no action", () => {
    expect(readSource("src", "components", "ReportsClient.tsx")).not.toMatch(/from "@\/app\/actions/);
  });

  it("the print kit is honest data-reads: its one action records nothing in an archive, and it calls no other", () => {
    const kit = readSource("src", "components", "print", "PrintKitClient.tsx");
    expect(kit.match(/from "@\/app\/actions[^"]*"/g)).toEqual(['from "@/app/actions/print-kit"']);
    expect(kit).toMatch(/import \{ recordPrinted \} from "@\/app\/actions\/print-kit"/);
    expect(printsAnArchiveWithoutWriting(actionBody(readSource("src", "app", "actions", "print-kit.ts"), "recordPrinted"))).toBe(true);
  });

  it("Copy last event is honest data-new-tournament: it calls cloneEvent alone, which does not refuse an archived source", () => {
    const copy = readSource("src", "components", "CopyLastEvent.tsx");
    expect(copy.match(/from "@\/app\/actions[^"]*"/g)).toEqual(['from "@/app/actions/tournament"']);
    expect(copy).toMatch(/import \{ cloneEvent \} from "@\/app\/actions\/tournament"/);
    const clone = actionBody(readSource("src", "app", "actions", "tournament.ts"), "cloneEvent");
    expect(clone, "cloneEvent not found").not.toBe("");
    expect(refusesAnArchivedSource(clone), "cloneEvent refuses an archived source: the copy would be refused in the error screen").toBe(false);
  });

  it("CONTROL: a new mark is seen, a refusing clone is seen, a print that writes first is seen", () => {
    expect(marksIn([{ file: "x.tsx", src: '<button data-reads="" onClick={save}>' }, { file: "y.tsx", src: "<button>" }], "data-reads")).toEqual(["x.tsx"]);
    expect(marksIn([{ file: "z.tsx", src: '<section data-new-tournament="">' }], "data-new-tournament")).toEqual(["z.tsx"]);
    expect(marksIn([{ file: "w.tsx", src: '<div data-this-tournament={on ? "" : undefined}>' }], THIS_TOURNAMENT_ATTRIBUTE)).toEqual(["w.tsx"]);
    expect(refusesAnArchivedSource("export async function cloneEvent(id) {\n  await assertEventWritable(id);\n}")).toBe(true);
    expect(refusesAnArchivedSource("export async function cloneEvent(id) {\n  const source = await prisma.event.findUnique({});\n}")).toBe(false);
    const good = 'const archived = await archiveRefusalFor(e, "organizer");\n  if (archived) return { ok: true, stamps: {}, recorded: false };\n  await savePrintLog(e, s, log);';
    expect(printsAnArchiveWithoutWriting(good)).toBe(true);
    expect(printsAnArchiveWithoutWriting("await savePrintLog(e, s, log);\n" + good.replace("await savePrintLog(e, s, log);", ""))).toBe(false);
    expect(printsAnArchiveWithoutWriting(good.replace("{ ok: true, stamps: {}, recorded: false }", "{ ok: false, error: archived }"))).toBe(false);
  });
});
