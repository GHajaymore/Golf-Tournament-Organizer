import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readVerbatim } from "./source";
import { CONTROL_CHANGED, changeLine, controlSignature, installFormControls, inventoryLine, screenLine } from "../../../e2e/form-controls";
import {
  FORM_CONTROLS_SCOPE, FORM_CONTROLS_SCOPE_320, VALUE_CLASSES, formControlsFigure, formControlsReport, joinFormControls, parseFormControlLine, signatureMatches,
} from "../../../scripts/qa/form-controls.mjs";

/**
 * "FORM CONTROLS CHANGED BY A TEST: N OF M", HELD WITHOUT A BROWSER.
 *
 * The status board's figure (382 of 711) was counted once by hand. The measure
 * that replaces it has a browser half (`e2e/form-controls.ts`: what a control
 * is called, and hearing it change), proved by `e2e/form-controls.spec.ts` on a
 * page of its own, and a half with no browser in it, held here:
 *
 *   - the SIGNATURE: a control's key is the same on the side that saw it and
 *     the side that changed it, and carries no fixture's name;
 *   - the JOIN: N of M, with what M leaves out and why;
 *   - the WORDS: the figure never printed without its scope, and "not
 *     measured" never printed as a nought.
 *
 * Each is a place the figure could be wrong and still look like a figure.
 */
const names = ["Zz Sweep Player 3", "Zz Status Organizer", "zz-sweep-k3x9"];
const seen = (role: string, name: string, off = false) => ({ role, name, off });

describe("a control's signature", () => {
  it("is its role and its name, with the fixture's names, figures, ids and days taken out", () => {
    expect(controlSignature("textbox", "Course name")).toBe('textbox "Course name"');
    expect(controlSignature("spinbutton", "Handicap for Zz Sweep Player 3", names)).toBe('spinbutton "Handicap for <name>"');
    expect(controlSignature("textbox", "Hole 12 score")).toBe('textbox "Hole # score"');
    expect(controlSignature("checkbox", "Round on Sat, 14 Nov 2026")).toBe('checkbox "Round on <date>"');
    expect(controlSignature("combobox", "Tee for cmh2k9x0a0001abcdxyz12345")).toBe('combobox "Tee for <id>"');
  });

  it("carries no part of a fixture's name (the repository is public, and so is a CI log)", () => {
    for (const label of ["Withdraw Zz Sweep Player 3", "Zz Status Organizer's role", "Player (zz-sweep-k3x9)", "Sweep"]) {
      const sig = controlSignature("checkbox", label, names);
      for (const part of ["Zz", "Sweep", "Player", "Organizer", "k3x9"]) expect(sig, `${label} -> ${sig}`).not.toContain(part);
    }
  });

  it("is not cut at the sweep's 70: a long name cut on one side of the join and not the other is two controls", () => {
    const long = "How many playing partners must confirm a card before it counts towards the weekly sheet";
    expect(controlSignature("spinbutton", long)).toBe(`spinbutton "${long}"`);
  });

  it("matches itself, and lets <name> alone stand for other words", () => {
    expect(signatureMatches('textbox "Course name"', 'textbox "Course name"')).toBe(true);
    // The inventory knew its fixture's names; the spec that changed the box had others, and the hook knows none.
    const inventory = controlSignature("spinbutton", "Handicap for Zz Sweep Player 3", names);
    expect(signatureMatches(inventory, controlSignature("spinbutton", "Handicap for Zz Other Golfer 7"))).toBe(true);
    // Nothing else is loose: another role, another caption, a longer or shorter one.
    expect(signatureMatches(inventory, 'textbox "Handicap for Zz Other Golfer #"')).toBe(false);
    expect(signatureMatches(inventory, 'spinbutton "Handicap index for Zz Other Golfer #"')).toBe(false);
    expect(signatureMatches(inventory, 'spinbutton "Handicap for "')).toBe(false);
    expect(signatureMatches('textbox "Course name"', 'textbox "Course name (short)"')).toBe(false);
    expect(signatureMatches('textbox "Course"', 'textbox "Course name"')).toBe(false);
    // The marks a signature is written with are themselves, not patterns.
    expect(signatureMatches('textbox "Hole # (par.)"', 'textbox "Hole 4 (par.)"')).toBe(false);
    expect(signatureMatches('radio "<name> (in Sc.ring)"', 'radio "Net (in Scoring)"')).toBe(false);
    expect(signatureMatches('radio "<name> (in Scoring)"', 'radio "Net (in Scoring)"')).toBe(true);
  });
});

describe("the ledger's lines", () => {
  it("are written and read back as the same thing", () => {
    expect(parseFormControlLine(screenLine("live", "/event/"))).toEqual({ kind: "screen", stage: "live", screen: "/event" });
    expect(parseFormControlLine(inventoryLine("setting-up", "/event", seen("textbox", "Name of Zz Sweep Player 3"), names))).toEqual({
      kind: "inventory", stage: "setting-up", screen: "/event", enabled: true, sig: 'textbox "Name of <name>"',
    });
    expect(parseFormControlLine(inventoryLine("live", "/event", seen("combobox", "Format", true)))).toMatchObject({ enabled: false, sig: 'combobox "Format"' });
    const said = JSON.stringify({ p: "/stages", c: "filled", r: "combobox", n: "Tee | men" });
    expect(changeLine(said)).toBe('C /stages | filled | combobox "Tee | men"');
    expect(parseFormControlLine(changeLine(said)!)).toEqual({ kind: "change", screen: "/stages", cls: "filled", sig: 'combobox "Tee | men"' });
  });

  it("a page may print anything: what is not a change is not written", () => {
    expect(changeLine("not json")).toBeNull();
    expect(changeLine("null")).toBeNull();
    expect(changeLine(JSON.stringify({ p: "/event", c: "filled", r: "textbox" }))).toBeNull();
    expect(changeLine(JSON.stringify({ p: "event", c: "filled", r: "textbox", n: "x" }))).toBeNull();
    expect(changeLine(JSON.stringify({ p: "/event", c: "FILLED | x", r: "textbox", n: "x" }))).toBeNull();
    for (const line of ["", "A 40abc", "P signed-in /event", "I live /event | maybe | textbox \"x\"", "I live /event | on | ", "C /event | invented | textbox \"x\"", "S live"]) {
      expect(parseFormControlLine(line), line).toBeNull();
    }
  });

  it("the browser says a change with the words the fixture listens for", () => {
    // The function runs in the page and cannot close over the constant, so the two are held together here.
    expect(String(installFormControls)).toContain(CONTROL_CHANGED.trim());
    for (const cls of ["filled", "empty", "refused", "pressed"]) expect(VALUE_CLASSES).toContain(cls);
  });
});

describe("N of M", () => {
  const ledger = [
    "S setting-up /event", "S live /event", "S setting-up /stages", "S live /stages", "S setting-up /print",
    'I setting-up /event | on | textbox "Name"',
    'I live /event | on | textbox "Name"',
    // Open while setting up, locked once live: a person could change it, so it is in M.
    'I setting-up /event | on | combobox "Format"',
    'I live /event | off | combobox "Format"',
    // Greyed at both stages: nobody could change it on this walk, so it is not in M.
    'I setting-up /event | off | textbox "Club code"',
    'I live /event | off | textbox "Club code"',
    'I setting-up /event | on | spinbutton "Handicap for <name>"',
    'I setting-up /stages | on | textbox "Name"',
    'I setting-up /stages | on | checkbox "Publish the draw"',
    // What every spec's contexts heard, with the reach lines that share the file.
    "A 40abc", "P signed-in /event",
    'C /event | filled | textbox "Name"', 'C /event | filled | textbox "Name"', 'C /event | empty | textbox "Name"',
    'C /event | filled | spinbutton "Handicap for Zz Other Golfer #"', 'C /event | refused | spinbutton "Handicap for Zz Other Golfer #"',
    // Changed on a screen the sweep walked, but nothing it saw there (behind a press).
    'C /event | on | checkbox "Also email me"',
    // The same name on another screen is another control; a screen the sweep never walked is not counted at all.
    'C /members | filled | textbox "Name"',
    'C /members | on | checkbox "Publish the draw"',
  ];

  it("counts a control once a screen, against what a person could have changed", () => {
    const r = joinFormControls(ledger);
    expect(r).toMatchObject({ measured: true, total: 5, changed: 2, neverEnabled: 1, changedButNotInInventory: 1, screensWalked: 3, stages: ["live", "setting-up"] });
    expect(r.screens).toEqual([
      { screen: "/event", total: 3, changed: 2, neverChanged: ['combobox "Format"'], neverEnabled: ['textbox "Club code"'] },
      { screen: "/print", total: 0, changed: 0, neverChanged: [], neverEnabled: [] },
      { screen: "/stages", total: 2, changed: 0, neverChanged: ['checkbox "Publish the draw"', 'textbox "Name"'], neverEnabled: [] },
    ]);
    // What each changed control was left as, counted by control and not by press.
    expect(r.valueClasses).toMatchObject({ filled: 2, empty: 1, refused: 1, on: 0 });
  });

  it("the order of the lines, and how many files they came in, change nothing", () => {
    expect(joinFormControls([...ledger].reverse())).toEqual(joinFormControls(ledger));
    expect(joinFormControls([...ledger, ...ledger])).toEqual(joinFormControls(ledger));
  });

  it("every control changed is M of M; none is 0 of M", () => {
    const inventory = ledger.filter((l) => l.startsWith("S ") || l.startsWith("I "));
    expect(joinFormControls(inventory)).toMatchObject({ total: 5, changed: 0 });
    const all = joinFormControls([...inventory, 'C /event | filled | textbox "Name"', 'C /event | filled | combobox "Format"', 'C /event | filled | spinbutton "Handicap for A B"', 'C /stages | filled | textbox "Name"', 'C /stages | on | checkbox "Publish the draw"']);
    expect(all).toMatchObject({ total: 5, changed: 5, changedButNotInInventory: 0 });
    expect(all.screens.flatMap((s: { neverChanged: string[] }) => s.neverChanged)).toEqual([]);
  });

  it("no inventory is NOT MEASURED, never 0 of 0", () => {
    const r = joinFormControls(ledger.filter((l) => l.startsWith("C ") || l.startsWith("A ")));
    expect(r).toMatchObject({ measured: false, total: 0, changed: 0 });
    expect(formControlsFigure(r)).toContain("NOT MEASURED");
    expect(formControlsFigure(r)).not.toMatch(/\d of \d/);
    expect(formControlsReport(r)).toHaveLength(1);
  });
});

describe("every round says the figure (the round's summary.md)", () => {
  const merge = readVerbatim("scripts/qa/merge.mjs");

  it("merge.mjs and the form-control scripts PARSE (a string match cannot see a syntax error)", () => {
    for (const file of ["scripts/qa/merge.mjs", "scripts/qa/form-controls.mjs", "scripts/qa/specs-by-area.mjs"]) {
      const run = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
      expect(run.status, `${file}: ${run.stderr}`).toBe(0);
    }
  });

  it("merge.mjs carries the figure through the reach it shapes and writes it into the summary, with the scope", () => {
    expect(merge).toContain('import { formControlsFigure } from "./form-controls.mjs";');
    expect(merge).toContain("formControls: report.formControls");
    expect(merge).toContain("**Form controls:** ${formControlsFigure(reach.formControls)}");
    // Said when there is none, never a zero.
    expect(merge).toContain("**Form controls:** not measured for this run");
  });

  it("the sentence a round prints is the figure's own, scope on it, or NOT MEASURED", () => {
    const r = joinFormControls(["S setting-up /event", 'I setting-up /event | on | textbox "Name"', 'C /event | filled | textbox "Name"']);
    expect(formControlsFigure(r)).toBe(`form controls changed by a test: 1 of 1 (100%) (${FORM_CONTROLS_SCOPE_320})`);
    // The desktop words only when a desktop stage was walked.
    const wide = joinFormControls(["S medal-desktop-setting-up /event", 'I medal-desktop-setting-up /event | on | textbox "Name"']);
    expect(formControlsFigure(wide)).toContain("1280px");
    expect(formControlsFigure(r)).not.toContain("1280px");
    expect(formControlsFigure(joinFormControls([]))).toContain("NOT MEASURED");
  });
});

describe("the measure can fail: widening M and taking a change away both move the figure", () => {
  const sweep = ["S setting-up /event", 'I setting-up /event | on | textbox "Name"', 'I setting-up /event | on | combobox "Format"'];
  const changes = ['C /event | filled | textbox "Name"', 'C /event | filled | combobox "Format"'];

  it("a control removed from a spec lowers N, and leaves M alone", () => {
    const whole = joinFormControls([...sweep, ...changes]);
    const without = joinFormControls([...sweep, changes[0]]);
    expect([whole.changed, whole.total]).toEqual([2, 2]);
    expect([without.changed, without.total]).toEqual([1, 2]);
    expect(without.screens[0].neverChanged).toEqual(['combobox "Format"']);
  });

  it("a second world's controls raise M, so a control only that world draws is counted and named", () => {
    const wider = joinFormControls([
      ...sweep, ...changes,
      "S knockout-desktop-setting-up /bracket", 'I knockout-desktop-setting-up /bracket | on | combobox "Seed order"',
      // Seen at the first width too: still ONE control.
      "S medal-desktop-setting-up /event", 'I medal-desktop-setting-up /event | on | textbox "Name"',
    ]);
    expect([wider.changed, wider.total]).toEqual([2, 3]);
    expect(wider.screens.find((x) => x.screen === "/bracket")?.neverChanged).toEqual(['combobox "Seed order"']);
    expect(wider.stages).toEqual(["knockout-desktop-setting-up", "medal-desktop-setting-up", "setting-up"]);
  });
});

describe("the report", () => {
  const r = joinFormControls([
    "S setting-up /event", "S live /event", "S live /stages",
    'I setting-up /event | on | textbox "Name"', 'I setting-up /event | on | combobox "Format"', 'I live /event | on | textbox "Notes"',
    'I live /stages | on | checkbox "Publish the draw"', 'I live /stages | on | textbox "Round name"', 'I live /stages | on | combobox "Tee"',
    'C /event | filled | textbox "Name"', 'C /event | filled | combobox "Format"',
  ]);

  it("the figure is never printed without what it leaves out", () => {
    const figure = formControlsFigure(r);
    expect(figure).toBe(`form controls changed by a test: 2 of 6 (33%) (${FORM_CONTROLS_SCOPE_320})`);
    for (const said of ["console sweep", "organizer's menu", "320px", "1280px", "setting up and live", "one medal", "one knockout", "another format"]) expect(FORM_CONTROLS_SCOPE).toContain(said);
    expect(formControlsReport(r)[0]).toBe(figure);
    expect(formControlsReport(r).join("\n")).toContain("CHANGED is not SAVED AND READ BACK");
  });

  it("names every control no test changed, under its screen, the screen missing most first", () => {
    const lines = formControlsReport(r);
    const from = lines.indexOf("FORM CONTROLS NO TEST CHANGED, by screen:");
    expect(from).toBeGreaterThan(0);
    expect(lines.slice(from + 1).filter(Boolean)).toEqual([
      "  /stages: 0 of 3 changed",
      '    checkbox "Publish the draw"',
      '    combobox "Tee"',
      '    textbox "Round name"',
      "  /event: 2 of 3 changed",
      '    textbox "Notes"',
    ]);
    const done = formControlsReport(joinFormControls(["S live /event", 'I live /event | on | textbox "Name"', 'C /event | filled | textbox "Name"']));
    expect(done.slice(done.indexOf("FORM CONTROLS NO TEST CHANGED, by screen:") + 1)).toEqual(["  none"]);
  });

  it("scripts/e2e-coverage.mjs prints it from a ledger folder, however deep, and puts it in --json", () => {
    const dir = mkdtempSync(join(tmpdir(), "zz-form-controls-"));
    try {
      // As ci.yml's `e2e-cover` has them: one folder a shard, the sweep's inventory in one and the changes in another.
      mkdirSync(join(dir, "e2e-tests-small-phone-1of2", "coverage"), { recursive: true });
      mkdirSync(join(dir, "e2e-tests-desktop-2of3", "coverage"), { recursive: true });
      writeFileSync(join(dir, "e2e-tests-small-phone-1of2", "coverage", "form-controls-inventory-41.txt"), ["S live /event", 'I live /event | on | textbox "Name"', 'I live /event | on | combobox "Format"'].join("\n") + "\n");
      writeFileSync(join(dir, "e2e-tests-desktop-2of3", "coverage", "77.txt"), ["A 40abc", 'C /event | filled | textbox "Name"'].join("\r\n") + "\r\n");
      const run = (...args: string[]) => spawnSync(process.execPath, ["scripts/e2e-coverage.mjs", "--form-controls", `--ledger=${dir}`, ...args], { encoding: "utf8" });
      const text = run();
      expect(text.status, text.stderr).toBe(0);
      expect(text.stdout).toContain(`form controls changed by a test: 1 of 2 (50%) (${FORM_CONTROLS_SCOPE_320})`);
      expect(text.stdout).toContain('    combobox "Format"');
      const json = JSON.parse(run("--json").stdout);
      expect(json.formControls).toMatchObject({ measured: true, total: 2, changed: 1 });
      // An empty folder is said, and is still not a failure: the measure reports, it does not gate.
      const empty = spawnSync(process.execPath, ["scripts/e2e-coverage.mjs", "--form-controls", `--ledger=${join(dir, "nothing-here")}`], { encoding: "utf8" });
      expect(empty.status).toBe(0);
      expect(empty.stdout).toContain("NOT MEASURED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
