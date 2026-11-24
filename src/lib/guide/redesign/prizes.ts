import type { GuideVariant } from "./index";

/**
 * THE GUIDE'S WORDS FOR PRIZES & SIDE GAMES, THE OFFER HALF (R8a), drawn only while the screen is shown.
 *
 * It replaces nothing: today's guide (Part 5 money setup, Part 8 prizes) stays true until the screens go on. Winners and
 * who has paid are settled on Winners & money (R8b), so this says what is OFFERED and says where the rest still is.
 */
export const PRIZES_GUIDE: GuideVariant = {
  screen: "prizes",
  replaces: [],
  sections: [
    {
      id: "prizesoffer",
      part: "Part 5",
      title: "Prizes & side games",
      blocks: [
        { kind: "where", text: "This event → Prizes & side games" },
        {
          kind: "p",
          text: "**TourneyHQ works out and records who is owed what. It does not pay anyone.** This screen is what is OFFERED, before play: how money is handled, the prize list, and the pots and contests the whole field can join. The side games of one group are kept apart, on the groups' own screen.",
        },
        {
          kind: "steps",
          items: [
            "**How money works here** comes first. Answer it once (follow the club, **Costs handled outside the app**, **Tournament kitty** or **Split shared costs**) and on a phone it folds to one line, such as **Money: Tournament kitty**, with the screen's own words saying a change keeps your prize list and side games. Pressing a choice deletes nothing.",
            "On the **Add a prize** card, type a category and an amount and press [[Add]]. The **Prizes** card lists the lines and the purse at the top adds up the amounts. **One prize per player** is a tick on the **Prizes** card: a player who wins one placing prize is set aside for the next.",
            "Under each round's pots, set the buy-in and press [[Save]] to start a skins pot; **Add a game** offers a birdie pot, low gross or net, closest to the pin and the rest. A contest can name its sponsor, shown on the board with a thank-you.",
            "A pot and a contest are per round, so the round is picked on the skins pot's card. A round with one ball per side (foursomes) can hold no pot, and the screen says why instead of offering one.",
          ],
        },
        {
          kind: "p",
          text: "Once the tournament is completed what you offered is shut (the prize list, a pot or contest's definition and stake, how money is handled) and [[Reopen tournament]] is the way out. Winners, who has paid in, the kitty and settling up are never locked: they are recorded after the result is final, on Winners & money once it is shown (and lower on this screen until then). A pot's and a contest's own card keeps who is in it and who has paid.",
        },
      ],
    },
  ],
};
