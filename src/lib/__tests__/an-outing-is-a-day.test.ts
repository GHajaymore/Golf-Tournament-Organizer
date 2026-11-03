import { describe, it, expect } from "vitest";
import { ORG_KINDS, COMMUNITY_VOICES, orgProfile } from "@/lib/domain/org-profile";
import { navForRole } from "@/lib/nav";

/**
 * AN OUTING IS A DAY, NEVER THE OUTFIT (the panel's ruling, 2026-10-26).
 *
 * A personal organizer's console was headed "OUTING", with "Outing settings"
 * beneath it, and the Tournaments screen, the staff list and the course
 * library said "outing" for the organizer's whole golf. Ajay: "a club or
 * league/society should not be called as outing. outing is a tournament".
 *
 * So: no name an organization is given (its label, its noun in a sentence,
 * its settings page, its console section) may say "outing", for any kind, in
 * any country's words, under any name it chose for itself. Walked over every
 * cell rather than the one that was seen, with a control proving the check
 * can see the word.
 */

const COUNTRIES = ["", "US", "United States", "GB", "United Kingdom", "IE", "AU", "Australia", "NZ", "ZA", "CA"];
const VOICES = ["", ...Object.keys(COMMUNITY_VOICES), "something-unknown"];

const saysOuting = (s: string) => /\bouting/i.test(s);

describe("no organization is called an outing", () => {
  it("in its label, its noun, its settings page or its console section", () => {
    const seen: string[] = [];
    for (const kind of ORG_KINDS)
      for (const country of COUNTRIES)
        for (const voice of VOICES) {
          const p = orgProfile(kind, country, voice);
          for (const [field, value] of Object.entries({ label: p.label, noun: p.noun, settingsLabel: p.settingsLabel, groupLabel: p.groupLabel }))
            if (saysOuting(value)) seen.push(`${kind}/${country || "-"}/${voice || "-"} ${field}="${value}"`);
        }
    expect(seen).toEqual([]);
  });

  it("a personal organizer's console is 'Your golf', and its settings page is 'Settings'", () => {
    const p = orgProfile("personal", "US");
    expect(p.groupLabel).toBe("Your golf");
    expect(p.settingsLabel).toBe("Settings");
  });

  it("control: the check sees the word in the names this file was written about", () => {
    expect(saysOuting("Outing settings")).toBe(true);
    expect(saysOuting("OUTING")).toBe(true);
    expect(saysOuting("Organizer · outing")).toBe(true);
    // and leaves the event word alone where it is a day out
    expect(saysOuting("Your golf")).toBe(false);
  });
});

describe("the console's own menu never heads the organization 'outing'", () => {
  // The rule and its reader are tested apart: the sidebar once ignored the
  // profile's labels while every profile assertion stayed green.
  it("for every kind, in every country's words", () => {
    const seen: string[] = [];
    for (const kind of ORG_KINDS)
      for (const country of COUNTRIES)
        for (const section of navForRole("admin", undefined, { outfit: orgProfile(kind, country) })) {
          if (saysOuting(section.label)) seen.push(`${kind}/${country || "-"} section "${section.label}"`);
          const settings = section.items.find((i) => i.key === "organization");
          if (settings && saysOuting(settings.label)) seen.push(`${kind}/${country || "-"} item "${settings.label}"`);
        }
    expect(seen).toEqual([]);
  });
});
