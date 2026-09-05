import { describe, it, expect } from "vitest";
import {
  scopeKey,
  parseScopeKey,
  visibleScopes,
  canReadScope,
  canPostToScope,
  sortThreads,
  cleanMessageBody,
  unreadCount,
  directKeyFor,
  teeGroupId,
  MAX_MESSAGE_LENGTH,
  type MembershipContext,
} from "@/lib/domain/messaging";

const base: MembershipContext = {
  email: "rita@example.invalid",
  role: "player",
  organizationId: "org1",
  eventId: "ev1",
  playerId: "p1",
  onRoster: true,
  groupIds: ["g1"],
  stageIds: ["s1"],
  teamIds: [],
  matchIds: ["m1"],
  foursomeIds: [teeGroupId("s1", "Group 3")],
  directThreadIds: ["d1"],
  // Empty for a player, and required rather than optional so no construction
  // site can silently omit it and quietly narrow an organizer's reach.
  staffScopes: { groupIds: [], stageIds: [], teamIds: [] },
};

const ctx = (over: Partial<MembershipContext> = {}): MembershipContext => ({ ...base, ...over });

describe("scope keys", () => {
  it("round-trip", () => {
    expect(parseScopeKey(scopeKey("flight", "g1"))).toEqual({ kind: "flight", id: "g1" });
    expect(parseScopeKey(scopeKey("club"))).toEqual({ kind: "club", id: "" });
  });

  it("rejects anything that is not a known kind", () => {
    // A scope key can arrive off the wire, so an unknown kind must not parse
    // into something the permission code then reasons about.
    expect(parseScopeKey("wheelbarrow:1")).toBeNull();
    expect(parseScopeKey("nokind")).toBeNull();
  });
});

describe("what a player can see", () => {
  it("sees their own flight, round, match, four and direct threads", () => {
    const keys = visibleScopes(ctx());
    expect(keys).toContain(scopeKey("flight", "g1"));
    expect(keys).toContain(scopeKey("round", "s1"));
    expect(keys).toContain(scopeKey("match", "m1"));
    expect(keys).toContain(scopeKey("foursome", teeGroupId("s1", "Group 3")));
    expect(keys).toContain(scopeKey("direct", "d1"));
    expect(keys).toContain(scopeKey("event"));
    expect(keys).toContain(scopeKey("club"));
  });

  it("never sees the organizers' thread", () => {
    // The one scope with no player-visible form. Everything else is a matter
    // of which flight you are in; this is a matter of which side of the desk.
    expect(canReadScope(ctx(), scopeKey("staff"))).toBe(false);
  });

  it("does not see another flight, round, match or four", () => {
    // The whole point of the derived set: an id they are not in simply is not
    // in the list, so there is no check to forget.
    const c = ctx();
    expect(canReadScope(c, scopeKey("flight", "g2"))).toBe(false);
    expect(canReadScope(c, scopeKey("round", "s2"))).toBe(false);
    expect(canReadScope(c, scopeKey("match", "m2"))).toBe(false);
    expect(canReadScope(c, scopeKey("foursome", teeGroupId("s1", "Group 4")))).toBe(false);
    expect(canReadScope(c, scopeKey("direct", "d2"))).toBe(false);
  });

  it("does not see the tournament at all when they are not in the field", () => {
    // On the roster but not entered: club news yes, this week's tournament no.
    const outsider = ctx({ playerId: null, groupIds: [], stageIds: [], matchIds: [], foursomeIds: [] });
    expect(canReadScope(outsider, scopeKey("event"))).toBe(false);
    expect(canReadScope(outsider, scopeKey("club"))).toBe(true);
  });

  it("sees nothing club-wide when they are not on the roster", () => {
    const stranger = ctx({ onRoster: false, playerId: null, groupIds: [], stageIds: [], matchIds: [], foursomeIds: [], directThreadIds: [] });
    expect(canReadScope(stranger, scopeKey("club"))).toBe(false);
  });

  it("keeps the same four in two rounds apart", () => {
    // "Group 3" on Saturday and "Group 3" on Sunday are different fours. Left
    // unqualified they would share one conversation.
    const c = ctx({ foursomeIds: [teeGroupId("s1", "Group 3")] });
    expect(canReadScope(c, scopeKey("foursome", teeGroupId("s2", "Group 3")))).toBe(false);
  });
});

describe("what staff can see", () => {
  it("reads the organizers' thread and the tournament without being in the field", () => {
    const staff = ctx({ role: "assistant", playerId: null, groupIds: [], stageIds: [], matchIds: [], foursomeIds: [] });
    expect(canReadScope(staff, scopeKey("staff"))).toBe(true);
    expect(canReadScope(staff, scopeKey("event"))).toBe(true);
  });

  /**
   * Reading what they are allowed to write.
   *
   * The comment that used to sit here said an organizer "can post to the whole
   * tournament and to any flight from the console" and then asserted they
   * could not READ that flight — while justifying it with "silently sitting
   * inside every private four's conversation", which is a foursome, a
   * different scope kind entirely. The distinction it was reaching for is real
   * and is now the actual rule: a flight, a round and a side are structures an
   * organizer administers; a four, a match and a direct message are private
   * conversations.
   *
   * What the old behaviour cost: a non-playing organizer — the ordinary case —
   * broadcast to Flight A, the send succeeded, and the thread was invisible to
   * them. The pane went blank, it was absent from their list, `markRead` was a
   * no-op, and every player reply stayed outside their unread count.
   */
  it("reads a flight, round or side it may broadcast to, without being in it", () => {
    const staff = ctx({
      role: "admin",
      playerId: null,
      groupIds: [],
      stageIds: [],
      teamIds: [],
      staffScopes: { groupIds: ["g9"], stageIds: ["s9"], teamIds: ["t9"] },
    });
    expect(canReadScope(staff, scopeKey("flight", "g9"))).toBe(true);
    expect(canReadScope(staff, scopeKey("round", "s9"))).toBe(true);
    expect(canReadScope(staff, scopeKey("team", "t9"))).toBe(true);
  });

  it("still does not read a private four, a match or a direct thread", () => {
    // The bound on the widening, and the thing the old comment actually meant.
    // These are conversations rather than structures, and `BROADCASTABLE`
    // excludes them for the same reason.
    const staff = ctx({
      role: "admin",
      playerId: null,
      groupIds: [],
      stageIds: [],
      matchIds: [],
      foursomeIds: [],
      directThreadIds: [],
      staffScopes: { groupIds: ["g9"], stageIds: ["s9"], teamIds: ["t9"] },
    });
    expect(canReadScope(staff, scopeKey("foursome", teeGroupId("s9", "Group 1")))).toBe(false);
    expect(canReadScope(staff, scopeKey("match", "m9"))).toBe(false);
    expect(canReadScope(staff, scopeKey("direct", "d9"))).toBe(false);
  });

  it("does not read another tournament's flight", () => {
    // The bound that matters most. `staffScopes` is built per event, so an id
    // from somewhere else is simply not in the list — the widening is to the
    // structures of THIS tournament and no wider.
    const staff = ctx({
      role: "admin",
      groupIds: [],
      staffScopes: { groupIds: ["g9"], stageIds: [], teamIds: [] },
    });
    expect(canReadScope(staff, scopeKey("flight", "someone-elses-flight"))).toBe(false);
  });

  it("gives a PLAYER none of it, however the context is built", () => {
    // A player never gets these ids from `membershipFor`, but the rule is in
    // `visibleScopes` rather than in the query, so it is asserted here too.
    const player = ctx({
      role: "player",
      groupIds: [],
      stageIds: [],
      teamIds: [],
      staffScopes: { groupIds: ["g9"], stageIds: ["s9"], teamIds: ["t9"] },
    });
    expect(canReadScope(player, scopeKey("flight", "g9"))).toBe(false);
    expect(canReadScope(player, scopeKey("round", "s9"))).toBe(false);
    expect(canReadScope(player, scopeKey("team", "t9"))).toBe(false);
  });

  it("lists a playing organizer's own flight once", () => {
    // They reach it by both routes. A duplicated key would inflate the `IN`
    // list every read is built from, for nothing.
    const staff = ctx({ role: "admin", groupIds: ["g1"], staffScopes: { groupIds: ["g1"], stageIds: [], teamIds: [] } });
    const keys = visibleScopes(staff).filter((k) => k === scopeKey("flight", "g1"));
    expect(keys).toHaveLength(1);
  });
});

describe("who may post", () => {
  it("lets anyone in a narrow scope talk", () => {
    const c = ctx();
    for (const key of [
      scopeKey("flight", "g1"),
      scopeKey("round", "s1"),
      scopeKey("match", "m1"),
      scopeKey("direct", "d1"),
      scopeKey("foursome", teeGroupId("s1", "Group 3")),
    ]) {
      expect(canPostToScope(c, key), key).toBe(true);
    }
  });

  it("makes the two widest scopes read-only for players", () => {
    // A field of 120 all able to reply to a club announcement is a broadcast
    // storm, not a conversation.
    const c = ctx();
    expect(canReadScope(c, scopeKey("event"))).toBe(true);
    expect(canPostToScope(c, scopeKey("event"))).toBe(false);
    expect(canPostToScope(c, scopeKey("club"))).toBe(false);
  });

  it("lets staff post to them", () => {
    const staff = ctx({ role: "admin" });
    expect(canPostToScope(staff, scopeKey("event"))).toBe(true);
    expect(canPostToScope(staff, scopeKey("club"))).toBe(true);
  });

  it("never lets anyone post to a scope they cannot read", () => {
    const c = ctx();
    expect(canPostToScope(c, scopeKey("staff"))).toBe(false);
    expect(canPostToScope(c, scopeKey("flight", "g2"))).toBe(false);
  });
});

describe("message bodies", () => {
  it("rejects whitespace-only, which is what a stray Enter sends", () => {
    expect(cleanMessageBody("   \n\t ").ok).toBe(false);
    expect(cleanMessageBody("").ok).toBe(false);
  });

  it("normalises line endings before measuring length", () => {
    const r = cleanMessageBody("a\r\nb");
    expect(r.ok).toBe(true);
    expect(r.text).toBe("a\nb");
  });

  it("caps the length", () => {
    expect(cleanMessageBody("x".repeat(MAX_MESSAGE_LENGTH)).ok).toBe(true);
    expect(cleanMessageBody("x".repeat(MAX_MESSAGE_LENGTH + 1)).ok).toBe(false);
  });
});

describe("unread", () => {
  const msgs = [
    { createdAt: 100, authorEmail: "sam@example.invalid" },
    { createdAt: 200, authorEmail: "RITA@example.invalid" },
    { createdAt: 300, authorEmail: "sam@example.invalid" },
  ];

  it("counts what arrived after the watermark", () => {
    expect(unreadCount(msgs, "rita@example.invalid", 150)).toBe(1);
    expect(unreadCount(msgs, "rita@example.invalid", null)).toBe(2);
    expect(unreadCount(msgs, "rita@example.invalid", 300)).toBe(0);
  });

  it("never counts your own, whatever case you signed up in", () => {
    // Email is identity here and arrives in whatever case someone typed.
    expect(unreadCount(msgs, "rita@example.invalid", 0)).toBe(2);
  });
});

describe("thread ordering", () => {
  it("floats unread above newer-but-read", () => {
    const sorted = sortThreads([
      { id: "a", scopeKey: "event:", title: "", lastMessageAt: 300, unread: 0 },
      { id: "b", scopeKey: "event:", title: "", lastMessageAt: 100, unread: 2 },
    ]);
    expect(sorted.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("is stable for two threads saved in the same millisecond", () => {
    const rows = [
      { id: "b", scopeKey: "event:", title: "", lastMessageAt: 100, unread: 0 },
      { id: "a", scopeKey: "event:", title: "", lastMessageAt: 100, unread: 0 },
    ];
    expect(sortThreads(rows).map((t) => t.id)).toEqual(["a", "b"]);
    expect(sortThreads([...rows].reverse()).map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("direct threads", () => {
  it("gives the same key whoever opens it first", () => {
    // Otherwise "Rita messages Sam" and "Sam messages Rita" are two threads
    // each showing half the conversation.
    expect(directKeyFor(["sam@x.test", "rita@x.test"])).toBe(
      directKeyFor(["rita@x.test", "sam@x.test"]),
    );
  });

  it("is case- and duplicate-insensitive", () => {
    expect(directKeyFor(["Rita@X.test", "rita@x.test", "sam@x.test"])).toBe("rita@x.test|sam@x.test");
  });
});

describe("players only", () => {
  it("is a separate audience from the whole tournament", () => {
    // "Everyone in this tournament" includes the committee. An organizer
    // telling the field something does not always want it landing with their
    // assistants as an announcement too.
    const c = ctx();
    expect(canReadScope(c, scopeKey("players"))).toBe(true);
    expect(canReadScope(c, scopeKey("event"))).toBe(true);
    expect(scopeKey("players")).not.toBe(scopeKey("event"));
  });

  it("is readable by staff, who sent it", () => {
    // Not a contradiction of the name: the audience is the field, but an
    // organizer who cannot see what went out to their own players has a
    // worse problem than an untidy audience list.
    const staff = ctx({ role: "admin", playerId: null, groupIds: [], stageIds: [], matchIds: [], foursomeIds: [] });
    expect(canReadScope(staff, scopeKey("players"))).toBe(true);
  });

  it("is not readable by someone outside the field entirely", () => {
    const outsider = ctx({
      playerId: null, groupIds: [], stageIds: [], matchIds: [], foursomeIds: [],
    });
    expect(canReadScope(outsider, scopeKey("players"))).toBe(false);
  });

  it("is announcements-only, like the other two broadcast scopes", () => {
    // A field of 120 all able to reply is a broadcast storm, not a
    // conversation — the same reason club and event are staff-post-only.
    expect(canPostToScope(ctx(), scopeKey("players"))).toBe(false);
    expect(canPostToScope(ctx({ role: "admin" }), scopeKey("players"))).toBe(true);
  });

  it("parses as a known kind", () => {
    expect(parseScopeKey(scopeKey("players"))).toEqual({ kind: "players", id: "" });
  });
});
