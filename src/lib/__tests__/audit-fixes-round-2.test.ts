import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * Round-2 audit fixes that live at server-action / service sinks a unit test
 * cannot reach directly. The money ones mirror the already-audited per-round
 * sink gate (`gameNets` skips a provisional pot); these pin that the season and
 * settle-up paths carry the same gate, so a still-changeable amount is never
 * presented as settled — the core money rule.
 */
describe("skins money is gated on finality at every sink, not just per round", () => {
  const src = readSource("src/lib/services/skins-pot.ts");

  it("excludes provisional weeks from the season total", () => {
    // Without this a mid-round league night folds a still-changeable week into a
    // total the Prizes screen calls 'already settled'.
    expect(src).toContain("!w.result.provisional");
  });

  it("offers no settle-up transfers while a pot is provisional", () => {
    // A skin carries, so a 'X pays Y' list before every hole is in invites a
    // handover the last group overturns.
    expect(src).toContain("result && !result.provisional ? settle(");
  });
});

/**
 * Touch targets on the money screens clear the 44px floor. The inline
 * min-heights that used to sit here were the SAME property as `.touch-target`'s
 * coarse-pointer rule and silently beat it, leaving 40px targets a member taps
 * on the tee. Pinned as absence, which needs no comment-stripping help.
 */
describe("on-course tap targets are not shrunk below the floor by an inline min-height", () => {
  it("PersonChip does not pin a sub-44 min-height inline", () => {
    expect(readSource("src/components/PersonChip.tsx")).not.toMatch(/minHeight:\s*4[0-3]\b/);
  });
  it("the money pot-entry buttons do not pin a sub-44 min-height inline", () => {
    expect(readSource("src/components/MoneyClient.tsx")).not.toMatch(/minHeight:\s*4[0-3]\b/);
  });
});
