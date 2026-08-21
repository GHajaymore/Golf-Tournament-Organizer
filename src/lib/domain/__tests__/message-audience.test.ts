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

  it("treats a whitespace-only name as no person", () => {
    const a = messageAudience({ personName: "   ", scopeLabel: "Everyone", alsoText: true });
    expect(a.direct).toBe(false);
    expect(a.name).toBe("Everyone");
  });
});
