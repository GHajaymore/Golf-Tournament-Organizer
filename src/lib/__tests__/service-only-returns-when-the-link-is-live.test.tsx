import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE CONTROL FOR `service-only-is-hidden.test.tsx`: the day a federation
 * link is live, flipping `federationLinkLive()` alone brings the choice back —
 * on the screen, in the server's list and in every reader — with nothing else
 * changed. If this goes red, the switch is no longer the only switch.
 */

vi.mock("@/lib/integrations/federation-link", () => ({ federationLinkLive: () => true }));
vi.mock("@/app/actions/handicap-policy", () => ({ saveHandicapPolicy: vi.fn(), saveScoreReporting: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));

const { HANDICAP_POLICIES, SERVICE_ONLY, handicapPolicyOf, mayChooseHandicapPolicy, offeredHandicapPolicies } = await import(
  "@/lib/domain/handicap-policy"
);
const { HandicapSetup } = await import("@/components/HandicapSetup");

const view = (policy: "club" | "hybrid" | "ghin") => ({
  policy,
  canEdit: true,
  countryKnown: true,
  body: { id: "england-golf", name: "England Golf", number: "England Golf membership number (CDH)" },
  handicap: { providerId: "england-golf", label: "England Golf", status: "unconfigured", howToEnable: "" },
  scores: { enabled: false, providerId: "england-golf", label: "England Golf", status: "unconfigured", howToEnable: "" },
});

describe("with the federation link forced live", () => {
  it("Club settings offers the service-only choice again", () => {
    const html = renderToStaticMarkup(<HandicapSetup view={view("club")} />);
    expect(html).toContain("England Golf only");
    expect(html).toContain("England Golf where a member has one");
    expect(html).not.toContain("is coming");
  });

  it("a club on it is told so", () => {
    const html = renderToStaticMarkup(<HandicapSetup view={view("ghin")} />);
    expect(html).toContain("Nobody at the club enters a handicap by hand");
  });

  it("the server may store it, and a stored value reads as what it says", () => {
    expect(offeredHandicapPolicies()).toEqual(HANDICAP_POLICIES);
    expect(mayChooseHandicapPolicy(SERVICE_ONLY)).toBe(true);
    expect(handicapPolicyOf(" GHIN ")).toBe("ghin");
  });
});
