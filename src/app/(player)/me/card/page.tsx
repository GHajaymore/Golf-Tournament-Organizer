import Link from "next/link";
import { handicapsForRound, teesForEvent, teeForPlay } from "@/lib/services/handicaps";
import { screenMetadata } from "@/lib/screen-metadata";
import { redirect } from "next/navigation";
import { needsTeams } from "@/lib/formats";
import { generatesPairings } from "@/lib/stage-types";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canEnterScores, mayReportPartialCard, allowsAutoConfirm } from "@/lib/tournament-settings";
import { holeStrokesReceived, allocationHoles } from "@/lib/domain";
import { meFor } from "@/lib/services/me";
import { cardBrand } from "@/lib/services/organization";
import { NO_CARD_REVISION } from "@/lib/domain/pending-card";
import { PlayerCard } from "@/components/PlayerCard";
import { partnerCardsFor } from "@/lib/services/group-cards";
import { roundCardFor } from "@/lib/services/round-card";
import { Icon } from "@/components/Icon";

export const metadata = screenMetadata("/me/card");

/**
 * My card — one player, one round, one hole at a time.
 *
 * The console's score entry can enter anyone's card and switch between tee
 * groups, because an organizer legitimately does both. A player entering
 * their own round needs neither, and every control that offers them is one
 * more thing to get wrong on a phone. So this is the same HoleByHoleCard with
 * the field of one.
 *
 * The tournament's own setting still decides whether players may report at
 * all — and the save action enforces it independently, because hiding a
 * screen stops nobody from calling the action.
 */
export default async function PlayCardPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const settings = settingsOf(state.event);
  const me = await meFor(state, session.email);
  // The club's mark for the head of the card. Same reader every other card in
  // the app uses, so no two of them can disagree about the club's name.
  const brand = await cardBrand(session.eventId);

  if (!me.playerId || !me.round) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          You aren&rsquo;t entered in this tournament, so there&rsquo;s no card to fill in.
        </p>
      </div>
    );
  }

  if (!canEnterScores(settings, session.viewRole)) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          Scores for this tournament are entered by the organizer. Your card will appear on the board once
          it is in.
        </p>
      </div>
    );
  }

  // This screen is a single player's stroke card and nothing else. A match is
  // scored between two people and a team round on a side's card, so neither
  // can be entered here — and silently rendering an 18-box grid for them would
  // collect strokes the tournament never reads.
  const stage = state.stages.find((s) => s.id === me.round!.stageId) ?? null;
  const teamRound = !!stage && needsTeams(stage.format);
  const matchRound = !!stage && generatesPairings(stage.type);

  if (teamRound || matchRound) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          {teamRound
            ? `${me.round.name} is played as ${stage?.format}, so the card belongs to your side rather than to you individually.`
            : `${me.round.name} is match play, so your score is recorded against your opponent rather than as your own card.`}{" "}
          Your organizer enters it, and it appears on the board as soon as it&rsquo;s in.
        </p>
        {/* A way forward out of what was otherwise a dead end.
            A player taps "My card" on a match-play round, is told the card is
            not theirs, and until now the only offer was the whole board. Their
            own match is one tap away and is what they came for — so it is
            offered first, and only when there is one to offer. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          {me.round.matches.length > 0 && (
            <Link className="btn btn-primary" href="/me">
              <Icon name="sword" /> {me.round.matches.length === 1 ? "See my match" : "See my matches"}
            </Link>
          )}
          <Link className="btn btn-secondary" href="/me/board">
            <Icon name="ranking" /> See the board
          </Link>
        </div>
      </div>
    );
  }

  const holes = me.round.holes;

  // The course this ROUND is played on, narrowed to the nine actually played
  // — not the event's, which is only the fallback. A player standing on a
  // second venue was being shown the first course's par, yardage and stroke
  // index, and a stroke index is what decides where their shots fall.
  // One reading, shared with Today's tiles — see services/round-card.ts.
  const { venue, known, card } = await roundCardFor(state, stage, holes);

  /**
   * Handicap strokes per hole, resolved on the SERVER.
   *
   * Only the server can see the whole chain — the player's tee, its Course
   * Rating and Slope, the round's allowance and its hole count — and the card
   * has never shown any of it. A player working out their own net score from a
   * gross total and a roster Index is doing arithmetic the tournament will not
   * agree with: the audit found exactly that on the organizer's entry screen,
   * where the running net came off the raw Index while the dots beside it came
   * off the Course Handicap, five shots apart on one screen.
   */
  const playing = state.strokeHandicapFor(me.playerId, me.round.stageId);
  /**
   * And WHICH SET those shots came off, which the comment above has named as
   * missing since it was written.
   *
   * Resolved by `handicapsForRound`, the same function the number above comes
   * from, so the tee printed on the card and the strokes allocated on it
   * cannot come from two different answers. It walks the player's own tee,
   * then their FLIGHT's — a club championship puts championship, seniors and
   * ladies on three sets per flight rather than per player — then the round's,
   * and the committee's policy decides which of those may win.
   */
  const teeRow = (
    await handicapsForRound(
      session.eventId,
      holes,
      // The round’s own set before the tournament’s, and a fallback scoped
      // to the course this round is actually played on. See `teeForPlay`.
      teeForPlay(
        await teesForEvent(session.eventId),
        { stageTeeId: stage?.teeId, eventDefaultTeeId: state.event.defaultTeeId },
        stage?.courseId ?? state.event.courseId ?? null,
      ),
    )
  ).find((r) => r.playerId === me.playerId);
  const tee = teeRow?.teeName ? { name: teeRow.teeName, rated: teeRow.rated } : null;
  /**
   * The group this player may keep score for — the rest of their foursome on
   * this round's published sheet, by the same rule `saveScorecard` enforces.
   * Only when players enter scores at all, which the guard above settled.
   */
  const partners = stage
    ? await partnerCardsFor({
        eventId: state.event.id,
        stage,
        playerId: me.playerId,
        holes,
        confirmed: state.confirmed,
      })
    : [];

  const alloc = allocationHoles(holes);
  const shots = Array.from({ length: holes }, (_, i) =>
    known ? holeStrokesReceived(playing, card.strokeIndex[i] ?? 18, alloc) : 0,
  );

  return (
    <>
    <PlayerCard
      stageId={me.round.stageId}
      playerId={me.playerId}
      playerName={me.name}
      roundLabel={me.round.label}
      courseName={known ? card.name : ""}
      // Whether that course is the club's own. At home the club's mark heads
      // the card; away, the course leads and the club is named beneath it — a
      // society's outing at Pebble Beach should not look like the society owns
      // the course.
      venueIsHome={!!brand?.homeCourseId && brand.homeCourseId === (venue?.id ?? "")}
      holes={holes}
      pars={known ? card.pars.slice(0, holes) : []}
      yards={known ? card.yards.slice(0, holes) : []}
      strokeIndex={known ? card.strokeIndex.slice(0, holes) : []}
      shotsPerHole={shots}
      playingHandicap={playing}
      tee={tee}
      status={me.round.card?.status ?? "entered"}
      // Whether signing this card hands it to anybody. Under player
      // confirmation nothing approves a scorecard — `certifyCard` writes
      // "certified" and the only paths out are staff actions — so the card
      // stops there, and saying "it's with the committee now" is a wait that
      // never ends. A casual round is exactly that case.
      staffApproves={!allowsAutoConfirm(settings)}
      // The club's badge at the head of the card, so the card a player holds
      // carries the mark that is on the paper one.
      brand={brand}
      initialStrokes={me.round.card?.strokes ?? []}
      // Which version the screen loaded, so a save that would land on top of
      // somebody else’s change is refused rather than winning silently.
      //
      // `NO_CARD_REVISION` rather than "" when there is no card yet. The empty
      // string reached the server as "no opinion, write unconditionally" —
      // which is the CONSOLE's meaning, and the opposite of this screen's. A
      // player who opened an empty card, went offline and entered nine holes
      // then replaced a full eighteen the committee had entered meanwhile,
      // with no conflict shown.
      initialRevision={me.round.card?.revision ?? NO_CARD_REVISION}
      /**
       * Whether this card may go in hole by hole, from the same reader
       * `saveScorecard` refuses on — and on `session.role`, not `viewRole`,
       * because that is what the action tests. An organizer previewing as a
       * player still saves as staff, and telling this screen otherwise would
       * hold a card the server would have taken.
       *
       * Without it the screen auto-saved every hole into a certain refusal and
       * reported it as "This card wouldn't save. Show it to the committee
       * before you sign." for the whole round.
       */
      savePartial={mayReportPartialCard(settings, session.role)}
      partners={partners}
      startHole={me.round.group?.startHole ?? 1}
    />
    {/* Rules left the tab bar for Events (2026-09-19); the card is where a
        local rule or the handicap allowance comes up, so it is linked here. */}
    <p style={{ margin: "14px 0 0" }}>
      <Link
        href="/me/rules"
        style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent-300)", display: "inline-flex", alignItems: "center", gap: 4, minHeight: 44 }}
      >
        <Icon name="book-open" /> This tournament&rsquo;s rules
      </Link>
    </p>
    </>
  );
}
