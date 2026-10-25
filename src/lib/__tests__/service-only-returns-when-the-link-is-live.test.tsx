import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE CONTROL FOR `service-only-is-hidden.test.tsx`: the day a federation
 * link is live, flipping `federationLinkLive()` alone brings both body choices
 * back — service-only and "where a member has one" —
 * on the screen, in the server's list and in every reader — with nothing else
 * changed. If this goes red, the switch is no longer the only switch.
 */

vi.mock("@/lib/integrations/federation-link", () => ({ federationLinkLive: () => true }));
vi.mock("@/app/actions/handicap-policy", () => ({ saveHandicapPolicy: vi.fn(), saveScoreReporting: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));

const { HANDICAP_POLICIES, SERVICE_ONLY, WHERE_A_MEMBER_HAS_ONE, handicapPolicyOf, mayChooseHandicapPolicy, offeredHandicapPolicies } = await import(
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

  it("a club on either is told so", () => {
    expect(renderToStaticMarkup(<HandicapSetup view={view("ghin")} />)).toContain("Nobody at the club enters a handicap by hand");
    expect(renderToStaticMarkup(<HandicapSetup view={view("hybrid")} />)).toContain("play off their index from England Golf");
  });

  it("the three choices are buttons again", () => {
    const html = renderToStaticMarkup(<HandicapSetup view={view("club")} />);
    expect(html.match(/aria-pressed/g)?.length).toBe(3);
    expect(html).toContain("Entered here only");
  });

  it("the server may store both, and a stored value reads as what it says", () => {
    expect(offeredHandicapPolicies()).toEqual(HANDICAP_POLICIES);
    expect(mayChooseHandicapPolicy(SERVICE_ONLY)).toBe(true);
    expect(mayChooseHandicapPolicy(WHERE_A_MEMBER_HAS_ONE)).toBe(true);
    expect(handicapPolicyOf(" GHIN ")).toBe("ghin");
    expect(handicapPolicyOf(" HYBRID ")).toBe("hybrid");
  });
});
