import { describe, expect, it, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/handicap-policy", () => ({ saveHandicapPolicy: vi.fn(), saveScoreReporting: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));

import { federationLinkLive } from "@/lib/integrations/federation-link";
import {
  HANDICAP_POLICIES,
  NEEDS_FEDERATION_LINK,
  SERVICE_ONLY,
  WHERE_A_MEMBER_HAS_ONE,
  handicapPolicyOf,
  mayChooseHandicapPolicy,
  offeredHandicapPolicies,
} from "@/lib/domain/handicap-policy";
import { HandicapSetup, type HandicapSetupView } from "@/components/HandicapSetup";
import { readSource } from "./source";

/**
 * THE CHOICES THAT READ FROM A HANDICAP BODY ARE HIDDEN UNTIL A FEDERATION
 * LINK IS LIVE (the team's rulings, 2026-10-24).
 *
 * "GHIN only" (or "England Golf only", …) said nobody at the club may type an
 * index, and "GHIN where a member has one" said it of every member with a
 * number — while every adapter reports `unconfigured` and nothing fetches one.
 * `federationLinkLive()` is the one switch: the screen's list, the server's
 * refusal and every reader of the stored value ask it. The control — the same
 * screen and readers with the switch forced on — is
 * `service-only-returns-when-the-link-is-live.test.tsx`; the database half is
 * `service-only-reads-as-the-clubs-own.audit.test.ts`.
 */

const US: HandicapSetupView = {
  policy: "club",
  canEdit: true,
  countryKnown: true,
  body: { id: "ghin", name: "GHIN (USGA)", number: "GHIN number" },
  handicap: { providerId: "ghin", label: "GHIN (USGA)", status: "unconfigured", howToEnable: "" },
  scores: { enabled: false, providerId: "ghin", label: "GHIN (USGA)", status: "unconfigured", howToEnable: "" },
};

describe("today, with no federation link live", () => {
  it("the switch says no — nothing in integrations/ fetches an index", () => {
    expect(federationLinkLive()).toBe(false);
  });

  it("Club settings offers neither body choice — no choice at all — and says the link is coming", () => {
    const html = renderToStaticMarkup(<HandicapSetup view={US} />);
    expect(html, "the service-only choice is drawn").not.toContain("GHIN only");
    expect(html, "the where-a-member-has-one choice is drawn").not.toContain("where a member has one");
    // One choice left is no choice: no pressed button standing alone.
    expect(html, "a choice button is drawn").not.toContain("aria-pressed");
    expect(html).toContain("Where indexes come from");
    expect(html).toContain("Handicaps are entered here: by an organizer, or suggested from your members&#x27; cards.");
    expect(html).toContain("A live link that fetches indexes from GHIN is coming.");
    // And the help behind the ⓘ no longer promises the hidden choice.
    expect(readSource("src/components/HandicapSetup.tsx")).toMatch(/serviceOnlyOffered \? \(/);
  });

  it("the server's list is the screen's list: the club's own record only", () => {
    expect(NEEDS_FEDERATION_LINK).toEqual(["hybrid", "ghin"]);
    expect(offeredHandicapPolicies()).toEqual(["club"]);
    expect(mayChooseHandicapPolicy(SERVICE_ONLY)).toBe(false);
    expect(mayChooseHandicapPolicy(WHERE_A_MEMBER_HAS_ONE)).toBe(false);
    expect(mayChooseHandicapPolicy("club")).toBe(true);
    expect(readSource("src/app/actions/handicap-policy.ts")).toMatch(/if \(!mayChooseHandicapPolicy\(policy\)\) \{/);
  });

  it("a stored body choice reads as the club's own record, however it was stored", () => {
    expect(SERVICE_ONLY).toBe("ghin");
    expect(WHERE_A_MEMBER_HAS_ONE).toBe("hybrid");
    for (const raw of ["ghin", " GHIN ", "Ghin", "hybrid", " HYBRID ", "Hybrid"]) expect(handicapPolicyOf(raw), raw).toBe("club");
    expect(handicapPolicyOf("club")).toBe("club");
    // Every policy the app knows is covered by this sentence or by the club's own.
    for (const p of HANDICAP_POLICIES) expect(handicapPolicyOf(p), p).toBe("club");
  });
});

/** Every non-test source file under src. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") out.push(...sourceFiles(p));
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("every reader of the stored setting goes through handicapPolicyOf", () => {
  const root = process.cwd();
  const files = sourceFiles(join(root, "src")).map((f) => ({ path: relative(root, f).split("\\").join("/"), src: readSource(relative(root, f)) }));
  const readers = files.filter((f) => /handicapPolicy: true/.test(f.src));

  it("finds the readers (a control: the roster screen and Club settings' view are among them)", () => {
    const paths = readers.map((r) => r.path);
    expect(paths).toContain("src/app/(app)/roster/page.tsx");
    expect(paths).toContain("src/lib/services/integrations.ts");
    expect(readers.length).toBeGreaterThanOrEqual(5);
  });

  it("each file that selects the column reads it through handicapPolicyOf", () => {
    for (const r of readers) expect(r.src, r.path).toContain("handicapPolicyOf(");
  });

  it("nothing compares the raw column with a value", () => {
    for (const f of files) expect(f.src, f.path).not.toMatch(/\.handicapPolicy\s*[!=]==/);
  });
});
