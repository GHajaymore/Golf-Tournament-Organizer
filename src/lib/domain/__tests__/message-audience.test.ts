import { describe, it, expect } from "vitest";
import { messageAudience } from "../message-audience";

/**
 * Who a message goes to, when two controls have both had a say.
 *
 * "Who is this for?" sits above a group select and a "…or one person" select.
 * The person wins, nothing said so, and picking one blanked the group select
 * to a value none of its options carries — so the card asked a question and
 * displayed no answer.
 */
describe("who a message is for", () => {
  it("goes to the chosen group when no person is picked", () => {
    const a = messageAudience({ personName: "", scopeLabel: "Your group — Group 1", alsoText: false });
    expect(a.direct).toBe(false);
    expect(a.name).toBe("Your group — Group 1");
    expect(a.textNote).toBe("");
  });

  it("lets the person win over the group, and says it is direct", () => {
    // Both controls hold a value at once — this is the case the screen used to
    // render as a blank select.
    const a = messageAudience({
      personName: "zz-Sam Ellis",
      scopeLabel: "Your group — Group 1",
      alsoText: false,
    });
    expect(a.direct).toBe(true);
    expect(a.name).toBe("zz-Sam Ellis");
    expect(a.detail).toContain("nobody else sees");
  });

  it("says the text will not go when a person is picked", () => {
    // canText is false the moment a person is picked, which HIDES the whole
    // checkbox with the tick still set and reverts the button from
    // "Send + text" to "Send". Somebody does not get a promised message.
    const a = messageAudience({ personName: "zz-Sam Ellis", scopeLabel: "Everyone", alsoText: true });
    expect(a.textNote).toContain("goes in the app only");
  });

  it("stays quiet about texts when one will actually go", () => {
    expect(messageAudience({ personName: "", scopeLabel: "Everyone", alsoText: true }).textNote).toBe("");
    expect(
      messageAudience({ personName: "zz-Sam", scopeLabel: "Everyone", alsoText: false }).textNote,
    ).toBe("");
  });

  it("never renders 'everyone in .' for a group with no label", () => {
    // The opening state of a tournament with nothing to compose to. Saying
    // nothing beats saying something false.
    const a = messageAudience({ personName: "", scopeLabel: "", alsoText: false });
    expect(a.name).toBe("this tournament");
    expect(a.name).not.toBe("");
  });

  it("writes a sentence that reads, whichever kind of group it is", () => {
    // Read off the screen, 2026-10-13: "Going to everyone in Everyone at the club." The card put
    // "everyone in" before every label, and four of the labels already say who they are.
    const said = (scopeLabel: string, personName = "") => {
      const a = messageAudience({ personName, scopeLabel, alsoText: false });
      return a.lead + a.said;
    };
    // A group that is a description of its members IS the sentence, in the sentence's own case.
    expect(said("Everyone at the club")).toBe("Going to everyone at the club");
    expect(said("Everyone at the society")).toBe("Going to everyone at the society");
    expect(said("Everyone in this tournament")).toBe("Going to everyone in this tournament");
    expect(said("Everyone in this round")).toBe("Going to everyone in this round");
    expect(said("Players only")).toBe("Going to players only");
    expect(said("Organizers only")).toBe("Going to organizers only");
    expect(said("Your group — Group 1")).toBe("Going to your group — Group 1");
    expect(said("Your team")).toBe("Going to your team");
    // A group with a NAME is somewhere people are in.
    expect(said("Flight A")).toBe("Going to everyone in Flight A");
    expect(said("Seniors")).toBe("Going to everyone in Seniors");
    expect(said("Round 2 — Stroke Play")).toBe("Going to everyone in Round 2 — Stroke Play");
    expect(said("The Blues")).toBe("Going to everyone in The Blues");
    // A name that merely BEGINS like one of those words is still a name.
    expect(said("Yourkshire Terriers")).toBe("Going to everyone in Yourkshire Terriers");
    expect(said("Everyones Favourites")).toBe("Going to everyone in Everyones Favourites");
    // Nothing to send to, and one person.
    expect(said("")).toBe("Going to everyone in this tournament");
    expect(said("Flight A", "zz-Sam Ellis")).toBe("Going to zz-Sam Ellis");
    // And no sentence says "everyone" twice.
    for (const label of ["Everyone at the club", "Everyone in this tournament", "Players only", "Flight A", ""]) {
      expect(said(label).toLowerCase().split("everyone").length - 1, label).toBeLessThanOrEqual(1);
    }
  });

  it("treats a whitespace-only name as no person", () => {
    const a = messageAudience({ personName: "   ", scopeLabel: "Everyone", alsoText: true });
    expect(a.direct).toBe(false);
    expect(a.name).toBe("Everyone");
  });
});
