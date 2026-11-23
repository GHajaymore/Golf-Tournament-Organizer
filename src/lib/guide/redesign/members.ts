import type { GuideVariant } from "./index";

/**
 * THE GUIDE'S WORDS FOR MEMBERS WITH HISTORY (R7), drawn only while the screen is shown.
 *
 * It replaces nothing: today's guide says where the member list is, and the history has its own address until
 * the screen goes on. A person looking at the new screen reads this beside it.
 */
export const MEMBERS_GUIDE: GuideVariant = {
  screen: "members",
  replaces: [],
  sections: [
    {
      id: "clubmembers",
      part: "The club",
      title: "Members and their history",
      blocks: [
        {
          kind: "p",
          text: "**Members** is the club's list of the people it keeps, read by every tournament of the club. Under the list, **Member history** shows what one member has played: every tournament they entered, and the handicap each was played off, as it stood then and not as it is today.",
        },
        { kind: "where", text: "Club → Members → a member's name" },
        {
          kind: "steps",
          items: [
            "Press a member's name in the list. **Member history** opens under the list.",
            "Read their tournaments, dates, whether they played and the handicap each was played off.",
            "A member who has met others in a match also has a **Match record**: press an opponent's name to read their history in turn.",
          ],
        },
        {
          kind: "p",
          text: "Only the club's {organizers} and their assistants can open this screen; a player cannot. Casual rounds are not counted in a member's history, because they are not club competitions and do not build a handicap.",
        },
      ],
    },
  ],
};
