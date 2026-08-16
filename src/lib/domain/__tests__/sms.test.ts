import { describe, it, expect } from "vitest";
import {
  canFanOutToSms,
  segmentCount,
  isGsm7,
  toGsmSafe,
  composeSms,
  inboundIntent,
  normalizePhone,
  samePhone,
  planFanOut,
  MAX_SMS_SEGMENTS,
  estimateCost,
  formatCost,
  type SmsRecipient,
} from "@/lib/domain/sms";

describe("which scopes may text at all", () => {
  it("allows the ones an organizer broadcasts to", () => {
    for (const k of ["club", "event", "flight", "round", "team"] as const) {
      expect(canFanOutToSms(k), k).toBe(true);
    }
  });

  it("never texts a chat scope", () => {
    // A fourball's thread is where somebody says "putting now" nine times.
    // At a few pence each across a field, that is a bill nobody agreed to —
    // so this is permanent, not a setting.
    for (const k of ["foursome", "match", "direct", "staff"] as const) {
      expect(canFanOutToSms(k), k).toBe(false);
    }
  });
});

describe("what a message costs", () => {
  it("counts a short plain message as one segment", () => {
    expect(segmentCount("Tee times are up")).toBe(1);
    expect(segmentCount("x".repeat(160))).toBe(1);
    expect(segmentCount("x".repeat(161))).toBe(2);
  });

  it("counts an emoji message in the much smaller unicode segments", () => {
    // The trap: one character outside GSM-7 drops the whole message from 160
    // characters a segment to 70.
    expect(isGsm7("Tee times are up ⛳")).toBe(false);
    expect(segmentCount("x".repeat(71))).toBe(1);
    expect(segmentCount(`${"x".repeat(71)}⛳`)).toBe(2);
  });

  it("charges two slots for the extended characters", () => {
    // Square brackets and the euro sign are GSM-7 but cost double.
    expect(segmentCount(`${"x".repeat(159)}[`)).toBe(2);
  });

  it("substitutes the characters that silently double a bill", () => {
    // A curly apostrophe is what a phone keyboard produces, and it alone
    // halves the characters per segment.
    const typed = "Don’t forget — we’re off at 8:10…";
    expect(isGsm7(typed)).toBe(false);
    expect(isGsm7(toGsmSafe(typed))).toBe(true);
    expect(toGsmSafe(typed)).toBe("Don't forget - we're off at 8:10...");
  });
});

describe("composing", () => {
  it("names the club and says how to stop", () => {
    const { text } = composeSms("Brookfield GC", "Frost delay, 30 minutes");
    expect(text.startsWith("Brookfield GC: ")).toBe(true);
    expect(text).toContain("Reply STOP to opt out");
  });

  it("never lets the opt-out be the part that gets cut", () => {
    // A programme without a visible opt-out is what regulators act on, so it
    // is counted before the body is trimmed rather than appended after.
    const { text, truncated, segments } = composeSms("Brookfield GC", "x".repeat(2000));
    expect(truncated).toBe(true);
    expect(text).toContain("Reply STOP to opt out");
    expect(text.startsWith("Brookfield GC: ")).toBe(true);
    expect(segments).toBeLessThanOrEqual(MAX_SMS_SEGMENTS);
  });

  it("leaves a message that already fits completely alone", () => {
    const { truncated } = composeSms("BGC", "Tee times are up on the app");
    expect(truncated).toBe(false);
  });

  it("copes with a club that has no name set", () => {
    const { text } = composeSms("", "Tee times are up");
    expect(text.startsWith("Tee times are up")).toBe(true);
  });
});

describe("an inbound reply", () => {
  it("honours every keyword a carrier expects", () => {
    for (const w of ["STOP", "stop", " Stop. ", "UNSUBSCRIBE", "cancel", "quit"]) {
      expect(inboundIntent(w), w).toBe("stop");
    }
    for (const w of ["START", "unstop", "YES"]) expect(inboundIntent(w), w).toBe("start");
    expect(inboundIntent("HELP")).toBe("help");
  });

  it("does not read a sentence containing the word stop as an opt-out", () => {
    // "we had to stop at the turn" is not an opt-out, and treating it as one
    // silently loses somebody their tee times.
    expect(inboundIntent("we had to stop at the turn")).toBe("other");
    expect(inboundIntent("can you stop putting me in flight B")).toBe("other");
  });
});

describe("phone numbers", () => {
  it("keeps an international number intact", () => {
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalizePhone("0044 7700 900123")).toBe("+447700900123");
  });

  it("applies a country code to a national number, dropping the trunk zero", () => {
    expect(normalizePhone("07700 900123", "44")).toBe("+447700900123");
  });

  it("refuses to guess a country code it wasn't given", () => {
    // Guessing is how a club texts a stranger in another country.
    expect(normalizePhone("07700 900123")).toBe("07700900123".replace(/\D/g, ""));
  });

  it("matches the same number written two ways", () => {
    expect(samePhone("+44 7700 900123", "07700 900123")).toBe(true);
    expect(samePhone("(0161) 496 0198", "0161 496 0198")).toBe(true);
    expect(samePhone("07700 900123", "07700 900124")).toBe(false);
    expect(samePhone("", "07700 900123")).toBe(false);
  });
});

describe("planning a fan-out", () => {
  const r = (name: string, phone: string, smsOptIn: boolean): SmsRecipient => ({ name, phone, smsOptIn });

  it("sends only to people who opted in", () => {
    // Handing over a number so the organizer can ring you about a tee time is
    // not agreeing to bulk texts. Conflating the two is what gets an SMS
    // programme shut down.
    const plan = planFanOut(
      [r("Rita", "+447700900123", true), r("Sam", "+447700900124", false)],
      "Frost delay",
    );
    expect(plan.send.map((x) => x.name)).toEqual(["Rita"]);
    expect(plan.skipped[0]).toEqual({ name: "Sam", reason: "hasn't opted in to texts" });
  });

  it("skips anyone with no number, and says so", () => {
    const plan = planFanOut([r("Dev", "", true)], "Frost delay");
    expect(plan.send).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("no mobile number");
  });

  it("charges a shared number once", () => {
    // A couple entered separately on one mobile is one text and one charge.
    const plan = planFanOut(
      [r("Rita", "+44 7700 900123", true), r("Pat", "07700 900123", true)],
      "Frost delay",
    );
    expect(plan.send).toHaveLength(1);
    expect(plan.skipped[0].reason).toMatch(/same number/);
  });

  it("totals what the send will actually be billed as", () => {
    const long = "x".repeat(200); // two segments
    const plan = planFanOut(
      [r("A", "+447700900001", true), r("B", "+447700900002", true), r("C", "+447700900003", true)],
      long,
    );
    expect(plan.segmentsEach).toBe(2);
    expect(plan.totalSegments).toBe(6);
  });

  it("costs nothing when nobody has opted in", () => {
    const plan = planFanOut([r("A", "+447700900001", false)], "hello");
    expect(plan.totalSegments).toBe(0);
  });
});

describe("what it costs the club", () => {
  it("says nothing when the club hasn't set a rate", () => {
    // A made-up price is worse than no price, because an organizer will
    // believe it — and the US and UK differ by roughly four times.
    expect(estimateCost(100, 0)).toBeNull();
    expect(formatCost(null)).toBe("");
  });

  it("works out a US-style send", () => {
    // ~$0.011 a segment all-in, 60 people, one segment each.
    expect(estimateCost(60, 11_000)).toBeCloseTo(0.66, 5);
    expect(formatCost(estimateCost(60, 11_000))).toBe("about $0.66");
  });

  it("works out a UK-style send in the club's own symbol", () => {
    expect(formatCost(estimateCost(60, 40_000), "£")).toBe("about £2.40");
  });

  it("rounds up, never down", () => {
    // A send that comes in over the number they were shown is a broken
    // promise; under is a pleasant surprise.
    expect(formatCost(estimateCost(1, 11_000))).toBe("about $0.02");
    expect(formatCost(estimateCost(3, 11_000))).toBe("about $0.04");
  });

  it("never shows a tiny send as free", () => {
    expect(formatCost(estimateCost(1, 1))).toBe("about $0.01");
  });

  it("scales with segments, which is the point of counting them", () => {
    // The two-segment message costs exactly double, which is why the composer
    // bothers to strip curly quotes.
    const one = estimateCost(60, 11_000)!;
    const two = estimateCost(120, 11_000)!;
    expect(two).toBeCloseTo(one * 2, 5);
  });
});
