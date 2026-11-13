import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  LINK_ALPHABET,
  LINK_CODE_LENGTH,
  normaliseLinkCode,
  groupedCode,
  spokenCode,
  playerLinkUrl,
  linkAddress,
  lastPlayDay,
  addDays,
  passLastDay,
  passRefusal,
  mayPlayThroughLink,
  guestCookieValue,
  readGuestCookieValue,
  guestCookieRefusal,
  GUEST_COOKIE_MAX_SECONDS,
  passStatusWords,
  suggestsNewLink,
  playerLinkShareMessage,
  PLAYER_LINK_WORDS,
} from "@/lib/domain/player-link";
import { generateLinkCode } from "@/lib/codes";
import { lookupOf, sealCode, unsealCode, deviceHashOf } from "@/lib/services/player-link";
import { clubToday } from "@/lib/domain/club-clock";
import { sessionValue } from "@/lib/domain/session-token";

/**
 * A GUEST'S PLAYER LINK, THE PARTS THAT NEED NO DATABASE (J39/J40 PR 1).
 * The rows are in `a-guest-reaches-only-its-entry.audit.test.ts`.
 */

const CODE = "K7QM2XRA9DTP";
const live = { revokedAt: null, version: 1, heldVersion: 1, entryStatus: "confirmed", isGuest: true, lastDay: "2026-12-02", today: "2026-12-02" };

describe("the code", () => {
  it("is twelve Crockford symbols: 60 bits, no I, L, O or U", () => {
    expect(LINK_ALPHABET).toHaveLength(32);
    for (const ch of "ILOU") expect(LINK_ALPHABET).not.toContain(ch);
    expect(new Set(LINK_ALPHABET).size).toBe(32);
    expect(Math.log2(LINK_ALPHABET.length) * LINK_CODE_LENGTH).toBe(60);
  });
  it("is drawn from that alphabet, at that length, and differs each time", () => {
    const codes = Array.from({ length: 200 }, () => generateLinkCode());
    for (const c of codes) {
      expect(c).toHaveLength(LINK_CODE_LENGTH);
      for (const ch of c) expect(LINK_ALPHABET).toContain(ch);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });
  it("is read forgivingly: case, dashes, spaces, the read-out dot, O for 0, I and L for 1", () => {
    expect(normaliseLinkCode("K7QM-2XRA-9DTP")).toBe(CODE);
    expect(normaliseLinkCode("k7qm 2xra 9dtp")).toBe(CODE);
    expect(normaliseLinkCode(" K7QM · 2XRA · 9DTP ")).toBe(CODE);
    expect(normaliseLinkCode("1O0L-IIII-0000")).toBe("100111110000");
    expect(normaliseLinkCode("https://tourneyhq.club/p#K7QM2XRA9DTP")).toBe(CODE);
    expect(normaliseLinkCode("#K7QM2XRA9DTP")).toBe(CODE);
  });
  it("refuses what is not one: wrong length, a U, a symbol, not a string", () => {
    for (const bad of ["K7QM2XRA9DT", "K7QM2XRA9DTPP", "K7QM2XRA9DTU", "K7QM2XRA9DT!", "", 12, null, undefined, { code: CODE }]) {
      expect(normaliseLinkCode(bad), String(bad)).toBeNull();
    }
  });
  it("is written three ways, one secret; the link carries it in the fragment, never the path", () => {
    expect(groupedCode(CODE)).toBe("K7QM-2XRA-9DTP");
    expect(spokenCode(CODE)).toBe("K7QM · 2XRA · 9DTP");
    expect(playerLinkUrl("https://tourneyhq.club/", CODE)).toBe("https://tourneyhq.club/p#K7QM2XRA9DTP");
    expect(playerLinkUrl("https://tourneyhq.club", CODE)).not.toContain("/p/");
    expect(linkAddress("https://tourneyhq.club")).toBe("tourneyhq.club/p");
  });
});

describe("stored hashed, never the code (design §2.3)", () => {
  it("the lookup is stable, keyed, and not the bare hash of the code", () => {
    expect(lookupOf(CODE)).toBe(lookupOf(CODE));
    expect(lookupOf(CODE)).not.toBe(lookupOf("K7QM2XRA9DTQ"));
    expect(lookupOf(CODE)).not.toBe(createHash("sha256").update(CODE).digest("hex"));
    expect(lookupOf(CODE)).not.toContain(CODE);
  });
  it("the sealed copy opens for its own pass at its own version, and for nothing else", () => {
    const sealed = sealCode(CODE, "plabc12345", 1);
    expect(sealed).not.toContain(CODE);
    expect(unsealCode(sealed, "plabc12345", 1)).toBe(CODE);
    expect(unsealCode(sealed, "plabc12345", 2), "a rotated pass's old seal opened").toBeNull();
    expect(unsealCode(sealed, "plother9999", 1), "a seal copied to another pass opened").toBeNull();
    expect(unsealCode(sealed.slice(0, -2) + "AA", "plabc12345", 1), "a tampered seal opened").toBeNull();
    expect(sealCode(CODE, "plabc12345", 1), "the nonce is fresh each time").not.toBe(sealed);
  });
  it("a browser's hash is the link's own, not the device cookie's own hash", () => {
    expect(deviceHashOf("browser-value")).toBe(deviceHashOf("browser-value"));
    expect(deviceHashOf("browser-value")).not.toBe(createHash("sha256").update("browser-value").digest("hex"));
  });
});

describe("when a pass is live (design §2.6)", () => {
  it("lives while nothing ends it", () => {
    expect(passRefusal(live)).toBeNull();
    expect(passRefusal({ ...live, heldVersion: null }), "opened from its code, any current version").toBeNull();
    expect(passRefusal({ ...live, entryStatus: "pending" }), "pending: live, for Today only").toBeNull();
    expect(passRefusal({ ...live, entryStatus: "waitlisted" })).toBeNull();
  });
  it("ends turned off, rotated, withdrawn, disqualified or replaced, and made a member", () => {
    expect(passRefusal({ ...live, revokedAt: new Date() })).toBe("revoked");
    expect(passRefusal({ ...live, version: 2, heldVersion: 1 })).toBe("rotated");
    for (const s of ["withdrawn", "disqualified", ""]) expect(passRefusal({ ...live, entryStatus: s }), s).toBe("left");
    expect(passRefusal({ ...live, isGuest: false })).toBe("member");
  });
  it("ends after the 90th CLUB day after the last round: the day, not the instant", () => {
    expect(passLastDay("2026-12-02")).toBe("2027-03-02");
    expect(passRefusal({ ...live, today: "2027-03-02" }), "the 90th day still opens").toBeNull();
    expect(passRefusal({ ...live, today: "2027-03-03" })).toBe("expired");
    // E2E_TZ=Pacific/Auckland: at 2027-03-02 13:00 UTC it is already 3 March at the club.
    const instant = new Date("2027-03-02T13:00:00Z");
    expect(passRefusal({ ...live, today: clubToday("Pacific/Auckland", instant) }), "the club's day ended it").toBe("expired");
    expect(passRefusal({ ...live, today: clubToday("UTC", instant) }), "a UTC club is still on the 90th day").toBeNull();
  });
  it("finds the last day of golf from the rounds and the event's own days; none, no day-expiry", () => {
    expect(lastPlayDay({ startOn: "2026-12-01", endOn: "2026-12-02" }, [{ playedOn: "2026-12-05" }, { playedOn: "" }])).toBe("2026-12-05");
    expect(lastPlayDay({ startOn: "", endOn: "" }, [])).toBe("");
    expect(passRefusal({ ...live, lastDay: "", today: "2099-01-01" })).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("S5: only a CONFIRMED entrant plays through a link", () => {
    expect(mayPlayThroughLink("confirmed")).toBe(true);
    for (const s of ["pending", "waitlisted", "withdrawn", "disqualified", ""]) expect(mayPlayThroughLink(s), s).toBe(false);
  });
});

describe("the guest cookie (S6)", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  it("reads back exactly what it wrote, and never holds the code", () => {
    const v = guestCookieValue("plabc12345", 3, now);
    expect(v.startsWith("guest1~")).toBe(true);
    expect(readGuestCookieValue(v)).toEqual({ passId: "plabc12345", version: 3, issuedAt: Math.floor(now.getTime() / 1000) });
  });
  it("no other cookie's signed value stands in for it: a session, a round code's play value, an event id", () => {
    for (const other of [
      sessionValue("cmabc123456789", now),
      `stage123:player456:${now.getTime()}:fp`,
      "cmevent1234567",
      "guest1~plabc12345:3",
      "guest1~plabc12345:3:abc:extra",
      "guest2~plabc12345:3:abc",
      "guest1~PLABC12345:3:abc",
      "guest1~plabc12345:0:abc",
    ]) {
      expect(readGuestCookieValue(other), other).toBeNull();
    }
  });
  it("is refused by the server after 180 days, whatever the browser keeps, and when dated ahead", () => {
    const held = readGuestCookieValue(guestCookieValue("plabc12345", 1, now))!;
    expect(guestCookieRefusal(held, new Date(now.getTime() + (GUEST_COOKIE_MAX_SECONDS - 60) * 1000))).toBeNull();
    expect(guestCookieRefusal(held, new Date(now.getTime() + (GUEST_COOKIE_MAX_SECONDS + 60) * 1000))).toBe("expired");
    expect(guestCookieRefusal(held, new Date(now.getTime() - 3600 * 1000))).toBe("not yet");
  });
});

describe("the organizer's panel and the share message", () => {
  it("says where the link stands, and suggests a new one at three browsers, never refuses one", () => {
    expect(passStatusWords({ made: false, revoked: false, browsers: 0, lastOpened: "" })).toBe("Not made yet");
    expect(passStatusWords({ made: true, revoked: false, browsers: 0, lastOpened: "" })).toBe("Not opened yet");
    expect(passStatusWords({ made: true, revoked: false, browsers: 1, lastOpened: "3 Nov" })).toBe("Opened on 1 phone or browser · last 3 Nov");
    expect(passStatusWords({ made: true, revoked: true, browsers: 2, lastOpened: "" })).toMatch(/^Turned off/);
    expect(suggestsNewLink({ made: true, revoked: false, browsers: 2, lastOpened: "" })).toBe(false);
    expect(suggestsNewLink({ made: true, revoked: false, browsers: 3, lastOpened: "" })).toBe(true);
  });
  it("carries the first name only, the link, the address and the code; never a bet", () => {
    const m = playerLinkShareMessage({ name: "Robin Vale", eventName: "Larkfield Spring Outing", link: playerLinkUrl("https://tourneyhq.club", CODE), address: "tourneyhq.club/p", code: CODE });
    expect(m.startsWith("Robin, here is your player link for Larkfield Spring Outing")).toBe(true);
    expect(m).not.toContain("Vale");
    expect(m).toContain("https://tourneyhq.club/p#K7QM2XRA9DTP");
    expect(m).toContain("K7QM-2XRA-9DTP");
    expect(m).toContain("Keep it to yourself.");
    expect(m.toLowerCase()).not.toMatch(/\bbet\b/);
  });
  it("never calls a guest lesser, and never says closed", () => {
    const all = JSON.stringify(PLAYER_LINK_WORDS) + PLAYER_LINK_WORDS.sendToOne("Robin") + PLAYER_LINK_WORDS.otherPhone("3 Nov");
    expect(all).not.toMatch(/\b(just|limited|basic|closed)\b/i);
  });
});
