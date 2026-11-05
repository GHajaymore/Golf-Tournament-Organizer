"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { GroupScoring, type GroupPartner, type PartnerSave } from "./GroupScoring";
import {
  EndCheckPanel,
  GroupCardFollow,
  KeepingBar,
  MatchFollow,
  forgetUnsent,
  FollowRefresh,
  type EndCheckView,
  type GroupKeepingView,
} from "./PlayGroupKeeping";
import { keepingRole } from "@/lib/domain/keeping-words";
import { bringIntoView } from "@/lib/bring-into-view";
import { usePageIsLive } from "./usePageIsLive";
import { HeldBeforeLoad, takeHeldPress, dropHeldPress } from "./HeldBeforeLoad";
import { redeemRoundCode, claimPlayerSlot, redeemRoundCodeForm, claimPlayerSlotForm, leavePlay, savePlayMatchHoles, savePlayMatchResult, savePlayCard, certifyPlayCard, savePlayMatchCard } from "@/app/actions/play";
import { HoleByHoleCard } from "./HoleByHoleCard";
import { usePendingCard } from "./usePendingCard";
import { OrgBrand, type Brand } from "./OrgBrand";
import { Icon } from "./Icon";
import { MoreInfo } from "./MoreInfo";
import { filterNames, showsNameFilter } from "@/lib/domain/name-filter";
import { cardTotals, TOTAL_LABEL } from "@/lib/domain/card-totals";
import { computeStrokeCard, stablefordPointsForHole, modifiedStablefordForHole } from "@/lib/domain/stroke";
import { toParText } from "@/lib/domain";
import { boardKind } from "@/lib/formats";
import { isStablefordRound } from "@/lib/domain/week-basis";
import { stablefordPickUp } from "@/lib/domain/card-points";
import { certifyPrompt } from "@/lib/domain/card-approval";
import { MatchKeeper } from "./MatchKeeper";
import { MatchStrokeKeeper } from "./MatchStrokeKeeper";
import type { KeptMatch, MatchStrokeCard } from "@/lib/services/match-card";
import { linkFromHash, formatAccessCode } from "@/lib/code-format";
import {
  groupNeedsName,
  keepingSentence,
  keepingYes,
  lastTimeSentence,
  parseRemembered,
  rememberGroup,
  rememberedGroup,
  targetKey,
  type PlayGroup,
  type PlayTarget,
} from "@/lib/domain/play-groups";
import type { ClaimFormState } from "@/app/actions/play";

/** A match as its holder keeps it — built by `matchCardFor`, one type for both pages. */
type PlayMatch = KeptMatch;

interface Props {
  /**
   * `staff-kept`: the tournament's cards are kept by its organizers
   * (`canEnterScores(settings, "player")` is false), so nothing here may be
   * saved and nothing is offered — see the page.
   */
  stage: "code" | "score" | "no-match" | "card" | "staff-kept";
  /** The club's word for its organizer ("organizer" / "organiser"), for `staff-kept`. */
  organizer?: string;
  /**
   * `staff-kept` because THIS ROUND is "Organizer only (paper cards)", not the
   * whole tournament (`playerEntryRefusal`, 2026-11-05): said of the round.
   */
  staffKeptRound?: boolean;
  /**
   * ONE SCORER PER GROUP (2026-11-05, phase 2): who keeps this player's group
   * and who is in it (`keeperFor`). Absent where each player keeps their own —
   * a round kept "each", or a tournament round whose draw is not published.
   */
  group?: GroupKeepingView;
  /** The rest of the group, whose cards this phone keeps when it is the scorer on a stroke round. */
  partners?: GroupPartner[];
  /** The end-of-round check, for this phone's match or own card (`EndCheckPanel`). */
  endCheck?: EndCheckView;
  /**
   * THE LEADERBOARD, ONE TAP AWAY (2026-10-18). At the first real cup every
   * player scored by the code, and this page was score entry and nothing
   * else: nobody could see how the cup stood without the link from the
   * printed sheet. The tournament's public board, where the organizer has
   * made it public ("Anyone with the link"); otherwise none, and nothing is
   * drawn.
   */
  boardHref?: string;
  /**
   * The round and the code holder, for keeping their card on the phone while
   * it is sent (`usePendingCard`). Both come from the play session.
   */
  stageId?: string;
  playerId?: string;
  /**
   * The code holder's OTHER matches in this round — a round robin draws one
   * player into several. Offered as links; the one on screen is `match`.
   */
  otherMatches?: { id: string; label: string }[];
  brand?: Brand | null;
  playerName?: string;
  eventName?: string;
  roundLabel?: string;
  submitWhole?: boolean;
  match?: PlayMatch;
  /**
   * How many holes THIS ROUND is played over.
   *
   * The grid used to be sized from `pars.length`, which is the card and not
   * the round. A nine-hole match handed the event's eighteen-hole card drew
   * eighteen cells, and since only nine of them can ever be filled the submit
   * button read "Fill all 18 holes to submit" and stayed disabled for good —
   * a player with a round code could not hand in their card at all. The nine
   * cells past the end were then discarded on save, so the number on screen
   * was never the number being stored either.
   */
  holes?: number;
  pars?: number[];
  yards?: number[];
  strokeIndex?: number[];
  /** The club card's own stroke index for these holes, to print in place of the 1–9 ranking on a nine. */
  cardStrokeIndex?: number[];
  /** The course's number for the card's first hole — 10 on a back nine (`firstHoleOf`). */
  firstHole?: number;
  netMode?: boolean;
  /** The organizer's "Voice entry" setting — off, the card offers no microphone. */
  voiceEntry?: boolean;
  /**
   * A net match's shots per hole, side A's and side B's as drawn, resolved on
   * the server exactly as the console's card does. Null for a gross match, or
   * a card with no stroke index.
   */
  matchShots?: { a: number[]; b: number[] } | null;
  /** The holder's own stroke card, where the round keeps its matches on cards (`matchKeptBy`). */
  strokeCard?: MatchStrokeCard;
  /**
   * EVERY BALL IN THE MATCH, when this phone is the group's scorer on a round
   * kept on stroke cards (2026-11-05): each player's card, or each side's one
   * card. The scorer picks a ball; each save names it (`playerId`).
   */
  strokeBalls?: Array<{ id: string; name: string; card: MatchStrokeCard }>;
  /**
   * The format, when the code is for a round played by SIDES — a four-ball or
   * foursomes, kept on one phone. This surface keeps a player's own card or
   * match and never a side's, so it says that instead of "no match for you".
   */
  sideRound?: string;
  /**
   * The player's own strokes, for a round that is scored from a card rather
   * than played against somebody.
   *
   * A medal has no draw, so this surface's match-only shape sent every player
   * on a stroke-play round to "no match for you" — on a template that turns
   * player self-scoring ON and hands out a Round Code precisely so a roster of
   * names can score without accounts.
   *
   * Sent as already returned rather than opened blank, or saving would erase a
   * round somebody entered at the turn.
   */
  card?: (number | null)[];
  /**
   * Whether this card is already signed (certified by the player, or approved by the committee).
   * It started unsigned on every visit, so a signed card offered "Certify my card" again.
   */
  signed?: boolean;
  /**
   * That this round is temporary, in words, or "" for a tournament.
   *
   * A casual round deletes itself about a day after it is set up, and the
   * whole justification for that being acceptable is that the people it
   * belongs to are told BEFORE it happens. This surface was the last place
   * they were not.
   *
   * It became the important one the moment a casual round started issuing a
   * Round Code: before that a guest could not reach a card at all and the
   * warning on /me covered everybody who could. Now a fourball's other three
   * players score here, with no account, and they were scoring a round that
   * vanished overnight with nothing said.
   *
   * They cannot keep it — `keepRound` is staff-only and refuses everybody else
   * by name — so the sentence names the remedy they actually have, which is to
   * ask whoever set it up. Already worded by `expiryNotice`; empty renders
   * nothing.
   */
  expiryNotice?: string;
  /** The same warning in one line — see `Shell`. */
  expiryShort?: string;
  /**
   * How this round is scored — gross | net | both | stableford.
   *
   * The card reported a gross total and a to-par figure, always, whatever the
   * round was played for. On the charity-day template that is precisely
   * backwards: it runs a STABLEFORD, and its own blurb says why — "so a bad
   * hole can't ruin anyone's round". A first-timer who takes a ten was shown
   * "+6" rather than the nought points it actually costs them, on the one
   * screen the template exists to send them to.
   *
   * `cardTotals` is the reader the console's card already uses, so the phone
   * and the desk now report the same figures for the same round.
   */
  scoringBasis?: string;
  /**
   * The round's format, because it outranks the basis where they disagree.
   *
   * A Modified Stableford round whose basis still reads "gross" — the ordinary
   * way this happens, the format changed after the basis was set — is still
   * won on points. See `ENGINE_TOTALS`.
   */
  roundFormat?: string;
  /**
   * Strokes received per hole, RESOLVED ON THE SERVER.
   *
   * Never recomputed here from a raw index. `stroke.ts` records what that
   * costs on the console's card: a net and a Stableford total three to five
   * strokes away from the dots printed beside them, and one stroke away at
   * minimum, since Stroke Play carries a 95% allowance. The same numbers the
   * board and the skins pot are settled from.
   */
  shots?: number[];
  /**
   * Whether a signed card then waits for the committee.
   *
   * True under `scoreApproval: "staff"` — a charity day, a club medal — where
   * the card sits pending until an organizer approves it. False under player
   * confirmation, which is what a casual round is set to and which
   * `createMatch` explains in its own words: "there is no committee to approve
   * a card that both players just agreed on standing on the 18th green".
   *
   * The sentence under the Certify button said the committee accepts it, to
   * everybody. Two people on a Sunday were told to wait for a committee that
   * does not exist and never arrives.
   */
  staffApproves?: boolean;
  /**
   * Whether this card is signed at all — false on a casual round
   * (`signsCards`, Ajay 2026-10-07). Default true: a tournament's card keeps
   * its signature whatever an un-updated caller sends.
   */
  signs?: boolean;
  /**
   * The code this phone's session was opened with, unformatted — so a sign
   * scanned on a phone already scoring can be told apart from the round it is
   * on. The holder typed or scanned it themselves; it is never in the cookie.
   */
  sessionCode?: string;
}

/**
 * The play shell, and the one thing every stage inside it has to say.
 *
 * `notice` renders here rather than in each stage so a surface added later
 * carries the warning without anybody remembering to add it — the shape this
 * codebase keeps arriving at, and the reason the /me banner had to be added by
 * hand in the first place.
 */
function Shell({
  brand,
  notice,
  short = "",
  boardHref,
  children,
}: {
  brand?: Brand | null;
  /** The tournament's public board, when it has one — see `boardHref` on the page's props. */
  boardHref?: string;
  /** Already-worded, from `expiryNotice`. Empty renders nothing. */
  notice?: string;
  /**
   * The same warning in one line (`expiryShort`), with `notice` behind its ⓘ
   * — the words the round's own screen and Today use, so a friend scoring by
   * the code reads what the host reads.
   */
  short?: string;
  children: React.ReactNode;
}) {
  return (
    // The page's main landmark: /play is its own page, outside the player
    // app's layout, so nothing above it supplies one (2026-10-08).
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        padding: "22px 16px 40px",
      }}
    >
      {/* Listening before the forms below are drawn, so a press made before
          the page is live is held for it (`HeldBeforeLoad`). */}
      <HeldBeforeLoad />
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <OrgBrand brand={brand} />
          {boardHref && (
            <a href={boardHref} className="btn btn-secondary" style={{ marginLeft: "auto", minHeight: 44, fontSize: 14, flex: "none" }}>
              <Icon name="ranking" /> Leaderboard
            </a>
          )}
        </div>
        {notice && (
          <div
            className="card elev-sm"
            style={{
              marginBottom: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              borderColor: "var(--color-warning)",
            }}
          >
            <Icon name="clock" style={{ flex: "none" }} />
            {short ? (
              <MoreInfo short={short} style={{ minWidth: 0, flex: 1 }}>
                {notice}
              </MoreInfo>
            ) : (
              <span style={{ fontSize: 13, lineHeight: 1.5, minWidth: 0, flex: 1 }}>{notice}</span>
            )}
          </div>
        )}
        {children}
      </div>
    </main>
  );
}

/**
 * A SIGN SCANNED ON A PHONE THAT IS ALREADY SCORING (2026-10-17).
 *
 * The round's printed sign opens `/play#CODE`. On a phone with no session the
 * code step reads it. On a phone holding a session the server shows that
 * session and knows nothing of the `#`, so without this the second round's
 * sign silently reopened the first round's card. It asks, and never switches
 * by itself: switching mid-card is a decision, not a side effect of a scan.
 */
function ScannedSign({ sessionCode, roundLabel }: { sessionCode: string; roundLabel?: string }) {
  const [other, setOther] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const fromSign = linkFromHash(window.location.hash);
    if (!fromSign.code) return;
    if (fromSign.code === sessionCode) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      return;
    }
    setOther(fromSign.code);
  }, [sessionCode]);
  if (!other) return null;
  return (
    // A section in the page, not a dialog: nothing behind it is blocked, and
    // `dialogs-are-swept` counts the app's real dialogs.
    <section
      aria-label="A sign for another round"
      className="card elev-sm"
      // `calc` keeps the page's 16px gutter on a phone: the play page's own
      // padding is inside its <main>, and this sits above it.
      style={{ maxWidth: 560, width: "calc(100% - 32px)", margin: "16px auto 0", padding: "12px 14px", gap: 10, border: "1px solid var(--color-warning)" }}
    >
      <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45 }}>
        This phone is scoring <b>{roundLabel || "another round"}</b>. The code you scanned, {formatAccessCode(other)}, is
        for a different round.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ minHeight: 44 }}
          disabled={pending}
          // The `#` stays on the address, so the code step reads it after the reload.
          onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
        >
          Switch to that round
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ minHeight: 44 }}
          disabled={pending}
          onClick={() => {
            history.replaceState(null, "", window.location.pathname + window.location.search);
            setOther("");
          }}
        >
          Keep scoring this one
        </button>
      </div>
    </section>
  );
}

/**
 * THE GROUP THIS PHONE KEPT LAST TIME IN A TOURNAMENT, if it is still a group of this round
 * (`rememberedGroup`) — null when storage is blocked, empty, or holds a group that has changed.
 */
function rememberedIn(eventId: string, groups: readonly PlayGroup[]): PlayGroup | null {
  if (!eventId || groups.length === 0) return null;
  try {
    return rememberedGroup(parseRemembered(window.localStorage.getItem(`thq-play-last:${eventId}`)), groups);
  } catch {
    return null;
  }
}

export function PlayClient(props: Props) {
  return (
    <>
      {props.stage !== "code" && props.sessionCode ? (
        <ScannedSign sessionCode={props.sessionCode} roundLabel={props.roundLabel} />
      ) : null}
      {/* KEYED BY WHAT IS OPEN (2026-10-25). Tapping a name now draws the card
          from the claim's own answer instead of reloading the page — a second
          trip down one bar of signal (see `claimName`). Everything below keeps
          state seeded from its first props (the card, the queue's key, whether
          it is signed), so a different screen must be a fresh one. */}
      <PlayScreens key={`${props.stage}:${props.stageId ?? ""}:${props.playerId ?? ""}`} {...props} />
    </>
  );
}

function PlayScreens(props: Props) {
  /**
   * THE CODE AND THE NAMES ARE FORMS THAT TAKE A PRESS BEFORE THE SCRIPT (2026-10-25).
   *
   * On slow 3G the box was on the screen at 1.8 s and Continue woke at 7.8 s:
   * it waited for the page's whole script. Continue can be pressed from the
   * first paint now. A press made before the page is live is HELD
   * (`HeldBeforeLoad`) and taken up the moment it is (`takeHeldPress`, below),
   * because a plain post would be a new page and start the scripts again.
   * With no script at all — or none ten seconds after the press — each form
   * posts the plain way (`redeemRoundCodeForm`, `claimPlayerSlotForm`) and the
   * server draws the next step; these two hooks are how it hands this page
   * what a plain post answered. Every way round, the same actions underneath
   * (`openCode`, `claimName`), so the same answer.
   */
  const [posted, postCode] = useActionState(redeemRoundCodeForm, null);
  const [claimPosted, postName] = useActionState(claimPlayerSlotForm, null);
  const live = usePageIsLive();
  const [code, setCode] = useState(() => posted?.code ?? claimPosted?.code ?? "");
  const [error, setError] = useState(() => (posted && !posted.ok ? posted.error ?? "" : claimPosted?.error ?? ""));
  const [nameFilter, setNameFilter] = useState("");
  const [players, setPlayers] = useState<Array<{ id: string; name: string }> | null>(() =>
    posted?.ok ? posted.players ?? [] : null,
  );
  const [groups, setGroups] = useState<PlayGroup[]>(() => (posted?.ok ? posted.groups ?? [] : []));
  // `keepsGroups`: the round is kept by one scorer per group, so the phone keeps the whole group's card.
  const [context, setContext] = useState<{ eventName: string; roundLabel: string; stageId: string; eventId: string; keepsGroups?: boolean } | null>(() =>
    posted?.ok
      ? { eventName: posted.eventName ?? "", roundLabel: posted.roundLabel ?? "", stageId: posted.stageId ?? "", eventId: posted.eventId ?? "", keepsGroups: posted.keepsGroups }
      : claimPosted?.step
        ? {
            eventName: claimPosted.eventName ?? "",
            roundLabel: claimPosted.roundLabel ?? "",
            stageId: claimPosted.stageId ?? "",
            eventId: claimPosted.eventId ?? "",
            keepsGroups: claimPosted.keepsGroups,
          }
        : null,
  );
  /**
   * After a group is tapped: the one confirmation, then — in a group of
   * somebody's own cards — whose card. Seeded from the server's answer when the
   * tap was a plain post (`claimPlayerSlotForm`), so both ways draw one screen.
   */
  const [step, setStep] = useState<ClaimFormState["step"] | null>(() => claimPosted?.step ?? null);
  const [pending, startTransition] = useTransition();

  /**
   * THE GROUP THIS PHONE KEPT LAST TIME IN THIS TOURNAMENT (2026-11-05).
   * Read after the page is live (storage is the phone's, not the server's, so the
   * page the server drew can never differ from it), per event, through
   * `rememberedGroup` — which is null when that group has gone or changed. "Not my
   * group" (`showAll`) opens the full list. Blocked storage is simply no memory.
   */
  const [last, setLast] = useState<PlayGroup | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rememberEventId = context?.eventId ?? "";
  useEffect(() => {
    if (!rememberEventId || groups.length === 0) {
      setLast(null);
      return;
    }
    setLast(rememberedIn(rememberEventId, groups));
  }, [rememberEventId, groups]);

  /**
   * WHO KEEPS THE GROUP'S CARD ON THIS PHONE (2026-11-05, phase 2).
   *
   * `epoch` is the one this phone holds as the group's scorer, sent with every
   * save (`keeperGate`); a take-over on another phone moves it on, and this
   * phone's next save is refused in words. `refusedBy` is that refusal's
   * keeper: from then on the phone FOLLOWS — the pad and its "n/18 holes" go,
   * because nothing it holds was saved — until the page is drawn again with
   * the new keeper. Reset whenever the server says who keeps it.
   */
  const [epoch, setEpoch] = useState<number | null>(props.group?.epoch ?? null);
  const epochNow = useRef(epoch);
  epochNow.current = epoch;
  const [refusedBy, setRefusedBy] = useState<string | null>(null);
  const keeperNow = props.group?.keeperId ?? null;
  const epochDrawn = props.group?.epoch ?? null;
  useEffect(() => {
    setEpoch(epochDrawn);
    setRefusedBy(null);
  }, [keeperNow, epochDrawn]);
  const role = props.group ? keepingRole({ me: props.group.me, keeperId: keeperNow, refusedBy }) : null;
  /** The ball on screen, when the scorer keeps every ball of a match on stroke cards (`strokeBalls`). */
  const [ball, setBall] = useState(props.playerId ?? "");
  const following = role === "follower";
  // A following phone is drawn again as the scores go in.
  // A following phone is drawn again as the scores go in: <FollowRefresh /> in its view.
  /** What a save carries: the epoch, when this phone keeps the group. */
  const keeperOpts = () => (epochNow.current !== null ? { epoch: epochNow.current } : undefined);
  /** A save's answer, read for the keeper's half: a new epoch, or the card kept elsewhere. */
  const heardKeeper = (res: { ok: boolean; epoch?: number; keptBy?: string }) => {
    if (res.ok && res.epoch !== undefined) setEpoch(res.epoch);
    if (!res.ok && res.keptBy !== undefined) setRefusedBy(res.keptBy);
  };

  // Set as the card saves; nothing reads it.
  const [, setSaved] = useState(false);
  // Whether this card has been signed. Held apart from `saved`, because
  // saving and signing are different statements — see the buttons.
  const [certified, setCertified] = useState(props.signed === true);
  // The player's own card, for a round with no opponent in it. Sized to the
  // ROUND rather than to what arrived, so a short stored card still draws
  // every hole the round is played over.
  const [card, setCard] = useState<(number | null)[]>(() =>
    Array.from({ length: props.holes || props.pars?.length || 18 }, (_, i) => props.card?.[i] ?? null),
  );

  /**
   * "SAVES AS YOU GO" — AND NOW IT DOES (2026-09-19).
   *
   * Both views said so and neither did: every tap only changed the screen,
   * and nothing reached the server until the player pressed Save. There was
   * no copy on the phone either, so a reload, a dead spot or a closed tab
   * lost every hole since the last press. Found by the player-side audit.
   *
   * The same queue the signed-in card uses: each change is written to the
   * phone FIRST, then sent a moment later, retried when signal returns, and a
   * refusal is reported as a refusal rather than retried for ever. Called
   * here, unconditionally, because hooks cannot sit inside the view branches
   * below; each is switched on only in its own view.
   *
   * The match queue is keyed apart from the card's, so the two never share a
   * device copy.
   */
  const holeCount0 = props.holes || props.pars?.length || 18;
  const fitted = (strokes: readonly (number | null)[] | undefined) =>
    Array.from({ length: holeCount0 }, (_, i) => strokes?.[i] ?? null);
  // The card as the server held it when this page was drawn: every hole on it is "Sent".
  const [drawnCard] = useState(() => (props.stage === "card" ? fitted(props.card) : null));
  const cardQueue = usePendingCard<(number | null)[]>({
    stageId: props.stageId ?? "play",
    playerId: props.playerId ?? "code",
    // Not on a phone following the group: it keeps no card to send.
    enabled: props.stage === "card" && !following,
    drawnFrom: drawnCard,
    cells: (v) => v,
    // A tournament that takes whole cards: kept on the phone until the last
    // hole is in, then sent on its own.
    holding: !!props.submitWhole && card.filter((h) => typeof h === "number" && h > 0).length < holeCount0,
    send: async (value) => {
      const res = await savePlayCard(value, keeperOpts());
      heardKeeper(res);
      if (!res.ok) throw new Error(res.error ?? "Couldn't save that card.");
      setSaved(true);
      // READ BACK: the card as the row now holds it, so "Sent" is the record's word.
      return { serverHolds: fitted(res.card) };
    },
  });
  /**
   * HOLES LEFT ON THE PHONE LAST TIME ARE TAKEN BACK UP AND SENT.
   *
   * The device copy only ever holds holes the server had not confirmed — it is
   * deleted the moment a send lands — so finding one means this phone has work
   * nobody else has seen: the signal died, or the tab was closed. On this
   * surface that is the whole point of keeping it, and there is no second
   * scorer's version to choose between: the Round Code save is the holder's
   * own card, written whole. So it is simply picked up where it was left.
   */
  const { recovered: cardRecovered, clearRecovered: clearCardRecovered, push: pushCard, settle: settleCard } = cardQueue;
  useEffect(() => {
    if (props.stage !== "card" || !cardRecovered) return;
    // A phone following the group keeps nothing to send: what it had left was
    // never saved, and sending it now would write over the scorer's card.
    if (following) {
      clearCardRecovered();
      return;
    }
    const back = Array.from({ length: holeCount0 }, (_, i) => cardRecovered[i] ?? null);
    setCard(back);
    clearCardRecovered();
    pushCard(back);
  }, [props.stage, cardRecovered, clearCardRecovered, pushCard, holeCount0, following]);

  /**
   * THE CARD MOVED TO ANOTHER PHONE: this one's unsent holes are forgotten —
   * its own card's queue, each partner's, and the match's — because they can
   * never be sent now, and a copy left behind would go out the day this phone
   * took the card back, over everything entered since. Said in words on the
   * line above the card (`refusedSentence`).
   */
  useEffect(() => {
    if (refusedBy === null) return;
    settleCard(drawnCard ?? []);
    forgetUnsent(props.stageId ?? "play", [
      props.playerId ?? "code",
      ...(props.partners ?? []).map((p) => p.id),
      ...(props.match ? [`match-a:${props.match.id}`, `${props.playerId ?? "code"}:${props.match.id}`] : []),
      // Every ball the scorer kept on a match kept on stroke cards.
      ...(props.match ? (props.strokeBalls ?? []).map((b) => `${b.id}:${props.match!.id}`) : []),
    ]);
    // Once, when the refusal arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refusedBy]);

  /* ── Step 1: enter the code ───────────────────────────────────────── */

  /**
   * THE NAME TAPPED OPENS THE CARD IN ONE TRIP, NOT TWO (2026-10-25).
   *
   * The claim's answer already carries the card: `claimPlayerSlot` revalidates
   * `/play`, so the server draws the page for the new session into the same
   * response and the router puts it on screen. The page then reloaded on top of
   * that, and the player waited for the whole page to come down again. Measured
   * on slow 3G (`e2e/round-code-on-3g.spec.ts`): 2.8 s from the tap to a pad
   * that takes a score, of which the reload was the larger part. `PlayScreens`
   * is keyed by what is open, so the card starts from its own props.
   */
  const claimName = (playerId: string, withCode = code) =>
    startTransition(async () => {
      const res = await claimPlayerSlot(withCode, playerId);
      if (!res.ok) setError(res.error ?? "Couldn't start your session.");
    });

  /**
   * ONE CONFIRMATION, ONCE PER PHONE (2026-11-04).
   *
   * A group tapped is said back in full before anything is kept — "You're
   * keeping Group 3: Rakesh & Snehal v Subhas & Prashant · 12:54 off the 10th"
   * — because the cup's wrong card began with one wrong tap and nothing after it
   * said whose match it was. Asked once: the phone remembers the group it
   * confirmed for the round, and the same group tapped again goes straight
   * through. A DIFFERENT group is a different decision and is asked about.
   * Never per hole. Kept on the phone, never on the server: it is this phone's
   * answer, and storage that is blocked simply asks again.
   *
   * `at` is where the phone is when the round has only just been opened (a
   * scanned group, `openCode`): the state this closure was made with is older
   * than the round, so what the round is comes in with the call.
   *
   * AND ACROSS THE TOURNAMENT (2026-11-05): the group kept is also written per
   * EVENT (`thq-play-last:<event>`), with the people in it, so the next round
   * of the same tournament offers it first ("Last time: Group 3 — …") — read
   * back by `rememberedGroup`, which says nothing if that group has changed.
   */
  type At = { code: string; stageId: string; eventId: string; keepsGroups?: boolean };
  const confirmedBefore = (target: PlayTarget, at?: At) => {
    const stageId = at?.stageId ?? context?.stageId ?? "";
    try {
      return !!stageId && window.localStorage.getItem(`thq-play-kept:${stageId}`) === targetKey(target);
    } catch {
      return false;
    }
  };
  const keep = (target: PlayTarget, at?: At) => {
    const stageId = at?.stageId ?? context?.stageId ?? "";
    const eventId = at?.eventId ?? context?.eventId ?? "";
    try {
      if (stageId) window.localStorage.setItem(`thq-play-kept:${stageId}`, targetKey(target));
      if (eventId && target.kind === "group") window.localStorage.setItem(`thq-play-last:${eventId}`, JSON.stringify(rememberGroup(target.group)));
    } catch {
      // Blocked storage: the phone asks again next time, which is safe.
    }
    const withCode = at?.code ?? code;
    if (target.kind === "player") return claimName(target.id, withCode);
    const g = target.group;
    // A match kept by tapping is one card whoever opens it; any of its players
    // opens it — except where one phone keeps the group's card, when the phone
    // says which one it is (`groupNeedsName`), or every phone is side A's player.
    if (!groupNeedsName(g, at?.keepsGroups ?? context?.keepsGroups ?? false)) return claimName(g.players[0]?.id ?? "", withCode);
    setStep({ kind: "pick", group: g });
  };
  const choose = (target: PlayTarget, at?: At) => {
    setError("");
    if (confirmedBefore(target, at)) keep(target, at);
    else setStep({ kind: "confirm", target });
  };
  /**
   * `wantGroup` is the group a scanned sign names (`linkFromHash`): once the round's
   * groups are in, a group that is one of them goes straight to the confirmation —
   * the list is skipped, never the question. A key the round no longer lists (a sign
   * printed before the draw changed) simply leaves the list on screen.
   */
  const openCode = (typed: string, wantGroup?: string | null) => {
    setError("");
    startTransition(async () => {
      const res = await redeemRoundCode(typed);
      if (!res.ok) {
        setError(res.error ?? "That code isn't valid.");
        return;
      }
      const at = { code: typed, stageId: res.stageId ?? "", eventId: res.eventId ?? "", keepsGroups: res.keepsGroups };
      setPlayers(res.players ?? []);
      setGroups(res.groups ?? []);
      // In the same render as the list, so the full list is never drawn for a moment before "Last time".
      setLast(rememberedIn(at.eventId, res.groups ?? []));
      setShowAll(false);
      setContext({ eventName: res.eventName ?? "", roundLabel: res.roundLabel ?? "", stageId: at.stageId, eventId: at.eventId, keepsGroups: res.keepsGroups });
      setStep(null);
      const want = wantGroup ? res.groups?.find((g) => g.key === wantGroup) : undefined;
      if (want) choose({ kind: "group", group: want }, at);
    });
  };

  const backToList = () => {
    setStep(null);
    setError("");
    // "No" to the group offered first means it is not theirs: the whole list.
    setShowAll(true);
    // Drawn by the server with no list behind it: ask for the list again.
    if (!players) openCode(code);
  };

  /**
   * A SCANNED SIGN OPENS ITS ROUND (2026-10-17).
   *
   * The sign's address carries the code after a `#` (`roundCodeLink`), so this
   * runs in the browser only: a link preview or a prefetch never redeems. A
   * code alone goes to the round's groups; a code with a group
   * (`#ABCD-EFGH.t3`, 2026-11-05) goes straight to the confirmation of that
   * group (`openCode`), skipping the list and never the question — so a scan
   * can never pick a group or a player without a yes. The `#` is cleared at
   * once so a reload does not open the round again. Somebody who typed into
   * the box before the page woke keeps what they typed.
   */
  useEffect(() => {
    if (props.stage !== "code") return;
    const fromSign = linkFromHash(window.location.hash);
    if (!fromSign.code) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const box = document.getElementById("play-round-code") as HTMLInputElement | null;
    if (box && box.value.trim()) return;
    setCode(formatAccessCode(fromSign.code));
    openCode(fromSign.code, fromSign.group);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.stage]);

  /**
   * A PRESS MADE BEFORE THE PAGE WAS LIVE, TAKEN UP NOW IT IS (2026-10-25).
   * `HeldBeforeLoad` kept it, and the button has been marked busy since. Once,
   * on arrival: Continue with what is in the box, or the group or name that
   * was tapped — which is then confirmed like any tap (`choose`).
   */
  useEffect(() => {
    if (props.stage !== "code") return;
    const held = takeHeldPress();
    if (!held) return;
    if (held.kind === "code") {
      const typed = String(held.data.get("code") ?? "");
      setCode(typed);
      openCode(typed);
    } else if (held.kind === "group" && held.value) {
      const group = groups.find((g) => g.key === held.value);
      if (group) choose({ kind: "group", group });
    } else if (held.kind === "name" && held.value) {
      const player = players?.find((p) => p.id === held.value);
      if (player) choose({ kind: "player", id: player.id, name: player.name });
    }
    // Once, on arrival: the groups and names are those the page arrived with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.stage]);

  if (props.stage === "code") {
    const submit = () => openCode(code);

    // Filtered, never reordered — see name-filter.ts for why, and for the
    // threshold below.
    const shownPlayers = filterNames(players ?? [], nameFilter);
    // A group stays listed while any name in it matches: the scorer finds
    // their GROUP by a name they know, and still taps the group.
    const shownGroups = nameFilter.trim() ? groups.filter((g) => filterNames(g.players, nameFilter).length > 0) : groups;
    // Anybody the groups leave out (a late entry nobody has put in one) is still reachable, by name.
    const grouped = new Set(groups.flatMap((g) => g.players.map((p) => p.id)));
    const ungrouped = groups.length > 0 ? shownPlayers.filter((p) => !grouped.has(p.id)) : [];
    // The group this phone kept last time in this tournament, still a group of this round, is offered first;
    // the full list sits behind "Not my group" (2026-11-05).
    const lastMode = !!last && groups.length > 0 && !showAll;

    /* ── The one confirmation: what this phone is about to keep ───────── */
    if (step?.kind === "confirm" && context) {
      const target = step.target;
      return (
        <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
          <section aria-label="Check it's yours" style={{ display: "flex", flexDirection: "column", gap: 18, paddingTop: 12 }}>
            <div>
              <div className="page-kicker">{[context.roundLabel, context.eventName].filter(Boolean).join(" · ")}</div>
              <h1 style={{ fontSize: 24, lineHeight: 1.3, margin: "8px 0 0", fontFamily: "var(--font-heading)", overflowWrap: "anywhere" }}>
                {keepingSentence(target)}
              </h1>
              {target.kind === "group" && groupNeedsName(target.group, context.keepsGroups ?? false) && (
                <p className="text-muted" style={{ margin: "8px 0 0", fontSize: 15 }}>
                  {context.keepsGroups
                    ? "This phone keeps the whole group's card. Next you pick your own name."
                    : "Next you pick whose card you’re keeping."}
                </p>
              )}
            </div>
            {error && (
              <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
                <Icon name="warning-circle" /> {error}
              </p>
            )}
            {/* Plain forms, so the same two answers work with no script: yes is
                posted as confirmed (`claimPlayerSlotForm`), no asks for the list
                again (`redeemRoundCodeForm`). With a script, both are taken here.
                `data-plain-post` tells `HeldBeforeLoad` this page works without
                script, so on a walk whose scripts never came it is stopped and
                painted (Safari) rather than left waiting for them. */}
            <form action={postName} data-plain-post="">
              <input type="hidden" name="code" value={code} />
              {target.kind === "group" ? (
                <input type="hidden" name="group" value={target.group.key} />
              ) : (
                <input type="hidden" name="playerId" value={target.id} />
              )}
              <input type="hidden" name="confirmed" value="yes" />
              <button
                type="submit"
                className="btn btn-primary btn-block"
                style={{ minHeight: 52, fontSize: 17 }}
                disabled={pending}
                onClick={(e) => {
                  e.preventDefault();
                  keep(target);
                }}
              >
                {pending ? "Opening…" : keepingYes(target)}
              </button>
            </form>
            <form action={postCode} data-plain-post="">
              <input type="hidden" name="code" value={code} />
              <button
                type="submit"
                className="btn btn-secondary btn-block"
                style={{ minHeight: 48 }}
                disabled={pending}
                onClick={(e) => {
                  e.preventDefault();
                  backToList();
                }}
              >
                No, go back
              </button>
            </form>
          </section>
        </Shell>
      );
    }

    /* ── A group of somebody's own cards: whose card ──────────────────── */
    if (step?.kind === "pick" && context) {
      const group = step.group;
      return (
        <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
          <div style={{ marginBottom: 16 }}>
            <div className="page-kicker">{[group.title, group.tee].filter(Boolean).join(" · ")}</div>
            <h1 style={{ fontSize: 24, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
              {/* One scorer per group: the phone keeps everyone's card, so the name is who holds it. */}
              {context.keepsGroups ? "Which one are you?" : "Whose card are you keeping?"}
            </h1>
          </div>
          {error && (
            <p style={{ fontSize: 13, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}
          <form action={postName} data-plain-post="" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="group" value={group.key} />
            <input type="hidden" name="confirmed" value="yes" />
            {group.players.map((p) => (
              <button
                key={p.id}
                type="submit"
                name="playerId"
                value={p.id}
                className="btn btn-secondary btn-block"
                disabled={pending}
                style={{ minHeight: 52, fontSize: 16, justifyContent: "flex-start", overflowWrap: "anywhere" }}
                onClick={(e) => {
                  e.preventDefault();
                  claimName(p.id);
                }}
              >
                {p.name}
              </button>
            ))}
          </form>
          <form action={postCode} data-plain-post="">
            <input type="hidden" name="code" value={code} />
            <button
              type="submit"
              className="btn"
              style={{ marginTop: 12 }}
              onClick={(e) => {
                e.preventDefault();
                backToList();
              }}
            >
              Back to the groups
            </button>
          </form>
        </Shell>
      );
    }

    if (players && context) {
      return (
        <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
          <div style={{ marginBottom: 16 }}>
            <div className="page-kicker">{context.roundLabel}</div>
            <h1 style={{ fontSize: 24, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
              {context.eventName}
            </h1>
            <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              {groups.length > 0 ? "Tap your group to start scoring." : "Tap the name on the card you're keeping."}
            </p>
          </div>

          {error && (
            <p style={{ fontSize: 13, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}

          {/* A WAY TO FIND YOURSELF, once the list is long enough to need one.
              ──────────────────────────────────────────────────────────────
              This is the screen a player uses standing on the first tee, one
              handed, in daylight, having just been read a code out. The field
              arrives alphabetically and nothing else — on a thirty-three
              player event that is four screens of scrolling to tap your own
              name, and an open day is worse.

              The organizer's score-entry list got a search box at a comparable
              length, and it is used by one person sitting down. This one is
              used by everybody in the field, outdoors.

              SHOWN ONLY WHERE IT HELPS. A society four-ball does not want a
              search box over four names — it would be a control that costs a
              tap and saves nothing. The threshold is about the list, not about
              any particular event.

              It filters and never reorders: a player scanning alphabetically
              for their name must not have it move while they type. */}
          {!lastMode && showsNameFilter(players.length) && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label htmlFor="play-name-filter">{groups.length > 0 ? "Find your group by a name" : "Find the name"}</label>
              <input
                id="play-name-filter"
                className="input"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
                placeholder="Start typing…"
                autoComplete="off"
                // Not `type="search"`: the clear affordance a search input
                // draws is smaller than the touch minimum this screen is held
                // to, and there is a full-width list underneath doing the
                // same job.
                inputMode="text"
              />
            </div>
          )}

          {/* THE ROUND'S GROUPS, not its names (2026-11-04): each match, or each
              group off the tee sheet, as ONE large button — a scorer knows
              their group ("the 12:54 off the 10th") and finds it among five,
              where a name was a small target among twenty, and the cup's wrong
              card began with an opponent's name tapped. The group is then
              confirmed once (`choose`).

              A FORM, so a group tapped before the page's script has arrived
              still goes on: held until the page is live (`HeldBeforeLoad`), or
              with no script a plain post — the tapped button carries the group,
              the hidden box the code (`claimPlayerSlotForm`). */}
          {/* THE GROUP THIS PHONE KEPT LAST TIME, FIRST (2026-11-05): one large button for the group
              it kept earlier in this tournament, if that is still a group of this round, and the
              rest of the list behind "Not my group". Tapping it is still confirmed (`choose`) —
              once per round, like any group. */}
          {lastMode && last && (
            <div data-last-group="" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                type="button"
                className="card elev-sm"
                disabled={pending}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 14px",
                  minHeight: 64,
                  cursor: "pointer",
                  color: "var(--color-text)",
                  font: "inherit",
                  overflowWrap: "anywhere",
                }}
                onClick={() => choose({ kind: "group", group: last })}
              >
                {last.tee && (
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-neutral-400)" }}>{last.tee}</span>
                )}
                <span style={{ display: "block", fontSize: 17, fontWeight: 600, marginTop: last.tee ? 3 : 0, lineHeight: 1.35 }}>
                  {lastTimeSentence(last)}
                </span>
              </button>
              <button type="button" className="btn btn-secondary btn-block" style={{ minHeight: 48 }} disabled={pending} onClick={() => setShowAll(true)}>
                Not my group
              </button>
            </div>
          )}

          {groups.length > 0 && !lastMode ? (
            <form action={postName} data-held-until-live="group" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input type="hidden" name="code" value={code} />
              {shownGroups.length === 0 && (
                <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                  No group has a name like “{nameFilter.trim()}”. Check the spelling, or clear the box to see every group.
                </p>
              )}
              {shownGroups.map((g) => (
                <button
                  key={g.key}
                  type="submit"
                  name="group"
                  value={g.key}
                  className="card elev-sm"
                  disabled={pending}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "12px 14px",
                    minHeight: 64,
                    cursor: "pointer",
                    color: "var(--color-text)",
                    font: "inherit",
                    overflowWrap: "anywhere",
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    dropHeldPress(e.currentTarget.form);
                    choose({ kind: "group", group: g });
                  }}
                >
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--color-neutral-400)" }}>
                    {[g.title, g.tee].filter(Boolean).join(" · ")}
                  </span>{" "}
                  <span style={{ display: "block", fontSize: 17, fontWeight: 600, marginTop: 3, lineHeight: 1.35 }}>{g.names}</span>
                </button>
              ))}
            </form>
          ) : null}

          {/* A FORM, so a name tapped before the page's script has arrived still
              goes on: held until the page is live (`HeldBeforeLoad`), or with
              no script a plain post — the tapped button carries the player, the
              hidden box the code (`claimPlayerSlotForm`). The names are the
              list only where the round has no groups; otherwise only anybody
              the groups leave out. Either way the name is confirmed (`choose`). */}
          {!lastMode && (groups.length === 0 || ungrouped.length > 0) && (
          <form action={postName} data-held-until-live="name" style={{ marginTop: groups.length > 0 ? 14 : 0 }}>
          <input type="hidden" name="code" value={code} />
          {groups.length > 0 && (
            <h2 className="text-muted" style={{ fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>Not in a group</h2>
          )}
          <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
            {groups.length === 0 && shownPlayers.length === 0 && (
              <p className="text-muted" style={{ fontSize: 13, margin: 0, padding: "13px 14px", lineHeight: 1.5 }}>
                No name matches “{nameFilter.trim()}”. Check the spelling, or clear the box to see
                everyone in the round.
              </p>
            )}
            {(groups.length > 0 ? ungrouped : shownPlayers).map((p) => (
              <button
                key={p.id}
                type="submit"
                name="playerId"
                value={p.id}
                disabled={pending}
                onClick={(e) => {
                  e.preventDefault();
                  dropHeldPress(e.currentTarget.form);
                  choose({ kind: "player", id: p.id, name: p.name });
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "13px 14px",
                  fontSize: 15,
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--color-divider)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          </form>
          )}

          {/* Its own plain form too: before the script, the way back to an empty
              box is to open the code page afresh. */}
          <form action="/play" method="get">
          <button
            type="submit"
            className="btn"
            style={{ marginTop: 12 }}
            onClick={(e) => {
              e.preventDefault();
              setPlayers(null);
              setContext(null);
              // An EMPTY box (2026-10-17, the night before the first real cup):
              // it kept the code just used, and a phone puts the cursor at the
              // end, so typing the other nine's code made "RAE948RW-6J9B-QR7Z"
              // and "That code isn't valid" — to a player who typed it right.
              setCode("");
              setError("");
            }}
          >
            Use a different code
          </button>
          </form>
        </Shell>
      );
    }

    return (
      <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
        <div style={{ marginBottom: 16 }}>
          <h1 style={{ fontSize: 24, margin: 0, fontFamily: "var(--font-heading)" }}>Enter your score</h1>
          {/* TRUE FOR BOTH KINDS OF ROUND, because this screen cannot know
              which it is: the code has not been entered yet, so there is no
              event to ask about its shape.

              It read "the round code your organizer gave you — it's on the tee
              sheet". A casual round has no organizer and no tee sheet, and
              since a quick round started issuing codes this is the screen its
              players arrive on — somebody whose mate read them eight letters
              on the first tee, being told to look for a tee sheet that does
              not exist. "Whoever set the round up" covers a club secretary and
              a mate equally, and the tee sheet is kept as the second half,
              where it is an example rather than the instruction. */}
          <MoreInfo short="Type the round code you were given." style={{ marginTop: 6 }}>
            Whoever set the round up will have read it out, or it may be on the tee sheet.
          </MoreInfo>
        </div>

        {/* A FORM THAT TAKES A PRESS THE MOMENT IT IS DRAWN. Before the page's
            script has arrived the press is held and taken up when it has
            (`HeldBeforeLoad`); with no script, it posts the plain way
            (`redeemRoundCodeForm`) and the server draws the names, or says what
            is wrong with the code beside the button; once the page is live the
            press is taken here (`openCode`). So Continue is pressable from the
            first paint, and greyed only by a live page, over an empty box or
            while it checks. */}
        <form
          action={postCode}
          data-held-until-live="code"
          className="card elev-sm"
          style={{ gap: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            dropHeldPress(e.currentTarget);
            submit();
          }}
        >
          <div className="field">
            <label htmlFor="play-round-code">Round code</label>
            <input
              id="play-round-code"
              name="code"
              className="input"
              value={code}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              style={{ fontSize: 20, letterSpacing: "0.12em", textAlign: "center" }}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={live && (pending || code.trim().length === 0)}
          >
            {pending ? "Checking…" : "Continue"}
          </button>
        </form>
      </Shell>
    );
  }

  /* ── A round scored from a card, not against an opponent ──────────── */

  if (props.stage === "card") {
    /**
     * A MEDAL, ON THE SURFACE THAT ONLY KNEW ABOUT MATCHES.
     *
     * Same grid the console's own entry screen uses — `HoleByHoleCard` is
     * presentational and calls back, so this owns the strokes and the save and
     * the two screens cannot come to draw a card differently.
     *
     * The save goes through `savePlayCard`, which writes through the same
     * `writeScorecard` the console does: one set of rules about validation,
     * partial cards, conflicts, certification and freezing a round's
     * handicaps, rather than a second copy on this side.
     */
    const holeCount = props.holes || props.pars?.length || 18;
    const filledHoles = card.filter((h) => typeof h === "number" && h > 0).length;
    const cardComplete = filledHoles === holeCount;
    const pars = props.pars ?? [];
    /**
     * The figures THIS ROUND is won on, computed the way the console does.
     *
     * `computeStrokeCard` with the server-resolved shots, and `cardTotals` to
     * decide which of its numbers to print — one reader for both, so the card
     * on the phone and the card on the desk cannot disagree about the same
     * round. Modified Stableford is scored on the Modified table, which is why
     * the format is passed rather than inferred.
     */
    const totals = computeStrokeCard(card, pars, 0, props.strokeIndex, {
      shotsPerHole: props.shots,
      pointsForHole:
        boardKind(props.roundFormat ?? "") === "modified-stableford"
          ? modifiedStablefordForHole
          : stablefordPointsForHole,
    });
    const shown = cardTotals(props.scoringBasis ?? "gross", props.roundFormat);
    const figure = (t: (typeof shown)[number]): string | number =>
      t === "gross"
        ? totals.gross || "—"
        : t === "net"
          ? totals.net || "—"
          : t === "points"
            ? totals.points
            : toParText(totals.toPar);

    const certifyCard = () => {
      setError("");
      startTransition(async () => {
        // A hole still on its way goes first, as on the signed-in card: the
        // last hole is tapped and the card signed in one breath.
        await cardQueue.landed();
        // Save first: signing a card the server has not seen would certify
        // numbers nobody stored. Same order as the console's own card.
        const sent = card;
        const wrote = await savePlayCard(sent, keeperOpts());
        heardKeeper(wrote);
        if (!wrote.ok) {
          setError(wrote.error ?? "Couldn't save that card.");
          return;
        }
        setSaved(true);
        // Saved beside the queue: tell it what the row now holds, so the marks stay true.
        cardQueue.heard(fitted(wrote.card));
        const res = await certifyPlayCard();
        if (!res.ok) {
          setError(res.error ?? "Couldn't certify that card.");
          return;
        }
        setCertified(true);
      });
    };

    /**
     * TRY AGAIN THROUGH THE QUEUE, not beside it (2026-10-25). It saved by hand
     * and left the queue holding the refusal, so the marks and the card line
     * could disagree with the save that had just worked. Back into the queue,
     * the card is kept on the phone, sent, read back and marked like any tap.
     */
    const saveCard = () => {
      setError("");
      cardQueue.push(card);
    };

    /** One hole of this phone's own card, onto the phone now and to the server a moment later. */
    const setMine = (hole: number, value: number | null) => {
      const next = Array.from({ length: holeCount }, (_, i) => card[i] ?? null);
      next[hole] = value;
      setCard(next);
      setSaved(false);
      cardQueue.push(next);
    };

    /**
     * A GROUPMATE'S CARD, kept by this phone as the group's scorer
     * (2026-11-05): through the round code's own save, carrying the epoch and
     * whose card it is (`savePlayCard`'s `playerId`). Refused in words when
     * the card has moved to another phone, like the scorer's own.
     */
    const savePartnerByCode: PartnerSave = async (_stage, partnerId, strokes) => {
      const res = await savePlayCard(strokes, { ...keeperOpts(), playerId: partnerId });
      heardKeeper(res);
      if (!res.ok) throw new Error(res.error ?? "Couldn't save that card.");
      return { ok: true, revision: "", stored: res.card ?? strokes };
    };
    const keepsTheGroup = role === "keeper" && (props.partners?.length ?? 0) > 0;
    const bar =
      props.group && role ? (
        <KeepingBar
          view={props.group}
          role={role}
          refusedBy={refusedBy}
          boardHref={props.boardHref}
          onKept={(e) => {
            setEpoch(e);
            setRefusedBy(null);
          }}
        />
      ) : null;
    const header = (
      <div style={{ marginBottom: 14 }}>
        <div className="page-kicker">{props.roundLabel} · {props.eventName}</div>
        <h1 style={{ fontSize: 22, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
          {props.playerName}
        </h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
          {/* Says which kind of round this is, because the surface used to
              claim every round was a match. */}
          {following ? "Your group's card, as it is kept." : keepsTheGroup ? "Your group's cards, hole by hole." : "Your own card, hole by hole."}{" "}
          {following
            ? ""
            : props.submitWhole
              ? "Your organizer wants the full round submitted at the end."
              : "Saves as you go."}
        </p>
      </div>
    );
    const signOut = (
      <button
        type="button"
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start", marginTop: 12 }}
        onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
      >
        Sign out
      </button>
    );

    /* ── Another phone keeps the group's card: follow it, read-only ── */
    if (following && props.group) {
      return (
        <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
          {header}
          {bar}
          <FollowRefresh />
          <GroupCardFollow view={props.group} holes={holeCount} firstHole={props.firstHole ?? 1} pars={pars} />
          {/* Each player confirms their OWN card, whoever kept it (Rule 3.3b). */}
          {props.endCheck && <EndCheckPanel check={props.endCheck} />}
          {signOut}
        </Shell>
      );
    }

    return (
      <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
        {header}
        {bar}

        <div className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: "flex", gap: 14, fontSize: 15, flexWrap: "wrap" }}>
            {/* The figure the round is decided on leads, because that is the
                one being read. `cardTotals` puts points first on a Stableford
                for exactly that reason. */}
            {shown.map((t, i) => (
              <span key={t} className={i === 0 ? undefined : "text-muted"}>
                <b>{figure(t)}</b> {TOTAL_LABEL[t].toLowerCase()}
              </span>
            ))}
            {/* Never progress the server refused: under a refusal the holes are on this phone only. */}
            <span className="text-muted" style={{ marginLeft: "auto" }}>
              {filledHoles}/{holeCount} holes{cardQueue.status.tone === "warn" ? " · not saved" : ""}
            </span>
          </div>

          {keepsTheGroup ? (
            <GroupScoring
              stageId={props.stageId ?? "play"}
              holes={holeCount}
              pars={pars}
              yards={props.yards ?? []}
              strokeIndex={props.strokeIndex ?? []}
              me={{ id: props.playerId ?? "me", name: props.playerName ?? "You", shotsOn: (h: number) => props.shots?.[h] ?? 0 }}
              myStrokes={card}
              onSetMine={setMine}
              mySync={cardQueue.holes}
              myRefusal={cardQueue.refusal}
              partners={props.partners ?? []}
              holding={(s) => !!props.submitWhole && s.filter((v) => typeof v === "number" && v > 0).length < holeCount}
              firstHole={props.firstHole ?? 1}
              showVoice={props.voiceEntry ?? true}
              dense
              offerPickUp={isStablefordRound(props.scoringBasis, props.roundFormat) && boardKind(props.roundFormat ?? "") !== "modified-stableford"}
              savePartner={savePartnerByCode}
            />
          ) : (
          <HoleByHoleCard
            /* WITH THE SHOTS (2026-10-04). The totals above came off
               `props.shots` and the hole never showed them, so a partner
               scoring their own net round by its code could not see where
               their strokes fell — two on the 1st, on the host's card, and
               nothing on their own. The same numbers, on the hole. */
            players={[{ id: "me", name: props.playerName ?? "You", shotsOn: (h: number) => props.shots?.[h] ?? 0 }]}
            cards={{ me: card }}
            pars={pars}
            yards={props.yards ?? []}
            strokeIndex={props.strokeIndex ?? []}
            holes={holeCount}
            firstHole={props.firstHole ?? 1}
            // The pad's second row — bogey, the commonest score in the
            // amateur game — on the first screen: mic beside the hole, its
            // notes under the pad (2026-10-07). See `HoleByHoleCard`'s `dense`.
            dense
            onSet={(_id, hole, value) => {
              const next = Array.from({ length: holeCount }, (_, i) => card[i] ?? null);
              next[hole] = value;
              setCard(next);
              setSaved(false);
              // Onto the phone now, to the server a moment later.
              cardQueue.push(next);
            }}
            meId="me"
            showVoice={props.voiceEntry ?? true}
            // Where each hole is — on this phone, sent, or not sent — from the queue itself.
            sync={cardQueue.holes}
            refusal={cardQueue.refusal}
            // STABLEFORD PICK-UP (Rule 21.1b, 2026-10-08) — the round code is
            // how the charity day's Stableford is scored, so a player here may
            // pick up exactly as on their own card: net double bogey, zero
            // points, the card finished. Standard Stableford only.
            {...(isStablefordRound(props.scoringBasis, props.roundFormat) &&
            boardKind(props.roundFormat ?? "") !== "modified-stableford"
              ? {
                  pickedUp: {
                    me: card.map((v, i) => v != null && v === stablefordPickUp(pars[i] ?? 4, props.shots?.[i] ?? 0)),
                  },
                  onPickUp: (_id: string, hole: number, on: boolean) => {
                    const next = Array.from({ length: holeCount }, (_, i) => card[i] ?? null);
                    next[hole] = on ? stablefordPickUp(pars[hole] ?? 4, props.shots?.[hole] ?? 0) : null;
                    setCard(next);
                    setSaved(false);
                    cardQueue.push(next);
                  },
                }
              : {})}
          />
          )}

          {/* Where the card is — the same words the signed-in card uses, and the
              same words as the marks on each hole above. */}
          <p role="status" style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            {cardQueue.status.tone === "idle"
              ? filledHoles > 0
                ? `${cardQueue.status.label} — ${filledHoles} of ${holeCount} holes in`
                : ""
              : cardQueue.status.label}
          </p>
          {/* Only when the server said no: a way to try again by hand. */}
          {cardQueue.status.tone === "warn" && (
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={saveCard}>
              Try saving again
            </button>
          )}

          {/* SIGNING IT — Rule 3.3b, and the half this surface did not have.
              Without it every card a field submitted with a Round Code
              arrived at the committee reading "Not certified yet" and landed
              in "needs attention", where the only control is "Approve
              anyway": the same screen citing the rule above the button that
              overrides it. Measured on 2026-09-10.

              A separate, deliberate act, exactly as it is on the signed-in
              card. Saving is bookkeeping; certifying is a statement that
              these hole scores are right.

              It APPEARS with the last hole, as on `/me/card` (2026-10-05): the
              "n/18 holes" figure above says how far there is to go, and a
              greyed button under the pad for the whole round said nothing it
              did not. Never on an unfinished card — certifying one would claim
              holes nobody played were right. */}
          {/* A casual card is done when its holes are — no signature. */}
          {props.signs === false && cardComplete && (
            <p style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              <Icon name="check" /> Every hole in — that&rsquo;s your card. Change a score any time if
              it&rsquo;s wrong.
            </p>
          )}
          {props.signs !== false && (cardComplete || certified) && (
          <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || !cardComplete || certified}
            onClick={certifyCard}
            style={{ minHeight: 52 }}
          >
            <Icon name="check" /> {certified ? "Certified" : "Certify my card"}
          </button>
          {/* WHAT HAPPENS NEXT, and it is not the same in the two kinds of
              round. "The committee accepts it after that" is true under staff
              approval and false under player confirmation — where the card is
              final the moment it is signed and nobody is going to look at it.

              `createMatch` sets a casual round to player confirmation and says
              why in its own words: "there is no committee to approve a card
              that both players just agreed on standing on the 18th green".
              The screen was telling those two the opposite, and it started
              being read by them the moment a quick round began issuing Round
              Codes. */}
          <p className="text-muted" style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
            {certifyPrompt(cardComplete, holeCount, !!props.staffApproves)}
          </p>
          </>
          )}
          {/* Brought into view: Certify is the last thing on the card, often at the very foot of a
              phone's screen, and a refusal drawn under it was below the fold (Firefox, 2026-10-21). */}
          {error && (
            <p role="alert" ref={bringIntoView} style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}
        </div>

        {signOut}
      </Shell>
    );
  }

  /* ── Signed in with a code, on a tournament whose cards the club keeps ── */

  if (props.stage === "staff-kept") {
    const organizer = props.organizer ?? "organizer";
    return (
      <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
        <div className="card elev-sm">
          <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>{props.playerName}</h1>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {props.eventName}
            {props.roundLabel ? ` · ${props.roundLabel}` : ""}
          </span>
          <span className="card-title" style={{ marginTop: 12 }}>Your club is keeping the cards</span>
          <p className="text-muted" style={{ fontSize: 14, lineHeight: 1.55, margin: "8px 0 0" }}>
            {props.staffKeptRound
              ? `The ${organizer} enters this round's scores from paper cards, so there is nothing to enter on this phone. `
              : `Scores for this tournament are entered by the ${organizer}, so there is nothing to enter on this phone. `}
            {props.boardHref
              ? "Follow the round on the board: the scores appear there as they go in."
              : `The scores go on the board as they are entered. Ask your ${organizer} for its link.`}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {props.boardHref && (
              <a href={props.boardHref} className="btn btn-primary" style={{ minHeight: 44 }}>
                <Icon name="ranking" /> See the board
              </a>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ minHeight: 44 }}
              disabled={pending}
              onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
            >
              Enter a different code
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ── Signed in with a code, but not playing this round ────────────── */

  if (props.stage === "no-match") {
    return (
      <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
        <div className="card elev-sm">
          {props.sideRound ? (
            <>
              {/* A side's round — see `sideRound`. Not "no match for you". */}
              <span className="card-title">This round is kept on one phone</span>
              <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
                {props.playerName}, {props.sideRound} is scored side by side on one card, so whoever set the
                round up keeps it for everyone. There&rsquo;s nothing to enter here — the scores are on their phone.
              </p>
            </>
          ) : (
            <>
              <span className="card-title">No match for you in {props.roundLabel}</span>
              <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
                {props.playerName}, you don&rsquo;t have a match scheduled in this round of {props.eventName}.
                If you were given a code for a different round, enter that one instead — otherwise check with
                your organizer.
              </p>
            </>
          )}
          {/* A WAY FORWARD. This screen offered only "Sign out", which for a
              code holder is the same act but reads as the end of the road. The
              commonest cause is simply the wrong round's code. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
            >
              Enter a different code
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  /* ── Step 2: the card ─────────────────────────────────────────────── */

  // A cup's second nine is another round with its own code, and the way
  // to it was a "Sign out" at the foot of the page.
  const next = (
    <button
      type="button"
      className="btn btn-secondary"
      style={{ minHeight: 44 }}
      disabled={pending}
      onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
    >
      Enter another round code
    </button>
  );
  const footer = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
      {/* Never "playing as" whoever's name opened a tapped match: that card
          is the match, the same for both sides (`matchCardFor`). A stroke
          card is one player's, and says whose. */}
      <span className="text-muted" style={{ fontSize: 13 }}>
        {following
          ? "Following this match"
          : props.strokeCard
            ? `Keeping ${props.playerName}'s card`
            : "Keeping this match for both sides"}
      </span>
      <button
        type="button"
        className="btn"
        style={{ marginLeft: "auto", fontSize: 13, padding: "4px 10px" }}
        onClick={() => startTransition(async () => { await leavePlay(); window.location.reload(); })}
      >
        Sign out
      </button>
    </div>
  );
  const otherMatches = props.otherMatches?.map((o) => ({ href: `/play?m=${encodeURIComponent(o.id)}`, label: o.label }));

  /**
   * THE MATCH, ON A ROUND KEPT BY ONE SCORER PER GROUP (2026-11-05, phase 2):
   * the line above says who keeps it; the keeper's saves carry the epoch and
   * a refusal because the card moved flips this phone to following; a phone
   * that follows sees the match read-only; and every phone sees the end-of-
   * round check once the match is decided.
   */
  const matchBar =
    props.group && role ? (
      <KeepingBar
        view={props.group}
        role={role}
        refusedBy={refusedBy}
        boardHref={props.boardHref}
        onKept={(e) => {
          setEpoch(e);
          setRefusedBy(null);
        }}
      />
    ) : null;
  const matchCheck = props.endCheck ? <EndCheckPanel check={props.endCheck} /> : null;
  const keptHoles = async (matchId: string, holes: Array<"A" | "B" | "H" | null>) => {
    const res = await savePlayMatchHoles(matchId, holes, keeperOpts());
    heardKeeper(res);
    return res;
  };
  const keptResult = async (matchId: string, winner: "A" | "B" | "H", margin: string) => {
    const res = await savePlayMatchResult(matchId, winner, margin, keeperOpts());
    heardKeeper(res);
    return res;
  };
  const keptCard = async (matchId: string, strokes: (number | null)[]) => {
    const res = await savePlayMatchCard(matchId, strokes, keeperOpts());
    heardKeeper(res);
    return res;
  };

  if (following && props.match) {
    return (
      <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
        <div style={{ marginBottom: 14 }}>
          <div className="page-kicker">{props.roundLabel} · {props.eventName}</div>
        </div>
        {matchBar}
        <FollowRefresh />
        <MatchFollow match={props.match} holes={props.holes || props.match.holes.length || 18} firstHole={props.firstHole ?? 1} />
        {matchCheck}
        {footer}
      </Shell>
    );
  }

  // A round the organizer keeps on stroke cards (`matchKeptBy`): the holder's
  // own ball, and the app works the match out. Never both cards on one round.
  /**
   * THE SCORER KEEPS EVERY BALL (2026-11-05): one card a ball, picked by name.
   * Every card stays mounted — hidden when not picked — so each keeps its own
   * queue running (`usePendingCard`), and a hole tapped just before switching
   * is still sent. Each save names its ball and carries the epoch.
   */
  const balls = role === "keeper" && props.strokeBalls && props.strokeBalls.length > 1 ? props.strokeBalls : null;
  if (props.strokeCard && balls) {
    const shown = balls.some((b) => b.id === ball) ? ball : balls[0].id;
    return (
      <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
        {matchBar}
        <div role="group" aria-label="Whose card" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {balls.map((b) => (
            <button
              key={b.id}
              type="button"
              className={b.id === shown ? "btn btn-primary" : "btn btn-secondary"}
              aria-pressed={b.id === shown}
              style={{ minHeight: 44 }}
              onClick={() => setBall(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
        {balls.map((b) => (
          // A region named for the ball; the others hidden AND inert — out of
          // the accessibility tree and out of reach of a tap or a label — yet
          // mounted, so each ball's offline queue keeps running.
          <section
            key={b.id}
            aria-label={`${b.name}'s card`}
            hidden={b.id !== shown}
            inert={b.id !== shown}
            data-ball={b.id}
          >
            <MatchStrokeKeeper
              match={props.match!}
              card={b.card}
              holes={props.holes ?? 18}
              pars={props.pars ?? []}
              yards={props.yards ?? []}
              strokeIndex={props.strokeIndex ?? []}
              firstHole={props.firstHole ?? 1}
              voiceEntry={props.voiceEntry}
              submitWhole={props.submitWhole}
              stageId={props.stageId ?? "play"}
              holderId={b.id}
              holderName={b.name}
              roundLabel={props.roundLabel}
              eventName={props.eventName}
              otherMatches={otherMatches}
              save={async (matchId, strokes) => {
                const res = await savePlayMatchCard(matchId, strokes, { ...keeperOpts(), playerId: b.id });
                heardKeeper(res);
                return res;
              }}
              next={next}
              footer={footer}
            />
          </section>
        ))}
        {matchCheck}
      </Shell>
    );
  }

  if (props.strokeCard) {
    return (
      <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
        {matchBar}
        <MatchStrokeKeeper
          match={props.match!}
          card={props.strokeCard}
          holes={props.holes ?? 18}
          pars={props.pars ?? []}
          yards={props.yards ?? []}
          strokeIndex={props.strokeIndex ?? []}
          firstHole={props.firstHole ?? 1}
          voiceEntry={props.voiceEntry}
          submitWhole={props.submitWhole}
          stageId={props.stageId ?? "play"}
          holderId={props.playerId ?? "code"}
          holderName={props.playerName ?? "You"}
          roundLabel={props.roundLabel}
          eventName={props.eventName}
          otherMatches={otherMatches}
          save={keptCard}
          next={next}
          footer={footer}
        />
        {matchCheck}
      </Shell>
    );
  }

  // The one match card, shared with the player app — see `MatchKeeper`.
  return (
    <Shell brand={props.brand} notice={props.expiryNotice} short={props.expiryShort} boardHref={props.boardHref}>
      {matchBar}
      <MatchKeeper
        match={props.match!}
        holes={props.holes}
        pars={props.pars}
        yards={props.yards}
        strokeIndex={props.strokeIndex}
        cardStrokeIndex={props.cardStrokeIndex}
        firstHole={props.firstHole}
        voiceEntry={props.voiceEntry}
        matchShots={props.matchShots}
        submitWhole={props.submitWhole}
        stageId={props.stageId}
        roundLabel={props.roundLabel}
        eventName={props.eventName}
        otherMatches={otherMatches}
        saveHoles={keptHoles}
        saveResult={keptResult}
        next={next}
        footer={footer}
      />
      {matchCheck}
    </Shell>
  );
}
