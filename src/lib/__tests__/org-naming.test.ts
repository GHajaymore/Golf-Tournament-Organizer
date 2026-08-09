import { describe, it, expect } from "vitest";
import { newOrganizationName } from "../org-naming";

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
