import { describe, it, expect } from "vitest";
import { landingAfterCreate } from "@/lib/domain/after-create";
import { readSource } from "./source";

describe("the create ends where entries are opened", () => {
  it("a new tournament lands on Entries, a copy on the dashboard", () => {
    expect(landingAfterCreate("created")).toBe("/registration");
    expect(landingAfterCreate("copied")).toBe("/dashboard");
  });

  it("the create form navigates through it and never hard-codes the dashboard", () => {
    const src = readSource("src", "components", "CreateFirstTournament.tsx");
    expect(src).toContain('landingAfterCreate("created")');
    expect(src).toContain('landingAfterCreate("copied")');
    expect(src).not.toMatch(/router\.push\("\/dashboard"\)/);
  });
});
