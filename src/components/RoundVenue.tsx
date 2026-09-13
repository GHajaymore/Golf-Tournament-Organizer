"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStageCourse } from "@/app/actions/courses";
import { CoursePicker } from "@/components/CoursePicker";
import { Icon } from "./Icon";

/**
 * Which course this round is scored against — stated where the scores go in.
 *
 * Two different jobs, kept apart deliberately.
 *
 * CHOOSING the venue is a scoring decision and belongs here: the round is
 * about to be entered, and picking the wrong card is how a net score comes out
 * against holes nobody played. So the picker lives on this screen.
 *
 * ENTERING or CORRECTING a card is not. There is exactly one card editor in
 * this app — the course library — and this links to it rather than growing a
 * second one. A card pasted here and a card typed there would be two writers
 * of the same eighteen numbers, and the first time they disagreed the round
 * would be scored against whichever screen happened to save last. The event
 * used to carry its own card for exactly this reason and it was silently
 * ignored; that is the mistake this avoids repeating, not one to repeat here.
 *
 * So: say what the round is scored against, make the card checkable, and hand
 * over to the one place that edits it.
 */
export function RoundVenue({
  stageId,
  courseId,
  venues,
  library = [],
  venue,
  canEdit,
}: {
  stageId: string;
  /** The venue set on the round itself. "" means it inherits. */
  courseId: string;
  /** Every venue this tournament may be played on. */
  venues: Array<{ id: string; name: string }>;
  /**
   * Every course the club has, not only the ones already on this tournament.
   *
   * With one venue there was nothing to offer, so the picker hid and the
   * round's venue could only be corrected from the Rounds screen — which is
   * the wrong place to be standing when you have just been handed a card
   * from a course the tournament does not know about. Choosing one adds it
   * to the tournament's venues, which is what the action does now.
   */
  library?: Array<{ id: string; name: string; city?: string }>;
  /** The venue this round resolves to, and whether it has a card. */
  venue: { name: string; courseId: string; hasCard: boolean } | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  /**
   * What a venue change would re-score, once the action has refused it.
   *
   * A venue change moves no stroke. It moves the STROKE INDEX those strokes
   * are scored against, so the handicap shots land on different holes and
   * every net result in the round changes with nothing on screen looking any
   * different. The count has to come from the server, and the organizer
   * cannot weigh the decision before they have it.
   */
  const [pendingVenue, setPendingVenue] = useState<{ id: string; cards: number } | null>(null);
  const [pending, startTransition] = useTransition();

  const missingCard = !!venue && !venue.hasCard;
  /**
   * NO COURSE AT ALL — which is not a quieter version of "no card", it is the
   * loudest state there is, and it was the one state this panel stayed silent
   * in.
   *
   * Every condition below asks what there is to CHOOSE BETWEEN, and each
   * answers zero on a tournament nobody has set a course for: no second
   * venue, no library to look elsewhere in, and `missingCard` is
   * `!!venue && !venue.hasCard`, which is false when there is no venue to
   * have a card. So the panel returned null, `ScoreEntryClient`'s per-match
   * picker was hidden by the same arithmetic one screen down, and score entry
   * offered no way whatsoever to say where the round was played.
   *
   * Measured on 2026-09-13 against the development database: of three
   * tournaments, TWO were in exactly this state — no venue row, no event
   * course, an empty club library — and neither could be given one from the
   * screen where the scores go in.
   *
   * It is the sharpest case because this picker is the only one in the app
   * with `searchDirectory` on. An empty library is precisely when the
   * directory is the ONLY possible answer, and precisely when the control
   * that reaches it disappeared.
   */
  const noVenue = !venue;
  /**
   * Shown when there is a real choice to make.
   *
   * Two venues is one. A card missing from the venue is another. The club
   * having OTHER courses is the third — that one used to be invisible, so a
   * single-venue tournament could not have a round's venue corrected here at
   * all, however many courses the club owned. And no venue at all is the
   * fourth; see above.
   *
   * With none of the four it stays hidden: the venue is already named in the
   * header beside the dates, and a dropdown of one is furniture.
   */
  const elsewhereToPlay = library.some((c) => !venues.some((v) => v.id === c.id));
  if (!canEdit || (venues.length < 2 && !elsewhereToPlay && !missingCard && !noVenue)) return null;

  /**
   * The one card editor, opened on this course.
   *
   * Deep-linked rather than "go to Tournament details and find it": the whole
   * point of raising this here is that somebody is mid-task, and a correction
   * that costs a hunt is a correction that does not get made.
   */
  const editHref = venue ? `/event?course=${encodeURIComponent(venue.courseId)}` : "/event";

  return (
    <div
      className="card elev-sm"
      style={{
        marginBottom: 16,
        gap: 8,
        ...(missingCard || noVenue ? { borderLeft: "3px solid var(--color-accent)" } : {}),
      }}
    >
      {/* `noVenue` too, and it is the reason this gate exists at all rather
          than the picker simply always rendering: with an empty library and
          no venues there is nothing in `options`, which reads like a broken
          control — until you remember `searchDirectory` is on here, so typing
          three letters reaches the whole catalogue and adds what it finds to
          the library on the way past. A picker with an empty local list is
          the right control here; a hidden one is not. */}
      {(venues.length > 1 || library.length > 0 || noVenue) && (
        <CoursePicker
          label="Played at"
          /* THIS is where a round's venue is chosen, so it reaches the whole
             catalogue and not just the four courses the club has entered so
             far. It was off here and on in Tournament details, which meant
             the same question — where are we playing — got a different answer
             depending on which screen asked it. A society that plays
             somewhere new every month meets that difference immediately.

             Deliberately NOT switched on in score entry: see the note there.
             Setting a venue and recording where a match happened to be played
             are different acts, and only one of them should invite a search. */
          searchDirectory
          /* The tournament's own venues first, then the rest of the club's
             library — same list, in the order a round is most likely to
             want. Deduped, because a venue is in both. */
          options={[
            ...venues,
            ...library.filter((c) => !venues.some((v) => v.id === c.id)),
          ]}
          value={courseId}
          disabled={pending}
          // Empty means inherit, and the label names what that resolves to,
          // so a blank is never presented as "nowhere".
          noneLabel={venue ? `${venue.name} (inherited)` : "Not set"}
          hint="The card this whole round is scored against."
          onChange={(id) =>
            startTransition(async () => {
              const res = await setStageCourse(stageId, id || null);
              if (res.needsConfirm) {
                setPendingVenue({ id, cards: res.cards ?? 0 });
                return;
              }
              if (!res.ok) setError(res.error ?? "Couldn't set the venue for this round.");
              else router.refresh();
            })
          }
        />
      )}

      {/* Beside the control, and holding the number the server counted. The
          decision is not "change the venue" — it is "re-score 37 cards that
          are already in", and nobody can make that one without the count. */}
      {pendingVenue && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            border: "1px solid var(--color-accent)",
            borderRadius: 8,
            fontSize: 12.5,
            lineHeight: 1.55,
          }}
        >
          <b>
            <Icon name="warning" /> This round already has {pendingVenue.cards} card
            {pendingVenue.cards === 1 ? "" : "s"} entered.
          </b>
          <div className="text-muted" style={{ marginTop: 4 }}>
            Changing where it was played re-scores them. No stroke is altered — the shots are
            allocated off the new course&rsquo;s stroke index instead, so every net result in the
            round can move and nothing on screen looks any different afterwards.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => {
                const chosen = pendingVenue.id;
                setPendingVenue(null);
                startTransition(async () => {
                  const res = await setStageCourse(stageId, chosen || null, "full", true);
                  if (!res.ok) setError(res.error ?? "Couldn't set the venue for this round.");
                  else router.refresh();
                });
              }}
            >
              Change it anyway
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setPendingVenue(null)}>
              Leave it as it is
            </button>
          </div>
        </div>
      )}

      {noVenue ? (
        <>
          {/* Said here because here is where the scores are about to go in.
              The card below this panel is already drawing hole numbers with
              no par and no stroke index under them, which reads as a card
              that has not loaded rather than a tournament with no course. */}
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name="warning-circle" /> No course set for this round
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
            Par and stroke index have nothing to come from, so net scores, Stableford points and
            every &ldquo;±&rdquo; on the board have nothing to measure against. Find the course
            above — it is added to your club&rsquo;s library on the way past, and every round
            played there uses the same card.
          </p>
        </>
      ) : missingCard ? (
        <>
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name="warning-circle" /> {venue!.name} has no card yet
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
            Par and stroke index are missing, so net scores, Stableford points and every
            &ldquo;±&rdquo; on the board have nothing to measure against. Enter the card once and
            every round played here uses it.
          </p>
          <Link className="btn btn-primary" href={editHref} style={{ alignSelf: "flex-start" }}>
            <Icon name="note-pencil" /> Enter this course&rsquo;s card
          </Link>
        </>
      ) : (
        venue && (
          // The card is right there in the grid below — par and S.I. on their
          // own rows — so this does not repeat it. It only says where to go
          // when reading it shows something wrong.
          <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.5 }}>
            Check par and stroke index on the card below against the real one.{" "}
            <Link href={editHref}>Correct {venue.name}&rsquo;s card</Link> if anything is out — it
            is stored once, for every round played there.
          </p>
        )
      )}

      {error && (
        <p className="form-error">
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
