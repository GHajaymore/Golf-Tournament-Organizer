import { describe, it, expect } from "vitest";
import { newOrganizationName, organizationWasNamed } from "../org-naming";

/**
 * The name a brand-new organization takes on someone's first tournament.
 *
 * The decision that matters: when an organizer says who runs the event, the
 * organization is named after the club — not the person — so a club's
 * tournaments read under the club. When they don't, nothing changes from the
 * behaviour before the field existed.
 */
describe("newOrganizationName", () => {
  it("uses the club/society name when the organizer gave one", () => {
    expect(newOrganizationName("Cedar Dunes Golf Club", "Ada Organizer", "ada@example.com")).toBe(
      "Cedar Dunes Golf Club",
    );
  });

  it("falls back to the person's name when no org name is given", () => {
    expect(newOrganizationName("", "Ada Organizer", "ada@example.com")).toBe("Ada Organizer");
    expect(newOrganizationName(undefined, "Ada Organizer", "ada@example.com")).toBe("Ada Organizer");
    expect(newOrganizationName(null, "Ada Organizer", "ada@example.com")).toBe("Ada Organizer");
  });

  it("trims surrounding whitespace, and treats a blank org name as none", () => {
    expect(newOrganizationName("  Cedar Dunes  ", "Ada", "ada@example.com")).toBe("Cedar Dunes");
    expect(newOrganizationName("   ", "Ada Organizer", "ada@example.com")).toBe("Ada Organizer");
  });

  it("uses the email only when both names are empty", () => {
    expect(newOrganizationName("", "   ", "ada@example.com")).toBe("ada@example.com");
  });
});

/**
 * Whether the organizer NAMED it, as against the app deriving one.
 *
 * Since sign-up creates the organization, the name column is never empty —
 * every organization is born called after the person. A setup checklist asking
 * "is it named?" of the column would tick the step for a club called "Ada
 * Organizer", which is the one thing on that screen definitely still to do.
 */
describe("organizationWasNamed", () => {
  it("is false while the name is still the one the app derived", () => {
    expect(organizationWasNamed("Ada Organizer", "Ada Organizer", "ada@example.com")).toBe(false);
    // The email fallback, for somebody who signed up with a blank name.
    expect(organizationWasNamed("ada@example.com", "", "ada@example.com")).toBe(false);
  });

  it("is true once it is called something of its own", () => {
    expect(organizationWasNamed("Cedar Dunes Golf Club", "Ada Organizer", "ada@example.com")).toBe(true);
  });

  it("is false for a name that is blank or only whitespace", () => {
    expect(organizationWasNamed("", "Ada Organizer", "ada@example.com")).toBe(false);
    expect(organizationWasNamed("   ", "Ada Organizer", "ada@example.com")).toBe(false);
  });

  it("ignores surrounding whitespace rather than reading it as a new name", () => {
    // Otherwise re-saving the settings form without touching the field would
    // tick the step.
    expect(organizationWasNamed("  Ada Organizer  ", "Ada Organizer", "ada@example.com")).toBe(false);
  });

  it("agrees with what newOrganizationName would have produced", () => {
    // The two must not drift: this asks "is it still the fallback?", so the
    // fallback has to be the same one.
    const derived = newOrganizationName(null, "Ada Organizer", "ada@example.com");
    expect(organizationWasNamed(derived, "Ada Organizer", "ada@example.com")).toBe(false);
  });
});
