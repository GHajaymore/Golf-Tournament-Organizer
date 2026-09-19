"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { HoleByHoleCard } from "@/components/HoleByHoleCard";
import { ScorecardTable, type CardBrand } from "@/components/ScorecardTable";
import { saveScorecard, certifyScorecard, disputeScorecard } from "@/app/actions/tournament";
import { usePendingCard } from "@/components/usePendingCard";
import { CardConflict } from "@/components/CardConflict";
import { RuleCite } from "@/components/RuleCite";
import { toParText } from "@/lib/domain";
import { cardRevision } from "@/lib/domain/pending-card";
import { certifyPrompt, certifiedNote } from "@/lib/domain/card-approval";
import { Icon } from "./Icon";
import { ConfirmButton } from "./ConfirmButton";
import { GroupScoring, type GroupPartner } from "./GroupScoring";
import { parseTypedCard } from "@/lib/domain/score-entry-input";

/**
 * A player's own card, on a phone, outdoors, mid-round.
 *
 * Deliberately thinner than the console's StrokePlayEntry: no player picker
 * and no tee-group switch. What it does offer, since 2026-09-19, is the three
 * ways the club asked for: tap hole by hole, SAY the hole ("four", or "Marcus
 * five, me four"), or TYPE the whole card in one line — and, where the
 * published tee sheet put this player in a group, keep the group's cards on
 * this one phone (`GroupScoring`). Signing stays each player's own.
 *
 * Three things this screen has to do that the old one did not:
 *
 *   1. Show where the round stands, always. A player taps a score and
 *      immediately wants "so what am I?" — and was getting no answer at all
 *      without leaving for the board. Gross, to par, net and thru now sit
 *      above the hole and never move.
 *   2. Save itself. There was a Save button, and a Save button on a golf
 *      course is a round lost to a phone that went in a pocket. Every tap
 *      writes, and the screen says which state that write is in — the same
 *      sticky, honest reporting the console's entry card uses, for the same
 *      reason: a failed write and a successful one otherwise look identical.
 *   3. Say what a shot is worth. The strokes this player receives on each hole
 *      come from the SERVER, resolved off their tee and the round's allowance.
 *      Net worked out on the phone from a roster Index is arithmetic the
 *      tournament will not agree with.
 *
 * Certify stays a button, and stays deliberate. Saving is bookkeeping;
 * certifying is a statement under Rule 3.3b that these hole scores are right.
 */
export function PlayerCard({
  stageId,
  playerId,
  playerName,
  roundLabel,
  courseName = "",
  venueIsHome = false,
  holes,
  pars,
  yards,
  strokeIndex,
  shotsPerHole = [],
  playingHandicap = 0,
  tee = null,
  status,
  brand,
  initialStrokes,
  initialRevision = "",
  savePartial = true,
  staffApproves = true,
  partners = [],
  startHole = 1,
}: {
  /**
   * The rest of the foursome on the round's PUBLISHED tee sheet, whose cards
   * this player may keep (`services/group-cards.ts` — the same rule
   * `saveScorecard` enforces). Empty means a card for one, as before.
   */
  partners?: GroupPartner[];
  /** Where this player’s group teed off, so the card opens on the hole they are playing. */
  startHole?: number;
  stageId: string;
  playerId: string;
  playerName: string;
  roundLabel: string;
  /** The round's venue, when it is not simply the tournament's. */
  courseName?: string;
  /** Whether that course is the club's own — decides whether the club's mark
   *  heads the card or is named beneath the course. */
  venueIsHome?: boolean;
  holes: number;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  /** Handicap strokes received per hole, allocated on the server. */
  shotsPerHole?: number[];
  /** The Playing Handicap those strokes add up to, for the header. */
  playingHandicap?: number;
  /**
   * Which set this card was scored from.
   *
   * The one thing a golfer checks before they hit, and the thing that
   * explains their shots — slope belongs to the tee. Resolved on the server
   * through the tee policy and the player’s flight.
   */
  tee?: { name: string; rated: boolean } | null;
  status: string;
  /** The club's mark, for the head of the card — the badge that is on the
   *  paper one. Optional; an unbranded card simply has no header. */
  brand?: CardBrand | null;
  /** The card as already returned. Opening blank and then saving would erase
   *  a round that was half entered on the ninth tee. */
  initialStrokes: (number | null)[];
  /**
   * The revision of the card this screen was rendered from.
   *
   * Sent with every save so the server can refuse one that would land on
   * top of somebody else's change. Empty means an unconditional write, so
   * a caller that has not been given one behaves exactly as before.
   */
  initialRevision?: string;
  /**
   * Whether this viewer may send a half-filled card — `mayReportPartialCard`,
   * resolved on the server, which is the same rule `saveScorecard` enforces.
   *
   * Default true so nothing that does not pass it changes behaviour. Under
   * `scoreEntryWindow: "after"` it is false for a player, and the card is then
   * kept on the phone until it is finished rather than sent hole by hole into
   * a refusal the screen reads as a failure.
   */
  savePartial?: boolean;
  /**
   * Whether a committee is going to look at this card once it is signed, from
   * the round's own `scoreApproval` setting.
   *
   * Default TRUE, which is the safe direction: a caller that has not been
   * updated keeps promising the review, and the failure mode of getting it
   * wrong that way is a club being told about its own committee. The other
   * default would quietly stop every club medal mentioning the review that is
   * genuinely coming.
   */
  staffApproves?: boolean;
}) {
  const [strokes, setStrokes] = useState<(number | null)[]>(() =>
    Array.from({ length: holes }, (_, i) => initialStrokes[i] ?? null),
  );
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [state, setState] = useState(status);
  /** Hole by hole for the round; the full card for checking it after. */
  const [view, setView] = useState<"hole" | "card">("hole");
  /** Keeping score for yourself, or for the whole group on this phone. */
  const [who, setWho] = useState<"me" | "group">("me");
  const [typed, setTyped] = useState("");
  const [typedNote, setTypedNote] = useState("");
  const [error, setError] = useState("");
  /** What the server holds, when it refused our write for disagreeing. */
  const [conflict, setConflict] = useState<{ strokes: (number | null)[]; revision: string } | null>(null);
  const revision = useRef(initialRevision);

  const filled = strokes.filter((s) => s != null).length;
  const complete = filled >= holes;
  const locked = state === "approved";
  const knownCourse = pars.length > 0;

  /**
   * Where the round stands, over the holes actually played.
   *
   * Par to date rather than par for the course, and strokes received on the
   * holes played rather than the whole allowance — so the numbers mean
   * something through six holes as well as through eighteen. The same rule the
   * server totals by, so this screen and the board cannot disagree.
   */
  const summary = useMemo(() => {
    let gross = 0;
    let parThru = 0;
    let received = 0;
    let played = 0;
    for (let i = 0; i < holes; i += 1) {
      const s = strokes[i];
      if (typeof s !== "number" || s <= 0) continue;
      gross += s;
      parThru += pars[i] ?? 0;
      received += shotsPerHole[i] ?? 0;
      played += 1;
    }
    return { gross, played, toPar: gross - parThru, net: gross - Math.round(received), received };
  }, [strokes, pars, shotsPerHole, holes]);

  /**
   * Write on every change, not on a button.
   *
   * Debounced so tapping through a hole is one request rather than four, and
   * the latest card is read from a ref: two taps inside one render both
   * started from the same array otherwise, and the second wrote the first
   * one's hole back to null.
   */
  const latest = useRef(strokes);
  latest.current = strokes;
  const dirty = useRef(false);

  /**
   * The card is kept on the phone BEFORE the network is tried.
   *
   * This used to be a bare debounce whose only copy of the strokes was React
   * state, so a scorer behind the 12th with no signal who locked their phone
   * lost the holes they had entered — and the screen went on showing them
   * until it reloaded. See domain/pending-card.ts.
   */
  const card = usePendingCard<(number | null)[]>({
    stageId,
    playerId,
    enabled: !locked,
    // This tournament takes the whole card and this one is not whole yet. The
    // holes still go to the device on every tap; only the request waits, and
    // the hole that completes the card releases it.
    holding: !savePartial && !complete,
    send: async (value) => {
      const res = await saveScorecard(stageId, playerId, value, revision.current);
      if (!res.ok) {
        /**
         * Somebody else wrote this card while we were away.
         *
         * NOT thrown: a throw would be retried, and retrying is the one thing
         * that must not happen — every attempt would overwrite their change
         * the moment it stopped disagreeing. The queue holds, the strokes stay
         * on the phone, and a person decides.
         *
         * "held" is what makes that true. A bare `return` resolved the promise,
         * which the queue read as a successful send — so it deleted the device
         * copy and cleared the queue while this chooser was on screen, and the
         * comment above described something the code did not do.
         */
        setConflict(res.conflict);
        return "held";
      }
      revision.current = res.revision;
      setConflict(null);
      setError("");
      /**
       * The badge is what the SERVER says the card is, not what this screen
       * guessed a save would do to it.
       *
       * It used to read `s === "certified" ? "entered" : s` — every successful
       * save retracts the signature. That was true of the server once and is
       * not now: a save only de-certifies when the NUMBERS changed, because
       * the console re-saves every unchanged card in a tee group and the retry
       * queue can replay a card seconds after `certifyScorecard` signed it.
       *
       * The second case is this screen's own. A player finishing a round on
       * patchy signal certifies, the queued card goes up a moment later
       * unchanged, and the badge fell back to "entered" over a card the
       * committee held as certified — telling a player who had signed that
       * they had not, with nothing they could do but sign again.
       *
       * Taking the answer removes the copy rather than correcting it, so the
       * next change to what a save does to a status cannot leave this screen
       * behind. It is also strictly more informative: a card another screen
       * disputed now reads as disputed instead of keeping whatever this one
       * last believed.
       */
      setState(res.status);
      return "sent";
    },
  });

  /**
   * The recovered card, fitted to this round, and whether it says anything new.
   *
   * A device copy that matches what the server already holds is not a decision
   * worth putting in front of a player mid-round — it is the ordinary case
   * where the last send did land and only the tidy-up was missed. Compared by
   * revision, the same content hash the conflict machinery uses, so "the same
   * card" means the same thing in both places.
   */
  const recoveredFitted = useMemo(
    () => Array.from({ length: holes }, (_, i) => card.recovered?.[i] ?? null),
    [card.recovered, holes],
  );
  const recoveredDiffers =
    !!card.recovered && cardRevision(recoveredFitted) !== cardRevision(strokes);

  useEffect(() => {
    // Nothing to decide: drop it rather than leave a stale key on the phone.
    if (card.recovered && !recoveredDiffers) card.clearRecovered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.recovered, recoveredDiffers]);

  /**
   * WHICH DISAGREEMENT THE CHOOSER IS ASKING ABOUT — decided here, rendered in
   * ONE place.
   *
   * There were two `<CardConflict>` call sites at different positions in the
   * JSX below, one guarded by `conflict` and one by `!conflict &&
   * recoveredDiffers`. They are mutually exclusive, so only ever one showed —
   * but because they sat at different positions, a flip between the two states
   * made React UNMOUNT one and MOUNT the other rather than update in place.
   *
   * CLAUDE.md's entry on the `offline.spec:245` intermittent names exactly
   * that as the next thing to look at: every failing log ends `element was
   * detached from the DOM, retrying`, which is what an unmount under a pending
   * click looks like. On 2026-09-15 that flake recurred with the geometry
   * assertion two lines above the click having just PASSED — so the box was
   * right when measured and wrong when pressed, which points at identity
   * rather than layout.
   *
   * THIS IS NOT A CONFIRMED FIX and must not be written up as one. The failure
   * is intermittent and has never been reproduced on demand, so the most that
   * can be said is that one named mechanism for "detached from the DOM" is
   * gone. It is worth doing regardless: one element at one position is simpler
   * than two that alternate, and `CardConflict` holds no state, so nothing is
   * preserved across the flip that should not be.
   */
  const chooser = conflict
    ? {
        kind: "conflict" as const,
        mine: strokes,
        theirs: conflict.strokes,
        onKeepMine: () => {
          // Adopt their revision so the next write is no longer stale, then
          // push ours on top. This is the destructive choice and is only ever
          // reached by somebody tapping "Keep mine".
          revision.current = conflict.revision;
          setConflict(null);
          card.push(latest.current);
        },
        onTakeTheirs: () => {
          // Their card becomes what this screen is editing. Nothing is sent:
          // the server already holds exactly this.
          revision.current = conflict.revision;
          const theirs = Array.from({ length: holes }, (_, i) => conflict.strokes[i] ?? null);
          dirty.current = false;
          setStrokes(theirs);
          latest.current = theirs;
          setConflict(null);
          // Settled, not merely forgotten: there is nothing left to send, so
          // the queue is emptied too. `clearRecovered` alone left it flagged
          // and the status line warning for the rest of the round.
          card.settle();
        },
      }
    : recoveredDiffers
      ? {
          /**
           * The situation, which this did not say — so the recovery case
           * rendered the CONFLICT's words: "Somebody else — usually the
           * committee — edited this card while your phone was offline", when
           * nobody had edited anything, and "If you are not sure, use theirs",
           * which discards the only copy of these holes.
           */
          kind: "recovered" as const,
          mine: recoveredFitted,
          theirs: strokes,
          onKeepMine: () => {
            dirty.current = true;
            setStrokes(recoveredFitted);
            latest.current = recoveredFitted;
            card.clearRecovered();
            // Straight back into the queue: these holes have never reached the
            // server.
            card.push(recoveredFitted);
          },
          onTakeTheirs: () => card.settle(),
        }
      : null;

  /**
   * BRING THE CHOOSER INTO VIEW WHEN IT APPEARS, because it renders where
   * nobody is looking.
   *
   * It is an inline section after the scorecard, and a scorecard is eighteen
   * rows tall. Measured on a 320x568 phone with the chooser open: its top edge
   * is at y=783 — 215px BELOW the fold. Nothing scrolled to it, and the status
   * line that might have mentioned it renders BELOW it again, so a player
   * whose card is in dispute saw an unchanged scorecard and no sign that
   * anything had happened.
   *
   * That matters more than an ordinary bit of layout: until this is answered
   * the strokes are not sent and the card cannot be certified, so it is the
   * most urgent thing on the screen and it was the only thing off it.
   *
   * FOUND WHILE DEBUGGING A TEST. `offline.spec:245` failed intermittently
   * because Playwright had to SCROLL to this element before it could click —
   * which is a fact about the product, not about the test. The flake is fixed
   * separately; this is the half of that measurement a player feels.
   *
   * Fires on the transition to open, not on every render, so it cannot fight
   * somebody who has scrolled away and come back. No `behavior` is passed:
   * that leaves it to the page's `scroll-behavior`, which is smooth for most
   * people and `auto` for anybody who has asked for reduced motion.
   */
  const chooserOpen = !!chooser;
  const chooserRef = useRef<HTMLDivElement>(null);
  const chooserWasOpen = useRef(false);
  useEffect(() => {
    if (chooserOpen && !chooserWasOpen.current) {
      chooserRef.current?.scrollIntoView({ block: "center" });
    }
    chooserWasOpen.current = chooserOpen;
  }, [chooserOpen]);

  useEffect(() => {
    if (!dirty.current || locked) return;
    card.push(latest.current);
    // `card.push` is stable and the ref carries the latest strokes, so this
    // deliberately watches the VALUE rather than the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, locked]);

  const setHole = (hole: number, value: number | null) => {
    dirty.current = true;
    setNote("");
    setStrokes((prev) => {
      const next = [...prev];
      next[hole] = value;
      return next;
    });
  };

  /**
   * THE WHOLE CARD, TYPED IN ONE LINE — for the player who kept a paper card
   * and wants it in before the bar. Read by `parseTypedCard`; a hole typed as
   * a dash is left as it was, never cleared, so typing the back nine onto a
   * card with the front nine in does not wipe the front nine.
   */
  const applyTyped = () => {
    const read = parseTypedCard(typed, holes);
    if (!read.ok) {
      setTypedNote(read.problem);
      return;
    }
    dirty.current = true;
    setNote("");
    setStrokes((prev) => prev.map((s, i) => read.strokes[i] ?? s));
    setTyped("");
    setTypedNote(`${read.filled} ${read.filled === 1 ? "hole" : "holes"} filled in. Check them against your card below.`);
  };

  /**
   * SAYING THE CARD IS WRONG.
   *
   * DELIBERATELY DOES NOT SAVE FIRST, unlike `certify` directly below. Certify
   * sends the holes because signing is a statement that THESE numbers are
   * right, so the server must have them. A dispute is the opposite statement —
   * that whatever the server is holding should not be accepted — and writing
   * this phone's version of the card on the way would be quietly correcting
   * the very numbers being objected to.
   *
   * Optimistic on the label only. If the server refuses — an approved card is
   * locked — the error line says so and the state is put back, because a
   * player told their objection was recorded when it was not is worse than
   * one told it failed.
   */
  const dispute = () =>
    startTransition(async () => {
      const before = state;
      setError("");
      setState("disputed");
      try {
        await disputeScorecard(stageId, playerId);
        setNote("");
      } catch (e) {
        setState(before);
        setError(e instanceof Error ? e.message : "Couldn't flag that card.");
      }
    });

  const certify = () =>
    startTransition(async () => {
      try {
        // Save first: certifying a card the server has not seen would certify
        // whatever was last written, which is not what is on this screen.
        //
        // (The dispute path below deliberately does NOT save first — see it.)
        //
        // Captured, not re-read after the await: `settle()` below has to know
        // whether THIS card is the one still outstanding.
        const sent = latest.current;
        const res = await saveScorecard(stageId, playerId, sent, revision.current);
        if (!res.ok) {
          // Certifying is a statement under Rule 3.3b that these hole scores
          // are right. Signing one while two versions disagree would be
          // vouching for numbers this player has not seen.
          setConflict(res.conflict);
          return;
        }
        revision.current = res.revision;
        await certifyScorecard(stageId, playerId);
        setState("certified");
        setNote(certifiedNote(staffApproves));
        /**
         * Nothing is outstanding, so the queue must be told.
         *
         * `certify` saves through the action directly, not through the queue —
         * and it saves `latest.current`, which is exactly what the queue was
         * holding. Leaving it queued left the status line reading "Saving…"
         * over a card the committee already had, and sent the identical card
         * again on the next retry.
         *
         * That replay is what turned the badge back to "entered": it was a
         * successful save, and a successful save used to mean de-certified on
         * this screen. The badge is fixed above by taking the server's word;
         * this stops the pointless replay that exposed it.
         *
         * Guarded, because settling clears the DEVICE copy. A hole typed
         * between the save above and this line is not covered by what was
         * just certified, and dropping it would lose a stroke that exists
         * nowhere else.
         *
         * By IDENTITY rather than by comparing revisions: `setHole` builds a
         * new array every time, so `latest.current === sent` is exactly "no
         * hole has been typed since". A revision comparison would be a second
         * way of asking the same question that can quietly answer `false`
         * forever if the two sides ever hash differently shaped arrays — and
         * a guard that never fires looks identical to a guard that works.
         */
        if (latest.current === sent) card.settle();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't certify that card.");
      }
    });

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--color-neutral-400)",
        }}
      >
        {[roundLabel, courseName].filter(Boolean).join(" · ")}
      </div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: "6px 0 14px" }}>
        {playerName || "My card"}
      </h1>

      {locked ? (
        /**
         * APPROVED, AND THEREFORE READ-ONLY — NOT THEREFORE INVISIBLE.
         *
         * This branch was the sentence and nothing else, so the screen called
         * "My card" showed no card. Read off the demo tournament on
         * 2026-09-12 as a player whose round had been signed off: one line of
         * grey text where eighteen holes had been.
         *
         * Approval is the committee accepting the card AS A RESULT —
         * `isCardLocked` says so — and a result is the thing a player most
         * wants to look at afterwards. It is theirs to stop changing, not
         * theirs to stop seeing. There is nowhere else to see it either: the
         * board carries a total, and the paper card is at the club.
         *
         * `ScorecardTable` "renders read-only by default and takes `onSet` to
         * become editable", in its own words, so this is the same grid the
         * editable branch below renders with the one prop left off. Not a
         * second card that could come to disagree with it.
         */
        <>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)", marginTop: 0 }}>
            This card has been approved by the committee. Ask an organizer if something needs changing.
          </p>
          <ScorecardTable
            holes={holes}
            pars={pars}
            yards={yards}
            strokeIndex={strokeIndex}
            strokes={strokes}
            shotsPerHole={shotsPerHole}
            playingHandicap={playingHandicap}
            tee={tee}
            brand={brand}
            courseName={courseName}
            venueIsHome={venueIsHome}
          />
        </>
      ) : (
        <>
          {/* Where I stand. Above the hole and never moving, because it is the
              question that follows every single tap. */}
          <section
            className="card elev-sm"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "12px 14px",
              marginBottom: 12,
            }}
          >
            <Stat label="Thru" value={summary.played === 0 ? "–" : String(summary.played)} />
            <Stat label="Gross" value={summary.gross === 0 ? "–" : String(summary.gross)} />
            {knownCourse && (
              <Stat
                label="To par"
                value={summary.played === 0 ? "–" : toParText(summary.toPar)}
                tone={summary.played === 0 ? undefined : summary.toPar < 0 ? "good" : undefined}
              />
            )}
            {knownCourse && shotsPerHole.length > 0 && (
              <Stat
                label="Net"
                value={summary.played === 0 ? "–" : String(summary.net)}
                hint={`Playing handicap ${playingHandicap}`}
              />
            )}
          </section>

          {/* Two ways to fill the same card, because they are two different
              moments. Hole by hole is the round: one number, big targets, on
              a phone between shots. The full card is the check afterwards —
              against the paper one in your pocket, where every hole, the
              shots you got and both totals have to be visible at once. */}
          <div className="seg" style={{ marginBottom: 12 }}>
            <label className="seg-opt">
              <input
                type="radio"
                name="card-view"
                checked={view === "hole"}
                onChange={() => setView("hole")}
              />
              <Icon name="flag" /> Hole by hole
            </label>
            <label className="seg-opt">
              <input
                type="radio"
                name="card-view"
                checked={view === "card"}
                onChange={() => setView("card")}
              />
              <Icon name="table" /> Full card
            </label>
          </div>

          {/* Whose card this phone is keeping. Only offered when the published
              tee sheet put this player in a group — the marker system — and
              only for the numbers: signing stays each player's own. */}
          {view === "hole" && partners.length > 0 && (
            <div className="seg" style={{ marginBottom: 12 }}>
              <label className="seg-opt">
                <input type="radio" name="card-who" checked={who === "me"} onChange={() => setWho("me")} />
                <Icon name="golf" /> Just me
              </label>
              <label className="seg-opt">
                <input type="radio" name="card-who" checked={who === "group"} onChange={() => setWho("group")} />
                <Icon name="users-three" /> My group ({partners.length + 1})
              </label>
            </div>
          )}

          {view === "hole" && who === "group" && partners.length > 0 ? (
            <GroupScoring
              stageId={stageId}
              holes={holes}
              pars={pars}
              yards={yards}
              strokeIndex={strokeIndex}
              me={{ id: playerId, name: playerName, shotsOn: (hole: number) => shotsPerHole[hole] ?? 0 }}
              myStrokes={strokes}
              onSetMine={setHole}
              partners={partners}
              startHole={startHole}
              holding={(s) => !savePartial && s.filter((v) => v != null).length < holes}
            />
          ) : view === "hole" ? (
            <HoleByHoleCard
              players={[
                {
                  id: playerId,
                  name: playerName,
                  shotsOn: (hole: number) => shotsPerHole[hole] ?? 0,
                },
              ]}
              cards={{ [playerId]: strokes }}
              pars={pars}
              yards={yards}
              strokeIndex={strokeIndex}
              holes={holes}
              onSet={(_pid, hole, value) => setHole(hole, value)}
              meId={playerId}
              startHole={startHole}
            />
          ) : (
            <>
            <details style={{ marginBottom: 12 }}>
              <summary style={{ fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                <Icon name="note-pencil" style={{ marginRight: 6 }} /> Type the whole card
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6 }}>
                <label htmlFor="typed-card" style={{ fontSize: 12.5, color: "var(--color-neutral-400)" }}>
                  Your {holes} scores in order, with spaces — “4 5 3 4 …”. A dash skips a hole.
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="typed-card"
                    className="input"
                    inputMode="numeric"
                    autoComplete="off"
                    value={typed}
                    onChange={(e) => {
                      setTyped(e.target.value);
                      setTypedNote("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") applyTyped();
                    }}
                    style={{ flex: 1, minWidth: 0, minHeight: 44, fontVariantNumeric: "tabular-nums", letterSpacing: "0.04em" }}
                  />
                  <button type="button" className="btn btn-primary" onClick={applyTyped} style={{ minHeight: 44 }}>
                    Fill in
                  </button>
                </div>
                {typedNote && (
                  <p role="status" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>
                    {typedNote}
                  </p>
                )}
              </div>
            </details>
            <ScorecardTable
              holes={holes}
              pars={pars}
              yards={yards}
              strokeIndex={strokeIndex}
              strokes={strokes}
              shotsPerHole={shotsPerHole}
              playingHandicap={playingHandicap}
              tee={tee}
              brand={brand}
              courseName={courseName}
              venueIsHome={venueIsHome}
              onSet={setHole}
            />
            </>
          )}

          {/*
            Two versions of this card disagree, so a person chooses.

            Above the status line and above the certify button, because while
            this is on screen neither of those means anything: the strokes have
            not been sent, and signing a card whose numbers are in dispute is
            the one thing Rule 3.3b does not allow.
          */}
          {/*
            ONE CHOOSER, FOR BOTH DISAGREEMENTS.

            Which one it is asking about is decided in `chooser` above, beside
            the handlers — including the tab-eviction case this module exists
            for, where holes found on the phone have never reached the server
            and nothing may be auto-sent, because the device copy can be
            twenty minutes old and the committee may have corrected the card
            since. That is the same argument this chooser settles, which is
            why it is the same chooser and now literally the same element.
          */}
          {chooser && (
            <div ref={chooserRef} style={{ margin: "12px 0" }}>
              <CardConflict
                kind={chooser.kind}
                mine={chooser.mine}
                theirs={chooser.theirs}
                pars={pars}
                busy={pending}
                onKeepMine={chooser.onKeepMine}
                onTakeTheirs={chooser.onTakeTheirs}
              />
            </div>
          )}

          {/* No Save button. The card writes itself; this says what happened,
              and stays put when it failed. */}
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minHeight: 22,
              marginTop: 12,
              fontSize: 12.5,
              fontWeight: card.status.tone === "warn" ? 600 : 400,
              color:
                card.status.tone === "warn"
                  ? "var(--color-danger)"
                  : card.status.tone === "idle"
                    ? "var(--color-accent-2-300)"
                    : "var(--color-neutral-400)",
            }}
          >
            {/*
              What the scorer is told, from domain/pending-card.

              The old wording here — "Not saved… check your signal and tap a
              hole again" — is now false in the case that matters most. The
              holes ARE saved, on the phone, and they will send themselves. A
              scorer told otherwise stands on a tee hunting for a bar of signal
              instead of playing their shot.
            */}
            {card.status.tone === "working" && (<><Icon name="circle-notch" /> {card.status.label}</>)}
            {card.status.tone === "queued" && (<><Icon name="cloud-arrow-up" /> {card.status.label}</>)}
            {card.status.tone === "warn" && (<><Icon name="warning-circle" /> {card.status.label}</>)}
            {card.status.tone === "idle" && filled > 0 && (
              <><Icon name="check" /> Saved — {filled} of {holes} holes in</>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            // Certifying an unfinished card would be claiming holes that were
            // never played were right.
            disabled={pending || !complete || state === "certified"}
            onClick={certify}
            style={{ width: "100%", minHeight: 52, marginTop: 10 }}
          >
            <Icon name="check" /> {state === "certified" ? "Certified" : "Certify my card"}
          </button>

          <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
            {certifyPrompt(complete, holes, staffApproves)}
          </p>

          {/* SAYING THE CARD IS WRONG — the other answer to "is this right?".

              Certify is a statement under Rule 3.3b that these scores ARE
              right, and until now it was the only answer this screen took.
              Match play has had the opposite since it was written —
              `disputeMatch`, from score entry — and stroke play had no door,
              so `disputeScorecard` existed, authorized and audited, and could
              not be reached. The app could render a disputed card and never
              produce one.

              It matters most in the case this format is built around: one
              person in a fourball enters three other people's rounds. A player
              who opens a card somebody else filled in and finds a 6 where they
              made a 4 should be able to SAY so — silently editing a card the
              marker has already signed is the thing certification exists to
              prevent.

              Offered only while there is a card and it is still open. An
              approved one is locked — `disputeScorecard` refuses it, so a
              button here would be one that only ever errors — and a disputed
              one is already said. */}
          {state !== "disputed" && filled > 0 && (
            <div style={{ marginTop: 10 }}>
              <ConfirmButton
                className="btn btn-secondary"
                style={{ width: "100%", minHeight: 44, fontSize: 13 }}
                icon="warning"
                label="Something on this card is wrong"
                title="Dispute this card"
                confirmLabel="Flag it"
                note="Tells the committee not to accept it until it is sorted out. Your scores are kept."
                disabled={pending}
                onConfirm={dispute}
              />
            </div>
          )}
          {state === "disputed" && (
            <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> Flagged as wrong. The committee has been told and will
              not accept it until it is sorted out.
            </p>
          )}
          <p style={{ margin: "6px 0 0" }}>
            <RuleCite rule="scorecardCertification" />
          </p>
          {note && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-accent-2-300)" }}>
              <Icon name="check" /> {note}
            </p>
          )}
          {error && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** One number in the running summary. Big enough to read at arm's length. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good";
}) {
  return (
    <div style={{ minWidth: 0, textAlign: "center" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-neutral-400)" }}>
        {label}
      </div>
      <div
        title={hint}
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 26,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          color: tone === "good" ? "var(--color-accent-2-300)" : "var(--color-text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
