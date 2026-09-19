import { describe, it, expect } from "vitest";
import { clubLeads, TAGLINE, type Brand } from "@/components/OrgBrand";

/**
 * WHOSE MARK LEADS THE HEADER — Ajay's decision of 2026-09-18.
 *
 * TourneyHQ first, on every screen, in its own colours, with its tagline where
 * there is room. A club's own logo replaces it only when BOTH are true: the
 * club is on a white-label (paid) plan, AND it has actually uploaded a logo.
 *
 * `showAttribution` is false on a white-label plan (set once, in
 * organization.ts, from `features.whiteLabel`).
 */
const club = (over: Partial<Brand> = {}): Brand => ({
  name: "zz-Ridgeline Golf Club",
  logoUrl: "",
  showAttribution: true,
  ...over,
});

describe("whose logo leads the header", () => {
  it("is TourneyHQ for a club on an ordinary plan, logo or not", () => {
    expect(clubLeads(club())).toBe(false);
    expect(clubLeads(club({ logoUrl: "https://example.invalid/logo.png" }))).toBe(false);
  });

  it("is the club's, on a white-label plan with a logo uploaded", () => {
    expect(clubLeads(club({ showAttribution: false, logoUrl: "https://example.invalid/logo.png" }))).toBe(true);
  });

  it("is still TourneyHQ on a white-label plan with NO logo uploaded", () => {
    // A header with no mark at all is worse than either mark.
    expect(clubLeads(club({ showAttribution: false, logoUrl: "" }))).toBe(false);
  });

  it("is TourneyHQ when there is no club at all", () => {
    expect(clubLeads(null)).toBe(false);
    expect(clubLeads(undefined)).toBe(false);
  });

  it("treats a missing plan flag as an ordinary plan, never as white-label", () => {
    // Undefined must not read as "paid" — the TourneyHQ mark is the default.
    expect(clubLeads(club({ showAttribution: undefined, logoUrl: "https://example.invalid/l.png" }))).toBe(false);
  });

  it("carries the tagline the club chose", () => {
    expect(TAGLINE).toBe("From Registration to Recognition.");
  });
});
