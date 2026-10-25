/**
 * A card that has not reached the server yet.
 *
 * The scoring screen writes the whole card on a 600ms debounce and, until now,
 * kept it nowhere else. A failed write set a flag and left the strokes in React
 * state — so a scorer behind the 12th with no signal, who then locked their
 * phone or let the tab be evicted, lost the holes they had entered. Not
 * delayed: LOST, with a card that still looked filled in until it reloaded.
 *
 * That is the most damaging failure this app can have. A wrong number can be
 * corrected by anybody who was there; a hole nobody recorded is gone, and the
 * player finds out at the scorer's table.
 *
 * So the rule is: **the local copy is written before the network is tried, and
 * cleared only when the server has confirmed.** Everything here decides what to
 * do with that copy and what to tell the person holding the phone.
 *
 * WHAT THIS IS NOT. It is not a sync engine and does not merge anything. The
 * card is written whole, so a queued card replaces what the server holds — see
 * `staleAgainst` below, which is about noticing that rather than resolving it.
 * Merging needs the server to say what it had, and that is a later change.
 */

/** How long a queued card may sit before the wording stops being reassuring. */
export const NAG_AFTER_MS = 120_000;

/** Between retries. Long enough not to burn battery hunting for a signal. */
export const RETRY_EVERY_MS = 15_000;

/**
 * How long one send may be out before another may be started beside it.
 *
 * One card goes at a time (`usePendingCard`), because a second sent beside the
 * first carries a revision the first is about to make stale. But a request can
 * hang — a phone that walked out of coverage mid-send hears nothing for as long
 * as the network stack cares to wait — and "one at a time" must not become
 * "none, until that one gives up". Past this, the one that is out is treated
 * as lost and the newest card may go. Far longer than any save that is merely
 * slow, so two are never out together on a connection that is working.
 */
export const SEND_PATIENCE_MS = 20_000;

/** Whether a send may start now, given whether one is out and for how long. */
export function mayStartSend(input: { out: boolean; outForMs: number }): boolean {
  return !input.out || input.outForMs >= SEND_PATIENCE_MS;
}

/**
 * What one attempt to send actually did.
 *
 * There are THREE outcomes, and the type exists because the code was written as
 * if there were two. A send could resolve (taken) or throw (retry) — so a
 * conflict, where the server answers and deliberately does not take the card,
 * had nowhere to go. It resolved, which the caller read as success: the device
 * copy was deleted and the queue cleared while the chooser was still on screen,
 * leaving the scorer's holes in React state and nowhere else.
 *
 * `held` is that third outcome. The server was reached and said no for a reason
 * a person has to settle, so the copy stays on the phone and retrying is
 * pointless until somebody decides.
 */
export type SendOutcome<T = unknown> =
  | "sent"
  | "held"
  | {
      serverHolds: T;
      /**
       * The server's card replaces the phone's and the queue is done — a
       * partner's own entry winning over their marker's (`GroupScoring`). The
       * caller has put that card on screen; without this, a read-back that
       * differs from what was sent is a send that did not land.
       */
      theirsWins?: boolean;
    };

/**
 * THE CARD THE SERVER SAYS IT HOLDS, READ BACK FROM THE ROW IT WROTE.
 *
 * A send that resolves is not, on its own, proof of anything about any hole.
 * The server may have fitted the card to the round, or a second writer may
 * have landed between the read and the write. So a send that can, answers
 * with what the database row holds after the write (`writeScorecard`'s
 * `stored`), and a hole is "Sent" only where THAT says what the phone says.
 * A plain "sent" is the older answer, from a save that cannot read back yet:
 * the server took the card as it was sent.
 */
export function serverHoldsAfter<T>(outcome: SendOutcome<T>, sent: T): T | null {
  if (outcome === "held") return null;
  if (outcome === "sent") return sent;
  return outcome.serverHolds;
}

/**
 * WHERE EACH HOLE'S SCORE IS — the honest card (2026-10-25).
 *
 *   none     nothing on this hole, here or there
 *   phone    "On your phone": kept on this device, the server does not have it yet
 *   sent     "Sent": the server said, after writing, that it holds exactly this
 *   refused  "Not sent": the server answered and would not take the card
 *
 * Worked out from the SENDER'S OWN STATE and nothing else: what the queue is
 * holding to send (the newest card pushed) against what the last answered send
 * read back. So the screen cannot say "Sent" for a hole the queue still holds —
 * the two are one comparison, not two opinions. A hole cleared on the phone and
 * not yet cleared on the server is "phone" too: the server still has the old
 * score, and that is the honest thing to say about it.
 */
export type HoleSync = "none" | "phone" | "sent" | "refused";

/** What a golfer reads beside a hole. Three words, no jargon. */
export const HOLE_SYNC_WORDS: Record<Exclude<HoleSync, "none">, string> = {
  phone: "On your phone",
  sent: "Sent",
  refused: "Not sent",
};

export function holeSyncs(input: {
  /** The card the queue holds — what it will send next. */
  onPhone: readonly unknown[];
  /** What the last answered send read back, or what the page was drawn from. Null for no card. */
  onServer: readonly unknown[] | null;
  /** The last attempt was answered with a refusal. */
  refused: boolean;
  holes: number;
}): HoleSync[] {
  return Array.from({ length: input.holes }, (_, i) => {
    const here = input.onPhone[i] ?? null;
    const there = input.onServer?.[i] ?? null;
    if (here === there) return here === null ? "none" : "sent";
    return input.refused ? "refused" : "phone";
  });
}

/**
 * One hole for several cards — the group's hole on a phone keeping the
 * foursome. The worst of them, because "Sent" for the hole must be true of
 * every card on it: a refusal outranks a hole still on the phone, which
 * outranks a hole that is sent.
 */
export function combineHoleSyncs(cards: ReadonlyArray<readonly HoleSync[]>, holes: number): HoleSync[] {
  const rank: Record<HoleSync, number> = { none: 0, sent: 1, phone: 2, refused: 3 };
  return Array.from({ length: holes }, (_, i) =>
    cards.reduce<HoleSync>((worst, c) => {
      const s = c[i] ?? "none";
      return rank[s] > rank[worst] ? s : worst;
    }, "none"),
  );
}

/** How many holes are on the phone and not on the server. */
export function unsentHoles(holes: readonly HoleSync[]): number {
  return holes.filter((h) => h === "phone" || h === "refused").length;
}

/**
 * WHEN A CARD THAT CANNOT BE SENT SAYS SO — a few holes, not a few seconds.
 *
 * Measured with a golf professional's eye rather than a network engineer's.
 * A course has dead spots, and a hole or two in one is the ordinary day: the
 * scores go when the player walks back into coverage on the next tee, and a
 * warning there is a warning about nothing, which teaches people to ignore
 * the one that matters. Three holes unsent is a player who has walked a
 * stretch of the course with nothing reaching the clubhouse, and is when a
 * marker would want to know before they reach the 18th.
 *
 * But three holes typed in one breath — a player catching up on the next tee
 * — are three holes unsent for the two seconds a save takes, and "nothing has
 * reached the club for a while" would be false. So the three holes must also
 * have been waiting longer than any save that is merely slow (`NAG_AFTER_MS`,
 * the point this file already stops being reassuring). And for a player who
 * stopped entering, half an hour — about two holes' play — with the oldest
 * change still on the phone, however few holes it is.
 */
export const LONG_WAIT_HOLES = 3;
export const LONG_WAIT_MS = 30 * 60_000;

export function isLongWait(unsent: number, waitingMs: number): boolean {
  return (unsent >= LONG_WAIT_HOLES && waitingMs >= NAG_AFTER_MS) || (unsent > 0 && waitingMs >= LONG_WAIT_MS);
}

/**
 * The server's own sentence, when it gave one worth reading.
 *
 * A server action's thrown message does not survive a production build — the
 * framework puts its own "An error occurred in the Server Components render"
 * in its place. That is not a reason a golfer can act on, so it is dropped
 * and the screen says what to do in its own words. A network failure has no
 * sentence at all.
 */
export function refusalWords(message: string): string {
  const m = message.trim();
  if (!m) return "";
  if (/Server Components render|omitted in production|Failed to fetch|NetworkError|Load failed/i.test(m)) return "";
  return m;
}

export interface PendingState {
  /** Holes typed and not yet confirmed by the server. */
  queued: boolean;
  /** A request is in flight right now. */
  sending: boolean;
  /** The browser's view of connectivity. */
  online: boolean;
  /** How long the oldest unsent change has been waiting, in ms. */
  waitingMs: number;
  /** The last attempt came back with an error the server chose to send. */
  refused: boolean;
  /**
   * The server answered and did not take the card — a conflict awaiting a
   * person. Distinct from `refused`, which is the server saying no for a reason
   * nobody can act on here (a locked card, a closed round).
   */
  held: boolean;
  /**
   * The card is being kept on the phone ON PURPOSE, because this tournament
   * takes whole cards and this one is not finished.
   *
   * Distinct from every other state here, and the distinction is the point.
   * `queued` normally means "on its way"; under `scoreEntryWindow: "after"` a
   * part-filled card is not on its way to anywhere and no amount of waiting or
   * signal will change that. The screen used to describe it as a failure —
   * "This card wouldn't save. Show it to the committee before you sign." — from
   * the first hole of the round, because the server's refusal is not a network
   * error and nothing told the screen to expect it.
   */
  holding: boolean;
  /**
   * How many holes are on the phone and not on the server (`unsentHoles`).
   * Optional so a caller that cannot count holes keeps the time-only rules.
   */
  unsent?: number;
  /** The server's own words for a refusal (`refusalWords`), or "". */
  refusal?: string;
  /**
   * The phone would not keep the card — private browsing, or a full store — so
   * the holes waiting are in this tab's memory and nowhere else.
   */
  unkept?: boolean;
}

export type SyncTone = "idle" | "working" | "queued" | "warn";

export interface SyncStatus {
  tone: SyncTone;
  label: string;
  /**
   * Whether it is safe to walk away. The single most important thing on the
   * screen: a scorer needs to know whether their holes are somewhere other
   * than this phone before they put it in a pocket.
   */
  safeToLeave: boolean;
}

export function syncStatus(s: PendingState): SyncStatus {
  if (s.held) {
    /**
     * Checked FIRST, and it must never read as saved.
     *
     * This state used to be indistinguishable from a clean save: the status
     * line said "Saved", tone idle, while the card sat unsent and the device
     * copy had already been deleted. A scorer reading that puts the phone in
     * their pocket, which is the one thing that loses the holes for good.
     */
    return {
      tone: "warn",
      label: "This card also changed elsewhere — choose which to keep. Your holes are still on this phone.",
      safeToLeave: false,
    };
  }

  if (s.refused) {
    // The server understood and said no — a locked card, a closed round.
    // Retrying cannot fix it, so the wording must not promise that it will.
    // Its own sentence when it gave one: "the committee has closed this
    // round" is something a player can act on; "wouldn't save" is not.
    const why = s.refusal?.trim() ?? "";
    return {
      tone: "warn",
      // Short sentences: this is read on a tee (`e2e/player-words.spec.ts`).
      label: why
        ? `Not sent: ${/[.!?]$/.test(why) ? why : `${why}.`} Your holes are kept on this phone. Show this card to the committee.`
        : "Not sent. This card wouldn't save. Your holes are kept on this phone. Show it to the committee before you sign.",
      safeToLeave: false,
    };
  }

  if (!s.queued) {
    // "Sent", the hole's own word for the same fact (`HOLE_SYNC_WORDS`): the
    // card line and the marks on the strip must not use two words for one state.
    return { tone: "idle", label: HOLE_SYNC_WORDS.sent, safeToLeave: true };
  }

  if (s.unkept) {
    // Every other branch below says, or implies, the holes are on the phone.
    // Here they are not: closing the tab would lose them.
    return {
      tone: "warn",
      label: "This phone won’t keep your holes. Private browsing, or is it full? Leave this screen open until they say “Sent”.",
      safeToLeave: false,
    };
  }

  if (s.holding) {
    /**
     * Kept back deliberately, and SAFE TO LEAVE.
     *
     * That last part is the whole reason this branch exists rather than
     * falling through to "Saving…". The holes are on the phone — `push` writes
     * the device copy before anything else, whether or not a request follows —
     * so a player who pockets the phone on the 9th loses nothing. Reporting
     * `safeToLeave: false` for a state that will not resolve until they have
     * played nine more holes would make the one line this screen has for
     * "are my holes safe" permanently false, which is how a warning stops
     * being read.
     *
     * Placed after `held` and `refused` so a real conflict or a real server
     * refusal still wins: those need a person, and this does not.
     */
    return {
      tone: "queued",
      label: "Saved on this phone. This tournament takes the whole card, so it goes in when you finish.",
      safeToLeave: true,
    };
  }

  const unsent = s.unsent ?? 0;
  if (isLongWait(unsent, s.waitingMs)) {
    /**
     * A LONG OUTAGE IS SAID, not left to a spinner or a calm "no signal" that
     * has been on screen since the 4th. Still kept — `push` wrote every one of
     * these to the phone — and still on its way by itself, so it is safe to
     * play on; what the player needs is the one thing to do if it never goes.
     * Before the in-flight branch, so a slow send that is out at the moment
     * does not hide it behind "Saving…".
     */
    const n = unsent > 0 ? `${unsent} hole${unsent === 1 ? " is" : "s are"}` : "Your holes are";
    return {
      tone: "warn",
      label: `${n} only on this phone. Nothing has reached the club for a while. They send by themselves when there’s signal. Still “${HOLE_SYNC_WORDS.phone}” when you finish? Show this card to the committee.`,
      safeToLeave: true,
    };
  }

  if (s.sending) {
    return { tone: "working", label: "Saving…", safeToLeave: false };
  }

  if (!s.online) {
    /**
     * The case this whole file exists for, and the wording matters.
     *
     * "Failed" would be a lie — nothing has failed, and the holes are on the
     * phone. But "saved" would be a worse lie. What a scorer needs is that
     * their entry is kept and will go when the signal comes back, so they can
     * carry on scoring rather than standing still waving the phone about.
     */
    return {
      tone: "queued",
      label: "No signal — your holes are saved on this phone and will send when it returns.",
      safeToLeave: true,
    };
  }

  if (s.waitingMs >= NAG_AFTER_MS) {
    // Online, not sending, and still waiting. Something is wrong that is not
    // the golf course, and saying so is better than a spinner forever.
    return {
      tone: "warn",
      label: "Still trying to send your holes. They are kept on this phone.",
      safeToLeave: true,
    };
  }

  return { tone: "working", label: "Saving…", safeToLeave: false };
}

/** Should another attempt be made right now? */
export function shouldRetry(s: {
  queued: boolean;
  sending: boolean;
  online: boolean;
  sinceLastAttemptMs: number;
  /** A conflict is waiting on a person; replaying it just conflicts again. */
  held?: boolean;
  /**
   * The card is whole-card-only and not whole yet. Retrying cannot help — the
   * server will refuse every one — and the timer would fire every fifteen
   * seconds for the length of a round.
   */
  holding?: boolean;
}): boolean {
  if (s.held) return false;
  if (s.holding) return false;
  if (!s.queued || s.sending) return false;
  // Offline attempts fail instantly and cost battery for nothing. The `online`
  // event is what wakes this up, not a timer grinding away in a pocket.
  if (!s.online) return false;
  return s.sinceLastAttemptMs >= RETRY_EVERY_MS;
}

/**
 * Is the screen's clock worth running at all?
 *
 * The hook polls on a timer to do two things, and in most states NEITHER
 * applies:
 *
 *   - retry a send — `shouldRetry` returns false on its first three lines for
 *     `held`, `holding` and `!queued`;
 *   - re-render so the label ages — and `syncStatus` reads the clock in
 *     exactly ONE branch, `waitingMs >= NAG_AFTER_MS`, which is reached only
 *     while the card is queued and not held. Every other label it returns is a
 *     pure function of booleans, so a tick produces the identical string.
 *
 * It ran every five seconds regardless, for the life of the page, and the two
 * states it is worst in are the two that last longest:
 *
 *   - A WHOLE-CARD round holds the card on purpose until the eighteenth hole.
 *     `shouldRetry`'s note on `holding` already says the timer must not "fire
 *     every fifteen seconds for the length of a round" — that was fixed for
 *     the retry and left in place for the re-render, which is the expensive
 *     half on a phone in a pocket.
 *   - A CONFLICT is waiting on a PERSON. The chooser is on screen asking which
 *     card to keep, and the subtree holding it re-rendered under their finger
 *     every five seconds.
 *
 * Deliberately NOT a function of `online` or `sending`, though both make the
 * next tick a no-op. Those flip in the ordinary course of sending and would
 * have the timer stopping and starting for a second at a time; these three are
 * the states a card SITS in.
 */
export function shouldPoll(s: { queued: boolean; held?: boolean; holding?: boolean }): boolean {
  if (s.held) return false;
  if (s.holding) return false;
  return s.queued;
}

/**
 * A card's revision — derived from its CONTENT, not from a clock.
 *
 * The obvious choice is a timestamp, and `Scorecard` does not carry one, which
 * turns out to be the better outcome. A content revision answers the question
 * actually being asked: has this card's numbers changed since I read them.
 *
 * Two consequences that a timestamp gets wrong:
 *
 *   - saving the SAME strokes twice is not a conflict. A retry that already
 *     succeeded, or two people typing the same number, produces no argument to
 *     put in front of anybody;
 *   - a write that changed nothing does not invalidate everybody else's copy.
 *
 * Not cryptographic and does not need to be. It compares two values this app
 * produced a moment apart; there is no adversary, and a hole that could not be
 * distinguished from another would have to differ by a multiple of 2^32.
 */
export function cardRevision(strokes: Array<number | null>): string {
  let h = 2166136261;
  const s = JSON.stringify(strokes ?? []);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    // FNV-1a, written as shifts because Math.imul on the prime is the same
    // thing spelled less obviously.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return `r${h.toString(36)}`;
}

/**
 * What a screen reports when it loaded and there was NO card on the server.
 *
 * "There was no card when I read this" and "I have the card in front of me,
 * write unconditionally" are opposite situations, and both used to arrive at
 * `saveScorecard` as the empty string — one because the page did
 * `card?.revision ?? ""`, the other because the console omits the argument.
 * The staleness check is skipped for a falsy revision, so the offline player
 * got the console's unconditional write.
 *
 * What that costs: a player opens their card before any row exists, loses
 * signal, enters nine holes. A staff member enters their full eighteen on the
 * console. The queue drains, and the phone's nine replace all of it with no
 * conflict raised and "Saved" on screen.
 *
 * Derived rather than a magic string, and deliberately the revision of an
 * EMPTY array: every real card is hashed at the round's length, 9 or 18, so
 * this cannot collide with one. Any card at all on the server differs from it,
 * which is exactly the comparison wanted.
 */
export const NO_CARD_REVISION = cardRevision([]);

/**
 * Whether a card this phone is keeping FOR SOMEBODY ELSE has changed since the
 * phone last knew it — the only thing that makes it worth sending.
 *
 * `lastKnown` is the revision of the card as this phone loaded it, or last
 * sent it: what it HELD, at the round's length. It is deliberately not the
 * revision the server gave. That one belongs to the conflict protocol, and for
 * a partner with no card it is `NO_CARD_REVISION` — which matches no card of
 * any length, so the eighteen blanks the phone holds for them always looked
 * "changed". Opening the Group view sent a blank card for every partner who
 * had not started (2026-10-11; found by the control crawl as a member).
 */
export function keptCardChanged(strokes: Array<number | null> | undefined, lastKnown: string): boolean {
  return !!strokes && cardRevision(strokes) !== lastKnown;
}

/**
 * Whether a queued card is about to overwrite somebody else's work.
 *
 * A card is written WHOLE, so replaying one that was typed twenty minutes ago
 * replaces whatever the server holds now — including a correction an organizer
 * made in the meantime. This does not resolve that; it detects it, so the
 * screen can ask a human instead of silently picking a winner.
 *
 * Compares the server's revision as it was when this card was last read
 * against what it is now. Equal means nobody else has touched it and the
 * replay is safe.
 */
export function staleAgainst(readAt: string, serverNow: string): boolean {
  if (!readAt || !serverNow) return false;
  return readAt !== serverNow;
}

/** Where one card's pending copy lives. One key per card, never per player. */
export function pendingKey(stageId: string, playerId: string): string {
  // Both ids, because a player has a card per ROUND and a phone may hold
  // several. Keying on the player alone would make Saturday's card overwrite
  // Sunday's the moment both were unsent.
  return `tourneyhq:pending-card:${stageId}:${playerId}`;
}
