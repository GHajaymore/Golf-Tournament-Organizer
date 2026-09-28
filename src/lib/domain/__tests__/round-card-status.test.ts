import { describe, expect, it } from "vitest";
import { roundCardStatus, type CardSource } from "../round-card-status";

/**
 * WHETHER A ROUND HAS THE CARD ITS FORMAT SCORES WITH (Ajay, 2026-09-28).
 *
 * Only "missing" stops a launch, so every way this could refuse a round that is
 * perfectly playable is asserted as a CONTROL beside the way it should refuse —
 * "a guard that refuses a real golf course is worse than no guard".
 */
const card = (over: Partial<CardSource> = {}): CardSource => ({ name: "zz-Links", hasCard: true, unchecked: false, ...over });
const medal = { format: "Stroke Play", scoringBasis: "net" };
const grossMatch = { format: "Match Play", scoringBasis: "gross" };
const netMatch = { format: "Match Play", scoringBasis: "net" };
const base = { roundVenue: null, eventCard: null, cardedVenues: 0, openCourse: false };

describe("a round that needs a card", () => {
  it("is ready when the tournament has one", () => {
    expect(roundCardStatus({ ...base, round: medal, eventCard: card() })).toBe("ready");
  });

  it("is missing when nothing resolves — the one status that stops launch", () => {
    expect(roundCardStatus({ ...base, round: medal })).toBe("missing");
    expect(roundCardStatus({ ...base, round: netMatch })).toBe("missing");
  });

  it("is missing when ITS OWN venue has no card, even though the home course does", () => {
    // Falling back would score a round played at Ardmore against the home
    // course's pars — the silent wrong-course case this exists to stop.
    const status = roundCardStatus({ ...base, round: medal, roundVenue: card({ name: "zz-Ardmore", hasCard: false }), eventCard: card() });
    expect(status).toBe("missing");
  });

  it("is unchecked — a warning, not a stop — on an imported card nobody confirmed", () => {
    expect(roundCardStatus({ ...base, round: medal, eventCard: card({ unchecked: true }) })).toBe("unchecked");
  });
});

describe("CONTROLS — a round that must never be refused", () => {
  it("gross match play needs no card at all", () => {
    expect(roundCardStatus({ ...base, round: grossMatch })).toBe("not-needed");
  });

  it("a tournament where players choose the course names it per match", () => {
    expect(roundCardStatus({ ...base, round: medal, openCourse: true })).toBe("ready");
  });

  it("a round with no venue of its own, in a tournament with carded venues, is scored per match", () => {
    expect(roundCardStatus({ ...base, round: medal, cardedVenues: 2 })).toBe("ready");
  });

  it("a round at its own carded venue is ready whatever the tournament holds", () => {
    expect(roundCardStatus({ ...base, round: medal, roundVenue: card({ name: "zz-Ardmore" }) })).toBe("ready");
  });
});
