import { describe, it, expect } from "vitest";
import { whereOf } from "@/lib/domain/event-where";
import { courseModeOf } from "@/lib/domain/venue";
import { readSource } from "./source";

/** Worked by hand: each row is what a club has stored, and the answer a secretary would give about it. */
describe("whereOf: where an event is played, from what is stored", () => {
  const none = { courseMode: "fixed", courseId: null, course: "" };
  it.each([
    ["nothing named, no venue", none, 0, "unset"],
    ["a blank name does not count as a course", { ...none, course: "   " }, 0, "unset"],
    ["a course named by hand", { ...none, course: "Hollins Moss" }, 0, "one"],
    ["a course picked by id", { ...none, courseId: "c1" }, 1, "one"],
    ["one venue and no name (an old row)", none, 1, "one"],
    ["two venues", { ...none, courseId: "c1" }, 2, "several"],
    ["three venues", { ...none, courseId: "c1", course: "A" }, 3, "several"],
    ["the players arrange their own", { courseMode: "open", courseId: null, course: "" }, 0, "open"],
    ["open wins over venues left from before", { courseMode: "open", courseId: "c1", course: "A" }, 2, "open"],
    ["a mode nobody recognises reads as fixed", { courseMode: "weird", courseId: "c1", course: "A" }, 1, "one"],
    ["no mode at all reads as fixed", { courseMode: null, courseId: null, course: null }, 0, "unset"],
  ] as const)("%s -> %s", (_name, event, venues, expected) => {
    expect(whereOf(event, venues)).toBe(expected);
  });

  it("asks the one reading of the open mode, and keeps no second one", () => {
    expect(courseModeOf("open")).toBe("open");
    const src = readSource("src/lib/domain", "event-where.ts");
    expect(src).toContain("courseModeOf(");
    expect(src).not.toMatch(/courseMode\s*===/);
  });
});
