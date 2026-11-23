import type { GuideVariant } from "./index";

/**
 * THE GUIDE'S WORDS FOR CLUB SETTINGS' STAFF & ACCESS (R7), drawn only while the screen is shown.
 *
 * It replaces nothing: today's guide says where each helper is added (Staff & helpers) and stays true until the
 * screen goes on. A person looking at the new screen reads this beside it.
 */
export const CLUB_SETTINGS_GUIDE: GuideVariant = {
  screen: "clubSettings",
  replaces: [],
  sections: [
    {
      id: "clubaccess",
      part: "The club",
      title: "Staff & access",
      blocks: [
        {
          kind: "p",
          text: "**Staff & access** in Club settings holds two lists, and each is kept by a different person. **On this event** is the helpers of the tournament you have open: anybody its {organizer} adds here can open the console for it. **Club staff** is the club's own list: somebody on it is an {organizer} on every tournament the club runs.",
        },
        { kind: "where", text: "Club settings → Staff & access → On this event" },
        {
          kind: "steps",
          items: [
            "Open **On this event** and type the helper's name and email.",
            "Choose what they may do: Assistant opens the console, Player only plays.",
            "Press [[Add account]]. They are listed at once, and they sign in with that email.",
            "To change a helper's role, pick the new one and confirm. To end their access, press their Remove access and confirm.",
          ],
        },
        {
          kind: "p",
          text: "You can manage a tournament's helpers if you are its {organizer}, even if you are not on the club's own staff. Changing the club's staff, or any other club setting, needs an owner or admin of the club, and a screen you may only read says so at the top. The only {organizer} of a tournament cannot be moved down or removed until somebody else is promoted, and the screen says that beside the button you pressed.",
        },
      ],
    },
  ],
};
