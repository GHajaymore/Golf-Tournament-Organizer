import type { GuideVariant } from "./index";

/**
 * THE GUIDE'S WORDS FOR THE CLUB'S COURSES SCREEN (R2), drawn only while the screen is shown.
 *
 * It replaces nothing: today's guide says where the library is (Tournament details → Courses) and stays
 * true until the screen goes on. A person looking at the new screen reads this beside it.
 */
export const COURSES_GUIDE: GuideVariant = {
  screen: "courses",
  replaces: [],
  sections: [
    {
      id: "clubcourses",
      part: "The club's courses",
      title: "Courses",
      blocks: [
        {
          kind: "p",
          text: "**Courses** is the club's own list of the courses it plays, with each one's card and tees. A course is entered once here and every tournament of the club can be played on it. You do not need a tournament to keep it: a club that has not made its first tournament yet can add its courses first.",
        },
        { kind: "where", text: "Club → Courses" },
        {
          kind: "steps",
          items: [
            "Press [[Add a course]]. Type the course's name, then paste its card (par, stroke index and yards for each hole) or type each hole in. A card with a stroke index used twice is refused, and the screen says so beside the button.",
            "Press [[Add course]]. The course is listed with its par, marked **Unverified** until somebody has held the saved card beside the club's printed one.",
            "Check the card against the printed one and press [[Verify card]]. Who checked it is kept and shown.",
            "Open the course's tees to add each set with its Course Rating and Slope, and press [[Save tees]]. A handicap is worked out from the tees, so a course with none cannot give a net score.",
          ],
        },
        {
          kind: "p",
          text: "Picking which course a tournament is played on is done on that tournament, not here. A club's Commissioner or Admin can change or remove a course; anybody else the screen is shown to reads it and is told so at the top.",
        },
        {
          kind: "p",
          text: "When another screen sends you here to put a card right, **Back to** at the top takes you to the screen you came from.",
        },
      ],
    },
  ],
};
