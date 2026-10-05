import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A CONTROL THAT SAVES ITSELF SAYS THAT IT HAS (2026-10-05).
 *
 * A box that saves when it is left has no Save button to press and nothing to
 * look at afterwards. `SaveState.tsx` states the rule — "three states, in the
 * same corner, every time" — and ten components that saved this way followed
 * none of it. One of them cost a knockout result on CI: the margin under a
 * bracket match was typed, the box was left, the next screen opened before
 * the save landed, and "1 UP" was never kept. An organizer does exactly that.
 *
 * Swept from the FILESYSTEM, so a component written next month is held to the
 * same rule the day it is added: anything with a blur handler that can reach a
 * server action must show a save state (`SaveState`, or a `role="status"` of
 * its own). The few that blur for another reason are named below with why.
 */

const DIR = join("src", "components");

/** Blur handlers that do not save — and what they do instead. */
const EXEMPT: Record<string, string> = {
  "CoursePicker.tsx": "blur closes the list; the choice is saved by its caller",
  "EventSetupClient.tsx": "blur looks a zip up; the event is saved by its own Save button",
  "FlightBoard.tsx": "blur abandons a rename; Enter is what saves it",
  "NewMatchForm.tsx": "blur closes the name suggestions; the round is saved by Start",
};

const components = readdirSync(join(process.cwd(), DIR)).filter((f) => f.endsWith(".tsx"));

const selfSaving = components.filter((f) => {
  const src = readSource(DIR, f);
  return /onBlur=\{/.test(src) && /from "@\/app\/actions\//.test(src);
});

describe("controls that save themselves say so", () => {
  it("finds them at all — the control: an empty sweep proves nothing", () => {
    for (const known of ["CutControl.tsx", "PrizesClient.tsx", "BracketClient.tsx", "CasualRoundPanel.tsx"]) {
      expect(selfSaving).toContain(known);
    }
  });

  for (const f of components) {
    it(`${f}`, () => {
      if (!selfSaving.includes(f) || EXEMPT[f]) return;
      const src = readSource(DIR, f);
      expect(
        /<SaveState\b|role="status"/.test(src),
        `${f} saves when a field is left and never says whether it did — show <SaveState status={useSaveStatus(pending)} />`,
      ).toBe(true);
    });
  }

  it("names nothing exempt that has stopped needing it", () => {
    for (const f of Object.keys(EXEMPT)) {
      expect(selfSaving, `${f} is exempt but no longer blurs onto a server action — drop it from the list`).toContain(f);
    }
  });
});
