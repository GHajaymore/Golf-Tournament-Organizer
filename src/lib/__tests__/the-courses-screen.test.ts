import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { cameFromPath } from "../domain/came-from";
import { COURSE_KEEPER_WORDS } from "../domain/course-words";
import { consoleScreens, isSwitchedOff } from "../../../e2e/routes";
import { SCREENS_BUILT } from "../../../e2e/console";

/**
 * THE CLUB'S COURSES SCREEN (R2): who it lets in, where it sends a person back to, and where its library
 * is mounted. The rules are the machine's (`organizationAccessFor`, `requireCourseKeeper`); these hold
 * the screen to them without a browser.
 */

describe("where a person was sent from (`?from=`)", () => {
  const OWN = "/courses";

  it("is one of the console's own addresses, and only the address comes back", () => {
    expect(cameFromPath("/stages", OWN)).toBe("/stages");
    expect(cameFromPath("/event", OWN)).toBe("/event");
    // The path's own query or place is not carried: what is returned is the known address.
    expect(cameFromPath("/stages?round=2", OWN)).toBe("/stages");
    expect(cameFromPath("/event#courses", OWN)).toBe("/event");
  });

  it("is nothing for anything that is not a screen of the console (never an open redirect)", () => {
    const refused = [
      "https://example.invalid/stages",
      "//example.invalid",
      "//example.invalid/stages",
      "/\\example.invalid",
      "javascript:alert(1)",
      "stages",
      "/stages/../organization",
      "/stages/",
      "/not-a-screen",
      "/stagesx",
      "",
      " /stages",
      "/stages".repeat(60),
    ];
    for (const from of refused) expect(cameFromPath(from, OWN), JSON.stringify(from)).toBeNull();
    expect(cameFromPath(undefined, OWN)).toBeNull();
    expect(cameFromPath(null, OWN)).toBeNull();
  });

  it("is nothing for the screen's own address (back to where you are is no way back)", () => {
    expect(cameFromPath("/courses", OWN)).toBeNull();
    expect(cameFromPath("/courses?course=x", OWN)).toBeNull();
    // CONTROL: the same address is a way back for another screen.
    expect(cameFromPath("/courses", "/event")).toBe("/courses");
  });
});

describe("the read-only banner says what the refusal behind the buttons says", () => {
  it("is the very sentence `requireCourseKeeper` refuses with", () => {
    const actions = readSource("src", "app", "actions", "courses.ts");
    expect(actions).toContain(JSON.stringify(COURSE_KEEPER_WORDS));
  });

  it("is asked of `organizationAccessFor`, the question the actions ask, and not worked out on the page", () => {
    const page = readSource("src", "app", "(app)", "courses", "page.tsx");
    expect(page).toMatch(/organizationAccessFor\(session\.email, organizationId, session\.role\)/);
    expect(page).toContain("canEdit={access.canEdit}");
    expect(page).toContain("COURSE_KEEPER_WORDS");
    expect(page).not.toMatch(/viewRole/);
  });
});

describe("the library is mounted once on each screen, and each says what it picks", () => {
  it("Courses is held to the Event screen's rule, drawn only when shown, and picks no event's course", () => {
    const page = readSource("src", "app", "(app)", "courses", "page.tsx");
    expect(page).toContain('requireOrgScreen("event")');
    expect(page).toMatch(/if \(!shown\.has\("courses"\)\) redirect\("\/event#courses"\);/);
    expect(page).toContain("eventPick={false}");
    expect(page).toMatch(/screensShownFor\(session\)/);
  });

  it("Tournament details still picks this event's courses", () => {
    const page = readSource("src", "app", "(app)", "event", "page.tsx");
    expect(page).toMatch(/<CourseLibrary[\s\S]*?\beventPick\b[\s\S]*?\/>/);
    expect(page).not.toContain("eventPick={false}");
  });

  it("no third screen mounts the library", () => {
    const mounts: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(name) && !p.includes("__tests__")) {
          const rel = p.split(/[\\/]/).slice(-6).join("/");
          if (/<CourseLibrary\b/.test(readSource(...p.slice(process.cwd().length + 1).split(/[\\/]/)))) mounts.push(rel);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(mounts.map((m) => m.split("/").slice(-2).join("/")).sort()).toEqual(["courses/page.tsx", "event/page.tsx"]);
  });
});

describe("the new address is held out of the live-screen sweeps while its switch is off", () => {
  it("`/courses` is a screen of its own, built at its address and not walked as a live one", () => {
    expect(SCREENS_BUILT.courses).toBe("/courses");
    expect(consoleScreens()).not.toContain("/courses");
  });

  it("CONTROL: a screen that merely chooses by the switch, or redirects for another reason, stays swept", () => {
    expect(consoleScreens()).toContain("/event");
    expect(isSwitchedOff('if (!shown.has("courses")) redirect("/event#courses");')).toBe(true);
    expect(isSwitchedOff('if (!session) redirect("/");')).toBe(false);
    expect(isSwitchedOff('const x = shown.has("rounds") ? a : b;')).toBe(false);
  });

  it("nothing else answers a redirect while off but the screens the sweeps hold out", () => {
    const out = ["courses"];
    const found: string[] = [];
    for (const name of readdirSync(join(process.cwd(), "src", "app", "(app)"))) {
      const dir = join(process.cwd(), "src", "app", "(app)", name);
      if (!statSync(dir).isDirectory()) continue;
      try {
        if (isSwitchedOff(readSource("src", "app", "(app)", name, "page.tsx"))) found.push(name);
      } catch {
        /* no page of its own */
      }
    }
    expect(found).toEqual(out);
  });
});

describe("the browser tab names the screen as the menu does", () => {
  it("is 'Courses', the word `nav-lifecycle.ts` gives the door", () => {
    expect(readSource("src", "app", "(app)", "courses", "page.tsx")).toMatch(/screenMetadata\("\/courses"\), title: "Courses"/);
    expect(readSource("src", "lib", "nav-lifecycle.ts")).toMatch(/id: "courses", label: "Courses"/);
  });
});
