/**
 * What the browser tests reached, against everything the app has.
 *
 *     node scripts/e2e-coverage.mjs            # print the report
 *     node scripts/e2e-coverage.mjs --reset    # empty the ledger before a run
 *     node scripts/e2e-coverage.mjs --json     # the same, as JSON on stdout
 *
 * The ledger is written by `e2e/coverage.ts` while specs run (.e2e/coverage/).
 * The lists it is held against come from the BUILD the tests ran on — every
 * server action it exports and every screen it routes — so nothing here is a
 * hand-kept list that can fall behind the app.
 *
 * It reports REACH. An action that was called is not thereby correct; an
 * action that was never called has not been tested by any browser test at
 * all, and that is the list this exists to print.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const DIST = process.env.NEXT_DIST_DIR ?? ".next-e2e";
const LEDGER = join(".e2e", "coverage");

if (process.argv.includes("--reset")) {
  rmSync(LEDGER, { recursive: true, force: true });
  console.log("coverage ledger emptied");
  process.exit(0);
}

const manifestPath = join(DIST, "server", "server-reference-manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`no build at ${DIST} — the report is read against the build the tests ran on`);
  process.exit(1);
}

// ── Everything the app has ────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
/** id → { name, file } for every server action the build exports. */
const actions = new Map();
for (const [id, entry] of Object.entries(manifest.node ?? {})) {
  const file = String(entry.filename ?? "").replace(/\\/g, "/");
  const short = file.includes("/src/") ? file.slice(file.lastIndexOf("/src/") + 1) : file;
  actions.set(id, { name: entry.exportedName ?? "(anonymous)", file: short });
}

const paths = JSON.parse(readFileSync(join(DIST, "server", "app-paths-manifest.json"), "utf8"));
/** Every screen, as the pattern a visited path is matched against. */
const screens = [];
for (const key of Object.keys(paths)) {
  if (!key.endsWith("/page")) continue;
  const route =
    "/" +
    key
      .slice(0, -"/page".length)
      .split("/")
      .filter((seg) => seg && !(seg.startsWith("(") && seg.endsWith(")")))
      .join("/");
  if (route.startsWith("/_")) continue;
  const pattern = new RegExp(
    "^" +
      route
        .split("/")
        .map((seg) => (seg.startsWith("[") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        .join("/") +
      "/?$",
  );
  screens.push({ route, pattern });
}

// ── What the tests touched ────────────────────────────────────────────────
const hitActions = new Map();
const hitScreens = new Map();
/** Refusals that appeared after a press with none of them on the screen: the words, and how often. */
const outOfSight = new Map();
let lines = 0;
if (existsSync(LEDGER)) {
  for (const name of readdirSync(LEDGER)) {
    if (!name.endsWith(".txt")) continue;
    for (const line of readFileSync(join(LEDGER, name), "utf8").split("\n")) {
      if (!line) continue;
      lines += 1;
      if (line.startsWith("A ")) {
        const id = line.slice(2).trim();
        hitActions.set(id, (hitActions.get(id) ?? 0) + 1);
      } else if (line.startsWith("P ")) {
        const [, role, path] = line.split(" ");
        const screen = screens.find((s) => s.pattern.test(path));
        if (!screen) continue;
        if (!hitScreens.has(screen.route)) hitScreens.set(screen.route, new Set());
        hitScreens.get(screen.route).add(role);
      } else if (line.startsWith("R ")) {
        // R <role> <path> | pressed: <what> | <marked or red> | <the words>
        const [head, pressed = "", kind = "", ...rest] = line.slice(2).split(" | ");
        const path = head.split(" ").slice(1).join(" ");
        const words = rest.join(" | ");
        const screen = screens.find((s) => s.pattern.test(path));
        const key = `${screen ? screen.route : path} | ${kind} | ${words}`;
        const was = outOfSight.get(key) ?? { screen: screen ? screen.route : path, kind, words, pressed: new Set(), times: 0 };
        was.pressed.add(pressed.replace("pressed: ", ""));
        was.times += 1;
        outOfSight.set(key, was);
      }
    }
  }
}

// ── The report ────────────────────────────────────────────────────────────
const byFile = new Map();
for (const [id, a] of actions) {
  if (!byFile.has(a.file)) byFile.set(a.file, { hit: [], missed: [] });
  byFile.get(a.file)[hitActions.has(id) ? "hit" : "missed"].push(a.name);
}
const actionsHit = [...actions.keys()].filter((id) => hitActions.has(id)).length;
const unknown = [...hitActions.keys()].filter((id) => !actions.has(id)).length;
const screensHit = screens.filter((s) => hitScreens.has(s.route)).length;

const report = {
  build: DIST,
  ledgerLines: lines,
  actions: { total: actions.size, reached: actionsHit, notInThisBuild: unknown },
  screens: { total: screens.length, reached: screensHit },
  files: [...byFile.entries()]
    .map(([file, v]) => ({ file, reached: v.hit.length, total: v.hit.length + v.missed.length, neverCalled: v.missed.sort() }))
    .sort((a, b) => b.neverCalled.length - a.neverCalled.length),
  screensNeverOpened: screens.filter((s) => !hitScreens.has(s.route)).map((s) => s.route).sort(),
  screensOpened: Object.fromEntries([...hitScreens.entries()].map(([route, roles]) => [route, [...roles].sort()])),
  // Read these; do not count them. "marked" is a refusal by its own markup; "red" is a short line in
  // the danger colour, which is usually one and sometimes a figure — see `watchRefusals` in e2e/coverage.ts.
  refusalsOutOfSight: [...outOfSight.values()]
    .map((r) => ({ screen: r.screen, kind: r.kind, words: r.words, pressed: [...r.pressed].sort(), times: r.times }))
    .sort((a, b) => a.screen.localeCompare(b.screen) || a.words.localeCompare(b.words)),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 1));
} else {
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  console.log(`E2E REACH — build ${DIST}, ${lines} ledger lines`);
  console.log(`  server actions called: ${actionsHit} of ${actions.size} (${pct(actionsHit, actions.size)}%)`);
  console.log(`  screens opened:        ${screensHit} of ${screens.length} (${pct(screensHit, screens.length)}%)`);
  if (unknown) console.log(`  (${unknown} recorded action ids are not in this build — the ledger is from another build)`);
  console.log("\nNEVER CALLED BY ANY BROWSER TEST, by file:");
  for (const f of report.files) {
    if (!f.neverCalled.length) continue;
    console.log(`\n  ${f.file} — ${f.reached} of ${f.total} reached`);
    console.log("    " + f.neverCalled.join(", "));
  }
  console.log("\nSCREENS NEVER OPENED:");
  console.log("  " + (report.screensNeverOpened.join("  ") || "none"));
  console.log("\nREFUSALS THAT APPEARED AFTER A PRESS WITH NONE OF THEM ON THE SCREEN:");
  if (!report.refusalsOutOfSight.length) console.log("  none seen (of the refusals the tests provoked)");
  for (const r of report.refusalsOutOfSight) {
    console.log(`  ${r.screen} — ${r.kind}, ${r.times}x, after pressing ${r.pressed.map((p) => `"${p}"`).join(" or ")}`);
    console.log(`    ${r.words}`);
  }
}
