"use client";
import { indexLabel } from "@/lib/domain/handicap-label";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CardPhotoReader } from "@/components/CardPhotoReader";
import { HoleByHoleCard } from "@/components/HoleByHoleCard";
import { ScorecardTable, type CardBrand } from "@/components/ScorecardTable";
import {
  computeStrokeCard,
  toParText,
  parseStrokesTranscript,
  stablefordPointsForHole,
  modifiedStablefordForHole,
} from "@/lib/domain";
import { boardKind } from "@/lib/formats";
import { cardTotals, TOTAL_LABEL } from "@/lib/domain/card-totals";
import { isCardLocked } from "@/lib/domain/card-approval";
import { visibleSaveNote, type SavedNote } from "@/lib/domain/save-note";
import { saveScorecard, saveScorecards } from "@/app/actions/tournament";
import { Icon } from "./Icon";
import { MicNote } from "./MicNote";
import { useSaveBeforeLeaving } from "./useSaveBeforeLeaving";
import { startDictation, type Dictation } from "@/lib/dictation";

interface StrokePlayer {
  id: string;
  name: string;
  handicap: number;
  handicapType?: string | null;
  handicapSource?: string | null;
  /**
   * Which set of tees this player is on, for the head of their card.
   *
   * Per player and not per screen, because a field can be mixed: a club
   * championship runs championship, seniors and ladies off three sets, set
   * once on each FLIGHT. Resolved on the server through the tee policy so
   * the name here is the one the shots below were computed from.
   */
  tee?: { name: string; rated: boolean } | null;
  /**
   * Marked out for this round of a weekly league.
   *
   * The picker listed the whole season roster, so a Tuesday where four of
   * six were in offered six names in one flat list with nothing to tell them
   * apart — and the FIRST of them, whoever the sort happened to put there,
   * was selected before the organizer looked. A card entered against an
   * absentee reaches the week sheet and the season standings.
   *
   * Marked rather than removed, deliberately. Somebody who turned up
   * unannounced played, and a screen that refuses to record their card is
   * wrong about the round in the more damaging direction.
   */
  absent?: boolean;
}

/**
 * The line under the card: the nines, then how many holes are in.
 *
 * Only an eighteen-hole round has a front and a back. `front` and `back` split
 * the ROUND's own holes at the ninth, so a nine-hole round read "Front 40 ·
 * Back —" — half a card apparently missing, walked on a casual nine on
 * 2026-09-27 — and a round of the BACK nine would have called its own total
 * "Front". The gross is printed just above, so a nine needs only the count.
 */
export function progressLine(card: { front: number; back: number; played: number }, holes: number): string {
  const count = `${card.played}/${holes} holes`;
  if (holes <= 9) return count;
  return `Front ${card.front || "—"} · Back ${card.back || "—"} · ${count}`;
}

export function StrokePlayEntry({
  players,
  pars,
  yards,
  strokeIndex,
  holes,
  stageId,
  cardsByPlayer,
  cardStatus = {},
  teeGroups = [],
  shotsByPlayer = {},
  cardScanAvailable = true,
  photoFolded = false,
  brand,
  scoringBasis = "both",
  format = "",
  courseName = "",
  venueIsHome = false,
  firstHole = 1,
  casual = false,
  meId,
}: {
  /**
   * A CASUAL ROUND'S CARD (Ajay, 2026-10-06: "just one screen including score
   * entry for the foursome"). Hole by hole for everybody on it, the mic beside
   * the hole, and no Save button to forget: every card changed on this phone
   * is sent a moment after the tap. The full card is one tap away. No picker,
   * no group select and no photo reader — one group, no desk.
   */
  casual?: boolean;
  /** The person holding the phone, for the mic's "me". See `HoleByHoleCard`. */
  meId?: string;
  /** The course's number for the first hole on the round's card — 10 on a back nine. */
  firstHole?: number;
  players: StrokePlayer[];
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  holes: number;
  stageId: string;
  cardsByPlayer: Record<string, (number | null)[]>;
  /** Where each card is between "written down" and "accepted". An approved
   *  card is the committee's, and `saveScorecard` refuses to write one — so
   *  the screen has to know before it offers, rather than after it fails. */
  cardStatus?: Record<string, string>;
  /** False when this club's plan doesn't include reading a card from a
   *  photo. Passed down so the control renders locked rather than vanishing. */
  cardScanAvailable?: boolean;
  /**
   * A PLAYER's screen (Ajay, 2026-10-06): voice entry stays on the main
   * screen and reading a card from a photo goes behind an extender — players
   * score on the course, and a photographed card is the desk's job. Staff
   * keep it open, since reading returned cards is what they are there to do.
   */
  photoFolded?: boolean;
  /** The round's tee sheet: who is sharing a card with whom. Empty when no
   *  sheet has been drawn, in which case entry falls back to one player. */
  teeGroups?: Array<{ name: string; time: string; playerIds: string[] }>;
  /** Handicap strokes per hole, per player, from the real course-handicap
   *  allocation on the server. Absent for an event with no tee ratings. */
  shotsByPlayer?: Record<string, number[]>;
  /** The club's mark, for the head of the card. The grid below is ONE player's
   *  card — the picker above chooses whose — so this is one badge on one card,
   *  the same as the player holds on their phone. The hole-by-hole view is a
   *  group of cards at once and deliberately carries no mark: four logos down
   *  a phone screen is clutter, not a scorecard. */
  brand?: CardBrand | null;
  /** How this round is scored — gross | net | both | stableford. Decides
   *  which totals the card reports. Defaults to "both", which is the three
   *  figures a caller that says nothing used to get. */
  scoringBasis?: string;
  /** The round's format. Wins over `scoringBasis` where the two contradict
   *  each other — a Stableford is won on points whatever the basis says. */
  format?: string;
  /** The course this round is played on. A scorecard is the COURSE's card,
   *  so this heads it — see `cardHeading`. */
  courseName?: string;
  /** Whether that course is the club's own. */
  venueIsHome?: boolean;
}) {
  /**
   * The card opens on somebody who was actually there.
   *
   * It opened on `players[0]` — the first of the season roster, absent or not
   * — so on a league week the pre-selected player could be one of the people
   * who told the club they could not make it. The first keystroke then lands
   * on the wrong card, and nothing on the screen said so.
   */
  const presentPlayers = players.filter((p) => !p.absent);
  const absentPlayers = players.filter((p) => p.absent);
  const [playerId, setPlayerId] = useState(presentPlayers[0]?.id ?? players[0]?.id ?? "");
  const [cards, setCards] = useState<Record<string, (number | null)[]>>(() => {
    const init: Record<string, (number | null)[]> = {};
    for (const p of players) init[p.id] = cardsByPlayer[p.id] ?? new Array(holes).fill(null);
    return init;
  });
  /**
   * Hole-at-a-time or the whole grid.
   *
   * Server-rendered as the grid and switched on mount, rather than read from
   * `window` in the initialiser: this is a client component, so it renders on
   * the server too, and touching `window` there is a hydration mismatch. The
   * cost is one re-render on a phone; the alternative is a console error and a
   * tree React re-creates from scratch.
   */
  // A casual round opens on the hole at every width — it is scored on the
  // course, and the same answer on server and client needs no effect.
  const [view, setView] = useState<"hole" | "card">(casual ? "hole" : "card");
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setView("hole");
  }, []);

  /**
   * Which tee group is being scored — the card, not the player.
   *
   * Defaults to the group containing the selected player, so arriving from
   * anywhere that already picked a player lands on the right card. `-1` means
   * "just this player", which is the only option when no sheet has been drawn
   * and the right one for a player posting their own round.
   */
  // A casual round's one group from the first render, so the card does not
  // open on one player and then jump to four.
  const [groupIdx, setGroupIdx] = useState(casual && teeGroups.length > 0 ? 0 : -1);
  useEffect(() => {
    const i = teeGroups.findIndex((g) => g.playerIds.includes(playerId));
    if (i !== -1) setGroupIdx(i);
    // Only when the player changes: re-running on teeGroups identity would
    // fight an organizer who has deliberately switched to another group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const [listening, setListening] = useState(false);
  const [listenHint, setListenHint] = useState("Tap the mic and read scores in order, e.g. “four, par, birdie, six”.");
  const recognitionRef = useRef<Dictation | null>(null);
  const [pending, startTransition] = useTransition();
  /**
   * "SAVED." HAS TO BELONG TO THE CARD IT IS SITTING UNDER.
   *
   * It was a plain string, set when a save returned and never cleared again —
   * not when the scorer picked a different player, not when they typed another
   * score. It renders inside the footer line, immediately after
   * "18/18 holes", which is exactly where somebody reads "this card is in".
   *
   * The sequence is the ordinary one for a fourball, and it loses a round.
   * Save the first player. Pick the second. Type their eighteen holes. The
   * footer now reads "Front 37 · Back 37 · 18/18 holes · Saved." over a card
   * the server has never seen — this screen holds a partial card on the device
   * under `scoreEntryWindow: "after"` and the note was left over from the
   * previous player. Walk away and that round is gone.
   *
   * Found exactly that way on 2026-09-11, walking a two-player round: the
   * second card read Saved, and the database had one scorecard.
   *
   * So it is DERIVED rather than cleared. The note remembers the cards it was
   * about and which player was on screen, and it is rendered only while both
   * still match — any edit to any card, and any change of player, and it is
   * simply no longer true, with nothing to remember to reset. There are five
   * places that mutate `cards`; a sixth added later is covered by this without
   * knowing the rule exists.
   */
  const [saved, setSaved] = useState<SavedNote | null>(null);

  // Still true? `visibleSaveNote` carries the whole reason.
  const saveNote = visibleSaveNote(saved, JSON.stringify(cards), playerId);

  const player = players.find((p) => p.id === playerId);
  const strokes = cards[playerId] ?? new Array(holes).fill(null);
  /**
   * The totals are built from what the ROUND allocated, not from an index.
   *
   * `shotsByPlayer` is the server-resolved Playing Handicap, hole by hole — the
   * same numbers this screen prints as dots beside each hole. The totals were
   * computed separately from `player.handicap`, the raw Handicap Index, so the
   * net and the Stableford points disagreed with the dots directly above them:
   * three to five strokes at a rated club, and one stroke at minimum anywhere,
   * because Stroke Play carries a 95% allowance and needs no ratings to
   * diverge. A committee override made it worse still.
   *
   * `PlayerCard.tsx` was fixed this way already, and its comment names this
   * defect by location. This is that fix, on the screen it points at.
   *
   * And a Modified Stableford round is scored on the Modified table. It was
   * shown standard points, labelled "Stableford" and displayed first, so two
   * eagles and sixteen pars read 40 on the card and 10 on the board.
   */
  const card = useMemo(
    () =>
      computeStrokeCard(strokes, pars, player?.handicap ?? 0, strokeIndex, {
        shotsPerHole: shotsByPlayer[playerId],
        pointsForHole:
          boardKind(format) === "modified-stableford"
            ? modifiedStablefordForHole
            : stablefordPointsForHole,
      }),
    [strokes, pars, strokeIndex, player, shotsByPlayer, playerId, format],
  );

  /**
   * Who is on the card being scored.
   *
   * Kept in tee-sheet order rather than field order — that is the order the
   * scorer reads names off the paper sheet, and matching it is the difference
   * between checking and searching. Ids the sheet lists but the field no longer
   * has (a withdrawal after the draw) are dropped rather than rendered blank.
   */
  const cardPlayers = useMemo(() => {
    const group = groupIdx >= 0 ? teeGroups[groupIdx] : null;
    const chosen = group
      ? group.playerIds
          .map((id) => players.find((p) => p.id === id))
          .filter((p): p is StrokePlayer => !!p)
      : players.filter((p) => p.id === playerId);
    return chosen.map((p) => ({
      id: p.id,
      name: p.name,
      shotsOn: (hole: number) => shotsByPlayer[p.id]?.[hole] ?? 0,
    }));
  }, [groupIdx, teeGroups, players, playerId, shotsByPlayer]);

  /**
   * Saves the cards that actually have scores on them.
   *
   * Two ways to get this wrong, and they pull in opposite directions. Saving
   * only the selected player drops the other three rounds the scorer just
   * entered, with a confirmation that said it worked. Saving everyone on the
   * tee sheet writes an empty card for each player who has not reported —
   * which is worse, because an empty card is not nothing: it marks a player as
   * having returned a round, and the approval step then has something to
   * approve that nobody wrote.
   *
   * So: a card is saved when it has at least one score on it. Scoring is
   * allowed to be partial — one player in a fourball entering their own round
   * is a normal thing to do, not an incomplete version of a group entry.
   */
  const save = () =>
    startTransition(async () => {
      const targets = (view === "hole" ? cardPlayers.map((p) => p.id) : [playerId]).filter((id) =>
        (cards[id] ?? []).some((s) => s != null),
      );
      // An approved card is left alone rather than attempted. The action
      // refuses it either way, but a group is saved in one loop — one throw
      // part-way through would drop the rounds of everyone after it in the
      // fourball, under a button that said Save.
      const locked = targets.filter((id) => isCardLocked(cardStatus[id] ?? ""));
      /**
       * ONE BAD CARD MUST NOT TAKE THE REST OF THE FOURBALL WITH IT.
       *
       * The note above guards the approved-card case and stops there, and the
       * hazard it describes was live for every OTHER throw `saveScorecard`
       * makes — a stroke the boundary refuses, a partial card, a revision
       * conflict. The loop had no catch, so the throw escaped the transition:
       * the cards before it were written, the cards after it were not, and
       * `setSaved` never ran, so the screen said NOTHING AT ALL under a button
       * that said Save. Two players' rounds silently missing is worse than the
       * refusal it came from.
       *
       * So each card is saved on its own account and its failure is reported
       * by name. `err.message` is the sentence the server wrote — `strokeFault`
       * names the hole and the number — and the fallback covers a transport
       * failure, which has no useful message of its own.
       */
      const failed: Array<{ id: string; why: string }> = [];
      for (const id of targets.filter((id) => !locked.includes(id))) {
        try {
          await saveScorecard(stageId, id, cards[id] ?? new Array(holes).fill(null));
        } catch (err) {
          failed.push({
            id,
            why: err instanceof Error && err.message ? err.message : "It didn't save — try again.",
          });
        }
      }
      const named = (id: string) => players.find((p) => p.id === id)?.name ?? "A card";
      setSaved({
        text: failed.length
          ? `${failed.map((f) => `${named(f.id)}: ${f.why}`).join(" ")}${
              targets.length - locked.length - failed.length > 0
                ? ` The other ${targets.length - locked.length - failed.length === 1 ? "card" : "cards"} saved.`
                : ""
            }`
          : locked.length
          ? `Saved. ${locked
              .map((id) => named(id))
              .join(", ")} — already approved, so left unchanged. An organizer can reopen it below.`
          : "Saved.",
        // What was actually sent, and who was on screen when it was.
        cards: JSON.stringify(cards),
        playerId,
      });
    });

  /**
   * A CASUAL CARD SAVES ITSELF — and only the cards this phone changed.
   *
   * A Save button at the foot of a hole-by-hole card is a round lost the day
   * somebody walks off the 18th without pressing it. So a moment after the
   * last tap, every card that differs from what this phone last sent goes.
   *
   * ONLY THOSE. The friends may be keeping their own cards on their own phones
   * by the round's code, and sending every card on the screen would write this
   * phone's stale copy of theirs over the holes they just entered. A card the
   * host never touched is never sent.
   *
   * A refusal is shown by name, as the button's save does, and is not retried
   * in a loop: the same card is not sent again until it changes or somebody
   * presses Try again.
   */
  const lastSent = useRef<Record<string, string>>(
    Object.fromEntries(players.map((p) => [p.id, JSON.stringify(cardsByPlayer[p.id] ?? new Array(holes).fill(null))])),
  );
  const refused = useRef("");
  const [retry, setRetry] = useState(0);
  /** The cards this phone differs on from what it last sent. */
  const changedIn = (snapshot: Record<string, (number | null)[]>) =>
    players
      .map((p) => p.id)
      .filter(
        (id) =>
          JSON.stringify(snapshot[id] ?? []) !== lastSent.current[id] &&
          (snapshot[id] ?? []).some((s) => s != null) &&
          !isCardLocked(cardStatus[id] ?? ""),
      );
  /**
   * One send at a time, each behind the last, and each asking what has
   * changed only when its turn comes. So a card is never sent twice, and an
   * older copy can never land after a newer one.
   */
  const inFlight = useRef<Promise<unknown>>(Promise.resolve());
  const sendChanged = (snapshot: Record<string, (number | null)[]>) => {
    const run = inFlight.current.then(async () => {
      const ids = changedIn(snapshot);
      if (ids.length === 0) return [];
      const cardOf = (id: string) => snapshot[id] ?? new Array(holes).fill(null);
      // ONE request for every card — see `saveScorecards`: a second request
      // sent as the scorer leaves can be aborted, and its card lost.
      try {
        const results = await saveScorecards(stageId, ids.map((id) => ({ playerId: id, strokes: cardOf(id) })));
        const failed: Array<{ id: string; why: string }> = [];
        for (const r of results) {
          if (r.ok) lastSent.current[r.playerId] = JSON.stringify(cardOf(r.playerId));
          else failed.push({ id: r.playerId, why: r.error ?? "It didn't save — try again." });
        }
        return failed;
      } catch (err) {
        const why = err instanceof Error && err.message ? err.message : "It didn't save — try again.";
        return ids.map((id) => ({ id, why }));
      }
    });
    inFlight.current = run.catch(() => undefined);
    return run;
  };
  // Leaving inside the 600ms — or while a save is still going — sends what
  // is left then. See `useSaveBeforeLeaving`.
  const latestCards = useRef(cards);
  useEffect(() => {
    latestCards.current = cards;
  }, [cards]);
  useSaveBeforeLeaving(() => {
    if (casual) void sendChanged(latestCards.current);
  });
  useEffect(() => {
    if (!casual || pending) return;
    const now = JSON.stringify(cards);
    if (refused.current === now) return;
    if (changedIn(cards).length === 0) return;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        const failed = await sendChanged(cards);
        refused.current = failed.length ? now : "";
        const named = (id: string) => players.find((p) => p.id === id)?.name ?? "A card";
        setSaved({
          text: failed.length ? failed.map((f) => `${named(f.id)}: ${f.why}`).join(" ") : "Saved.",
          cards: now,
          playerId,
        });
      });
    }, 600);
    return () => window.clearTimeout(timer);
    // `retry` re-arms it after a refusal; the rest is what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casual, cards, pending, retry]);
  const autoFailed = casual && !pending && refused.current !== "" && refused.current === JSON.stringify(cards);

  const toggleListen = () => {
    if (listening) {
      // Stop the recogniser, not just the button — see `dictation.test.ts`.
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
      return;
    }
    const started = startDictation({
      onTranscript: (transcript) => {
        const startIndex = Math.max(0, strokes.findIndex((s) => s == null));
        const parsed = parseStrokesTranscript(transcript, pars.slice(0, holes), startIndex === -1 ? 0 : startIndex);
        if (parsed.length) {
          const next = [...strokes];
          parsed.forEach((v, i) => { next[startIndex + i] = v; });
          setCards((prev) => ({ ...prev, [playerId]: next }));
          setListenHint(`Heard: “${transcript}” — filled ${parsed.length} hole${parsed.length === 1 ? "" : "s"}. Review and Save.`);
        } else {
          setListenHint(`Heard: “${transcript}” — didn’t catch any scores, try again.`);
        }
        setListening(false);
      },
      onError: () => {
        setListenHint("Didn’t catch that — try again or type it.");
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
    if (!started) {
      setListenHint("Voice entry isn’t supported in this browser — type the scores instead.");
      return;
    }
    recognitionRef.current = started;
    setListening(true);
    setListenHint("Listening…");
  };

  if (!player) {
    return (
      <div className="card elev-sm">
        <span className="text-muted" style={{ fontSize: 13 }}>
          No confirmed players yet — add them on the <Link href="/registration">Registration & field</Link> screen.
        </span>
      </div>
    );
  }

  // The grid, the hole columns and the par-marked score box all moved to
  // ScorecardTable when the two scorecards in this app became one. The marks
  // went with them — a birdie ring on a hole you know you bogeyed is still
  // caught the moment it appears, now on both screens instead of one.

  /** Reading a card from a photo — open for staff, behind More for a player. */
  const photoReader = (
    <CardPhotoReader
      available={cardScanAvailable}
      stageId={stageId}
      players={cardPlayers}
      holeCount={holes}
      onReading={(rows) =>
        setCards((prev) => {
          const next = { ...prev };
          for (const { playerId: id, strokes } of rows) {
            // Merge rather than replace: a hole the reader could not
            // make out must not wipe a score already typed in by hand.
            const current = next[id] ?? new Array(holes).fill(null);
            next[id] = current.map((existing, i) => strokes[i] ?? existing ?? null);
          }
          return next;
        })
      }
    />
  );

  // On a casual round's hole view the card IS the group: whose card the picker
  // chooses, and that one player's totals, describe nobody in particular —
  // each row carries its own "+1 thru 7".
  const onePlayerHead = !casual || view === "card";

  return (
    // A casual round's hole view is not framed twice: the hole card is the card.
    <div className={casual && view === "hole" ? undefined : "card elev-sm"}>
      {onePlayerHead && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label htmlFor={`${stageId}-entry-player`}>Player</label>
          {/* Split into two groups when a league has marked anybody out, and
              left as one flat list when it has not — a tournament has no
              "this week" and a lone optgroup labelled "Playing this round"
              would be a heading over the whole field.

              The absent are kept, and kept SECOND. A player who turned up
              unannounced still played, and a card is the proof; what this
              stops is the misclick, not the entry. */}
          <select id={`${stageId}-entry-player`} className="input" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            {absentPlayers.length === 0 ? (
              players.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (hcp {indexLabel(p)})</option>
              ))
            ) : (
              <>
                <optgroup label="Playing this round">
                  {presentPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (hcp {indexLabel(p)})</option>
                  ))}
                </optgroup>
                <optgroup label="Marked out this week">
                  {absentPlayers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (hcp {indexLabel(p)})</option>
                  ))}
                </optgroup>
              </>
            )}
          </select>
          {player?.absent && (
            <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0", lineHeight: 1.45 }}>
              <Icon name="warning-circle" /> {player.name} is marked out for this round. Entering a card
              here still counts it — change who is playing on the{" "}
              <Link href="/foursomes">Tee sheet</Link> if they did play.
            </p>
          )}
        </div>
        {/* The figures this round is actually scored on, in reading order.
            All four used to show on every card, so a gross medal reported a
            Net and a Stableford total the tournament never reads, and a
            Stableford round gave "to par" equal billing with the points it is
            won on. Two of four numbers being noise is worse than two numbers:
            on a phone in the sun the reader has to work out which is theirs.
            `cardTotals` is derived from the round, so this cannot drift from
            how the round is scored. */}
        <div style={{ display: "flex", gap: 18, textAlign: "center" }}>
          {cardTotals(scoringBasis, format).map((t) => (
            <div key={t}>
              <div className="card-kicker">{TOTAL_LABEL[t]}</div>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 22,
                  color:
                    t === "toPar"
                      ? "var(--color-accent-200)"
                      : t === "points"
                        ? "var(--color-accent-2-200)"
                        : undefined,
                }}
              >
                {t === "gross"
                  ? card.gross || "—"
                  : !card.played
                    ? "—"
                    : t === "net"
                      ? card.net
                      : t === "toPar"
                        ? toParText(card.toPar)
                        : card.points}
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* The whole-card dictation is not on a casual round: its card is kept a
          hole at a time, and the mic beside the hole ("Bea five, me four") is
          the one that fits that. */}
      {!casual && (
        <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={toggleListen}
          style={listening ? { color: "var(--color-accent-200)", borderColor: "var(--color-accent)" } : undefined}
        >
          <Icon name={listening ? "ph-fill ph-microphone" : "ph ph-microphone"} />{" "}
          {listening ? "Listening…" : "Voice entry"}
        </button>
        <span className="text-muted" style={{ fontSize: 13 }}>{listenHint}</span>
      </div>
      {/* What the mic does, beside the mic. One component for all four so they
          cannot drift into four different promises — see `MicNote`. */}
      <MicNote style={{ marginTop: 6 }} />
        </>
      )}

      {/* Two windows onto one card. The grid is for a desk and a stack of
          returned cards; the hole view is for a phone on the course. Both write
          to the same state, so switching never loses a score.

          A casual round offers the other window from the foot of the card
          instead — it opens on the hole and nearly always stays there. */}
      {!casual && (
      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        {(["hole", "card"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="btn btn-secondary"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            style={
              view === v
                ? { color: "var(--color-accent-200)", borderColor: "var(--color-accent)", fontSize: 13 }
                : { fontSize: 13 }
            }
          >
            <Icon name={v === "hole" ? "ph ph-flag" : "ph ph-table"} />{" "}
            {v === "hole" ? "Hole by hole" : "Full card"}
          </button>
        ))}
      </div>
      )}

      {view === "hole" ? (
        <div style={{ marginTop: casual ? 0 : 14 }}>
          {teeGroups.length > 0 && !casual && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Scoring</label>
              <select
                className="input"
                value={groupIdx}
                onChange={(e) => setGroupIdx(Number(e.target.value))}
              >
                <option value={-1}>{player ? `${player.name} only` : "One player"}</option>
                {teeGroups.map((g, i) => (
                  <option key={i} value={i}>
                    {[g.name || `Group ${i + 1}`, g.time].filter(Boolean).join(" · ")} —{" "}
                    {g.playerIds.length} players
                  </option>
                ))}
              </select>
            </div>
          )}
          <HoleByHoleCard
            players={cardPlayers}
            cards={cards}
            pars={pars}
            yards={yards}
            strokeIndex={strokeIndex}
            holes={holes}
            firstHole={firstHole}
            meId={meId && cardPlayers.some((p) => p.id === meId) ? meId : undefined}
            voice={casual}
            dense={casual}
            onSet={(pid, i, v) =>
              setCards((prev) => {
                const next = [...(prev[pid] ?? new Array(holes).fill(null))];
                next[i] = v;
                return { ...prev, [pid]: next };
              })
            }
          />
        </div>
      ) : (
      <div style={{ marginTop: 12 }}>
        {/* The one scorecard in this app. The player's card renders the same
            component, so a card checked on a phone and the same card on the
            console cannot show different totals. */}
        <ScorecardTable
          holes={holes}
          pars={pars}
          yards={yards}
          strokeIndex={strokeIndex}
          strokes={strokes}
          brand={brand}
          courseName={courseName}
          venueIsHome={venueIsHome}
          firstHole={firstHole}
          /* Which set THIS player is on. Resolved on the server through the
             tee policy and the flight, so a mixed field — championship,
             seniors, ladies off three sets — names the right one per card. */
          tee={player?.tee ?? null}
          shotsPerHole={Array.from({ length: holes }, (_, i) => shotsByPlayer[playerId]?.[i] ?? 0)}
          onSet={(i: number, v: number | null) => setCards((prev) => {
            const next = [...(prev[playerId] ?? new Array(holes).fill(null))];
            next[i] = v;
            return { ...prev, [playerId]: next };
          })}
        />
      </div>
      )}

      {casual ? (
        /* No Save button: the card saves itself (see `lastSent`). What is left
           is whether it has, and the other window onto the card. */
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--color-divider)", flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 14, color: autoFailed ? "var(--color-danger)" : "var(--color-neutral-400)", minWidth: 0 }} role="status" aria-live="polite">
            {pending ? "Saving…" : saveNote ?? ""}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            {autoFailed && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ minHeight: 44 }}
                onClick={() => {
                  refused.current = "";
                  setRetry((n) => n + 1);
                }}
              >
                Try again
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ minHeight: 44 }}
              onClick={() => setView(view === "hole" ? "card" : "hole")}
            >
              <Icon name={view === "hole" ? "ph ph-table" : "ph ph-flag"} />{" "}
              {view === "hole" ? "See the full card" : "Back to the hole"}
            </button>
          </span>
        </div>
      ) : (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--color-divider)", flexWrap: "wrap", gap: 8 }}>
        <span className="text-muted" style={{ fontSize: 13 }}>
          {progressLine(card, holes)}
          {saveNote && (
            <>
              {" · "}
              <span role="status" aria-live="polite">{saveNote}</span>
            </>
          )}
        </span>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          <Icon name="check" /> Save scorecard
        </button>
      </div>
      )}

      {/* Another way to get a card in without typing it. It fills the grid
          above and does not save; the submit is still what writes anything.

          BELOW the card, not above it (2026-10-04). Walked at 393px it sat
          between a player on the first tee and hole 1's buttons — a locked
          "coming soon" panel taking most of a screen of scrolling on every
          visit. A returned card photographed at the desk is read after the
          round, so here is where it is reached for anyway. */}
      {/* Not on a casual round: it is scored on the phone, and reading a
          returned paper card is a desk's job a friendly does not have. */}
      {cardPlayers.length > 0 && photoFolded && !casual && (
        <details style={{ marginTop: 14 }}>
          <summary
            className="touch-target"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 15, fontWeight: 600, color: "var(--color-accent-200)", listStyle: "none" }}
          >
            <Icon name="caret-down" aria-hidden />
            More: Read a paper card from a photo
          </summary>
          <div style={{ marginTop: 10 }}>{photoReader}</div>
        </details>
      )}
      {cardPlayers.length > 0 && !photoFolded && !casual && <div style={{ marginTop: 14 }}>{photoReader}</div>}
    </div>
  );
}
