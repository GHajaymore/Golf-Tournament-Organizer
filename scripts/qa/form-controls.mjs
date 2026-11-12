/**
 * FORM CONTROLS CHANGED BY A TEST: the join and the words, with no browser in them.
 *
 * The status board carried "form controls tested: 382 of 711", added from a crawl
 * count (2026-10-13) and a count of the code (2026-10-10); no script re-reads it. This is
 * the script's half; `scripts/e2e-coverage.mjs` prints what it returns.
 *
 * TWO KINDS OF LEDGER LINE, both written under `.e2e/coverage/` while specs run:
 *
 *   S <stage> <path>                    a screen the console sweep measured
 *   I <stage> <path> | on|off | <sig>   a form control it SAW there (the inventory,
 *                                       `e2e/console-sweep.spec.ts`; `off` is
 *                                       disabled or read-only at that stage)
 *   C <path> | <class> | <sig>          a control some spec CHANGED (the hook in
 *                                       `e2e/coverage.ts`, every context of every spec)
 *
 * <sig> is `role "accessible name"`, scrubbed of digits, days and database ids on
 * both sides (`controlSignature` in e2e/form-controls.ts). The inventory knows
 * its fixture's invented names and writes `<name>` for them; a spec's own
 * fixture has other names the hook cannot know. So `<name>` in an inventory
 * signature stands for ANY words when the two are compared, and nothing else is
 * loose: `textbox "Handicap for <name>"` is changed by
 * `textbox "Handicap for Zz Other Player #"`.
 *
 * WHAT THE FIGURE IS: of the controls the sweep saw ENABLED at least once on a
 * screen (M), the ones a spec changed on that same screen (N). A control is one
 * signature on one screen: forty score boxes of one name are one control, as
 * forty greyed boxes are one line of the sweep's known list.
 *
 * WHAT IT IS NOT, and the report says so beside the figure (`FORM_CONTROLS_SCOPE`):
 * the inventory is the organizer's menu screens at 320px (setting up and live, one medal) and at desktop
 * width, 1280px (setting up, that medal and one knockout). A control only another format, stage, dialog or folded
 * panel shows is not in M. And CHANGED is not "saved and read back": it says a
 * test altered the control, not that anything checked the result.
 */

export const FORM_CONTROLS_SCOPE =
  "inventory from the console sweep: the organizer's menu screens at 320px, setting up and live, for one medal, and at 1280px, setting up, for that medal and for one knockout; a control only another format, stage or dialog shows is not counted";

/** What a change may be recorded as. `refused` is the browser's own check (`validity.valid` false), nothing cleverer. */
export const VALUE_CLASSES = ["filled", "empty", "refused", "on", "off", "pressed"];

const path = (p) => (p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p);
const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is the control a spec changed (`got`) the one the inventory names (`inventory`)? Only `<name>` is loose. */
export function signatureMatches(inventory, got) {
  if (inventory === got) return true;
  if (!inventory.includes("<name>")) return false;
  return new RegExp("^" + inventory.split("<name>").map(escapeForRegex).join(".+") + "$").test(got);
}

/** One ledger line, read. `null` for a line that is not one of the three, or is cut short. */
export function parseFormControlLine(line) {
  if (line.startsWith("S ")) {
    const [stage, screen] = line.slice(2).trim().split(" ");
    return stage && screen ? { kind: "screen", stage, screen: path(screen) } : null;
  }
  if (line.startsWith("I ")) {
    const [head, state, ...rest] = line.slice(2).split(" | ");
    const [stage, screen] = head.trim().split(" ");
    const sig = rest.join(" | ").trim();
    if (!stage || !screen || !sig || (state !== "on" && state !== "off")) return null;
    return { kind: "inventory", stage, screen: path(screen), enabled: state === "on", sig };
  }
  if (line.startsWith("C ")) {
    const [screen, cls, ...rest] = line.slice(2).split(" | ");
    const sig = rest.join(" | ").trim();
    if (!screen || !sig || !VALUE_CLASSES.includes(cls)) return null;
    return { kind: "change", screen: path(screen.trim()), cls, sig };
  }
  return null;
}

/**
 * N of M, from ledger lines (any order, any number of files run together).
 *
 * `measured` is false when no sweep wrote an inventory into this ledger: then
 * there is no M, and the report must say "not measured", never "0 of 0".
 */
export function joinFormControls(lines) {
  const stages = new Set();
  const screensWalked = new Set();
  /** screen -> sig -> seen enabled at least once */
  const inventory = new Map();
  /** screen -> sig -> classes */
  const changes = new Map();
  for (const line of lines) {
    const row = parseFormControlLine(line);
    if (!row) continue;
    if (row.kind === "screen") {
      stages.add(row.stage);
      screensWalked.add(row.screen);
    } else if (row.kind === "inventory") {
      stages.add(row.stage);
      screensWalked.add(row.screen);
      if (!inventory.has(row.screen)) inventory.set(row.screen, new Map());
      const at = inventory.get(row.screen);
      at.set(row.sig, (at.get(row.sig) ?? false) || row.enabled);
    } else {
      if (!changes.has(row.screen)) changes.set(row.screen, new Map());
      const at = changes.get(row.screen);
      if (!at.has(row.sig)) at.set(row.sig, new Set());
      at.get(row.sig).add(row.cls);
    }
  }

  const screens = [];
  const usedChanges = new Set();
  let total = 0;
  let changed = 0;
  const classes = Object.fromEntries(VALUE_CLASSES.map((c) => [c, 0]));
  for (const screen of [...screensWalked].sort()) {
    const controls = inventory.get(screen) ?? new Map();
    const here = changes.get(screen) ?? new Map();
    const neverChanged = [];
    const neverEnabled = [];
    let screenChanged = 0;
    let screenTotal = 0;
    for (const sig of [...controls.keys()].sort()) {
      if (!controls.get(sig)) {
        neverEnabled.push(sig);
        continue;
      }
      screenTotal += 1;
      const seen = new Set();
      for (const [got, cls] of here) {
        if (!signatureMatches(sig, got)) continue;
        usedChanges.add(`${screen}\n${got}`);
        for (const c of cls) seen.add(c);
      }
      if (seen.size) {
        screenChanged += 1;
        for (const c of seen) classes[c] += 1;
      } else neverChanged.push(sig);
    }
    total += screenTotal;
    changed += screenChanged;
    screens.push({ screen, total: screenTotal, changed: screenChanged, neverChanged, neverEnabled });
  }

  // Changes on a screen the sweep walked that match nothing it saw there: a control behind a press,
  // or one another fixture shows. Counted so the size of what M leaves out is not a guess.
  let changedButNotInInventory = 0;
  for (const screen of screensWalked) for (const got of (changes.get(screen) ?? new Map()).keys()) if (!usedChanges.has(`${screen}\n${got}`)) changedButNotInInventory += 1;

  return {
    measured: screensWalked.size > 0,
    scope: FORM_CONTROLS_SCOPE,
    stages: [...stages].sort(),
    screensWalked: screensWalked.size,
    total,
    changed,
    neverEnabled: screens.reduce((n, s) => n + s.neverEnabled.length, 0),
    changedButNotInInventory,
    valueClasses: classes,
    screens,
  };
}

/** The one line with the figure on it. The scope is ON the line, so the figure is never quoted without it. */
export function formControlsFigure(r) {
  if (!r.measured) {
    return "form controls changed by a test: NOT MEASURED (no inventory in this ledger: the console sweep, Chromium's small phone only, did not run into it)";
  }
  const pct = r.total ? Math.round((r.changed / r.total) * 100) : 0;
  return `form controls changed by a test: ${r.changed} of ${r.total} (${pct}%) (${r.scope})`;
}

/** The whole section of the report: the figure, what it leaves out, and by name what no test changed. */
export function formControlsReport(r) {
  const out = [formControlsFigure(r)];
  if (!r.measured) return out;
  out.push(`  the sweep walked ${r.screensWalked} screens at ${r.stages.join(" and ")}; a control is one role and name on one screen, however many rows draw it`);
  out.push("  CHANGED is not SAVED AND READ BACK: a test altered the control; nothing here says the result was checked");
  const v = r.valueClasses;
  out.push(`  of the ${r.changed} changed: ${v.filled} given a value, ${v.empty} emptied, ${v.refused} left holding a value the browser's own check refuses, ${v.on} switched on, ${v.off} switched off, ${v.pressed} custom switches pressed`);
  out.push(`  not in the figure: ${r.neverEnabled} seen only greyed or read-only at both stages; ${r.changedButNotInInventory} changed on these screens that the sweep never saw (behind a press, or another fixture's)`);
  out.push("");
  out.push("FORM CONTROLS NO TEST CHANGED, by screen:");
  const missing = r.screens.filter((s) => s.neverChanged.length).sort((a, b) => b.neverChanged.length - a.neverChanged.length || a.screen.localeCompare(b.screen));
  if (!missing.length) out.push("  none");
  for (const s of missing) {
    out.push("");
    out.push(`  ${s.screen}: ${s.changed} of ${s.total} changed`);
    for (const sig of s.neverChanged) out.push(`    ${sig}`);
  }
  return out;
}
