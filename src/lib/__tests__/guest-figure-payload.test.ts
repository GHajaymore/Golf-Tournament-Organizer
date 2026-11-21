import { describe, it, expect } from "vitest";
import { figureRefusal } from "@/lib/domain/tee-sheet-replace";
import { cleanGuestRegistration, figurePayload, isGuestNonce, waitingCapFor } from "@/lib/domain/guest-entry";

/**
 * THE GUEST'S FORM AND THE COMMITTEE'S FIGURE ARE VALIDATED AT THE BOUNDARY (J39/J40 PR 3B; Security Lead C1.8, C1.1).
 * A `"use server"` export is a public endpoint and types are erased, so each argument arrives as whatever was posted.
 *
 * Break-it (seen red): let `figurePayload` pass a NaN through.
 */
describe("the committee's figure is a payload", () => {
  it("accepts a finite number in the handicap range, or none", () => {
    expect(figurePayload(undefined)).toEqual({ ok: true, figure: null });
    expect(figurePayload(null)).toEqual({ ok: true, figure: null });
    expect(figurePayload(16)).toEqual({ ok: true, figure: 16 });
    expect(figurePayload(-2.4)).toEqual({ ok: true, figure: -2.4 });
    expect(figurePayload(54)).toEqual({ ok: true, figure: 54 });
  });
  it("refuses NaN, Infinity, a string, an object and a figure out of range, in words", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "12", "", {}, [], true, 54.1, -10.1, 99]) {
      const r = figurePayload(bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/handicap/i);
    }
  });
});

describe("the guest's form", () => {
  it("reads a name, a figure and who invited them; trims, squashes and bounds them", () => {
    expect(cleanGuestRegistration({ name: "  Robin   Vale ", handicap: "14.2", invitedBy: " Corin  " })).toEqual({ ok: true, value: { name: "Robin Vale", declared: 14.2, invitedBy: "Corin" } });
    expect(cleanGuestRegistration({ name: "Robin Vale", handicap: "", invitedBy: "" })).toEqual({ ok: true, value: { name: "Robin Vale", declared: null, invitedBy: "" } });
    expect(cleanGuestRegistration({ name: "Robin Vale", handicap: "+2.4" })).toMatchObject({ ok: true, value: { declared: -2.4 } });
  });
  it("refuses no name, a long name, a bad figure and an out-of-range one, each in words", () => {
    expect(cleanGuestRegistration({ name: "  " })).toMatchObject({ ok: false, error: "Type the name you'll play under." });
    expect(cleanGuestRegistration({})).toMatchObject({ ok: false });
    expect(cleanGuestRegistration(null)).toMatchObject({ ok: false });
    expect(cleanGuestRegistration({ name: "x".repeat(81) })).toMatchObject({ ok: false });
    expect(cleanGuestRegistration({ name: "Robin", handicap: "abc" })).toMatchObject({ ok: false });
    expect(cleanGuestRegistration({ name: "Robin", handicap: "70" })).toMatchObject({ ok: false });
    expect(cleanGuestRegistration({ name: "Robin", handicap: 12 })).toMatchObject({ ok: false });
    expect(cleanGuestRegistration({ name: "Robin", invitedBy: "y".repeat(81) })).toMatchObject({ ok: false });
  });
  it("has no email or phone to fill: a key the caller adds is never read", () => {
    const r = cleanGuestRegistration({ name: "Robin Vale", handicap: "", email: "a@example.invalid", phone: "0123" });
    expect(r).toEqual({ ok: true, value: { name: "Robin Vale", declared: null, invitedBy: "" } });
  });
});

describe("the retry's nonce, the waiting cap and the figure gate", () => {
  it("a nonce is at least 128 bits of base64url (22 characters)", () => {
    expect(isGuestNonce("A".repeat(22))).toBe(true);
    expect(isGuestNonce("A".repeat(21))).toBe(false);
    expect(isGuestNonce("A".repeat(22) + "!")).toBe(false);
    expect(isGuestNonce(undefined)).toBe(false);
    expect(isGuestNonce(12345)).toBe(false);
  });
  it("at most max(24, the field's limit) guests wait at once", () => {
    expect(waitingCapFor(0)).toBe(24);
    expect(waitingCapFor(8)).toBe(24);
    expect(waitingCapFor(64)).toBe(64);
    expect(waitingCapFor(144)).toBe(144);
  });
  it("a net round asks the committee's figure; a gross-only event asks none", () => {
    expect(figureRefusal(["gross", "net"], "Robin", false)).toMatch(/Type the handicap the committee gives Robin/);
    expect(figureRefusal(["gross"], "Robin", false)).toBeNull();
    expect(figureRefusal(["gross", "net"], "Robin", true)).toBeNull();
  });
});
