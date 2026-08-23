"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStageCourse } from "@/app/actions/courses";
import { CoursePicker } from "@/components/CoursePicker";

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
  venue,
  canEdit,
}: {
  stageId: string;
  /** The venue set on the round itself. "" means it inherits. */
  courseId: string;
  /** Every venue this tournament may be played on. */
  venues: Array<{ id: string; name: string }>;
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
  // Nothing to say when there is one venue, it has a card, and the header
  // already names it. A locked dropdown of one is furniture.
  if (!canEdit || (venues.length < 2 && !missingCard)) return null;

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
        ...(missingCard ? { borderLeft: "3px solid var(--color-accent)" } : {}),
      }}
    >
      {venues.length > 1 && (
        <CoursePicker
          label="Played at"
          options={venues}
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
            <i className="ph ph-warning" /> This round already has {pendingVenue.cards} card
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

      {missingCard ? (
        <>
          <span className="card-title" style={{ fontSize: 14 }}>
            <i className="ph ph-warning-circle" /> {venue!.name} has no card yet
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
            Par and stroke index are missing, so net scores, Stableford points and every
            &ldquo;±&rdquo; on the board have nothing to measure against. Enter the card once and
            every round played here uses it.
          </p>
          <Link className="btn btn-primary" href={editHref} style={{ alignSelf: "flex-start" }}>
            <i className="ph ph-note-pencil" /> Enter this course&rsquo;s card
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
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}
    </div>
  );
}
