import { describe, it, expect } from "vitest";
import { commentarySource } from "../domain/commentary-source";
import { readSource } from "./source";

/**
 * A LINE THE ASSISTANT WROTE SAYS SO (sweep 1, c2, 2026-10-10).
 *
 * The commentary list draws an "AjAi" tag on a line whose stored source is
 * "ai" — "the one label that tells a reader a machine wrote the line", in the
 * panel's own words. `postCommentary` accepts the source. And the panel never
 * sent one: it drafted a line, put it in the box, and posted it as the
 * organizer's whatever happened next. The tag could not appear on any line,
 * ever, and members read machine-written commentary under an organizer's name.
 *
 * The rule: a line posted exactly as it was drafted is the assistant's. A line
 * the organizer changed is the organizer's — they have put their name to
 * words of their own.
 */
describe("who wrote a commentary line", () => {
  const draft = "Halloran leads by two with the back nine to play.";

  it("is the assistant when the draft is posted as it came", () => {
    expect(commentarySource(draft, draft)).toBe("ai");
    // Space at the ends is not an edit.
    expect(commentarySource(`  ${draft}\n`, draft)).toBe("ai");
  });

  it("is the organizer once they have changed a word", () => {
    expect(commentarySource("Halloran leads by three with the back nine to play.", draft)).toBe("organizer");
    expect(commentarySource(`${draft} Come on Tom!`, draft)).toBe("organizer");
  });

  it("is the organizer when nothing was drafted at all", () => {
    expect(commentarySource("Tee times moved to 9:30.", "")).toBe("organizer");
    expect(commentarySource("", "")).toBe("organizer");
  });

  it("the panel says which when it posts", () => {
    const panel = readSource("src/components/CommentaryPanel.tsx");
    expect(panel).toContain("postCommentary(text, commentarySource(text, drafted))");
    expect(panel, "posts every line as the organizer's").not.toContain("postCommentary(text))");
  });

  it("CONTROL: the list still draws the tag off the stored source", () => {
    expect(readSource("src/components/CommentaryPanel.tsx")).toContain('c.source === "ai"');
  });
});
