import { describe, it, expect } from "vitest";
import { consoleUrl } from "@/lib/console-url";

describe("consoleUrl", () => {
  it("preview adds the stepper query only", () => {
    expect(consoleUrl("/events/e1/stages", "preview")).toBe("/events/e1/stages?stepper=1");
  });

  it("build adds both queries", () => {
    expect(consoleUrl("/events/e1/stages", "build")).toBe("/events/e1/stages?stepper=1&build=1");
  });

  it("keeps the path's own query", () => {
    expect(consoleUrl("/events/e1/stages?round=r2", "build")).toBe("/events/e1/stages?round=r2&stepper=1&build=1");
  });

  it("keeps a hash, after the query", () => {
    expect(consoleUrl("/events/e1/stages?round=r2#cards", "preview")).toBe("/events/e1/stages?round=r2&stepper=1#cards");
    expect(consoleUrl("/events/e1#top", "build")).toBe("/events/e1?stepper=1&build=1#top");
  });

  it("a menu link keeps the preview, before a place on the screen (moved from the nav tests, R1b)", () => {
    expect(consoleUrl("/dashboard", "preview")).toBe("/dashboard?stepper=1");
    expect(consoleUrl("/stages?round=r1", "preview")).toBe("/stages?round=r1&stepper=1");
    expect(consoleUrl("/event#courses", "preview")).toBe("/event?stepper=1#courses");
  });

  it("already previewing is not doubled", () => {
    expect(consoleUrl("/stages?round=r1&stepper=1", "preview")).toBe("/stages?round=r1&stepper=1");
    expect(consoleUrl("/event?stepper=1#courses", "preview")).toBe("/event?stepper=1#courses");
  });

  it("does not double a query already there, and preview drops build", () => {
    expect(consoleUrl("/x?stepper=1&build=1", "build")).toBe("/x?stepper=1&build=1");
    expect(consoleUrl("/x?stepper=1&build=1", "preview")).toBe("/x?stepper=1");
  });
});
