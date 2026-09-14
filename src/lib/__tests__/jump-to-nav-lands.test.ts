import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY "JUMP TO" LINK LANDS ON SOMETHING.
 *
 * `SettingsNav` renders a row of in-page anchors for a screen too long to see
 * the whole of — Club settings at 11,000px, and now Tournament details at
 * ~6,300px. The links are built from a `sections` array; the targets are
 * `id`s on the sections themselves. Nothing connects the two but a matching
 * string.
 *
 * So a section renamed, removed, or reordered leaves a link that scrolls
 * nowhere. It does not throw, it does not log, and it does not look broken
 * until somebody clicks it and the page sits still — which reads as the app
 * being unresponsive rather than as a dead link.
 *
 * Swept from the filesystem rather than a list of two, so a third screen that
 * grows a nav is covered the day it does.
 */

function screensWithANav(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(p);
      } else if (/[\\/]page\.tsx$/.test(p) && /<SettingsNav\b/.test(readSource(p))) {
        out.push(p);
      }
    }
  };
  walk("src");
  return out;
}

const screens = screensWithANav();

describe("a jump-to nav lands on a real section", () => {
  it("finds the screens that have one — the sweep's own control", () => {
    /**
     * Without this, a renamed component makes "every link lands" true and
     * meaningless. Both are named because both are real: the nav was built
     * for Club settings and Tournament details is its second reader.
     */
    const names = screens.map((f) => f.replace(/\\/g, "/"));
    expect(names, "no screen renders a SettingsNav — the sweep is broken").toEqual(
      expect.arrayContaining([
        expect.stringContaining("organization/page.tsx"),
        expect.stringContaining("event/page.tsx"),
      ]),
    );
  });

  it.each(screens)("%s offers no link that scrolls nowhere", (screen) => {
    const src = readSource(screen);

    /**
     * The ids the nav will render, read out of the `sections` literal. Every
     * screen writes it the same way — `{ id: "money", label: "Money" }` —
     * because they share the `SettingsSection` type.
     */
    const listed = [...src.matchAll(/\{\s*id:\s*"([^"]+)",\s*label:/g)].map((m) => m[1]);
    expect(listed.length, "no sections listed — the nav would render empty").toBeGreaterThan(1);

    /**
     * And the ids that actually exist on the page: the anchor helper, or a
     * bare `<section id>` for the one screen that opens with a section of its
     * own before the helper was written.
     */
    const anchored = new Set([
      ...[...src.matchAll(/<SettingsSectionAnchor id="([^"]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]),
    ]);

    const dead = listed.filter((id) => !anchored.has(id));
    expect(dead, "these are offered by the nav and exist nowhere on the page").toEqual([]);
  });

  /**
   * AND NO LINK OFFERS THE PAGE YOU ARE ALREADY ON.
   *
   * `SettingsNav` is headed "On this page", so every chip is a promise about
   * what you will see when you land. A chip carrying the screen's OWN name
   * breaks that twice over: it answers "where does this go?" with "here", and
   * because the page title is not a heading inside any section, it names
   * something the reader will not find when they arrive.
   *
   * `/event` had exactly this — `{ id: "details", label: "Tournament details" }`
   * under an `<h1>` reading "Tournament details", scrolling to a card headed
   * "Tournament identity". Reported 2026-09-14 by somebody looking at the
   * screen; nothing in a 5,600-test suite could see it, because every id
   * matched an anchor and the link worked perfectly.
   *
   * The screen's own name comes from `screenName`, which reads `NAV` — the one
   * source for what a screen is called. So this compares the labels against
   * the sidebar rather than against a second list of page titles, and a screen
   * renamed in the sidebar is still covered.
   */
  it.each(screens)("%s offers no link named after the screen itself", async (screen) => {
    const src = readSource(screen);
    const labels = [...src.matchAll(/\{\s*id:\s*"[^"]+",\s*label:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length, "no sections listed — nothing to check").toBeGreaterThan(1);

    /** `src/app/(app)/event/page.tsx` -> `/event`, which is what NAV keys on. */
    const route = "/" + screen.replace(/\\/g, "/").replace(/^src\/app\/\([a-z]+\)\//, "").replace(/\/page\.tsx$/, "");
    const { screenName } = await import("@/lib/nav");
    const pageName = screenName(route);
    expect(pageName, `no NAV entry for ${route} — the comparison would be vacuous`).toBeTruthy();

    expect(
      labels,
      `a jump-to link is named "${pageName}", which is this screen's own name — ` +
        `it points at the page the reader is already on. Name the section instead.`,
    ).not.toContain(pageName);
  });

  it.each(screens)("%s anchors nothing the nav does not offer", (screen) => {
    /**
     * THE OTHER DIRECTION, which is the quieter fault. An anchored section
     * the nav does not list is a part of the page that cannot be reached from
     * the one control whose entire job is saying what the page contains — and
     * unlike a dead link, nothing ever looks wrong.
     */
    const src = readSource(screen);
    const listed = new Set([...src.matchAll(/\{\s*id:\s*"([^"]+)",\s*label:/g)].map((m) => m[1]));
    const anchored = [...src.matchAll(/<SettingsSectionAnchor id="([^"]+)"/g)].map((m) => m[1]);
    const unlisted = anchored.filter((id) => !listed.has(id));
    expect(unlisted, "these sections exist but the nav does not offer them").toEqual([]);
  });
});

/**
 * AND A LINK FROM ANOTHER SCREEN LANDS ON ONE TOO.
 *
 * A fragment that matches nothing does not throw and does not log. The browser
 * simply stays where it is, which reads as the link being broken or the app
 * being unresponsive.
 *
 * Swept rather than listed, so the next cross-screen anchor is covered the day
 * somebody writes it.
 *
 * THERE ARE NONE TODAY, and that is not the sweep failing. The one instance
 * this was written for — `EventContextBar`'s "Switch event" pointing at
 * `/event#tournaments` — has become a plain `/tournaments` link, because the
 * switcher got its own screen rather than a fragment on the configuration
 * screen that happened to hold it.
 *
 * So the control below cannot name an instance, and a sweep with no instances
 * and no control is decoration. It controls the INSTRUMENT instead: the same
 * matcher is run over a sample that is known to contain one, in the same run
 * that reports zero for `src`. If the pattern is ever broken — the escape
 * trap this repo has been bitten by three times — that goes red while the
 * count stays comfortingly at zero.
 */
describe("a link to another screen's section lands on it", () => {
  /** `/event` -> the file that renders it, route groups and all. */
  function pageFor(route: string): string | null {
    const candidates = [
      join("src", "app", "(app)", route, "page.tsx"),
      join("src", "app", "(player)", route, "page.tsx"),
      join("src", "app", route, "page.tsx"),
    ];
    for (const c of candidates) {
      try {
        readSource(c);
        return c;
      } catch {
        // Not this shape; try the next.
      }
    }
    return null;
  }

  /** The matcher itself, so the control below can run it over a known sample. */
  function linksIn(src: string, from: string): Array<{ from: string; route: string; id: string }> {
    return [...src.matchAll(/href="\/([a-z-]+)#([A-Za-z0-9_-]+)"/g)].map((m) => ({
      from,
      route: m[1],
      id: m[2],
    }));
  }

  function hashLinks(): Array<{ from: string; route: string; id: string }> {
    const out: Array<{ from: string; route: string; id: string }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(p);
        } else if (/\.tsx?$/.test(p)) {
          out.push(...linksIn(readSource(p), p));
        }
      }
    };
    walk("src");
    return out;
  }

  const links = hashLinks();

  it("recognises a cross-screen anchor when it sees one — the sweep's own control", () => {
    /**
     * `src` holds none of these today, so there is nothing real to name. What
     * can still be proved is that the instrument works: hand it a line in the
     * exact shape a screen would write, and a sweep reporting zero is then a
     * fact about the app rather than about a regex that matches nothing.
     */
    const found = linksIn(`<Link href="/event#scoring">Scoring</Link>`, "sample.tsx");
    expect(found, "the matcher no longer recognises a cross-screen anchor").toEqual([
      { from: "sample.tsx", route: "event", id: "scoring" },
    ]);
  });

  /**
   * `it.each([])` registers nothing, which is the vacuous pass this file is
   * otherwise careful about — so say out loud that there are none, and let the
   * control above be what proves the sweep still works.
   */
  if (links.length === 0) {
    it("finds no cross-screen anchors in src, which is the current answer", () => {
      expect(links).toEqual([]);
    });
  } else {
    it.each(links)("$from -> /$route#$id exists", ({ route, id }) => {
      const page = pageFor(route);
      expect(page, `no page renders /${route}`).not.toBeNull();
      const src = readSource(page!);
      const anchored =
        new RegExp(`<SettingsSectionAnchor id="${id}"`).test(src) ||
        new RegExp(`<section id="${id}"`).test(src) ||
        new RegExp(`id="${id}"`).test(src);
      expect(anchored, `/${route} has no element with id="${id}"`).toBe(true);
    });
  }
});
