import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/actions/handicap-policy", () => ({ saveHandicapPolicy: vi.fn(), saveScoreReporting: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams("") }));

import {
  HANDICAP_BODIES,
  bodyInProse,
  clubHandicapBody,
  defaultHandicapBody,
  handicapBody,
} from "@/lib/domain/handicap-body";
import { refuseHandByHand, handicapStanding } from "@/lib/domain/handicap-policy";
import { handicapAuthority, scoreReporter } from "@/lib/integrations/registry";
import { HandicapSetup } from "@/components/HandicapSetup";
import { readSource } from "./source";

/**
 * A CLUB NAMES THE BODY ITS MEMBERS BELONG TO (Ajay, 2026-10-17: "we need to
 * add international bodies too … add only the top 3-5 … go with what the golf
 * clubs follow").
 *
 * In every WHS country joining an affiliated club registers a golfer with the
 * national body, which holds their record and issues the index: GHIN in the
 * US, England Golf (the "CDH number"), Golf Ireland north and south, Golf
 * Canada, Golf Australia (the Golf ID). A club in England was shown "GHIN
 * (USGA) only" and asked for a "GHIN #" — every word of that is held here.
 */

const ENGLAND = handicapBody("england-golf")!;
const dear = (b: string) => handicapBody(b)!;

describe("the body a club is offered, from where it is", () => {
  const cases: Array<[string, string]> = [
    ["United States", "ghin"],
    ["US", "ghin"],
    // A club that has not said where it is: NOT assumed American (Ajay: "make
    // it geographical vs US enforced").
    ["", "national"],
    ["England", "england-golf"],
    ["GB", "england-golf"],
    ["Northern Ireland", "golf-ireland"], // one body for the whole island — never England's
    ["Ireland", "golf-ireland"],
    ["IE", "golf-ireland"],
    ["Scotland", "national"], // its own body, not in this list yet — and not England's
    ["Wales", "national"],
    ["Canada", "golf-canada"],
    ["AU", "golf-australia"],
    ["IN", "national"],
    ["Japan", "national"],
  ];
  for (const [country, id] of cases) {
    it(`${country || "(blank)"} → ${id}`, () => expect(defaultHandicapBody(country).id).toBe(id));
  }

  it("the club's country decides — nothing stored, and nothing a caller sends, can put it on another country's body", () => {
    expect(clubHandicapBody({ country: "England" }).id).toBe("england-golf");
    expect(clubHandicapBody({ country: "" }).id).toBe("national");
    // The stored column (it defaulted to "ghin" for every club ever made) is not read.
    expect(readSource("src/lib/domain/handicap-body.ts")).toMatch(
      /export function clubHandicapBody\(org: \{ country\?: string \| null \}\): HandicapBody \{\s*return defaultHandicapBody\(org\.country\);/,
    );
    // And the action takes no body from its caller.
    expect(readSource("src/app/actions/handicap-policy.ts")).toMatch(/export async function saveHandicapPolicy\(policy: string\): Promise<PolicyResult>/);
  });
});

describe("every body is honest about not being connected", () => {
  it("each has an index reader and a score poster, both reporting not connected", async () => {
    for (const b of HANDICAP_BODIES) {
      const a = handicapAuthority(b.id);
      const r = scoreReporter(b.id);
      expect(a, b.id).not.toBeNull();
      expect(r, b.id).not.toBeNull();
      expect(a!.status(null)).toBe("unconfigured");
      expect(a!.status({ providerId: b.id, secret: "zz-anything", settings: {} })).toBe("unconfigured");
      expect((await a!.lookup("zz-1", null)).ok).toBe(false);
      const post = await r!.post({ golferId: "zz-1", strokes: [], playedOn: new Date(0), courseId: "", teeId: "", competition: true, idempotencyKey: "zz" }, null);
      expect(post.ok).toBe(false);
      if (!post.ok) expect(post.retryable, `${b.id} must never queue posts it cannot send`).toBe(false);
    }
  });

  it("never claims an API exists — it says to ASK", () => {
    for (const b of HANDICAP_BODIES.filter((x) => x.id !== "ghin")) {
      const how = handicapAuthority(b.id)!.howToEnable;
      expect(how, b.id).toMatch(/^Ask /);
      expect(how, b.id).not.toMatch(/\bAPI\b/);
    }
  });
});

describe("the words a club in England reads", () => {
  it("a typed index is refused in England Golf's words, never GHIN's", () => {
    const only = refuseHandByHand("ghin", { handicap: 9 }, { handicap: 12.4 }, ENGLAND)!;
    expect(only).toContain("indexes from England Golf");
    expect(only).toContain("England Golf membership number (CDH)");
    const both = refuseHandByHand("hybrid", { handicap: 9 }, { handicap: 12.4, ghin: "zz-123" }, ENGLAND)!;
    expect(both).toContain("Clear their England Golf membership number (CDH)");
    for (const s of [only, both]) expect(s).not.toMatch(/GHIN/);
  });

  it("a missing number and an old index are said in the body's words", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    const missing = handicapStanding({ policy: "ghin", index: 12, syncedAt: null, ghin: "", now, body: dear("golf-australia") });
    expect(missing.note).toBe("No Golf ID on file, and this club plays off indexes from Golf Australia.");
    const old = handicapStanding({ policy: "ghin", index: 12, syncedAt: new Date("2026-10-01T12:00:00Z"), ghin: "zz-1", now, body: dear("golf-ireland") });
    expect(old.note).toBe("Index last received from Golf Ireland 16 days ago.");
    // The fallback reads as English, not as a proper name.
    expect(bodyInProse(dear("national"))).toBe("your national association");
  });

  it("the setting names England Golf from the club's country, offers no picker, and never says GHIN", () => {
    const html = renderToStaticMarkup(
      <HandicapSetup
        view={{
          policy: "hybrid",
          canEdit: true,
          countryKnown: true,
          body: { id: ENGLAND.id, name: ENGLAND.name, number: ENGLAND.number },
          handicap: { providerId: ENGLAND.id, label: ENGLAND.name, status: "unconfigured", howToEnable: handicapAuthority(ENGLAND.id)!.howToEnable },
          scores: { enabled: false, providerId: ENGLAND.id, label: ENGLAND.name, status: "unconfigured", howToEnable: "" },
        }}
      />,
    );
    expect(html).toContain("England Golf only");
    // Not "Both" (Ajay: "what is both means?") — the choice says what it does.
    expect(html).toContain("England Golf where a member has one");
    expect(html).not.toMatch(/>Both</);
    expect(html).toContain("Handicap body: England Golf");
    expect(html).toContain("from your club&#x27;s country");
    expect(html).toContain("It uses the World Handicap System.");
    expect(html).toContain("Members with an England Golf membership number (CDH) play off their index from England Golf");
    // Geographical, not picked (Ajay: "make it geographical vs US enforced").
    expect(html).not.toMatch(/<select/);
    expect(html).not.toMatch(/GHIN/);
  });

  it("a club that has not said where it is is asked to — and is not put on GHIN", () => {
    const national = dear("national");
    const html = renderToStaticMarkup(
      <HandicapSetup
        view={{
          policy: "club",
          canEdit: true,
          countryKnown: false,
          body: { id: national.id, name: national.name, number: national.number },
          handicap: { providerId: national.id, label: national.name, status: "unconfigured", howToEnable: "" },
          scores: { enabled: false, providerId: national.id, label: national.name, status: "unconfigured", howToEnable: "" },
        }}
      />,
    );
    expect(html).toContain("Handicap body: Your national association");
    expect(html).toContain("add your club&#x27;s country under Branding on this page");
    expect(html).not.toMatch(/GHIN/);
  });
});

describe("the doors", () => {
  it("'Both' stores the body as surely as '<body> only' does", () => {
    const src = readSource("src/app/actions/handicap-policy.ts");
    expect(src).toMatch(/const usesBody = policy !== "club";/);
    expect(src).toMatch(/\.\.\.\(usesBody \? \{ handicapAuthorityId:/);
  });

  it("the Members and Entries screens are handed the club's body, not left on their GHIN defaults", () => {
    expect(readSource("src/app/(app)/roster/page.tsx")).toMatch(/bodyNumber=\{clubHandicapBody\(org\)\.number\}/);
    expect(readSource("src/app/(app)/registration/page.tsx")).toMatch(/handicapBody=\{\{ label: bodyShortLabel\(body\)/);
  });
});
