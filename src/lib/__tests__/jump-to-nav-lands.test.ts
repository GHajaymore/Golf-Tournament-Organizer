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
 * `EventContextBar` sits on every authenticated screen and its "Switch event"
 * link points at `/event#tournaments` — the switcher, not the top of the
 * 6,330px configuration screen that holds it. That fragment is a string in one
 * file and an `id` in another, with nothing but a matching spelling between
 * them.
 *
 * A fragment that matches nothing does not throw and does not log. The browser
 * simply stays where it is, which reads as the link being broken or the app
 * being unresponsive — and this one is on EVERY screen, so it is the most
 * pressed link in the console.
 *
 * Swept rather than listed, so the next cross-screen anchor is covered the day
 * somebody writes it.
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

  function hashLinks(): Array<{ from: string; route: string; id: string }> {
    const out: Array<{ from: string; route: string; id: string }> = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && entry.name !== "__tests__") walk(p);
        } else if (/\.tsx?$/.test(p)) {
          for (const m of readSource(p).matchAll(/href="\/([a-z-]+)#([A-Za-z0-9_-]+)"/g)) {
            out.push({ from: p, route: m[1], id: m[2] });
          }
        }
      }
    };
    walk("src");
    return out;
  }

  const links = hashLinks();

  it("finds the cross-screen anchors at all — the sweep's own control", () => {
    /**
     * One today, and naming it is what stops this passing vacuously if the
     * attribute is ever written differently. If this goes red because the
     * link moved rather than broke, point the control at wherever it went.
     */
    expect(
      links.map((l) => `/${l.route}#${l.id}`),
      "no cross-screen anchor links found — the sweep is broken",
    ).toContain("/event#tournaments");
  });

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
});
