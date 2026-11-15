import { describe, it, expect } from "vitest";
import {
  scopeKey,
  parseScopeKey,
  visibleScopes,
  canReadScope,
  canPostToScope,
  directKeyFor,
  guestWhoKey,
  isGuestKey,
  playerOfGuestKey,
  whoKeysForEntry,
  unreadCount,
  outwardScopeKey,
  type MembershipContext,
} from "@/lib/domain/messaging";

/**
 * THE WHO-KEY, AND WHAT A GUEST, A MUTED GUEST AND THE DESK MAY READ AND POST
 * (J39/J40 PR 2; design §1, §4.1). Pure: no database.
 */

const player: MembershipContext = {
  whoKey: "rita@example.invalid",
  guest: false,
  muted: false,
  role: "player",
  organizationId: "org1",
  eventId: "ev1",
  playerId: "p1",
  onRoster: true,
  groupIds: ["g1"],
  stageIds: ["s1"],
  teamIds: ["t1"],
  matchIds: [],
  foursomeIds: ["s1#Group 1"],
  directThreadIds: [],
  staffScopes: { groupIds: [], stageIds: [], teamIds: [], playerIds: [] },
};
const guest: MembershipContext = { ...player, whoKey: guestWhoKey("p9"), guest: true, playerId: "p9", onRoster: true };
const staff: MembershipContext = {
  ...player,
  whoKey: "corin@example.invalid",
  role: "admin",
  playerId: null,
  groupIds: [],
  stageIds: [],
  teamIds: [],
  foursomeIds: [],
  staffScopes: { groupIds: ["g1"], stageIds: ["s1"], teamIds: ["t1"], playerIds: ["p1", "p9"] },
};

describe("the who-key", () => {
  it("a guest key has no @ and no |, so it can never be an address and a direct key stays parseable", () => {
    const k = guestWhoKey("clx9abc");
    expect(k).toBe("guest:clx9abc");
    expect(k).not.toMatch(/[@|]/);
    expect(isGuestKey(k)).toBe(true);
    expect(isGuestKey("rita@example.invalid")).toBe(false);
    expect(playerOfGuestKey(k)).toBe("clx9abc");
    expect(playerOfGuestKey("rita@example.invalid")).toBeNull();
  });

  it("a direct key of mixed keys round-trips through parseScopeKey (split on the FIRST colon)", () => {
    const key = scopeKey("direct", directKeyFor(["Sam@Example.invalid", guestWhoKey("clx9abc"), "sam@example.invalid"]));
    expect(key).toBe("direct:guest:clx9abc|sam@example.invalid");
    const parsed = parseScopeKey(key);
    expect(parsed).toEqual({ kind: "direct", id: "guest:clx9abc|sam@example.invalid" });
    expect(parsed!.id.split("|").sort()).toEqual(["guest:clx9abc", "sam@example.invalid"]);
    // And the browser is given the thread, never the keys.
    expect(outwardScopeKey(key, "th_1")).toBe("direct:~th_1");
  });

  it("whoKeysForEntry: an email, a guest, a guest with an email, and a member with none", () => {
    expect(whoKeysForEntry({ id: "p1", email: " Rita@Example.invalid ", standing: "member" })).toEqual(["rita@example.invalid"]);
    expect(whoKeysForEntry({ id: "p9", email: "", standing: "guest" })).toEqual(["guest:p9"]);
    expect(whoKeysForEntry({ id: "p9", email: "robin@example.invalid", standing: "guest" })).toEqual(["robin@example.invalid", "guest:p9"]);
    expect(whoKeysForEntry({ id: "p5", email: "", standing: "" }), "a member with no email: no key (D12)").toEqual([]);
  });

  it("unread counts by key: a guest's own posts are never unread to them", () => {
    const msgs = [
      { createdAt: 100, authorKey: "corin@example.invalid" },
      { createdAt: 200, authorKey: "guest:p9" },
    ];
    expect(unreadCount(msgs, "guest:p9", null)).toBe(1);
    expect(unreadCount(msgs, "corin@example.invalid", null)).toBe(1);
  });
});

describe("what a guest may read and post", () => {
  it("never the club's threads, though being in the field makes onRoster true", () => {
    expect(canReadScope(player, scopeKey("club"))).toBe(true);
    expect(canReadScope(guest, scopeKey("club")), "the club's chatter reached a guest").toBe(false);
  });

  it("every structural thread their entry puts them in, as any player", () => {
    for (const k of [scopeKey("event"), scopeKey("players"), scopeKey("round", "s1"), scopeKey("flight", "g1"), scopeKey("team", "t1"), scopeKey("foursome", "s1#Group 1")]) {
      expect(canReadScope(guest, k), k).toBe(true);
    }
    expect(canPostToScope(guest, scopeKey("round", "s1"))).toBe(true);
    expect(canPostToScope(guest, scopeKey("event")), "an announcement is not a conversation").toBe(false);
  });

  it("their own desk, and nobody else's", () => {
    expect(canPostToScope(guest, scopeKey("desk", "p9"))).toBe(true);
    expect(canReadScope(guest, scopeKey("desk", "p1"))).toBe(false);
    expect(canReadScope(player, scopeKey("desk", "p1")), "a member gets the same desk").toBe(true);
  });

  it("muted: the desk only", () => {
    const muted = { ...guest, muted: true };
    expect(canPostToScope(muted, scopeKey("round", "s1"))).toBe(false);
    expect(canPostToScope(muted, scopeKey("foursome", "s1#Group 1"))).toBe(false);
    expect(canPostToScope(muted, scopeKey("desk", "p9"))).toBe(true);
    expect(canReadScope(muted, scopeKey("round", "s1")), "still reads").toBe(true);
  });
});

describe("the desk, for staff", () => {
  it("staff read and post in every entry's desk of their event", () => {
    expect(canPostToScope(staff, scopeKey("desk", "p1"))).toBe(true);
    expect(canPostToScope(staff, scopeKey("desk", "p9"))).toBe(true);
    expect(canReadScope(staff, scopeKey("desk", "p-other-event")), "an id from another event").toBe(false);
  });
  it("CONTROL: a player's desk list is theirs alone", () => {
    expect(visibleScopes(player).filter((k) => k.startsWith("desk:"))).toEqual(["desk:p1"]);
    expect(visibleScopes(guest).filter((k) => k.startsWith("desk:"))).toEqual(["desk:p9"]);
  });
});
