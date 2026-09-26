import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { entryDatesOf, registrationStatus } from "@/lib/registration";
import { readSource } from "./source";

/**
 * AN ENTRY DEADLINE IS WRITTEN THE WAY THE CLUB WRITES A DATE.
 *
 * Walked as a member of the seeded Scottish club (en-GB) on 2026-09-26: one
 * Events card read "24 Oct 2026" for the tournament and, beneath it, "Entries
 * open Sep 19, 2026 · close Oct 17, 2026" — the event's date in the club's
 * words and its deadline in American ones. Same on the public sign-up page and
 * the organizer's Registration screen: ten calls to `formatDeadline` passed no
 * locale and fell back to en-US.
 */
describe("the entry window, in the club's locale", () => {
  it("is day-first for a British club", () => {
    const line = entryDatesOf("2026-09-19", "2026-10-17", "registration", "en-GB");
    expect(line).toMatch(/19 Sept? 2026/);
    expect(line).toMatch(/17 Oct 2026/);
  });

  it("is month-first for an American one (control)", () => {
    expect(entryDatesOf("2026-09-19", "2026-10-17", "registration", "en-US")).toMatch(/Oct 17, 2026/);
  });

  it("carries through to the status sentences", () => {
    const s = registrationStatus({
      eventStatus: "registration",
      deadline: "2026-01-05",
      opens: "",
      capacity: 0,
      confirmedCount: 0,
      override: null,
      now: new Date("2026-02-01T12:00:00Z"),
      locale: "en-GB",
    });
    expect(s.detail).toMatch(/5 Jan 2026 deadline has passed/);
  });
});

/**
 * THE CLASS, SWEPT: no call site drops the locale. A new screen that calls
 * `formatDeadline(x)` would bring the American date straight back, on one
 * card, and no single-screen test would notice.
 */
describe("every formatDeadline call passes a locale", () => {
  const root = join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__tests__") walk(full);
      } else if (/\.(ts|tsx)$/.test(name)) files.push(full);
    }
  };
  walk(root);
  // One argument, no comma: `formatDeadline(x)`.
  const bare = /formatDeadline\([^,()]*\)/;

  it("the pattern catches a bare call (control)", () => {
    expect(bare.test("closes ${formatDeadline(regDeadline)}")).toBe(true);
    expect(bare.test("closes ${formatDeadline(regDeadline, locale)}")).toBe(false);
  });

  it("finds none in the source", () => {
    const offenders = files
      .map((f) => relative(process.cwd(), f).split("\\").join("/"))
      .filter((rel) => bare.test(readSource(rel)));
    expect(offenders).toEqual([]);
  });
});
