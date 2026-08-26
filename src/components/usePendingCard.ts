"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  pendingKey,
  RETRY_EVERY_MS,
  shouldRetry,
  syncStatus,
  type SyncStatus,
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
  /** Record a change: kept on the device immediately, sent shortly after. */
  push: (value: T) => void;
  /** Anything recovered from a previous visit, or null. */
  recovered: T | null;
  /** Forget the recovered copy — the caller has taken it or rejected it. */
  clearRecovered: () => void;
}

export function usePendingCard<T>({
  stageId,
  playerId,
  send,
  debounceMs = 600,
  enabled = true,
}: {
  stageId: string;
  playerId: string;
  /** Attempt the write. Throw to signal failure. */
  send: (value: T) => Promise<void>;
  debounceMs?: number;
  enabled?: boolean;
}): PendingCard<T> {
  const key = pendingKey(stageId, playerId);

  const [queued, setQueued] = useState(false);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState(false);
  const [online, setOnline] = useState(true);
  const [recovered, setRecovered] = useState<T | null>(null);
  const [, tick] = useState(0);

  const value = useRef<T | null>(null);
  const queuedAt = useRef(0);
  const lastAttempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!enabled || value.current === null) return;
    lastAttempt.current = Date.now();
    setSending(true);
    try {
      await send(value.current);
      // Cleared ONLY here. Anywhere else and there is a moment where neither
      // the device nor the server is holding the scorer's holes.
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* a full or blocked store is not a reason to report a failed save */
      }
      setQueued(false);
      setRefused(false);
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
    } finally {
      setSending(false);
    }
  }, [enabled, key, send]);

  const push = useCallback(
    (next: T) => {
      value.current = next;
      // THE DEVICE FIRST. Synchronous, before any await, so a request that
      // never returns cannot leave this hole existing only in memory.
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* private mode or a full store: carry on, the network may still work */
      }
      if (!queued) queuedAt.current = Date.now();
      setQueued(true);
      setRefused(false);

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
    window.addEventListener("online", wake);
    window.addEventListener("offline", () => setOnline(false));

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
        })
      ) {
        void attempt();
      }
    }, Math.min(RETRY_EVERY_MS, 5000));

    return () => {
      window.removeEventListener("online", wake);
      clearInterval(t);
    };
  }, [attempt, queued, sending]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return {
    status: syncStatus({
      queued,
      sending,
      online,
      waitingMs: queuedAt.current ? Date.now() - queuedAt.current : 0,
      refused,
    }),
    push,
    recovered,
    clearRecovered: () => {
      setRecovered(null);
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* nothing to do */
      }
    },
  };
}
