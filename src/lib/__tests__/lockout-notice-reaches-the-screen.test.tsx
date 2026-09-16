import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaySettings } from "@/components/PlaySettings";
import { cleanSettings } from "@/lib/tournament-settings";

/**
 * THE WARNING HAS TO REACH THE SCREEN, not just the resolver.
 *
 * `access-lockout.test.ts` proves the sentence. This proves a person sees it.
 * The distinction is not academic here: the rule was written on 2026-09-11,
 * documented at length, and the register recorded it as "wired to nothing" —
 * it had a correct answer nobody was asking for. Half of that has since been
 * fixed in the action; this is the other half, and asserting the function
 * would prove nothing about whether the control says anything.
 *
 * The same class of gap as the society/league work two PRs ago, where a
 * correct resolver reached four readers that never called it. Rendering found
 * that; reading the source had not.
 */

const render = (playerAccess: string, strandedCount: number) =>
  renderToStaticMarkup(
    <PlaySettings
      mode="tournament"
      settings={cleanSettings({ playerAccess })}
      canEdit
      strandedCount={strandedCount}
      shareToken="zz-token"
      rounds={[]}
    />,
  );

describe("the settings screen says what turning Round Codes off would cost", () => {
  it("names the number while codes are still on", () => {
    const html = render("code", 12);
    expect(html, "an organizer would learn this only after saving").toContain(
      "12 players in this tournament have no email address",
    );
    expect(html, "does not say what to do about it").toContain("Registration &amp; field");
  });

  it("warns on BOTH as well as code-only", () => {
    /**
     * `usesAccessCodes` is true for "both", and it is the setting most likely
     * to be switched to plain email — a club part-way through moving its
     * members onto addresses. Asserting only the code-only case would miss the
     * commonest route into the damage.
     */
    expect(render("both", 12)).toContain("no email address");
  });
});

describe("and stays quiet the rest of the time", () => {
  it("says nothing when every entrant has an address", () => {
    /**
     * THE ORDINARY CASE. A warning that appears on a safe screen is the thing
     * that teaches an organizer to stop reading warnings — the same reasoning
     * the refusal's own tests lead with.
     */
    expect(render("code", 0)).not.toContain("no email address");
  });

  it("says nothing once codes are already off", () => {
    // Nothing left to withdraw. Without this the notice would sit permanently
    // on every email-sign-in tournament that ever used codes.
    expect(render("email", 12)).not.toContain("no email address");
  });
});

describe("the control", () => {
  it("renders the sign-in setting at all", () => {
    /**
     * Without this, every `not.toContain` above passes against markup that
     * failed to render — which is exactly how the society/league render test
     * nearly shipped asserting nothing, and the reason that file now carries
     * a control too.
     */
    const html = render("code", 0);
    expect(html, "PlaySettings no longer renders the sign-in control").toContain(
      "How players sign in",
    );
  });
});
