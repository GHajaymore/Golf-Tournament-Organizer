import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { SCREEN_KEYS } from "../domain/console-merges";
import { canAccessScreen } from "../roles";
import { previewModeOf, consoleUrl, memberHistoryHref } from "../console-url";
import { consoleScreens, switchedOffScreens } from "../../../e2e/routes";
import { SCREENS_BUILT } from "../../../e2e/console";

/**
 * CLUB SETTINGS' STAFF & ACCESS AND MEMBERS WITH HISTORY (R7): who is let in, and where each piece is drawn.
 * The rules are the machine's (`canAccessScreen`, `organizationAccessFor`, the actions); these hold the screens
 * to them without a browser. R7 adds no route and no action.
 */

/** Every .tsx under src that mounts `<tag`, as `dir/file`, comments stripped. */
function mountsOf(tag: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx$/.test(name) && !p.includes("__tests__")) {
        const rel = p.slice(process.cwd().length + 1).split(/[\\/]/);
        if (new RegExp(`<${tag}\\b`).test(readSource(...rel))) found.push(rel.slice(-2).join("/"));
      }
    }
  };
  walk(join(process.cwd(), "src"));
  return found.sort();
}

describe("the event's helpers are mounted once, by one boolean", () => {
  it("only `/access` (while Club settings is not shown) and Club settings (while it is) mount them, plus the component's own file", () => {
    expect(mountsOf("EventHelpers")).toEqual(["access/page.tsx", "organization/page.tsx"]);
    const access = readSource("src", "app", "(app)", "access", "page.tsx");
    // The old screen obeys the same boolean: while Club settings is shown it sends a person there, and draws nothing.
    // It does not redirect (every old door still opens on its own path: `lifecycle-menu.spec`): it says where the list went.
    expect(access).not.toMatch(/redirect\(await keepingPreview/);
    expect(access).toMatch(/if \(shown\.has\("clubSettings"\)\) \{/);
    expect(access).toContain('keepingPreview("/organization#access")');
    expect(access.indexOf('shown.has("clubSettings")')).toBeLessThan(access.indexOf("<EventHelpers"));
    const org = readSource("src", "app", "(app)", "organization", "page.tsx");
    expect(org).toMatch(/const redesigned = shown\.has\("clubSettings"\);/);
    // Drawn inside the `redesigned` branch only.
    expect(org.indexOf("<EventHelpers")).toBeGreaterThan(org.indexOf("redesigned ? ("));
    expect((org.match(/<EventHelpers\b/g) ?? []).length).toBe(1);
  });

  it("the club's staff list is mounted once whichever way the switch is, never twice", () => {
    const org = readSource("src", "app", "(app)", "organization", "page.tsx");
    expect((org.match(/<OrganizationAccess\b/g) ?? []).length).toBe(1);
    // Declared once, drawn in the redesigned fold or plain: three mentions, one component.
    expect((org.match(/\bclubStaff\b/g) ?? []).length).toBe(3);
  });
});

describe("a member's history is mounted once, by one boolean", () => {
  it("only `/member` (while Members is not shown) and Members (while it is) mount it", () => {
    expect(mountsOf("MemberHistory")).toEqual(["member/page.tsx", "roster/page.tsx"]);
    const member = readSource("src", "app", "(app)", "member", "page.tsx");
    expect(member).toMatch(/if \(shown\.has\("members"\)\) \{/);
    expect(member.indexOf('shown.has("members")')).toBeLessThan(member.indexOf("<MemberHistory"));
    const roster = readSource("src", "app", "(app)", "roster", "page.tsx");
    expect(roster).toMatch(/const historyHere = \(await screensShownFor\(session\)\)\.has\("members"\);/);
    expect(roster).toMatch(/\{historyHere && \(/);
  });

  it("is read for the roster's own roles, and a member's id is checked against THIS club's roster", () => {
    expect(canAccessScreen("admin", "roster")).toBe(true);
    expect(canAccessScreen("assistant", "roster")).toBe(true);
    expect(canAccessScreen("player", "roster"), "a player may open the club's members").toBe(false);
    expect(canAccessScreen("player", "member")).toBe(false);
    const roster = readSource("src", "app", "(app)", "roster", "page.tsx");
    expect(roster).toContain('requireOrgScreen("roster")');
    const history = readSource("src", "components", "club", "MemberHistory.tsx");
    // The id is looked up ONLY in the roster it was handed, and the component reads no roster of its own.
    expect(history).toMatch(/members\.find\(\(m\) => m\.id === memberId\)/);
    expect(history).not.toMatch(/loadRoster/);
    expect(history).toMatch(/memberHistory\(organizationId, selected\.id\)/);
    // Each page reads the club's roster once and hands it over.
    for (const page of ["member", "roster"]) {
      const src = readSource("src", "app", "(app)", page, "page.tsx");
      expect((src.match(/loadRoster\(/g) ?? []).length, `${page} reads the roster more than once`).toBe(1);
      expect(src).toMatch(/<MemberHistory[^>]*members=\{members\}/);
    }
  });

  it("the roster's name is a link to the history only while Members is shown, through the one address builder", () => {
    const client = readSource("src", "components", "RosterClient.tsx");
    expect(client).toMatch(/history \? <Link href=\{memberHistoryHref\(m\.id, "\/roster", history\.mode\)\}>/);
    expect(client).toMatch(/\bhistory: \{ mode: ConsoleMode \| null \} \| null;/);
    const roster = readSource("src", "app", "(app)", "roster", "page.tsx");
    expect(roster).toMatch(/history=\{historyHere \? \{ mode: await previewModeNow\(\) \} : null\}/);
    // No second template string for the address.
    expect(readSource("src", "components", "club", "MemberHistory.tsx")).toMatch(/memberHistoryHref\(id, base, previewMode\)/);
    expect(readSource("src", "components", "club", "MemberHistory.tsx")).not.toMatch(/\?member=\$\{/);
  });

  it("builds the address once: plain, in a preview, and as a section of the roster", () => {
    expect(memberHistoryHref("a b", "/member", null)).toBe("/member?member=a%20b");
    expect(memberHistoryHref("x", "/roster", null)).toBe("/roster?member=x#history");
    expect(memberHistoryHref("x", "/roster", "build")).toBe("/roster?member=x&stepper=1&build=1#history");
  });
});

describe("who sees On this event is the EVENT role, and the rest of Club settings is the CLUB role", () => {
  it("On this event asks the role the `/access` screen has always asked, not a rule written on the page", () => {
    const org = readSource("src", "app", "(app)", "organization", "page.tsx");
    expect(org).toMatch(/Boolean\(session\.eventId\) && canAccessScreen\(session\.viewRole, "access"\)/);
    expect(canAccessScreen("admin", "access")).toBe(true);
    expect(canAccessScreen("assistant", "access")).toBe(false);
    expect(canAccessScreen("player", "access")).toBe(false);
  });

  it("the club's own staff and defaults still read `organizationAccess`'s answer", () => {
    const org = readSource("src", "app", "(app)", "organization", "page.tsx");
    expect(org).toMatch(/const access = await organizationAccess\(session\);/);
    expect(org).toMatch(/const canEdit = access\?\.canEdit \?\? false;/);
    expect(org).toMatch(/<OrganizationAccess[\s\S]*?canEdit=\{canEdit\}/);
  });

  it("the moved components decide nothing: no role, no session, no `canEdit` of their own", () => {
    for (const f of ["EventHelpers.tsx", "MemberHistory.tsx"]) {
      const src = readSource("src", "components", "club", f);
      expect(src, `${f} reads the session`).not.toMatch(/getSession|viewRole|canAccessScreen|organizationAccess/);
      expect(src, `${f} is a client file`).not.toMatch(/^["']use client["']/m);
    }
  });
});

describe("R7 adds no route and no action", () => {
  it("the two screens are existing routes, built at their own addresses and still walked as live screens", () => {
    expect(SCREENS_BUILT.clubSettings).toBe("/organization");
    expect(SCREENS_BUILT.members).toBe("/roster");
    for (const path of ["/organization", "/roster", "/access", "/member"]) expect(consoleScreens(), path).toContain(path);
    // None of them is held out as a switched-off address: R7 has no `if (!shown.has(...)) redirect(` page.
    for (const path of ["/organization", "/roster", "/access", "/member"]) expect(switchedOffScreens(), path).not.toContain(path);
  });

  it("the new components hold no server action", () => {
    for (const f of ["EventHelpers.tsx", "MemberHistory.tsx"]) {
      expect(readSource("src", "components", "club", f)).not.toMatch(/["']use server["']/);
    }
  });

  it("`clubSettings` and `members` are keys of the redesign", () => {
    expect(SCREEN_KEYS).toContain("clubSettings");
    expect(SCREEN_KEYS).toContain("members");
  });
});

describe("a link or a redirect inside a previewed screen stays inside the preview", () => {
  it("reads the preview from the query", () => {
    expect(previewModeOf("")).toBeNull();
    expect(previewModeOf("?stepper=1")).toBe("preview");
    expect(previewModeOf("?stepper=1&build=1")).toBe("build");
    // The building flag alone is not a preview.
    expect(previewModeOf("?build=1")).toBeNull();
    expect(previewModeOf("?member=abc")).toBeNull();
  });

  it("keeps the member and the place when the preview is put back on", () => {
    expect(consoleUrl("/roster?member=abc#history", "build")).toBe("/roster?member=abc&stepper=1&build=1#history");
    expect(consoleUrl("/organization#access", "preview")).toBe("/organization?stepper=1#access");
  });
});
