import { describe, expect, it, vi } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/handicap-policy", () => ({ saveHandicapPolicy: vi.fn(), saveScoreReporting: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));

import { federationLinkLive } from "@/lib/integrations/federation-link";
import {
  HANDICAP_POLICIES,
  SERVICE_ONLY,
  handicapPolicyOf,
  mayChooseHandicapPolicy,
  offeredHandicapPolicies,
} from "@/lib/domain/handicap-policy";
import { HandicapSetup, type HandicapSetupView } from "@/components/HandicapSetup";
import { readSource } from "./source";

/**
 * THE "SERVICE ONLY" CHOICE IS HIDDEN UNTIL A FEDERATION LINK IS LIVE (the
 * team's ruling, 2026-10-24).
 *
 * "GHIN only" (or "England Golf only", …) said nobody at the club may type an
 * index, while every adapter reports `unconfigured` and nothing fetches one.
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

  it("Club settings does not offer the service-only choice, and says the link is coming", () => {
    const html = renderToStaticMarkup(<HandicapSetup view={US} />);
    expect(html).toContain("Entered here only");
    expect(html).toContain("GHIN where a member has one");
    expect(html, "the service-only choice is drawn").not.toContain("GHIN only");
    expect(html).toContain("A live link that fetches indexes from GHIN is coming.");
    // And the help behind the ⓘ no longer promises the hidden choice.
    expect(readSource("src/components/HandicapSetup.tsx")).toMatch(/serviceOnlyOffered \? \(/);
  });

  it("the server's list is the screen's list, without service-only", () => {
    expect(offeredHandicapPolicies()).toEqual(HANDICAP_POLICIES.filter((p) => p !== SERVICE_ONLY));
    expect(mayChooseHandicapPolicy(SERVICE_ONLY)).toBe(false);
    expect(mayChooseHandicapPolicy("club")).toBe(true);
    expect(mayChooseHandicapPolicy("hybrid")).toBe(true);
    expect(readSource("src/app/actions/handicap-policy.ts")).toMatch(/if \(!mayChooseHandicapPolicy\(policy\)\) \{/);
  });

  it("a stored service-only value reads as the club's own record, however it was stored", () => {
    expect(SERVICE_ONLY).toBe("ghin");
    for (const raw of ["ghin", " GHIN ", "Ghin"]) expect(handicapPolicyOf(raw), raw).toBe("club");
    expect(handicapPolicyOf("hybrid")).toBe("hybrid");
    expect(handicapPolicyOf("club")).toBe("club");
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
