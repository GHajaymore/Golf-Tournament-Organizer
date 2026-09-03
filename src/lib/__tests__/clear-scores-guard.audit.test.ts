import "dotenv/config";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Clearing a round's scores is an admin act, it refuses approved cards, and it
 * leaves a record.
 *
 * F1 of the 2026-09-02 exploratory audit. `clearRoundScores` deleted every card
 * in a round — including ones the committee had APPROVED, which the schema
 * calls the moment a card "is a result" — at assistant level, with no status
 * check and no audit row. `approvedBy` and `approvedAt` went with the row.
 *
 * The control's own copy says the round "can simply be scored again". It
 * cannot: re-entering the strokes does not restore who approved them or when,
 * and nothing anywhere recorded that the clearing happened. A round that has
 * been wiped looks exactly like a round nobody has played.
 *
 * Meanwhile `reopenScorecard`, which moves ONE card back a step and destroys
 * nothing, is admin-only. The dangerous door was the open one.
 *
 * ASSERTED BY READING THE SOURCE, deliberately. The behavioural version needs a
 * session with a role attached — `requireAdminEvent` reads the signed cookie —
 * and building one only proves the test harness can forge a session. What is
 * worth pinning is that the three guards are present and in the right order,
 * because each was absent and each has a different consequence.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const src = readFileSync(
  join(process.cwd(), "src", "app", "actions", "tournament.ts"),
  "utf8",
);

/** The body of clearRoundScores, so neighbouring actions cannot satisfy a match. */
const body = (() => {
  const from = src.indexOf("export async function clearRoundScores");
  expect(from, "clearRoundScores should exist").toBeGreaterThan(-1);
  const to = src.indexOf("\nexport ", from + 10);
  return src.slice(from, to > from ? to : undefined);
})();

describe("clearRoundScores", () => {
  it("is admin-only, like every other door that destroys a result", () => {
    // It took `requireStaffEvent`, which admits an assistant.
    expect(body).toMatch(/const eventId = await requireAdminEvent\(\)/);
    expect(body).not.toMatch(/requireStaffEvent/);
  });

  it("refuses when the committee has approved a card", () => {
    expect(body).toMatch(/status: "approved"/);
    expect(body).toMatch(/approved > 0/);
  });

  it("refuses OUTRIGHT rather than clearing the rest", () => {
    /**
     * Skipping the approved cards and clearing the others would leave a
     * half-erased round — some players with results, some without, and no
     * record of which — which is a state a committee cannot defend. The refusal
     * returns before anything is deleted.
     */
    const refusalAt = body.indexOf("approved > 0");
    const firstDeleteAt = body.indexOf("deleteMany");
    expect(refusalAt).toBeGreaterThan(-1);
    expect(firstDeleteAt).toBeGreaterThan(-1);
    expect(refusalAt, "the approved check must come before any delete").toBeLessThan(firstDeleteAt);
    // And it reports nothing cleared, so a caller cannot read it as partial success.
    expect(body).toMatch(/ok: false,\s*\r?\n?\s*cleared: 0,/);
  });

  it("says how to proceed rather than only saying no", () => {
    // A refusal with no route forward is a dead end; reopening a card is one
    // click away and is itself audited.
    expect(body).toMatch(/Reopen (it|them) first/);
  });

  it("writes an audit line when it does clear something", () => {
    expect(body).toMatch(/logAudit\(/);
    expect(body).toMatch(/clear-round-scores/);
  });

  it("audits AFTER the deletes, so the count is what happened", () => {
    const lastDeleteAt = body.lastIndexOf("deleteMany");
    const auditAt = body.indexOf("logAudit(");
    expect(auditAt).toBeGreaterThan(lastDeleteAt);
  });

  it("does not write an audit line for a no-op", () => {
    // An audit log that records nothing happening is one people stop reading.
    expect(body).toMatch(/if \(cleared > 0\) \{/);
  });
});

describe("the neighbouring door it was inconsistent with", () => {
  it("reopenScorecard is still admin-only", () => {
    // The comparison that made the gap obvious: moving one card back a step
    // needed admin, while erasing the whole round did not.
    const reopen = src.slice(src.indexOf("export async function reopenScorecard"));
    expect(reopen.slice(0, 400)).toMatch(/requireAdminEvent\(\)/);
  });
});
