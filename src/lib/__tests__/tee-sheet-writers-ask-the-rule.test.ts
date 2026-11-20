import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY WRITER OF A TEE SHEET ASKS THE ONE RULE (J12, state machine PR 7c).
 *
 * `teeSheetChangeAllowed` (`domain/tee-sheet-change.ts`) is the one answer to "may
 * this round's sheet be changed now"; its door is `teeSheetVerdictFor`
 * (`services/tee-sheet-change.ts`). A server action is a public endpoint, so a
 * writer written LATER that skips it reopens a completed tournament's sheet without
 * a screen ever showing it. The shape is banned, not the spelling: any exported
 * action whose body writes `Stage.teeSheet` or `Stage.teeSheetPublished` must ask
 * the door BEFORE its first write, and none may ask the setup lock or the field
 * rule's "place-in-group" in its stead (a second answer to the same question).
 */

const ACTIONS = join(process.cwd(), "src", "app", "actions");

/** Every exported async function in a source string, with its body. */
function exported(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = /export async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const next = src.indexOf("\nexport ", m.index + 1);
    out.push({ name: m[1], body: src.slice(m.index, next === -1 ? undefined : next) });
  }
  return out;
}

/** A Stage write whose data names the sheet: `stage.update` / `updateMany`, on prisma or a transaction. */
const WRITES_SHEET = /\b(?:prisma|tx)\.stage\.update(?:Many)?\(\s*\{[^]*?data:\s*\{[^}]*\bteeSheet(?:Published)?\b/;

/** Names of the exported actions in `src` that write a sheet without asking the door first, or that ask another answer. */
export function sheetWritersThatSkipTheRule(src: string): string[] {
  const bad: string[] = [];
  for (const f of exported(src)) {
    const write = WRITES_SHEET.exec(f.body);
    if (!write) continue;
    const asks = f.body.search(/await teeSheetVerdictFor\(/);
    const second = /assertUnlocked\(|isSetupLocked\(|lockedRefusal\(|"place-in-group"/.test(f.body);
    if (asks === -1 || asks > write.index || second) bad.push(f.name);
  }
  return bad;
}

describe("every tee-sheet writer asks the one rule", () => {
  const files = readdirSync(ACTIONS).filter((f) => f.endsWith(".ts"));

  it("no exported action writes a sheet without asking teeSheetVerdictFor first", () => {
    const found = files.flatMap((f) => sheetWritersThatSkipTheRule(readSource("src", "app", "actions", f)).map((n) => `${f}: ${n}`));
    expect(found).toEqual([]);
  });

  it("the five known writers are all seen (so the sweep is not passing on nothing)", () => {
    const seen = exported(readSource("src", "app", "actions", "tee-sheet.ts"))
      .filter((f) => WRITES_SHEET.test(f.body))
      .map((f) => f.name)
      .sort();
    expect(seen).toEqual(["moveInTeeSheet", "placeInTeeGroup", "replaceInTeeSheet", "saveTeeSheet", "setTeeSheetPublished"]);
  });

  it("CONTROL: a writer that skips the rule is seen", () => {
    const skips = `export async function sneakySave(stageId: string) {\n  const session = await requireStaffSession();\n  await prisma.stage.update({ where: { id: stageId }, data: { teeSheet: "{}" } });\n}\n`;
    expect(sheetWritersThatSkipTheRule(skips)).toEqual(["sneakySave"]);
  });

  it("CONTROL: a writer that asks after writing, or asks the field rule instead, is seen", () => {
    const late = `export async function lateAsk(stageId: string) {\n  await prisma.stage.updateMany({ where: { id: stageId }, data: { teeSheetPublished: true } });\n  await teeSheetVerdictFor(e, stageId, { kind: "publish" });\n}\n`;
    const other = `export async function oldRule(stageId: string) {\n  await fieldRefusal(e, "place-in-group");\n  await teeSheetVerdictFor(e, stageId, { kind: "move" });\n  await prisma.stage.updateMany({ where: { id: stageId }, data: { teeSheet: "{}" } });\n}\n`;
    expect(sheetWritersThatSkipTheRule(late)).toEqual(["lateAsk"]);
    expect(sheetWritersThatSkipTheRule(other)).toEqual(["oldRule"]);
  });

  it("CONTROL: a writer that asks first is passed", () => {
    const ok = `export async function goodSave(stageId: string) {\n  const v = await teeSheetVerdictFor(e, stageId, { kind: "save", publish: false });\n  await prisma.stage.update({ where: { id: stageId }, data: { teeSheet: "{}" } });\n}\n`;
    expect(sheetWritersThatSkipTheRule(ok)).toEqual([]);
  });
});
