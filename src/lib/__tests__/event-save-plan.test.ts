import { describe, it, expect } from "vitest";
import { eventSavePlan, failureWords, playSettingsDirty, playSettingsToSave, runSavePlan, type SaveStep } from "@/components/event/event-save-plan";

/** The one Save's plan, worked by hand: what is sent, in what order, and what is said when it stops. */
describe("eventSavePlan", () => {
  const b = [false, true];
  for (const locked of b) for (const details of b) for (const dates of b) for (const tee of b) for (const policy of b) {
    const plan = eventSavePlan({ locked, details, dates, tee, policy });
    it(`locked=${locked} details=${details} dates=${dates} tee=${tee} policy=${policy} -> ${plan.join(", ") || "nothing"}`, () => {
      // By hand: open sends the details (the days are inside them); locked sends the days alone; then the tees, then the policy.
      const want: SaveStep[] = [];
      if (locked ? dates : details) want.push(locked ? "setTournamentDates" : "saveEvent");
      if (tee) want.push("tee");
      if (policy) want.push("policy");
      expect(plan).toEqual(want);
      // Never both of the two event writes in one press, and never saveEvent while locked.
      expect(plan.includes("saveEvent") && plan.includes("setTournamentDates")).toBe(false);
      if (locked) expect(plan).not.toContain("saveEvent");
      // Lit for something means there is something to send.
      const lit = (locked ? dates : details) || tee || policy;
      expect(plan.length > 0).toBe(lit);
    });
  }
});

describe("what the screen says when the press stops", () => {
  it("names what was kept and what was not, for each stopping point", () => {
    expect(failureWords(["saveEvent"], "tee", false, null)).toBe("The details were saved. The tees were not: that didn't reach us. Press Save to finish.");
    expect(failureWords(["saveEvent", "tee"], "policy", false, "Nope.")).toBe("The details and the tees were saved. Who may play other tees was not: Nope. Press Save to finish.");
    expect(failureWords(["setTournamentDates"], "tee", true, "Round 1 has cards.")).toBe("The days were saved. The tees were not: Round 1 has cards. Press Save to finish.");
    expect(failureWords([], "saveEvent", false, "Name the tournament before saving.")).toBe("Name the tournament before saving.");
    expect(failureWords([], "saveEvent", false, null)).toBe("That didn't reach us. Press Save to try again.");
  });
});

describe("runSavePlan: a thrown or refused call is words, never an escape, and a retry sends only what is left", () => {
  it("a throw on the tee keeps the details, says so, and the retry sends the tee alone", async () => {
    const sent: SaveStep[] = [];
    let tee = "throws";
    const run = async (s: SaveStep) => {
      sent.push(s);
      if (s === "tee" && tee === "throws") throw new Error("network");
      return { ok: true };
    };
    const first = await runSavePlan(["saveEvent", "tee", "policy"], run, false);
    expect(first.done).toEqual(["saveEvent"]);
    expect(first.error).toBe("The details were saved. The tees were not: that didn't reach us. Press Save to finish.");
    expect(sent).toEqual(["saveEvent", "tee"]); // stopped: the policy was not tried
    // The screen kept the details, so its next plan leaves them out.
    tee = "works";
    sent.length = 0;
    const retry = await runSavePlan(eventSavePlan({ locked: false, details: false, dates: false, tee: true, policy: true }), run, false);
    expect(retry).toEqual({ done: ["tee", "policy"], error: null });
    expect(sent).toEqual(["tee", "policy"]);
  });

  it("a refusal stops the press with the server's words", async () => {
    const r = await runSavePlan(["setTournamentDates", "tee"], async (s) => (s === "tee" ? { ok: false, error: "Those tees aren't on this course." } : { ok: true }), true);
    expect(r.done).toEqual(["setTournamentDates"]);
    expect(r.error).toBe("The days were saved. The tees were not: Those tees aren't on this course. Press Save to finish.");
  });
});

describe("Players & scoring does not write back the policy Event keeps", () => {
  const form = { teePolicy: "one", scoreEntryBy: "players" };
  const stored = { teePolicy: "flight", scoreEntryBy: "players" };
  it("with the tees on Event the payload leaves the policy out and the card is not 'unsaved' for it", () => {
    expect(playSettingsToSave(form, false)).toEqual({ scoreEntryBy: "players" });
    expect(playSettingsDirty(form, stored, false)).toBe(false);
  });
  it("CONTROL: with the tees drawn here the policy is sent and counts", () => {
    expect(playSettingsToSave(form, true)).toEqual(form);
    expect(playSettingsDirty(form, stored, true)).toBe(true);
    expect(playSettingsDirty({ ...form, scoreEntryBy: "staff" }, stored, false)).toBe(true);
  });
});
