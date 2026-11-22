import type { GuideVariant } from "@/lib/guide/redesign";

/**
 * THE GUIDE'S WORDS FOR ROUNDS & FORMATS AS REDESIGNED (R4), drawn only while the screen is shown (`guideFor`). It takes the
 * place of today's "Rounds and formats" section; everybody else reads today's guide, unchanged.
 */
export const ROUNDS_GUIDE: GuideVariant = {
  screen: "rounds",
  replaces: ["rounds"],
  sections: [
    {
      id: "rounds",
      part: "Part 3",
      title: "Rounds and formats",
      blocks: [
        { kind: "where", text: "Set up → Rounds & formats" },
        { kind: "p", text: "Each round is one column with the same rows in the same order: **Day**, **Course** (only when the event has more than one course), **Format**, **Holes** and **Handicap**. A round that is still being set up shows how many of its settings are in place (“2 of 3 set”); a round that has begun shows its state instead." },
        { kind: "h", text: "The event's scoring, once" },
        { kind: "p", text: "The **Scoring** card above the rounds says whether players may enter their own scores and who keeps the card in each round. The answer to **Can players enter scores?** is the event's: when players may not, the committee keeps every card, whatever a round says. **Change** opens Players & scoring on Event." },
        { kind: "h", text: "Add a round" },
        {
          kind: "steps",
          items: [
            "Open [[Add a round]] and pick what the field plays, or a structure: a single match or a bracket.",
            "Choose how many, the format and the holes, and the first day if you know it.",
            "Press **Add**. The round arrives as a column below; every setting on it can be changed.",
          ],
        },
        { kind: "h", text: "Day, format, holes and handicap" },
        { kind: "p", text: "A round's day is proposed from the event's first day, one round a day, and marked **Default** until you pick another; **Use the default** puts it back. Handicap says gross, net or both, and shows the allowance with where it comes from: **the Rules' recommendation**, **the Rules**, or **usual** where it is a club custom the Rules do not state." },
        { kind: "h", text: "Between rounds" },
        { kind: "p", text: "A cut, a carry-forward or a qualification belongs to the gap, so it is drawn once under the round it follows, with one line saying what flows into the next round (**Into Round 2: top 8 and ties**)." },
        { kind: "h", text: "More" },
        { kind: "p", text: "**More** on each round holds the rest: the allowance and team shares, how scores are recorded, who keeps the card in this round, how players keep their matches, ties and points, the play-by date and the weekly sign-up." },
        { kind: "h", text: "When a round is locked" },
        { kind: "p", text: "A round that has scores shows its settings as text with one line, **This round has scores, so its settings are locked.** A completed event shows every round as text under one banner and draws no control. The banner says why and what to do, once, at the top." },
        { kind: "tip", text: "The draw, a round's handicaps and closing a round stay on this screen until Tee times & draw and Score entry are switched on, and then move there with a link where they were." },
      ],
    },
  ],
};
