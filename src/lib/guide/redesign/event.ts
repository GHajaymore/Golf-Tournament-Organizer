import type { GuideVariant } from "./index";

/**
 * THE GUIDE'S WORDS FOR EVENT AS REDESIGNED (R3), drawn only while the screen is shown (`guideFor`).
 *
 * It replaces nothing: today's guide describes Tournament details and stays true until the screen goes on. A person
 * looking at the new screen reads this beside it.
 */
export const EVENT_GUIDE: GuideVariant = {
  screen: "event",
  replaces: [],
  sections: [
    {
      id: "eventscreen",
      part: "Set up",
      title: "Event: what, when and where",
      blocks: [
        { kind: "where", text: "Set up → Event" },
        {
          kind: "p",
          text: "Event answers three questions and keeps them with **one Save**: **What** is it (the name and the kind), **When** is it played (the first and last day, and whether the days are tentative) and **Where** (the course, and the tees it is played from). Anything the Launch button is waiting on, and that is still empty, says **Required before launch**.",
        },
        {
          kind: "steps",
          items: [
            "Type the **Tournament name** and pick **What kind is this?**. The kind changes only the words members see; it changes nothing about how the golf is scored.",
            "Pick the first and last day. Tick **These dates are tentative** if they may still move.",
            "Under **Where**, choose **One course** and pick it, or **More than one course** and tick each of the club's courses the event is played on. Any kind of event may use more than one.",
            "Beside the course, choose **Played from**, the set of tees everyone plays unless you put them on their own, and **Who may play other tees**.",
            "Press [[Save]]. A refusal is said beside the button, and the screen keeps what you typed.",
          ],
        },
        {
          kind: "p",
          text: "Each round is played on one course. With more than one course ticked, you choose the course for each round on Rounds & formats. One round split across two courses on the same day, such as a shotgun on both, is not something the app does yet.",
        },
        { kind: "h", text: "More" },
        {
          kind: "p",
          text: "**More** holds the rest: **No fixed course, the players arrange their own** (a league where each pairing chooses its venue, so no course is set here), the **Overall result** (match play or stroke play, asked once there is a round), and **Dates and money**, which follow the club unless you set this event's own.",
        },
        { kind: "h", text: "After launch" },
        {
          kind: "p",
          text: "Once the tournament is launched the name, the kind, the course and the tees read as text under one banner that says why and what to do. The **days** can still change: the same **Save** keeps them, and keeps nothing else.",
        },
        {
          kind: "tip",
          text: "When entries open and close, how many places there are, and whether you approve each one are on Entries, not here.",
        },
      ],
    },
  ],
};
