import { describe, it, expect } from "vitest";
import { postRefusal, canPost } from "../announcement-post";

describe("when an announcement can be posted", () => {
  it("lets a titled post through, with or without a message", () => {
    expect(postRefusal("Frost delay", "First tee 9:30")).toBeNull();
    // The message is genuinely optional — a title alone is a whole notice.
    expect(postRefusal("Halfway house is open", "")).toBeNull();
    expect(canPost("Frost delay", "")).toBe(true);
  });

  it("does not accept whitespace as a title", () => {
    // The server action trims before it decides, so a screen that accepted
    // spaces would post nothing and say it had.
    expect(canPost("   ", "First tee 9:30")).toBe(false);
    expect(canPost("\n\t ", "")).toBe(false);
  });
});

describe("what it says when it refuses", () => {
  /**
   * TWO DIFFERENT REFUSALS, and the distinction is the point of the module.
   *
   * The organizer who typed a message and no title has not forgotten a field —
   * they think the message IS the announcement, which is a reasonable reading
   * of a box labelled "Message". Telling them to "add a title" answers a
   * question they did not ask. Telling them the title is what players see on
   * their dashboard explains why the app wants one.
   *
   * Asserted as two DIFFERENT strings rather than two non-null values,
   * because "returns some message either way" is exactly what the silent
   * version would have satisfied if it had returned a constant.
   */
  it("explains what the title is FOR when a message was written without one", () => {
    const why = postRefusal("", "First tee 9:30, back nine start for groups 5-8.");
    expect(why).toBe("Give this a title — it's the line players see on their dashboard.");
  });

  it("just asks for one when nothing has been typed at all", () => {
    expect(postRefusal("", "")).toBe("Add a title before posting.");
  });

  it("distinguishes the two cases", () => {
    // The whole reason this is not a single constant string.
    expect(postRefusal("", "some message")).not.toBe(postRefusal("", ""));
  });

  it("never refuses silently", () => {
    // The fault this replaces: `addAnnouncement` returned on an untitled post
    // without a word, and the screen's Post button did nothing at all. Any
    // refusal must carry a sentence a person can act on.
    for (const [title, body] of [
      ["", ""],
      ["", "a message"],
      ["   ", ""],
    ] as const) {
      const why = postRefusal(title, body);
      expect(why, `refused ${JSON.stringify({ title, body })} with no reason`).toBeTruthy();
      expect(why!.length).toBeGreaterThan(10);
    }
  });
});
