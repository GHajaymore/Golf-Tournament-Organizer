import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource } from "./source";
import { EVENT_STATUSES } from "@/lib/domain/phase-gate";
import { PRE_LAUNCH_STATUSES } from "@/lib/domain/lifecycle-state";

/**
 * NO TOURNAMENT IS STORED, ASKED OR SEEDED IN AN OLD WORD (state machine PR 8, J14;
 * proposal of 3 Nov, section 4c, step 5).
 *
 * Before 31 Oct a tournament climbed a ladder: draft, then "taking entries", then
 * "ready", then live. G1 made the three pre-launch rungs one Setting-up step, #976
 * stopped every action writing the two later words, and migration A045 moved every
 * row still holding one to `draft`, keeping the word in `Event.legacyStatus`. So
 * from here a tournament's status is one of three words — and a fixture, a seed, a
 * screen or a query that still says one of the other two is testing, or asking for,
 * a tournament that cannot exist. Worse: `isLaunched` is "not on the pre-launch
 * list", so a row seeded in an old word now reads as LAUNCHED, quietly.
 *
 * This refuses the two words AS A TOURNAMENT'S STATUS everywhere code is written —
 * `src`, `scripts`, `e2e` and `prisma/seed.ts` — in the five shapes they took:
 *
 *   written    `status: "registration"` (a fixture, a seed, an update)
 *   compared   `event.status === "ready"`, `stage.f.status !== "registration"`
 *   filtered   `status: { in: [..., "registration"] }`
 *   listed     `["draft", "registration", "ready"]` (a pre-launch list of one's own)
 *   asserted   `expect(row.status).toBe("registration")`
 *   in SQL     `"status" IN ('registration', …)`, `status = 'ready'`
 *
 * NOT the same word in another column or another thing: `playerCountMode`'s default
 * is "registration" (the trap section 4a names), the Entries screen is keyed
 * "registration", an e-mail kind is "registration", a handicap connection or a
 * course card is "ready". Nor `legacyStatus`, which is where the old word is KEPT.
 * Read through `readSource`, so a comment telling this history is not a use of it.
 */

const OLD = String.raw`(?:registration|ready)`;
const Q = String.raw`["'\`]`;

/** A status that is not a tournament's — told apart by the thing it hangs off. */
const NOT_A_TOURNAMENT = /handicap|connection|credential|scores|card|integration/i;

const SHAPES: { name: string; re: RegExp; chain?: boolean }[] = [
  { name: "written", re: new RegExp(String.raw`(?<![\w$.])(?:status|eventStatus)\s*:\s*${Q}${OLD}${Q}`, "g") },
  { name: "compared", re: new RegExp(String.raw`([\w$.?]*)(?:status|Status)\s*[!=]==?\s*${Q}${OLD}${Q}`, "g"), chain: true },
  { name: "compared", re: new RegExp(String.raw`${Q}${OLD}${Q}\s*[!=]==?\s*([\w$.?]*)(?:status|Status)\b`, "g"), chain: true },
  { name: "filtered", re: new RegExp(String.raw`(?<![\w$.])(?:status|eventStatus)\s*:\s*\{[^}]*${Q}${OLD}${Q}`, "g") },
  { name: "listed", re: new RegExp(String.raw`\[[^\]\[]*${Q}draft${Q}[^\]\[]*${Q}${OLD}${Q}[^\]\[]*\]`, "g") },
  { name: "listed", re: new RegExp(String.raw`\[[^\]\[]*${Q}${OLD}${Q}[^\]\[]*${Q}draft${Q}[^\]\[]*\]`, "g") },
  { name: "asserted", re: new RegExp(String.raw`([^;\n]*?)\.(?:status|eventStatus)\b[^;\n]*?\)\s*\.\s*toBe\(\s*${Q}${OLD}${Q}\s*\)`, "g"), chain: true },
  { name: "in SQL", re: new RegExp(String.raw`"?status"?\s*(?:=|<>|!=)\s*'${OLD}'`, "gi") },
  { name: "in SQL", re: new RegExp(String.raw`"?status"?\s+(?:NOT\s+)?IN\s*\([^)]*'${OLD}'`, "gi") },
];

/** Every use of an old word as a tournament's status in this source, by shape. */
export function oldWords(src: string): string[] {
  const found: string[] = [];
  for (const shape of SHAPES) {
    for (const m of src.matchAll(shape.re)) {
      if (shape.chain && NOT_A_TOURNAMENT.test(m[1] ?? "")) continue;
      found.push(`${shape.name}: ${m[0].replace(/\s+/g, " ").slice(0, 80)}`);
    }
  }
  return found;
}

/**
 * THE FILES ALLOWED TO SAY ONE, each for a reason that is the point of the file.
 * Never add a fixture here: move it to `draft` (and `registrationOpen: true`, or
 * `legacyStatus`, where members must see it before launch).
 */
const ALLOWED: Record<string, string> = {
  "src/lib/__tests__/no-tournament-keeps-an-old-word.test.ts": "this sweep: its controls are the words it refuses",
  "src/lib/__tests__/a-legacy-row-keeps-its-word.audit.test.ts":
    "the migration's proof: it seeds a row in each old word and watches A045 move it",
  "src/lib/__tests__/the-tournament-is-asked-one-way.test.ts":
    "its own sweep's controls: hand-spelled status tests, as strings, that it must flag",
  "src/lib/__tests__/the-timeline-reads-the-machine.test.ts":
    "its own sweep's controls: a stored status compared by hand, as a string, that it must flag",
};

const ROOT = process.cwd();
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesUnder(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(relative(ROOT, full).replace(/\\/g, "/"));
  }
  return out;
}
const FILES = [...filesUnder(join(ROOT, "src")), ...filesUnder(join(ROOT, "scripts")), ...filesUnder(join(ROOT, "e2e")), "prisma/seed.ts"];

describe("no tournament keeps an old word", () => {
  it("has the three words the app writes, and one of them before launch (the vocabulary this guards)", () => {
    expect([...EVENT_STATUSES].sort()).toEqual(["completed", "draft", "live"]);
    expect([...PRE_LAUNCH_STATUSES]).toEqual(["draft"]);
  });

  it("CONTROL: sees every shape, starting with a line from the seed as it was on 13 Nov", () => {
    // scripts/seed-club.mjs:2150 at 7d28ea10, the Captain's Day the members' walk enters.
    expect(oldWords(`      status: "registration",`)).toEqual([`written: status: "registration"`]);
    expect(oldWords(`await event("winter", "Winter Cup", { offset: 10, status: "registration" });`)).toHaveLength(1);
    expect(oldWords(`data: { status: "ready" }`)).toHaveLength(1);
    expect(oldWords(`eventBand({ eventStatus: "registration", regState })`)).toHaveLength(1);
    expect(oldWords(`if (state.event.status === "ready") return;`)).toHaveLength(1);
    expect(oldWords(`const launched = stage.f.status !== "draft" && stage.f.status !== "registration";`)).toHaveLength(1);
    expect(oldWords(`if ("registration" === event.status) go();`)).toHaveLength(1);
    expect(oldWords(`where: { status: { in: ["live", "registration"] } }`)).toHaveLength(1);
    expect(oldWords(`export const PRE_LAUNCH_STATUSES = ["draft", "registration", "ready"];`)).toHaveLength(1);
    expect(oldWords(`expect(open1?.status, "no tournament taking entries").toBe("registration");`)).toHaveLength(1);
    expect(oldWords(`UPDATE "Event" SET x = 1 WHERE "status" IN ('registration', 'ready')`)).toHaveLength(1);
    expect(oldWords(`select * from "Event" where status = 'ready'`)).toHaveLength(1);
  });

  it("CONTROL: never mistakes the same word in another column or another thing", () => {
    for (const fine of [
      `playerCountMode: "registration",`,
      `f.playerCountMode === "registration"`,
      `const session = await requireScreen("registration");`,
      `{ key: "registration", label: "Entries", href: "/registration" }`,
      `kind: "registration",`,
      `const connected = view.handicap.status === "ready";`,
      `{view.scores.enabled && view.scores.status !== "ready" && (`,
      `return policy === "club" || connectionStatus === "ready";`,
      `if (statusOf(credential) !== "ready") {`,
      `expect((await roundCardLines(eventId))[0].status).toBe("ready");`,
      `legacyStatus: "registration",`,
      `status: "draft",`,
      `const RETIRED_BY_A045 = ["ready", "registration"];`,
      `// status: "registration" was the old seed`,
    ]) {
      expect(oldWords(readSourceOf(fine)), fine).toEqual([]);
    }
  });

  it("has files to sweep in every place code is written (a sweep of nothing finds nothing)", () => {
    for (const dir of ["src/", "scripts/", "e2e/"]) {
      expect(FILES.filter((f) => f.startsWith(dir)).length, dir).toBeGreaterThan(dir === "src/" ? 500 : 20);
    }
    for (const f of Object.keys(ALLOWED)) expect(FILES, `${f} is allowed but not on disk`).toContain(f);
  });

  it("finds no old word as a tournament's status anywhere else", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (ALLOWED[file]) continue;
      for (const hit of oldWords(readSource(file))) offenders.push(`${file} — ${hit}`);
    }
    expect(
      offenders,
      `a tournament in a word A045 retired (state machine PR 8). Write "draft" — and registrationOpen: true where ` +
        `members must see it before launch — or ask the machine:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

/** The control's text read the way a file is: comments out, as `readSource` does it. */
function readSourceOf(text: string): string {
  return text.replace(/\/\/.*$/gm, "");
}
