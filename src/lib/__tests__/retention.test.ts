import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./source";
import { retentionDecision, dueForPurge, hoursRemaining, type RetainableEvent } from "../retention";
import { retentionNotice, keepsDataForever, planFor } from "../plans";

const NOW = new Date("2026-08-06T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const ev = (over: Partial<RetainableEvent> = {}): RetainableEvent => ({
  id: "e1",
  status: "completed",
  completedAt: hoursAgo(1),
  plan: "free",
  ...over,
});

describe("what is safe from deletion", () => {
  it("never touches a paid plan", () => {
    const d = retentionDecision(ev({ plan: "club", completedAt: hoursAgo(10_000) }), NOW);
    expect(d.purge).toBe(false);
    expect(d.reason).toMatch(/indefinitely/);
    expect(keepsDataForever("club")).toBe(true);
  });

  it("never touches a tournament that is still running", () => {
    for (const status of ["draft", "registration", "ready", "live"]) {
      const d = retentionDecision(ev({ status, completedAt: hoursAgo(500) }), NOW);
      expect(d.purge, status).toBe(false);
    }
  });

  it("never touches one with no completion time recorded", () => {
    // Every tournament predating this feature has a null completedAt. Guessing
    // one from updatedAt would have made retention's first act the deletion of
    // real results.
    const d = retentionDecision(ev({ completedAt: null }), NOW);
    expect(d.purge).toBe(false);
    expect(d.reason).toMatch(/no completion time/);
  });

  it("never touches one still inside the window", () => {
    expect(retentionDecision(ev({ completedAt: hoursAgo(47) }), NOW).purge).toBe(false);
    expect(retentionDecision(ev({ completedAt: hoursAgo(0) }), NOW).purge).toBe(false);
  });
});

describe("what is due", () => {
  it("selects a free tournament past the window", () => {
    const d = retentionDecision(ev({ completedAt: hoursAgo(49) }), NOW);
    expect(d.purge).toBe(true);
    expect(d.reason).toMatch(/past the 48h window/);
  });

  it("treats the boundary as due rather than leaving it forever", () => {
    expect(retentionDecision(ev({ completedAt: hoursAgo(48) }), NOW).purge).toBe(true);
  });

  it("reports how far past the window it is", () => {
    const d = retentionDecision(ev({ completedAt: hoursAgo(58) }), NOW);
    expect(d.overdueHours).toBeCloseTo(10, 1);
  });

  it("filters a mixed set down to only what is due", () => {
    const due = dueForPurge(
      [
        ev({ id: "old-free", completedAt: hoursAgo(72) }),
        ev({ id: "recent-free", completedAt: hoursAgo(2) }),
        ev({ id: "old-paid", plan: "club", completedAt: hoursAgo(72) }),
        ev({ id: "live", status: "live", completedAt: hoursAgo(72) }),
        ev({ id: "no-stamp", completedAt: null }),
      ],
      NOW,
    );
    expect(due.map((d) => d.id)).toEqual(["old-free"]);
  });
});

describe("telling the organizer while it still matters", () => {
  it("counts down for a finished free tournament", () => {
    expect(hoursRemaining(ev({ completedAt: hoursAgo(6) }), NOW)).toBeCloseTo(42, 1);
  });

  it("floors at zero rather than going negative", () => {
    expect(hoursRemaining(ev({ completedAt: hoursAgo(100) }), NOW)).toBe(0);
  });

  it("counts down for nothing on a paid plan or an unfinished event", () => {
    expect(hoursRemaining(ev({ plan: "club" }), NOW)).toBeNull();
    expect(hoursRemaining(ev({ status: "live" }), NOW)).toBeNull();
    expect(hoursRemaining(ev({ completedAt: null }), NOW)).toBeNull();
  });
});

/**
 * THE PROMISE MAY NOT OUTRUN THE IMPLEMENTATION.
 *
 * These three tests used to pin the opposite. They required the notice to say
 * "permanently deleted" and to contain the number 48 — a faithful, well-written
 * guard on a sentence that was not true. `dueForPurge` above is fully tested
 * and has never had a caller outside this file: no cron in any workflow, none
 * in vercel.json, no route, no script. Nothing has ever been purged.
 *
 * So the tests held the copy to a behaviour nobody had built, which is the
 * failure mode this repo already knows in another form — a green cell that
 * proves the fixture, not the feature. A test can pin the wrong thing
 * perfectly.
 *
 * What is asserted now is the RELATION: while nothing purges, no surface may
 * promise that anything is deleted. Wire `dueForPurge` to something real and
 * these relax on their own — which is the point, and why the condition is
 * computed rather than written down as a boolean somebody has to remember to
 * flip.
 */
describe("the notice shown before anyone plays", () => {
  /**
   * Does anything outside the tests actually purge?
   *
   * By IMPORT, not by call shape. The first version searched for
   * `dueForPurge(` and so matched the `export function dueForPurge(`
   * declaration in retention.ts itself — it was true from the moment it was
   * written, the branch below never ran, and the guard could not fail. A
   * mutation caught it: restoring the old false promise left it green.
   *
   * Which is the fault this whole change is about, arriving in the guard
   * against it. A test that pins the wrong thing perfectly.
   */
  const importsPurge = (src: string) =>
    /import\s*\{[^}]*\bdueForPurge\b[^}]*\}\s*from/.test(stripComments(src));

  const nonTestSources = (() => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((e) => {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) return e === "__tests__" ? [] : walk(p);
        return /\.tsx?$/.test(e) ? [p] : [];
      });
    return walk(join(process.cwd(), "src"));
  })();

  const purgeIsWired = nonTestSources.some((f) => importsPurge(readFileSync(f, "utf8")));

  it("can tell a wired purge from an unwired one", () => {
    /**
     * The control, in both directions, because the detector decides whether
     * the real assertion runs at all. A detector stuck on TRUE skips the
     * check; one stuck on FALSE would fail honest code later.
     */
    expect(importsPurge(`import { dueForPurge } from "@/lib/retention";`)).toBe(true);
    expect(importsPurge(`import { retentionDecision } from "@/lib/retention";`)).toBe(false);
    // And the declaration itself must not read as a call site — the bug above.
    expect(importsPurge(`export function dueForPurge(events) { return []; }`)).toBe(false);
    // The walk found real files, so `purgeIsWired` is an answer and not an
    // artefact of looking at nothing.
    expect(nonTestSources.length).toBeGreaterThan(100);
    expect(typeof dueForPurge).toBe("function");
  });

  it("does not promise a deletion while nothing deletes", () => {
    if (purgeIsWired) return; // built since — the blunt wording is honest again
    const notice = retentionNotice("free")!;
    expect(notice, "the notice must not claim data is deleted").not.toMatch(
      /deleted|permanently|erased|destroyed/i,
    );
    // And it must not name a window either: "kept 48 hours" is the same promise
    // wearing different words.
    expect(notice).not.toMatch(new RegExp(String(planFor("free").retentionHours)));
  });

  it("still tells the club to export, which is the part that was useful", () => {
    // The old sentence did one thing right: it made a club act. Dropping the
    // false half must not drop that.
    expect(retentionNotice("free")!).toMatch(/export/i);
  });

  it("does not promise to keep it for good either", () => {
    /**
     * The other direction, and the one that is easy to miss. Replacing "we
     * delete this" with "we keep this" would be equally untrue AND would turn
     * building the purge into breaking a promise — a stopgap that quietly
     * becomes permanent. The honest word is that nothing is guaranteed.
     */
    expect(retentionNotice("free")!).toMatch(/guarantee/i);
  });

  it("says nothing on a plan that keeps data", () => {
    expect(retentionNotice("club")).toBeNull();
  });
});

describe("an explicit hold", () => {
  it("keeps a tournament the plan would otherwise delete", () => {
    const d = retentionDecision(
      ev({ completedAt: hoursAgo(500), retainUntil: new Date("2027-01-01T00:00:00Z") }),
      NOW,
    );
    expect(d.purge).toBe(false);
    expect(d.reason).toMatch(/held until 2027-01-01/);
  });

  it("stops protecting once it lapses", () => {
    // A hold is a reprieve with a date on it, not an exemption forever.
    const d = retentionDecision(
      ev({ completedAt: hoursAgo(500), retainUntil: hoursAgo(1) }),
      NOW,
    );
    expect(d.purge).toBe(true);
  });

  it("only ever extends the countdown, never shortens it", () => {
    // A hold set earlier than the plan window must not cut short a window the
    // organizer was already promised.
    const shortHold = hoursRemaining(
      ev({ completedAt: hoursAgo(1), retainUntil: new Date(NOW.getTime() + 3600_000) }),
      NOW,
    );
    const planOnly = hoursRemaining(ev({ completedAt: hoursAgo(1) }), NOW);
    expect(shortHold).toBe(planOnly);
    expect(shortHold).toBeCloseTo(47, 1);
  });

  it("extends the countdown when it reaches further out", () => {
    const far = hoursRemaining(
      ev({ completedAt: hoursAgo(1), retainUntil: new Date(NOW.getTime() + 200 * 3600_000) }),
      NOW,
    );
    expect(far).toBeCloseTo(200, 1);
  });
});
