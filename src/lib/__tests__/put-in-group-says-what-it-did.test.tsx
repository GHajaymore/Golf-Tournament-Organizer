import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readSource } from "./source";

vi.mock("@/app/actions/tee-sheet", () => ({ placeInTeeGroup: async () => ({ ok: true, said: "" }) }));

/**
 * PUT IN GROUP SAYS WHAT IT DID, EVEN WHEN IT PLACED THE LAST ONE (round
 * round/day-of-field-b-3, run 42176202893: `day-of-tee-sheet.spec.ts`, phone).
 *
 * The press worked — the late entrant was in Group 2 on the screen — but "Isolde
 * is in Group 2, off at 8:10 AM." was never seen. The page drew the card only
 * while somebody was undrawn, so the refresh after the LAST placement unmounted
 * it, and the line it was holding went with it. On desktop the line flashed up
 * before the refresh and the spec caught it by luck; on the slower phone it
 * could not. The desk pressed and was told nothing.
 *
 * So the page keeps the card mounted whenever there is a saved sheet the staff
 * can work on, and the CARD decides what it draws: the list while somebody is
 * undrawn, only what the last press said once nobody is, and nothing at all
 * when it has nothing to say.
 */
describe("Put in group keeps its last word", () => {
  it("the tee sheet page does not unmount the card when the last undrawn player is placed", () => {
    const page = readSource("src", "app", "(app)", "foursomes", "page.tsx");
    const at = page.indexOf("<PlaceInGroup");
    expect(at, "the page draws the card").toBeGreaterThan(-1);
    // The condition the card is drawn under: the JSX expression it opens.
    const gate = page.slice(page.lastIndexOf("{", at), at);
    expect(gate, "the card's mount must not hang on who is still undrawn").not.toMatch(/undrawn/);
    expect(gate).toMatch(/savedSheet/);
  });

  it("CONTROL: the gate reader sees a condition on the undrawn list", () => {
    const page = "{stage && savedSheet && undrawn.length > 0 && (\n<PlaceInGroup";
    const at = page.indexOf("<PlaceInGroup");
    expect(page.slice(page.lastIndexOf("{", at), at)).toMatch(/undrawn/);
  });

  it("with nobody undrawn and nothing said, the card draws nothing", async () => {
    const { PlaceInGroup } = await import("@/components/PlaceInGroup");
    expect(renderToStaticMarkup(<PlaceInGroup stageId="s1" undrawn={[]} groups={[]} door={null} />)).toBe("");
  });
});
