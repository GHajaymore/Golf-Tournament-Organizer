import { describe, it, expect } from "vitest";
import { clubToday } from "@/lib/domain/club-clock";
import { daysToFirstRoundFrom, promotionReplyLine } from "@/lib/domain/promotion";
import { readSource } from "@/lib/__tests__/source";

/**
 * The promotion email's reply line follows how near the first round is, by the
 * CLUB's day. A place can now open on the morning of play (day-of field
 * changes), when "within 48 hours" would be no help to anyone.
 */
const say = (days: number | null) => {
  const l = promotionReplyLine(days);
  return l.before + l.strong + l.after;
};

describe("promotionReplyLine: the boundaries", () => {
  it("keeps the 48 hours three or more days out", () => {
    expect(say(3)).toBe(
      "If you can no longer play, please tell the organizer within 48 hours so the place can go to the next person on the list.",
    );
    expect(say(30)).toContain("within 48 hours");
  });

  it("two days out asks for an early answer, not a window", () => {
    expect(say(2)).toBe(
      "The first round is in two days. If you can no longer play, please tell the organizer as soon as you can so the place can go to the next person on the list.",
    );
    expect(say(2)).not.toContain("48");
  });

  it("the day before says tomorrow and asks straight away", () => {
    expect(say(1)).toBe(
      "The first round is tomorrow. If you can no longer play, please tell the organizer straight away so the place can go to the next person on the list.",
    );
  });

  it("on the day says today and asks straight away", () => {
    expect(say(0)).toBe(
      "The first round is today. If you can no longer play, please tell the organizer straight away so the place can go to the next person on the list.",
    );
  });

  it("a tournament already under way says so", () => {
    expect(say(-1)).toContain("The tournament has already started.");
    expect(say(-1)).toContain("straight away");
  });

  it("an undated round keeps the 48 hours the organizer's badge uses", () => {
    expect(say(null)).toContain("within 48 hours");
  });

  it("never threatens or invents a deadline the app does not enforce", () => {
    for (const d of [null, -3, 0, 1, 2, 3, 10]) {
      expect(say(d)).not.toMatch(/will be (given|passed|released)|deadline|\bbet\b/i);
    }
  });
});

describe("the days are the CLUB's, not the server's", () => {
  // 2026-11-10 20:00 UTC is already 2026-11-11 09:00 in Auckland (UTC+13).
  const instant = new Date("2026-11-10T20:00:00Z");
  const stages = [{ type: "Stroke Play Round", playedOn: "2026-11-11" }];

  it("a round dated the 11th is TODAY at an Auckland club and TOMORROW on the server's UTC day", () => {
    const auckland = clubToday("Pacific/Auckland", instant);
    const utc = clubToday("UTC", instant);
    expect(auckland).toBe("2026-11-11");
    expect(utc).toBe("2026-11-10");
    expect(daysToFirstRoundFrom({ startOn: "", stages }, auckland)).toBe(0);
    expect(daysToFirstRoundFrom({ startOn: "", stages }, utc)).toBe(1);
    expect(say(daysToFirstRoundFrom({ startOn: "", stages }, auckland))).toContain("The first round is today.");
  });

  it("3, 2, 1 and 0 days out, counted from the Auckland day", () => {
    const today = clubToday("Pacific/Auckland", instant); // 2026-11-11
    const out = (day: string) => daysToFirstRoundFrom({ startOn: "", stages: [{ type: "Stroke Play Round", playedOn: day }] }, today);
    expect([out("2026-11-14"), out("2026-11-13"), out("2026-11-12"), out("2026-11-11")]).toEqual([3, 2, 1, 0]);
  });

  it("skips a stage the field does not play, even when it comes first by position", () => {
    const today = "2026-11-11";
    const stages = [
      { type: "not a playing stage", playedOn: "2026-11-11" },
      { type: "Stroke Play Round", playedOn: "2026-11-15" },
    ];
    expect(daysToFirstRoundFrom({ startOn: "", stages }, today)).toBe(4);
  });

  it("takes the first PLAYING round's own day, else the tournament's first day", () => {
    const today = "2026-11-11";
    expect(daysToFirstRoundFrom({ startOn: "2026-11-20", stages: [{ type: "Stroke Play Round", playedOn: "" }] }, today)).toBe(9);
    expect(daysToFirstRoundFrom({ startOn: "2026-11-20", stages: [{ type: "Stroke Play Round", playedOn: "2026-11-12" }] }, today)).toBe(1);
    expect(daysToFirstRoundFrom({ startOn: "", stages: [{ type: "Stroke Play Round", playedOn: "" }] }, today)).toBeNull();
  });
});

describe("the wiring", () => {
  it("the notifier asks the CLUB's day, never new Date()", () => {
    const notify = readSource("src", "lib", "services", "field-notify.ts");
    expect(notify).toContain("todayForEvent(eventId)");
    expect(notify).not.toContain("new Date()");
  });

  it("a round's day is read by ONE function in both places", () => {
    expect(readSource("src", "lib", "domain", "promotion.ts")).toContain("roundDayOf(");
    expect(readSource("src", "lib", "services", "field-change.ts")).toContain("roundDayOf(");
  });
});
