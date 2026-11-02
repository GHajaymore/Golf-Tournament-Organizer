import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsTabs, SettingsTabPanel } from "@/components/SettingsTabs";
import { readsAsRefusal, tabAfterKey, tabFromHash } from "@/lib/settings-tabs";
import { readSource } from "./source";

/**
 * CLUB SETTINGS, ONE SECTION AT A TIME (Ajay, 2026-10-21: "go with your
 * recommendations and change the structure as needed").
 *
 * What these hold, and why each matters on this screen in particular:
 *
 *   - the tabs are TABS to a screen reader — a tablist, tabs that say which is
 *     chosen and which panel each controls, panels named by their tab;
 *   - every section is IN THE PAGE, the hidden ones carrying `hidden`: a
 *     section that unmounted would throw away an unsaved draft without a word,
 *     which is the reason the screen was not folded up before;
 *   - the hash picks the tab, and a hash the screen does not know is the first.
 *
 * What a render cannot see — a tap, a draft surviving a round trip, a link
 * changing the hash — is walked in `e2e/club-settings-tabs.spec.ts`.
 */

const SECTIONS = [
  { id: "identity", label: "Name & branding" },
  { id: "theme", label: "Colour" },
  { id: "access", label: "Staff & access", count: 2 },
];

const page = () =>
  renderToStaticMarkup(
    <SettingsTabs sections={SECTIONS} label="Club settings: sections">
      <SettingsTabPanel id="identity">
        <p>zz-the club&apos;s name</p>
      </SettingsTabPanel>
      <SettingsTabPanel id="theme">
        <input aria-label="zz-a draft" defaultValue="zz-typed, not saved" />
      </SettingsTabPanel>
      <SettingsTabPanel id="access">
        <p>zz-who may come in</p>
      </SettingsTabPanel>
    </SettingsTabs>,
  );

/** The opening tag of the element with this id. */
const tagWithId = (html: string, id: string) => {
  const m = new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(html);
  expect(m, `nothing carries id="${id}"`).not.toBeNull();
  return m![0];
};

describe("the settings tabs are tabs", () => {
  it("one tablist, named, with a tab for every section", () => {
    const html = page();
    expect(html.match(/role="tablist"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Club settings: sections"');
    expect(html.match(/role="tab"/g)).toHaveLength(SECTIONS.length);
    for (const s of SECTIONS) expect(html).toContain(s.label.replace(/&/g, "&amp;"));
  });

  it("the first is chosen, and is the one stop in the Tab order", () => {
    const html = page();
    const first = tagWithId(html, "tab-identity");
    expect(first).toContain('aria-selected="true"');
    expect(first).toContain('tabindex="0"');
    for (const id of ["theme", "access"]) {
      const tab = tagWithId(html, `tab-${id}`);
      expect(tab).toContain('aria-selected="false"');
      expect(tab).toContain('tabindex="-1"');
    }
  });

  it("each tab controls its panel, and each panel is named by its tab", () => {
    const html = page();
    for (const s of SECTIONS) {
      expect(tagWithId(html, `tab-${s.id}`)).toContain(`aria-controls="${s.id}"`);
      const panel = tagWithId(html, s.id);
      expect(panel).toContain('role="tabpanel"');
      expect(panel).toContain(`aria-labelledby="tab-${s.id}"`);
    }
  });

  it("a section with something waiting says how many, in words too", () => {
    const tab = /<a[^>]*id="tab-access"[^>]*>([\s\S]*?)<\/a>/.exec(page())![1];
    expect(tab).toContain(">2</span>");
    expect(tab).toContain("(2 waiting)");
    // CONTROL: a section with nothing waiting carries no number.
    expect(/<a[^>]*id="tab-theme"[^>]*>([\s\S]*?)<\/a>/.exec(page())![1]).not.toContain("waiting");
  });

  it("each tab is a link to its section, so a press before the script arrives still lands", () => {
    const html = page();
    for (const s of SECTIONS) expect(tagWithId(html, `tab-${s.id}`)).toContain(`href="#${s.id}"`);
  });
});

describe("a section not chosen is hidden, never unmounted", () => {
  it("every section's content is in the page from the server", () => {
    const html = page();
    // A draft lives in a section the reader is not looking at. If the panel
    // were left out of the page, the draft would go with it.
    expect(html).toContain("zz-the club&#x27;s name");
    expect(html).toContain('value="zz-typed, not saved"');
    expect(html).toContain("zz-who may come in");
  });

  it("the first section is shown and the rest carry hidden, so nothing flashes the whole page", () => {
    const html = page();
    expect(tagWithId(html, "identity")).not.toMatch(/\bhidden\b/);
    expect(tagWithId(html, "theme")).toMatch(/\bhidden=""/);
    expect(tagWithId(html, "access")).toMatch(/\bhidden=""/);
  });

  it("Club settings puts every section in a panel and draws no section only when chosen", () => {
    const src = readSource("src/app/(app)/organization/page.tsx");
    const panels = [...src.matchAll(/<SettingsTabPanel id="([^"]+)"/g)].map((m) => m[1]);
    expect(panels).toEqual(["identity", "theme", "defaults", "handicaps", "money", "plan", "access"]);
    // The heading is above the tabs, so it is on every one of them.
    expect(src.indexOf("<OrganizationHeading")).toBeGreaterThan(-1);
    expect(src.indexOf("<OrganizationHeading")).toBeLessThan(src.indexOf("<SettingsTabs"));
  });
});

describe("the hash picks the tab", () => {
  const ids = ["identity", "theme", "money", "plan"];

  it("a known hash is its section", () => {
    expect(tabFromHash("#money", ids)).toBe("money");
    expect(tabFromHash("#plan", ids)).toBe("plan");
    expect(tabFromHash("plan", ids)).toBe("plan");
  });

  it("no hash, or one the screen does not know, is the first section", () => {
    expect(tabFromHash("", ids)).toBe("identity");
    expect(tabFromHash("#", ids)).toBe("identity");
    expect(tabFromHash("#top", ids)).toBe("identity");
    expect(tabFromHash("#Money", ids), "a hash is matched exactly").toBe("identity");
    expect(tabFromHash("#money-setup", ids)).toBe("identity");
  });

  it("every address another screen links to is a section of Club settings", () => {
    // `#plan` from "Upgrade to keep it" and the billing return, `#access` from
    // the join email, `#money` from the setup checklist.
    const src = readSource("src/app/(app)/organization/page.tsx");
    const offered = [...src.matchAll(/\{\s*id:\s*"([^"]+)",\s*label:/g)].map((m) => m[1]);
    for (const id of ["plan", "access", "money"]) expect(tabFromHash(`#${id}`, offered)).toBe(id);
  });
});

describe("the arrows move along the tabs", () => {
  it("Right and Left step and wrap; Home and End go to the ends", () => {
    expect(tabAfterKey("ArrowRight", 0, 7)).toBe(1);
    expect(tabAfterKey("ArrowRight", 6, 7)).toBe(0);
    expect(tabAfterKey("ArrowLeft", 0, 7)).toBe(6);
    expect(tabAfterKey("ArrowLeft", 3, 7)).toBe(2);
    expect(tabAfterKey("Home", 4, 7)).toBe(0);
    expect(tabAfterKey("End", 1, 7)).toBe(6);
  });

  it("any other key is left alone", () => {
    for (const key of ["Enter", " ", "Tab", "ArrowDown", "a"]) expect(tabAfterKey(key, 2, 7)).toBeNull();
    expect(tabAfterKey("ArrowRight", 0, 0)).toBeNull();
  });
});

describe("what counts as a refusal, for marking a hidden tab", () => {
  it("a sentence is one", () => {
    expect(readsAsRefusal("Only an organization owner or admin can change these settings.")).toBe(true);
    expect(readsAsRefusal("Couldn't save that.")).toBe(true);
  });

  it("a figure, a word, or a wall of text is not", () => {
    expect(readsAsRefusal("-$13.34")).toBe(false);
    expect(readsAsRefusal("Required")).toBe(false);
    expect(readsAsRefusal("x ".repeat(300))).toBe(false);
  });
});
