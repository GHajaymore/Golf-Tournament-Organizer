import { describe, it, expect } from "vitest";
import {
  classifySendFailure,
  summariseEmailTrouble,
  TROUBLE_WINDOW_MS,
  type EmailFailureRow,
} from "@/lib/domain/email-trouble";

const now = Date.UTC(2026, 7, 16, 12, 0, 0);
const ago = (ms: number) => now - ms;
const row = (over: Partial<EmailFailureRow> = {}): EmailFailureRow => ({
  reason: "quota",
  kind: "registration",
  createdAt: ago(60_000),
  ...over,
});

describe("classifying a provider error", () => {
  it("reads the allowance errors the provider actually sends", () => {
    // Matched on prose as well as status because the provider reports its
    // allowance in words and the SDK does not always carry a status alongside.
    for (const message of [
      "You can only send 100 emails per day",
      "Too many requests",
      "Rate limit exceeded",
      "Daily quota exceeded",
      "Monthly allowance reached",
    ]) {
      expect(classifySendFailure(message), message).toBe("quota");
    }
    expect(classifySendFailure("Something else", 429)).toBe("quota");
  });

  it("calls anything unrecognised a rejection, not a quota problem", () => {
    // Deliberate. Telling an operator to upgrade their plan when the real
    // problem is a typo'd address sends them somewhere that cannot help; a
    // vague diagnosis is better than a confidently wrong one.
    expect(classifySendFailure("Invalid `to` field")).toBe("rejected");
    expect(classifySendFailure("")).toBe("rejected");
    expect(classifySendFailure("recipient domain does not exist")).toBe("rejected");
  });

  it("separates having no key from being refused", () => {
    expect(classifySendFailure("Email isn't configured on this server.")).toBe("unconfigured");
  });
});

describe("the banner", () => {
  it("says nothing when nothing has failed", () => {
    expect(summariseEmailTrouble([], now)).toBeNull();
  });

  it("ignores failures older than the window", () => {
    // A bad address from last month is not news on a screen about today.
    expect(summariseEmailTrouble([row({ createdAt: ago(TROUBLE_WINDOW_MS + 1000) })], now)).toBeNull();
  });

  it("leads with the quota, because that one is still happening", () => {
    // A rejected address affects one person and is already over. An exhausted
    // allowance affects everyone for the rest of the day, so it wins.
    const summary = summariseEmailTrouble(
      [row({ reason: "rejected" }), row({ reason: "quota" }), row({ reason: "rejected" })],
      now,
    );
    expect(summary?.severity).toBe("danger");
    expect(summary?.count).toBe(1);
    expect(summary?.title).toMatch(/allowance/);
  });

  it("says the entries are fine, which is the first thing an organizer will fear", () => {
    const summary = summariseEmailTrouble([row(), row()], now);
    expect(summary?.detail).toMatch(/Entries and accounts are unaffected/);
    expect(summary?.detail).toMatch(/2 players did not get their registration confirmation/);
  });

  it("spells out that a failed reset locks somebody out", () => {
    // The two kinds are not equally serious. A missing confirmation is an
    // annoyance; a missing reset link means that person cannot sign in at all.
    const summary = summariseEmailTrouble([row({ kind: "reset" })], now);
    expect(summary?.detail).toMatch(/cannot sign back in/);
  });

  it("counts both kinds in one line rather than two banners", () => {
    const summary = summariseEmailTrouble(
      [row({ kind: "registration" }), row({ kind: "reset" }), row({ kind: "registration" })],
      now,
    );
    expect(summary?.count).toBe(3);
    expect(summary?.detail).toMatch(/2 players/);
    expect(summary?.detail).toMatch(/One password reset link/);
  });

  it("is a softer warning when it is only a bad address", () => {
    const summary = summariseEmailTrouble([row({ reason: "rejected" })], now);
    expect(summary?.severity).toBe("warning");
    expect(summary?.detail).toMatch(/mistyped address/);
  });

  it("reads properly for exactly one", () => {
    const summary = summariseEmailTrouble([row()], now);
    expect(summary?.title).toMatch(/1 email was refused/);
    expect(summary?.detail).toMatch(/One player did not get/);
  });
});
