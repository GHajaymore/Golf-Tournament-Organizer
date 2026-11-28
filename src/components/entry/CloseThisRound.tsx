import { RoundClosedControl } from "@/components/RoundClosedControl";
import { RoundDeadlineControl } from "@/components/RoundDeadlineControl";
import { SectionFold } from "@/components/setup/SectionFold";
import {
  MARKED_OUT_WORDS,
  WITHDREW_WORDS,
  closingState,
  noCardReturnedLabel,
  noCardReturnedWords,
  type MissingCardPlayer,
} from "@/lib/domain/missing-cards";
import { MissingCards } from "./MissingCards";
import { matchesState, type ClosingKind } from "@/lib/domain/closing-words";

/**
 * CLOSING A ROUND AND ITS SCORING WINDOW, where the cards are (R12). Score entry draws this under the round it scores while
 * its key is shown, in EVERY staff branch (individual, team, cup session, a match kept by tapping); the old Rounds screen stops
 * drawing the same two controls by the same boolean (`onTheDayHere`), so a round is closed in one place at a time. Nothing here
 * is new behaviour: the cards still to come (`MissingCards`), the tick (`RoundClosedControl`, asked first about a card not yet
 * approved or signed) and the window (`RoundDeadlineControl`, told the club's day) are the controls the old screen had, with
 * the ⓘ behind the tick's long paragraph.
 *
 * A SERVER FILE: it imports only components from the client files, and calls nothing they export (the rule of
 * `server-never-calls-a-client-export.test.ts`). It works out the board's sentence for a missing card here and hands the words
 * down, so the stroke arithmetic stays out of the client bundle. On a phone the section folds like every other (`SectionFold`),
 * open while it has a card to wait for.
 */
export function CloseThisRound({
  stageId,
  label,
  closed,
  tick,
  cardsCounted,
  kind,
  matches,
  deadline,
  deadlineOverride,
  today,
  missing,
  withdrawDoor,
}: {
  stageId: string;
  /** "Round 2". */
  label: string;
  closed: boolean;
  /** Whether the round has the tick at all (`closingTickShown`). */
  tick: boolean;
  /** Whether cards are counted here: an individual stroke or Stableford round. A match is a result and a side's card is the side's. */
  cardsCounted: boolean;
  /** Which words the section speaks (`closingKind`): strokes and places, points, or matches. */
  kind: ClosingKind;
  /** A match round: how many of its matches are over (`storedMatchIsOver`), or null where matches are not what the round is. */
  matches: { finished: number; total: number } | null;
  /** The round's play-by date, as stored. */
  deadline: string;
  /** true = closed by hand, false = extended past the date, null = follow it. */
  deadlineOverride: boolean | null;
  /** Today at the club, yyyy-mm-dd, told by the page (`clubToday`): never this file's own clock. */
  today: string;
  missing: MissingCardPlayer[];
  /** Why nobody can withdraw now (`fieldDoors(…).withdraw`), or null: the FIELD rule, which a launched tournament does not shut. */
  withdrawDoor: string | null;
}) {
  const waiting = !closed && missing.length > 0;
  const working = noCardReturnedWords(label);
  // A round with no tick holds only the window, and says so: a bracket or a round of match points has no place for closing to take.
  const title = tick ? `Close ${label}` : `Scoring window for ${label}`;
  // A match round counts MATCHES (`matchesState`), never cards or places; any other round without cards says only open or closed.
  const state = cardsCounted
    ? closingState(closed, missing.length, label)
    : matches
      ? matchesState(closed, matches.finished, matches.total, label)
      : closed
        ? `${label} is closed`
        : "Open";
  return (
    <SectionFold id="close-round" title={title} state={state} needsYou={waiting} openOnPhone={waiting}>
      <div data-close-round style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {!closed && (
          <MissingCards
            round={label}
            players={missing}
            door={withdrawDoor}
            words={{ line: noCardReturnedLabel(label), says: working.says, cite: working.cite, withdrew: WITHDREW_WORDS, markedOut: MARKED_OUT_WORDS }}
          />
        )}
        {tick && (
          <div>
            <p className="card-title" style={{ fontSize: 14, margin: "0 0 6px" }}>Is this round over?</p>
            <RoundClosedControl stageId={stageId} closed={closed} kind={kind} infoBehind />
          </div>
        )}
        <div>
          <p className="card-title" style={{ fontSize: 14, margin: "0 0 6px" }}>Scoring window</p>
          <RoundDeadlineControl
            stageId={stageId}
            roundLabel={label}
            deadline={deadline}
            today={today}
            override={deadlineOverride}
            // Never shut while live: closing or reopening scoring is a decision made on the day (2026-09-27).
            locked={false}
          />
        </div>
      </div>
    </SectionFold>
  );
}
