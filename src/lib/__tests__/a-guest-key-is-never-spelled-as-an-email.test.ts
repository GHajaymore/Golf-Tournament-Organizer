import { describe, it, expect } from "vitest";
import { guestWhoKey, whoKeysForEntry } from "@/lib/domain/messaging";
import { PLAYER_LINK_WORDS } from "@/lib/domain/player-link";

/**
 * Two small belts from the #1133 security review (2026-11-14).
 *
 * F-5: the sender looks a guest's key up by player id with no event bound, so a
 * stored email reading `guest:<another club's guest>` would route one club's
 * notice to another club's guest. Today the email writes refuse one (`EMAIL_RE`
 * demands an `@` and no colon); `whoKeysForEntry`, the one answer every notice
 * asks, now drops one too, so a write added later that forgets cannot open it.
 *
 * F-4: a mute is on the guest's PASS. The staff panel's words promised the
 * person could not post at all; after launch the same person signing in with an
 * account is not muted. The words now say what is true: from their link.
 */

describe("F-5: a guest key is never taken from an entry's email", () => {
  it("an email that spells another guest's key reaches nobody by it", () => {
    const forged = guestWhoKey("zz-other-clubs-guest");
    expect(whoKeysForEntry({ id: "zz-member", email: forged, standing: "" }), "a stored email routed to another club's guest").toEqual([]);
    expect(whoKeysForEntry({ id: "zz-member", email: forged.toUpperCase(), standing: "" })).toEqual([]);
  });

  it("CONTROL: a real address, and a guest's own key, still reach the entry", () => {
    expect(whoKeysForEntry({ id: "zz-member", email: "Zz.Member@Example.Invalid", standing: "" })).toEqual(["zz.member@example.invalid"]);
    expect(whoKeysForEntry({ id: "zz-guest", email: "", standing: "guest" })).toEqual([guestWhoKey("zz-guest")]);
  });
});

describe("F-4: the mute panel promises only the link", () => {
  it("the confirmation says the posts are stopped from the guest's link, and the way on", () => {
    const said = PLAYER_LINK_WORDS.mutedSaid("Zz Quill");
    expect(said, "promises a mute that does not follow the person to an account").toMatch(/from their player link/);
    expect(said).toMatch(/can still message the organizers/);
  });
});
