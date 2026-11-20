import { describe, it, expect } from "vitest";
import { landingAfterCreate } from "@/lib/domain/after-create";
import { readSource } from "./source";

// Every form that makes a tournament: the first-event form, the Tournaments screen, Copy last event.
const CREATE_PATHS: { file: string[]; kinds: string[] }[] = [
  { file: ["src", "components", "CreateFirstTournament.tsx"], kinds: ['landingAfterCreate("created")', 'landingAfterCreate("copied")'] },
  { file: ["src", "components", "EventSwitcher.tsx"], kinds: ['landingAfterCreate(copyId ? "copied" : "created")'] },
  { file: ["src", "components", "CopyLastEvent.tsx"], kinds: ['landingAfterCreate("copied")'] },
];

describe("the create ends where entries are opened", () => {
  it("a new tournament lands on Entries, a copy on the dashboard", () => {
    expect(landingAfterCreate("created")).toBe("/registration");
    expect(landingAfterCreate("copied")).toBe("/dashboard");
  });

  for (const p of CREATE_PATHS) {
    it(`${p.file[2]} navigates through it and never hard-codes the dashboard`, () => {
      const src = readSource(...p.file);
      for (const k of p.kinds) expect(src).toContain(k);
      expect(src).not.toMatch(/router\.push\("\/dashboard"\)/);
    });
  }
});
