/**
 * What `/choose` says at the top, from what it knows about this person.
 *
 * A pure function so the three greetings can be pinned without a request —
 * the page supplies the facts (how many tournaments they can reach, whether
 * the tournament they last had open has been REMOVED, the club they belong to
 * without running) and this decides the words.
 *
 * The "removed" branch exists because a Par tournament is deleted when it
 * completes, or fourteen days after its golf began, and the member who had it
 * open arrived here the next day to the greeting for somebody who has never
 * used the app (walked 2026-09-30).
 */
export function chooseGreeting(input: {
  tournaments: number;
  lastOpenRemoved: boolean;
  clubName: string | null;
}): { title: string; line: string } {
  const { tournaments, lastOpenRemoved, clubName } = input;
  if (tournaments > 0) {
    return {
      title: "Which tournament?",
      line: `You have access to ${tournaments} tournament${tournaments === 1 ? "" : "s"}.`,
    };
  }
  if (lastOpenRemoved) {
    return {
      title: "Welcome back",
      line: "The tournament you last had open isn’t here any more — it has been closed and removed, with its cards and results. When you are entered in another, it appears here.",
    };
  }
  if (clubName) {
    return {
      title: "Welcome to TourneyHQ",
      line: `You're a member of ${clubName}, which hasn't published a tournament yet. When it does, it appears here and on Events, and you can enter from there.`,
    };
  }
  return {
    title: "Welcome to TourneyHQ",
    line: "Your account is ready. If an organizer has invited you to a tournament, it appears here as soon as they add your email — otherwise create your own below.",
  };
}
