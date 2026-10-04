import { describe, it, expect } from "vitest";
import { reviewsScores } from "@/lib/tournament-shape";
import { reviewedStatus } from "@/components/ScoreEntryClient";
import { readSource } from "./source";

/**
 * NO REVIEW FOR A CASUAL ROUND (Ajay, 2026-10-04). The queue half is pinned
 * against real rows in `review-queue.audit.test.ts`; this pins the rule and
 * the screens that read it.
 */
describe("reviewsScores", () => {
  it("is false for a casual round and true for every tournament shape", () => {
    expect(reviewsScores("match")).toBe(false);
    for (const shape of ["series", "single", "knockout", "", null, undefined]) {
      expect(reviewsScores(shape), String(shape)).toBe(true);
    }
  });
});

describe("what score entry's labels read", () => {
  it("reads a casual round's pending result as final, and keeps a raised dispute", () => {
    expect(reviewedStatus("pending", false)).toBe("confirmed");
    expect(reviewedStatus("auto-confirmed", false)).toBe("confirmed");
    expect(reviewedStatus("disputed", false)).toBe("disputed");
  });

  it("changes nothing where results are reviewed", () => {
    for (const s of ["pending", "confirmed", "auto-confirmed", "disputed"]) {
      expect(reviewedStatus(s, true)).toBe(s);
    }
  });
});

describe("the screens that ask", () => {
  it("hides the review controls and the dashboard tile on a casual round", () => {
    const entry = readSource("src", "components", "ScoreEntryClient.tsx");
    expect(entry).toContain("{reviews && activeStatus !== \"confirmed\"");
    expect(entry).toContain("{isAdmin && reviews && (");
    expect(readSource("src", "components", "EntryModes.tsx")).toContain("reviews={!casual}");
    expect(readSource("src", "app", "(app)", "dashboard", "page.tsx")).toContain(
      "isStaff && reviewsScores(state.event.shape)",
    );
  });

  it("never writes a casual result as confirmed — that would lock a mis-tapped score", () => {
    // The rule is display and queue only. `confirmed` refuses Clear until
    // reopened, and friends must be able to fix a score at any time.
    const services = readSource("src", "lib", "services", "tournament.ts");
    expect(services).toContain("reviewsScores(event.shape)");
    expect(readSource("src", "lib", "tournament-shape.ts")).not.toMatch(/scoreStatus/);
  });
});
