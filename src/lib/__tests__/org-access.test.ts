import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canAdministerOrganization } from "../services/org-access";

/** Same helper the other source-reading guards use: an assertion about code
 *  must not be satisfied — or defeated — by a comment describing it. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Who may administer a club.
 *
 * S1 of the 2026-08-12 audit: the highest-severity finding, and invisible to
 * every structural check the suite had. The id was always right and the role
 * was always wrong, so the IDOR sweep passed cleanly across the whole surface,
 * and roles.audit.test.ts asserted only that one club's rights don't leak
 * SIDEWAYS into another — never that a single event's admin doesn't leak
 * UPWARD into the club that owns it.
 */

const rule = (over: Parameters<typeof canAdministerOrganization>[0]) => canAdministerOrganization(over);

describe("the club takeover", () => {
  it("refuses a guest admin of one event", () => {
    // The attack, exactly. addAccount creates an Account and never an
    // OrganizationMember, so a guest organizer invited to run one event holds
    // session.role === "admin" with no membership. Under the old reading that
    // was administration of the whole club: addOrganizationMember(self,
    // "owner"), removeOrganizationMember(realOwner), and every event, the
    // roster and the branding change hands.
    expect(rule({ membershipRole: null, sessionRole: "admin", hasMembers: true })).toBe("denied");
  });

  it("refuses them however many owners the club has", () => {
    for (const hasMembers of [true]) {
      for (const sessionRole of ["admin", "assistant", "player"]) {
        expect(rule({ membershipRole: null, sessionRole, hasMembers }), sessionRole).toBe("denied");
      }
    }
  });

  it("refuses a plain club member, who is on the roster and nothing more", () => {
    // "member" is a roster role. If it ever conferred administration, every
    // member of the club would be an owner.
    expect(rule({ membershipRole: "member", sessionRole: "admin", hasMembers: true })).toBe("denied");
  });

  it("refuses an unrecognised membership role rather than defaulting it open", () => {
    for (const membershipRole of ["superadmin", "", "OWNER", "Admin"]) {
      expect(rule({ membershipRole, sessionRole: "admin", hasMembers: true }), membershipRole).toBe("denied");
    }
  });
});

describe("the people who really do run the club", () => {
  it("lets an owner and an admin through", () => {
    for (const membershipRole of ["owner", "admin"]) {
      expect(rule({ membershipRole, sessionRole: "player", hasMembers: true }), membershipRole).toBe("member");
    }
  });

  it("does not require them to be an organizer of the current tournament", () => {
    // A club owner entered as a player in one of their own events is still the
    // club's owner. The membership is the authority here, not the session.
    expect(rule({ membershipRole: "owner", sessionRole: "player", hasMembers: true })).toBe("member");
  });
});

describe("the anti-lockout escape hatch", () => {
  it("lets an event admin administer a club that nobody holds", () => {
    // Why the fallback existed: an organization created before memberships (or
    // by a code path that skipped creating one) has no owner, and refusing
    // outright would lock a real organizer out of their own tenant.
    expect(rule({ membershipRole: null, sessionRole: "admin", hasMembers: false })).toBe("ownerless");
  });

  it("is 'this club has nobody', NOT 'I am not a member'", () => {
    // The whole of S1 in one line. The old condition was `!membership`, which
    // is true of an attacker; this one is a fact about the club, and cannot be
    // true of a club that is being taken from someone.
    expect(rule({ membershipRole: null, sessionRole: "admin", hasMembers: true })).toBe("denied");
    expect(rule({ membershipRole: null, sessionRole: "admin", hasMembers: false })).toBe("ownerless");
  });

  it("still requires an organizer — it is not open to the field", () => {
    for (const sessionRole of ["assistant", "player", ""]) {
      expect(rule({ membershipRole: null, sessionRole, hasMembers: false }), sessionRole).toBe("denied");
    }
  });
});

describe("the rule lives in one place", () => {
  // organization.ts and settings.ts held identical copies, and a copy is how
  // one of them was still wrong after the other was noticed.
  //
  // Comments are stripped first: these assertions are about what the code
  // DOES, and the comments explaining the old fallback quote it verbatim.
  const read = (p: string) => stripComments(readFileSync(join(process.cwd(), p), "utf8"));

  for (const file of ["src/app/actions/organization.ts", "src/app/actions/settings.ts"]) {
    it(`${file} asks the shared rule`, () => {
      const src = read(file);
      expect(src).toMatch(/organizationAccess\(/);
      // The old fallback, in any spacing.
      expect(src).not.toMatch(/session\.role === "admin"\s*&&\s*!membership/);
    });
  }

  it("no other action reimplements it", () => {
    const dir = join(process.cwd(), "src", "app", "actions");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      expect(read(join("src", "app", "actions", f)), f).not.toMatch(/&&\s*!membership/);
    }
  });
});

describe("a new club always has an owner", () => {
  it("creates the membership even when the user has never signed in", () => {
    // `...(user ? { members: { create: ... } } : {})` created organizations
    // with nobody in them, which is precisely the state the escape hatch above
    // is permissive about. The source of ownerless clubs had to close too, or
    // the app would keep making new ones.
    const src = stripComments(readFileSync(join(process.cwd(), "src/lib/services/organization.ts"), "utf8"));
    expect(src).not.toMatch(/\.\.\.\(user \? \{ members/);
    expect(src).toMatch(/members: \{ create: \{ userId: owner\.id, role: "owner" \} \}/);
    expect(src).toMatch(/prisma\.user\.upsert/);
  });
});
