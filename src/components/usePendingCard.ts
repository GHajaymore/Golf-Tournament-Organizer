"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  holeSyncs,
  mayStartSend,
  pendingKey,
  refusalWords,
  RETRY_EVERY_MS,
  serverHoldsAfter,
  shouldPoll,
  shouldRetry,
  syncStatus,
  unsentHoles,
  type HoleSync,
  type SyncStatus,
  type SendOutcome,
} from "@/lib/domain/pending-card";

/**
 * Keeps a card on the phone until the server has it.
 *
 * The scoring screen wrote on a debounce and kept the strokes nowhere but
 * React state. A scorer behind the 12th with no signal, who then locked their
 * phone or let the tab be evicted, LOST the holes they had entered — and the
 * screen went on showing them until it reloaded.
 *
 * The order here is the whole point: **write to the device, then try the
 * network.** Not the other way round, and not only on failure. A save that is
 * attempted first and stored second has a window — small, but exactly the size
 * of a tunnel between two holes — in which the only copy is in memory.
 *
 * `localStorage` rather than IndexedDB deliberately. One card is a handful of
 * numbers, it must survive a tab eviction rather than a reinstall, and a
 * synchronous write is what lets it happen before the request rather than
 * after an await.
 */

export interface PendingCard<T> {
  /** What to show, from domain/pending-card. */
  status: SyncStatus;
  /**
   * WHERE EACH HOLE IS — "On your phone", "Sent", "Not sent" (`holeSyncs`).
   *
   * From the same two values the sender works from and nothing else: the card
   * it holds to send, and what the last answered send read back from the
   * server. So a hole cannot read "Sent" while the queue still holds it.
   */
  holes: HoleSync[];
  /** The server's own words for the last refusal, or "" (`refusalWords`). */
  refusal: string;
  /** Record a change: kept on the device immediately, sent shortly after. */
  push: (value: T) => void;
  /** Anything recovered from a previous visit, or null. */
  recovered: T | null;
  /** Forget the recovered copy — the caller has taken it or rejected it. */
  clearRecovered: () => void;
  /**
   * Nothing is outstanding: the server's copy is the one being edited.
   *
   * For the end of a conflict where the scorer chose the server's card. There
   * is nothing left to send, so the queue has to be emptied — otherwise the
   * status line goes on warning about a card that was settled minutes ago, and
   * a warning that is always there is one nobody reads.
   */
  settle: (serverHolds: T) => void;
  /**
   * What the server holds, heard from somewhere other than the queue's own
   * send — the card a conflict came back with, or one a caller saved itself
   * (signing). Required knowledge for "Sent" to stay true.
   */
  heard: (serverHolds: T) => void;
  /**
   * Resolves when no card is on its way — at once, when none is.
   *
   * For the one caller that saves a card ITSELF, beside the queue: signing.
   * A save started while a queued one is still out carries the revision from
   * before it, and is answered as a conflict with the phone's own hole.
   */
  landed: () => Promise<void>;
}

/** Two cards say the same on every hole either of them has. */
function sameCells(a: readonly unknown[], b: readonly unknown[]): boolean {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i += 1) if ((a[i] ?? null) !== (b[i] ?? null)) return false;
  return true;
}

export function usePendingCard<T>({
  stageId,
  playerId,
  send,
  drawnFrom,
  cells,
  debounceMs = 600,
  enabled = true,
  holding = false,
}: {
  stageId: string;
  playerId: string;
  /**
   * Attempt the write. Throw to signal failure. Answer `{ serverHolds }` with
   * the card as the server read it back after writing, wherever the save can:
   * that, not the send resolving, is what makes a hole "Sent".
   */
  send: (value: T) => Promise<SendOutcome<T>>;
  /**
   * The card as the server held it when this screen was drawn — every hole of
   * it is "Sent" until the phone changes one. Null for no card yet. REQUIRED,
   * so no caller can forget to say what the server already has.
   */
  drawnFrom: T | null;
  /** The card's holes, one value each, in order — what is compared hole by hole. */
  cells: (value: T) => readonly unknown[];
  debounceMs?: number;
  enabled?: boolean;
  /**
   * Keep this card on the device and do not try the network yet.
   *
   * The device copy is still written on every change — that is `push`'s first
   * act and the reason this hook exists. What this suppresses is only the
   * request, for the one case where the server is CERTAIN to refuse it: a
   * tournament that takes whole cards, and a card that is not whole. Sending
   * anyway does not fail safely, it fails loudly and wrongly, because a
   * deliberate refusal is not a network error and the screen reports it as a
   * card that would not save.
   *
   * Distinct from `enabled`. That means the card cannot be written at all
   * (approved, locked); this means not yet.
   */
  holding?: boolean;
}): PendingCard<T> {
  const key = pendingKey(stageId, playerId);

  const [queued, setQueued] = useState(false);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState(false);
  const [held, setHeld] = useState(false);
  const [online, setOnline] = useState(true);
  const [recovered, setRecovered] = useState<T | null>(null);
  /** The card the queue holds to send — `value` below, as something a render can read. Null: nothing waiting. */
  const [onPhone, setOnPhone] = useState<T | null>(null);
  /** What the server last said it holds: as drawn, then as each answered send read it back. */
  const [onServer, setOnServer] = useState<T | null>(drawnFrom);
  const [refusal, setRefusal] = useState("");
  /** The device would not take the last write — private browsing, or a full store. */
  const [unkept, setUnkept] = useState(false);
  const [, tick] = useState(0);

  const value = useRef<T | null>(null);
  const queuedAt = useRef(0);
  const lastAttempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The send that is out, as something to wait on — and null when none is. See `attempt`. */
  const inFlight = useRef<Promise<void> | null>(null);
  const latestAttempt = useRef<() => Promise<void>>(async () => {});
  // Through a ref: a caller's `cells` is a fresh arrow every render, and the send must not be rebuilt for it.
  const cellsOf = useRef(cells);
  cellsOf.current = cells;

  /** Anything left from a previous visit means the last one did not finish. */
  useEffect(() => {
    setOnline(typeof navigator === "undefined" || navigator.onLine !== false);
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setRecovered(JSON.parse(raw) as T);
    } catch {
      // A malformed or unreadable entry is not worth failing a round over.
      // The card on the server is still there; this was only the safety net.
    }
  }, [key]);

  const attempt = useCallback(async () => {
    if (!enabled || holding || value.current === null) return;
    /**
     * ONE CARD ON ITS WAY AT A TIME (2026-10-13).
     *
     * A card is sent with the revision this phone last heard from the server,
     * and hears the new one only when the send comes back. Three things start
     * a send — the pause after a tap, the signal returning, the retry timer —
     * and nothing stopped a second starting while the first was out. The
     * second then carried the OLD revision; by the time it arrived the server
     * held the first, and answered that the card had changed underneath it.
     *
     * So on a connection that takes two seconds to save, a player who entered
     * the next hole inside those two seconds was told "This card changed while
     * you were out of signal — somebody else, usually the committee, edited
     * this card", by their own previous hole, and "Use theirs" threw the new
     * hole away. Measured in a browser the night it was found: asked at 0.9s
     * and 1.5s between holes, not at 2.5s.
     *
     * A send that is asked for while one is out is not started. It is not
     * lost either: when the one that is out comes back, whatever is NEWEST
     * goes next, with the revision that answer carried.
     */
    // …unless the one that is out has been out so long it is taken for lost
    // (`SEND_PATIENCE_MS`): one at a time must not become none at all.
    if (!mayStartSend({ out: inFlight.current !== null, outForMs: Date.now() - lastAttempt.current })) return;
    const sent = value.current;
    let land: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      land = resolve;
    });
    inFlight.current = done;
    lastAttempt.current = Date.now();
    setSending(true);
    let goAgain = false;
    try {
      const outcome = await send(sent);
      /**
       * The server answered and did NOT take the card.
       *
       * Returning early here is the whole fix. `send` used to resolve on a
       * conflict exactly as it does on success, so everything below ran: the
       * device copy was deleted and the queue cleared while the chooser was
       * still on screen. The scorer's holes then existed only in React state,
       * `queued` was false so nothing would ever retry, and the status line
       * said "Saved". Locking the phone lost them.
       */
      if (outcome === "held") {
        setHeld(true);
        return;
      }
      // What the server says it holds now — read back from the row it wrote,
      // where the save can. Every "Sent" on the screen is measured against it.
      const holds = serverHoldsAfter(outcome, sent);
      if (holds !== null) setOnServer(holds);
      /**
       * THE SEND RESOLVED AND THE ROW DOES NOT SAY WHAT WAS SENT. Not landed,
       * whatever the answer called itself: the device copy stays, the queue
       * stays, and the holes that differ read "Not sent" with a reason — never
       * a quiet "Sent" over a record that says something else.
       */
      const theirsWins = typeof outcome === "object" && outcome.theirsWins === true;
      if (holds !== null && !theirsWins && !sameCells(cellsOf.current(holds), cellsOf.current(sent))) {
        setRefused(true);
        setRefusal("The club’s copy of this card does not say what this phone says");
        return;
      }
      setRefusal("");
      // A newer card was entered while this one was out. The device copy and
      // the queue are the NEWER card's — clearing them here would leave its
      // holes on neither the phone nor the server — and it goes next.
      if (value.current !== null && value.current !== sent) {
        goAgain = true;
        return;
      }
      // Cleared ONLY here. Anywhere else and there is a moment where neither
      // the device nor the server is holding the scorer's holes.
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* a full or blocked store is not a reason to report a failed save */
      }
      setQueued(false);
      setRefused(false);
      setHeld(false);
      // Nothing is waiting: what the phone shows is what the server holds.
      setOnPhone(null);
      queuedAt.current = 0;
    } catch (e) {
      /**
       * A refusal is not an outage.
       *
       * If the server answered — a locked card, a closed round — retrying
       * cannot help, and telling the scorer it will send later would be a
       * promise nothing can keep. A network error leaves `refused` false and
       * stays in the queue.
       */
      const networkish =
        e instanceof TypeError ||
        (typeof navigator !== "undefined" && navigator.onLine === false);
      setRefused(!networkish);
      // The server's own sentence, said at the hole — when it gave one a golfer can act on.
      setRefusal(networkish ? "" : refusalWords(e instanceof Error ? e.message : ""));
    } finally {
      // Only its own mark: a send given up on may come back after a newer one
      // has gone out, and must not report the newer one as landed.
      if (inFlight.current === done) {
        inFlight.current = null;
        setSending(false);
      }
      land();
      // Through the ref, not this closure: the card that goes next is sent by
      // whatever `attempt` is current, which may have been rebuilt meanwhile.
      if (goAgain) void latestAttempt.current();
    }
    // `holding` is a dependency, not a value read at push time: the hole that
    // completes the card flips it false in the same render that schedules the
    // send, so the debounced attempt has to be the new one.
  }, [enabled, holding, key, send]);
  latestAttempt.current = attempt;

  const push = useCallback(
    (next: T) => {
      value.current = next;
      // THE DEVICE FIRST. Synchronous, before any await, so a request that
      // never returns cannot leave this hole existing only in memory.
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
        setUnkept(false);
      } catch {
        // Private mode or a full store: carry on, the network may still work —
        // but "On your phone" would now be untrue past this tab, so it is said.
        setUnkept(true);
      }
      setOnPhone(next);
      if (!queued) queuedAt.current = Date.now();
      setQueued(true);
      setRefused(false);
      // A new hole is a new decision. Whatever the last conflict was, the
      // scorer has carried on, so this card is worth another attempt.
      setHeld(false);

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(attempt, debounceMs);
    },
    [attempt, debounceMs, key, queued],
  );

  /** Retry on a schedule, and immediately when the signal comes back. */
  useEffect(() => {
    const wake = () => {
      const up = typeof navigator === "undefined" || navigator.onLine !== false;
      setOnline(up);
      if (up) void attempt();
    };
    /**
     * NAMED, so it can be removed again.
     *
     * This was `() => setOnline(false)` written inline, which cannot be passed
     * to `removeEventListener` — and the cleanup below never tried. The effect
     * re-runs on every change to `attempt`, `queued`, `sending`, `held` and
     * `holding`, which on a scoring screen is every hole, so the listeners
     * accumulated for the life of the page: eighteen holes of typing left a
     * stack of them all calling `setOnline(false)` on one `offline` event.
     *
     * Harmless in its effect — they all set the same flag to the same value —
     * and a leak either way, which is enough reason for a screen a phone sits
     * on for four hours.
     */
    const sleep = () => setOnline(false);
    window.addEventListener("online", wake);
    window.addEventListener("offline", sleep);

    /**
     * NOTHING BELOW CAN CHANGE ANYTHING UNLESS A SEND IS OUTSTANDING.
     *
     * The DECISION is `shouldPoll`, beside `shouldRetry` and `syncStatus`,
     * which is where this file's rules live and the only place they can be
     * unit-tested. Read it for why: in short, the timer re-tried and
     * re-rendered every five seconds for the life of the page, and in the two
     * states a card SITS in — a whole-card round waiting for the eighteenth
     * hole, and a conflict waiting on a person — neither job applies.
     *
     * The second is the one that shows. The chooser is on screen asking which
     * card to keep, and the subtree holding it was re-rendering under the
     * scorer's finger. CLAUDE.md records `offline.spec.ts:245` as intermittent
     * on all three viewports with the signature "element is not stable …
     * element was detached from the DOM, retrying", and says the thing to look
     * at is "what re-renders the card chooser after it opens, not where the
     * nav sits". This is what.
     *
     * Every flag it reads is in the dependency array, so the timer starts
     * again the moment a send is outstanding.
     */
    if (!shouldPoll({ queued, held, holding })) {
      return () => {
        window.removeEventListener("online", wake);
        window.removeEventListener("offline", sleep);
      };
    }

    const t = setInterval(() => {
      // Re-render so the "waiting" wording ages honestly even when nothing
      // else changes.
      tick((n) => n + 1);
      if (
        shouldRetry({
          queued,
          sending,
          online: typeof navigator === "undefined" || navigator.onLine !== false,
          sinceLastAttemptMs: Date.now() - lastAttempt.current,
          held,
          holding,
        })
      ) {
        void attempt();
      }
    }, Math.min(RETRY_EVERY_MS, 5000));

    return () => {
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", sleep);
      clearInterval(t);
    };
  }, [attempt, queued, sending, held, holding]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The card the queue holds, or — with nothing waiting — the server's, which is then what the phone shows.
  const phoneCells = onPhone !== null ? cells(onPhone) : onServer !== null ? cells(onServer) : [];
  const serverCells = onServer !== null ? cells(onServer) : null;
  const holes = holeSyncs({
    onPhone: phoneCells,
    onServer: serverCells,
    refused,
    holes: Math.max(phoneCells.length, serverCells?.length ?? 0),
  });

  return {
    status: syncStatus({
      queued,
      sending,
      online,
      waitingMs: queuedAt.current ? Date.now() - queuedAt.current : 0,
      refused,
      held,
      holding,
      unsent: unsentHoles(holes),
      refusal,
      unkept: unkept && queued,
    }),
    holes,
    refusal,
    push,
    recovered,
    heard: (serverHolds: T) => setOnServer(serverHolds),
    landed: () => inFlight.current ?? Promise.resolve(),
    clearRecovered: () => {
      setRecovered(null);
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* nothing to do */
      }
    },
    settle: (serverHolds: T) => {
      value.current = null;
      setOnPhone(null);
      setOnServer(serverHolds);
      queuedAt.current = 0;
      setQueued(false);
      setHeld(false);
      setRefused(false);
      setRefusal("");
      setRecovered(null);
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* nothing to do */
      }
    },
  };
}
