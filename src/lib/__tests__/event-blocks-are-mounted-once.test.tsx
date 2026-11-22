import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaySettings } from "@/components/PlaySettings";
import { cleanSettings } from "@/lib/tournament-settings";
import { readSource } from "./source";

/**
 * THE BLOCKS THAT LEFT `PlaySettings` ARE DRAWN ONCE (R3-1).
 *
 * Event (R3), Players (R6) and Home (R10) each take a block out of the old Players & scoring card. A
 * block drawn in its new room AND in the old body would be on two screens at once, so ONE boolean per
 * block decides where it is mounted: `howInHere` (how players sign in, the weekly sign-up), `shareHere`
 * (who sees the board, the round codes) and `teesHere` (the event's tees). The page sets each from
 * `screensShownFor`, and with the switch off all three are true and the card is whole, as it was.
 *
 * This counts the mounts in the OLD body for every combination of the three. The new rooms are not built
 * yet; when each is, its own PR adds the other half of the count (its room, with the boolean the other
 * way) to this file.
 */

const TEE = { id: "t1", name: "White", courseRating: 71.2, slopeRating: 125, rated: true };

const draw = (here: { howInHere: boolean; shareHere: boolean; teesHere: boolean }) =>
  renderToStaticMarkup(
    <PlaySettings
      mode="tournament"
      // Players enter scores, with codes on, two rounds: every block asked for is asked.
      settings={cleanSettings({ scoreEntryBy: "players", playerAccess: "both" })}
      canEdit
      tees={[TEE]}
      rounds={[
        { stageId: "r1", label: "Round 1", code: "AB12CD" },
        { stageId: "r2", label: "Round 2", code: "EF34GH" },
      ]}
      {...here}
    />,
  );

const count = (html: string, needle: string) => html.split(needle).length - 1;

/** What each lifted block prints that nothing else on the card does. */
const MARKS: Record<"howInHere" | "shareHere" | "teesHere", string[]> = {
  howInHere: ["How players sign in", "Weekly sign-up"],
  shareHere: ["Who can see the leaderboard", "Round Codes"],
  teesHere: ['id="default-tee"', "Who may play other tees"],
};

describe("a block lifted out of Players & scoring is drawn in the old body exactly when its boolean says", () => {
  const keys = Object.keys(MARKS) as Array<keyof typeof MARKS>;
  // A mark can print more than once for ONE mount (a title and its "More about" button), so the whole
  // card's count is the yardstick: a block drawn is its full count, a block left out is none.
  const whole = draw({ howInHere: true, shareHere: true, teesHere: true });
  const stays = ["Who signs off a result", "Can players enter scores?"];

  it("CONTROL: every mark is found when the card is whole (a count of nothing proves nothing)", () => {
    for (const key of keys) for (const mark of MARKS[key]) expect(count(whole, mark), mark).toBeGreaterThan(0);
    for (const mark of stays) expect(count(whole, mark), mark).toBeGreaterThan(0);
  });

  for (let mask = 0; mask < 8; mask++) {
    const here = { howInHere: !!(mask & 1), shareHere: !!(mask & 2), teesHere: !!(mask & 4) };
    it(`howInHere=${here.howInHere} shareHere=${here.shareHere} teesHere=${here.teesHere}`, () => {
      const html = draw(here);
      for (const key of keys) {
        for (const mark of MARKS[key]) {
          expect(count(html, mark), `${mark} under ${key}=${here[key]}`).toBe(here[key] ? count(whole, mark) : 0);
        }
      }
      // What did not leave is always there, as many times as ever.
      for (const mark of stays) expect(count(html, mark), mark).toBe(count(whole, mark));
    });
  }
});

describe("the page and the club's defaults set the three booleans", () => {
  it("the event page sets each from the one question, never from a second source", () => {
    const page = readSource("src/app/(app)/event/page.tsx");
    expect(page).toMatch(/howInHere=\{!shown\.has\("players"\)\}/);
    expect(page).toMatch(/shareHere=\{!shown\.has\("home"\)\}/);
    expect(page).toMatch(/teesHere=\{!shown\.has\("event"\)\}/);
    expect(page).toMatch(/screensShownFor\(session\)/);
  });

  it("Club settings draws the house defaults whole", () => {
    const page = readSource("src/app/(app)/organization/page.tsx");
    expect(page).toMatch(/<PlaySettings[\s\S]*?howInHere[\s\S]*?shareHere[\s\S]*?teesHere[\s\S]*?\/>/);
  });

  it("each lifted component is mounted once in the card, behind its boolean", () => {
    const card = readSource("src/components/PlaySettings.tsx");
    for (const [name, flag] of [
      ["EntriesHowIn", "howInHere"],
      ["EntriesWeeklySignUp", "howInHere"],
      ["EventTees", "teesHere"],
      ["BoardVisibility", "shareHere"],
      ["ShareLinks", "shareHere"],
      ["RoundCodes", "shareHere"],
    ] as const) {
      expect(card.split(`<${name}`).length - 1, `<${name} mounted`).toBe(1);
      expect(card, `<${name} behind ${flag}`).toMatch(new RegExp(`${flag}\\s*(?:&&|\\))[\\s\\S]{0,500}?<${name}\\b`));
    }
  });
});
