import { describe, it, expect } from "vitest";
import { readSource } from "../../__tests__/source";
import {
  cardRevision,
  combineHoleSyncs,
  HOLE_SYNC_WORDS,
  holeSyncs,
  isLongWait,
  LONG_WAIT_HOLES,
  LONG_WAIT_MS,
  refusalWords,
  serverHoldsAfter,
  unsentHoles,
  type HoleSync,
  keptCardChanged,
  mayStartSend,
  SEND_PATIENCE_MS,
  NO_CARD_REVISION,
  NAG_AFTER_MS,
  pendingKey,
  RETRY_EVERY_MS,
  shouldPoll,
  shouldRetry,
  staleAgainst,
  syncStatus,
  type PendingState,
} from "../pending-card";

/**
 * What a scorer is told about holes that have not reached the server.
 *
 * Every case is the same person: someone standing on a tee, in patchy signal,
 * deciding whether it is safe to put the phone away and play their shot. Get
 * the wording wrong in one direction and they stand there waving it about; get
 * it wrong in the other and they walk off believing holes are safe that are
 * only on a device.
 */

const base: PendingState = {
  queued: false,
  sending: false,
  online: true,
  waitingMs: 0,
  refused: false,
  held: false,
  holding: false,
};
const at = (over: Partial<PendingState>) => syncStatus({ ...base, ...over });

describe("what the scorer is told", () => {
  it("says sent, and means it, when nothing is waiting", () => {
    // "Sent", the same word each hole uses (`HOLE_SYNC_WORDS`) — one state, one word.
    const s = at({});
    expect(s.label).toBe("Sent");
    expect(s.label).toBe(HOLE_SYNC_WORDS.sent);
    expect(s.safeToLeave).toBe(true);
  });

  it("does not call an offline queue a failure", () => {
    /**
     * THE CASE THIS FILE EXISTS FOR. Nothing has failed — the holes are on the
     * phone and will go when signal returns. "Failed" would send a scorer
     * hunting for a bar of signal instead of playing golf.
     */
    const s = at({ queued: true, online: false });
    expect(s.tone).toBe("queued");
    expect(s.label).toMatch(/no signal/i);
    expect(s.label).toMatch(/saved on this phone/i);
  });

  it("tells them it is safe to walk away while offline", () => {
    // The single most important bit on the screen. Their holes are somewhere
    // other than volatile memory, so they can pocket the phone and play.
    expect(at({ queued: true, online: false }).safeToLeave).toBe(true);
  });

  it("does NOT say it is safe while a request is still in flight", () => {
    expect(at({ queued: true, sending: true }).safeToLeave).toBe(false);
  });

  it("stops being reassuring once online and stuck", () => {
    // Online, not sending, still waiting: the problem is not the golf course.
    // A spinner forever is worse than saying so.
    const s = at({ queued: true, waitingMs: NAG_AFTER_MS });
    expect(s.tone).toBe("warn");
    expect(s.label).toMatch(/still trying/i);
    // Still safe to leave — the holes are kept.
    expect(s.safeToLeave).toBe(true);
  });

  it("is patient before then, because a slow send is normal", () => {
    expect(at({ queued: true, waitingMs: NAG_AFTER_MS - 1 }).tone).toBe("working");
  });

  it("treats a refusal as a different thing from an outage", () => {
    /**
     * The server understood and said no — a locked card, a closed round.
     * Retrying cannot fix that, so the wording must not promise it will, and
     * it must not tell them to walk away.
     */
    const s = at({ queued: true, refused: true });
    expect(s.tone).toBe("warn");
    expect(s.label).toMatch(/committee/i);
    expect(s.safeToLeave).toBe(false);
    expect(s.label).not.toMatch(/no signal|will send/i);
  });

  it("reports a refusal even while offline, because it is not about the signal", () => {
    expect(at({ queued: true, refused: true, online: false }).tone).toBe("warn");
  });

  /**
   * A tournament that takes the whole card at the end.
   *
   * The player is nine holes into a `scoreEntryWindow: "after"` round. Their
   * holes are on the phone and there is nothing to send yet — by design, not by
   * failure. Every other branch here describes something going wrong, and this
   * one describes the arrangement working.
   */
  it("does not call a card it is holding on purpose a failure", () => {
    const s = at({ queued: true, holding: true });
    expect(s.tone).toBe("queued");
    expect(s.label).not.toMatch(/wouldn't save|committee|still trying/i);
    expect(s.label).toMatch(/whole card/i);
  });

  it("tells them it is safe to walk away, because the holes are on the phone", () => {
    // The one line that matters most on this screen, and the reason the old
    // behaviour was worse than cosmetic: the refusal branch says
    // safeToLeave: false, so from the first hole of the round a player was
    // being told their card was not safe to leave. A warning that is always on
    // is one nobody reads — including on the round where it is true.
    expect(at({ queued: true, holding: true }).safeToLeave).toBe(true);
  });

  it("still lets a real conflict and a real refusal speak over it", () => {
    // Both need a person; being mid-round does not make either wait. A held
    // card is somebody else's edit, and a refusal after the card was completed
    // and sent is a locked card or a closed round.
    expect(at({ queued: true, holding: true, held: true }).label).toMatch(/choose which to keep/i);
    expect(at({ queued: true, holding: true, refused: true }).label).toMatch(/committee/i);
  });

  it("does not say 'no signal' to somebody whose card was never going to send", () => {
    // Offline is irrelevant while nothing is being attempted, and "will send
    // when it returns" would be a promise the signal cannot keep.
    const s = at({ queued: true, holding: true, online: false });
    expect(s.label).not.toMatch(/no signal/i);
    expect(s.safeToLeave).toBe(true);
  });
});

describe("when to try again", () => {
  const r = (over: Partial<Parameters<typeof shouldRetry>[0]>) =>
    shouldRetry({ queued: true, sending: false, online: true, sinceLastAttemptMs: RETRY_EVERY_MS, ...over });

  it("retries once the interval has passed", () => {
    expect(r({})).toBe(true);
  });

  it("never retries while offline", () => {
    // An offline attempt fails instantly and costs battery for nothing. The
    // `online` event wakes this up; a timer grinding away in a pocket does not.
    expect(r({ online: false })).toBe(false);
  });

  it("never doubles up on a request already in flight", () => {
    expect(r({ sending: true })).toBe(false);
  });

  it("never retries a card that is being held until it is whole", () => {
    // The server refuses a part-filled card in this mode, deliberately and
    // every time. Retrying is fifteen seconds of nothing, repeated for the
    // length of a round — and each failure re-arms the warning on screen.
    expect(r({ holding: true })).toBe(false);
    // And the moment the card is complete, the hold lifts and the same queued
    // card goes. Nothing else has to change for it to send.
    expect(r({ holding: false })).toBe(true);
  });

  it("does nothing when there is nothing queued", () => {
    expect(r({ queued: false })).toBe(false);
  });

  it("waits out the interval rather than hammering", () => {
    expect(r({ sinceLastAttemptMs: RETRY_EVERY_MS - 1 })).toBe(false);
  });
});

describe("noticing that a replay would overwrite somebody", () => {
  it("is not stale when nobody else has touched the card", () => {
    expect(staleAgainst("rev-1", "rev-1")).toBe(false);
  });

  it("is stale when the server has moved on", () => {
    // A card typed twenty minutes ago is written WHOLE, so replaying it
    // replaces an organizer's correction made in the meantime. This only
    // detects that — resolving it is a human's job, not a silent winner.
    expect(staleAgainst("rev-1", "rev-2")).toBe(true);
  });

  it("says nothing when either side is unknown", () => {
    // A missing revision is not evidence of a conflict, and treating it as one
    // would put a scary prompt in front of every scorer on a fresh card.
    expect(staleAgainst("", "rev-2")).toBe(false);
    expect(staleAgainst("rev-1", "")).toBe(false);
  });
});

describe("where a pending card is kept", () => {
  it("is one key per card, not per player", () => {
    // A phone can hold Saturday's card and Sunday's. Keying on the player
    // alone would let one overwrite the other the moment both were unsent.
    expect(pendingKey("sat", "p1")).not.toBe(pendingKey("sun", "p1"));
    expect(pendingKey("sat", "p1")).not.toBe(pendingKey("sat", "p2"));
  });

  it("is stable, because it is read back on the next load", () => {
    expect(pendingKey("s", "p")).toBe(pendingKey("s", "p"));
  });
});

describe("a card's revision, derived from what is on it", () => {
  it("is the same for the same card", () => {
    expect(cardRevision([4, 5, null])).toBe(cardRevision([4, 5, null]));
  });

  it("changes when any hole changes", () => {
    expect(cardRevision([4, 5, null])).not.toBe(cardRevision([4, 6, null]));
    expect(cardRevision([4, 5, null])).not.toBe(cardRevision([4, 5, 3]));
  });

  it("distinguishes a hole not played from a hole played in zero", () => {
    // They are different claims, and a scorecard that cannot tell them apart
    // is one that can silently turn a no-return into a score.
    expect(cardRevision([null])).not.toBe(cardRevision([0]));
  });

  it("distinguishes the same numbers on different holes", () => {
    expect(cardRevision([4, 5])).not.toBe(cardRevision([5, 4]));
  });

  it("treats a missing card as an empty one rather than throwing", () => {
    expect(() => cardRevision(undefined as unknown as number[])).not.toThrow();
    expect(cardRevision(undefined as unknown as number[])).toBe(cardRevision([]));
  });

  it("does not report a conflict when the same scores are saved twice", () => {
    /**
     * WHY THIS IS CONTENT AND NOT A CLOCK. A retry that already succeeded, or
     * two people typing the same number, produces no disagreement to put in
     * front of anybody — but a timestamp would call it a conflict and make
     * somebody choose between two identical cards.
     */
    const before = cardRevision([4, 5, 3]);
    const afterRewrite = cardRevision([4, 5, 3]);
    expect(staleAgainst(before, afterRewrite)).toBe(false);
  });

  it("reports a conflict when somebody else changed a hole", () => {
    const mine = cardRevision([4, 5, 3]);
    const theirs = cardRevision([4, 7, 3]);
    expect(staleAgainst(mine, theirs)).toBe(true);
  });
});

/**
 * A card the server answered and did not take.
 *
 * The third outcome. `send` could resolve or throw, so a conflict — where the
 * server is reached and deliberately refuses the write — resolved, and the
 * queue read that as success: it deleted the device copy, set `queued` false so
 * nothing would ever retry, and showed "Saved" while the chooser was still on
 * screen. The scorer's holes were then in React state and nowhere else, and
 * locking the phone lost them for good.
 */
describe("a card held back by a conflict", () => {
  const held = (over: Partial<PendingState> = {}) =>
    syncStatus({ ...base, queued: true, held: true, ...over });

  it("never reads as saved", () => {
    expect(held().label).not.toMatch(/^Saved/i);
    expect(held().tone).not.toBe("idle");
  });

  it("says it is not safe to walk away", () => {
    // The single thing the status line exists to answer. Getting it wrong here
    // is what puts the phone in a pocket.
    expect(held().safeToLeave).toBe(false);
  });

  it("says the holes are still on the phone", () => {
    expect(held().label).toMatch(/on this phone/i);
  });

  it("outranks every other state, including a clean queue", () => {
    // It is checked first because each of these would otherwise describe the
    // card as fine, or as merely slow.
    expect(held({ queued: false }).safeToLeave).toBe(false);
    expect(held({ online: false }).safeToLeave).toBe(false);
    expect(held({ sending: true }).safeToLeave).toBe(false);
    expect(held({ waitingMs: NAG_AFTER_MS * 2 }).safeToLeave).toBe(false);
  });

  it("is not the same thing as a refusal", () => {
    // `refused` is the server saying no for a reason nobody on this screen can
    // act on — a locked card, a closed round. A conflict has an answer, and it
    // is a person's to give.
    const refused = syncStatus({ ...base, queued: true, refused: true });
    expect(held().label).not.toBe(refused.label);
  });
});

describe("retrying a held card", () => {
  const args = {
    queued: true,
    sending: false,
    online: true,
    sinceLastAttemptMs: RETRY_EVERY_MS * 4,
  };

  it("does not happen — the same write would conflict again", () => {
    expect(shouldRetry({ ...args, held: true })).toBe(false);
  });

  it("still happens for an ordinary queued card", () => {
    expect(shouldRetry({ ...args, held: false })).toBe(true);
    expect(shouldRetry(args)).toBe(true);
  });
});

describe("whether the screen's clock is worth running", () => {
  /**
   * THE TIMER RAN EVERY FIVE SECONDS FOR THE LIFE OF THE PAGE.
   *
   * It does two jobs — retry a send, and re-render so the label ages — and in
   * the states a card SITS in, neither applies. `shouldRetry` already refuses
   * `held`, `holding` and `!queued`; and `syncStatus` reads the clock in
   * exactly one branch, so everywhere else a tick produces the identical
   * string at the cost of re-rendering the whole scoring screen.
   *
   * The visible cost is the card chooser. It is on screen asking a person
   * which card to keep, and the subtree holding it was re-rendering under
   * their finger. CLAUDE.md records `offline.spec.ts:245` as intermittent on
   * all three viewports, with the signature "element is not stable … element
   * was detached from the DOM, retrying", and says the thing to look for is
   * what re-renders the chooser after it opens rather than where the nav sits.
   */
  it("does not run while a conflict waits on a person", () => {
    expect(shouldPoll({ queued: true, held: true })).toBe(false);
  });

  it("does not run through a whole-card round", () => {
    /**
     * `shouldRetry`'s own note on `holding` says the timer must not "fire every
     * fifteen seconds for the length of a round". That was true of the retry
     * and not of the re-render, which is the half a phone in a pocket pays for.
     */
    expect(shouldPoll({ queued: true, holding: true })).toBe(false);
  });

  it("does not run when there is nothing outstanding", () => {
    // The commonest state of all: everything saved, the label a constant
    // "Saved", and a timer waking the page up for ever to say so again.
    expect(shouldPoll({ queued: false })).toBe(false);
  });

  it("DOES run for an ordinary queued card", () => {
    /**
     * The half that must not be lost. This is the one state where the label
     * genuinely ages — `waitingMs >= NAG_AFTER_MS` turns "Saving…" into "Still
     * trying to send your holes" — and where a retry is due. Stopping the
     * timer here would leave a spinner up for ever.
     */
    expect(shouldPoll({ queued: true })).toBe(true);
    expect(shouldPoll({ queued: true, held: false, holding: false })).toBe(true);
  });

  it("agrees with the label it exists to age", () => {
    /**
     * Measured against `syncStatus` rather than asserted twice. For each state
     * this refuses to poll, the label must be the SAME before and after the nag
     * threshold — which is the property that makes the tick pointless there. If
     * a future label starts reading the clock in one of these states this goes
     * red, which is exactly when the timer would be needed again.
     */
    const base: PendingState = {
      queued: true,
      sending: false,
      online: true,
      waitingMs: 0,
      refused: false,
      held: false,
      holding: false,
    };
    for (const state of [
      { ...base, held: true },
      { ...base, holding: true },
      { ...base, queued: false },
    ]) {
      expect(shouldPoll(state), "polls a state this loop assumes it skips").toBe(false);
      const young = syncStatus({ ...state, waitingMs: 0 });
      const old = syncStatus({ ...state, waitingMs: NAG_AFTER_MS * 3 });
      expect(old, `the label ages in a state the timer no longer runs in`).toEqual(young);
    }

    // And the control: the state it DOES poll is the state where the label
    // changes, or none of the above means anything.
    expect(shouldPoll(base)).toBe(true);
    expect(syncStatus({ ...base, waitingMs: NAG_AFTER_MS * 3 })).not.toEqual(
      syncStatus({ ...base, waitingMs: 0 }),
    );
  });
});

/**
 * A CARD KEPT FOR A PLAYING PARTNER IS SENT WHEN IT HAS CHANGED — NOT WHEN IT
 * IS OPENED (2026-10-11).
 *
 * The Group view keeps each partner's card on the phone and sends it when it
 * differs from "the server's". It measured that against the revision the
 * server gave — and for a partner with no card yet the server says
 * `NO_CARD_REVISION`, the revision of nothing, which by design matches no card
 * of any length. The phone holds eighteen blanks. They never matched, so
 * opening the Group view sent a blank card for every partner who had not
 * started: a card row nobody entered, under the marker's name, on a round the
 * partner had not played a hole of.
 *
 * Found by the control crawl as a member: on the league's card screen, choosing
 * "Group" — a view — was followed by a save.
 *
 * What a kept card is measured against is what THIS PHONE last knew it to be.
 */
describe("a card kept for a partner", () => {
  const blank = (holes: number) => new Array<number | null>(holes).fill(null);

  it("is not sent for a partner with no card, just for being opened", () => {
    for (const holes of [9, 18]) {
      const asLoaded = blank(holes);
      expect(keptCardChanged(asLoaded, cardRevision(asLoaded)), `${holes} holes`).toBe(false);
    }
  });

  it("CONTROL: measured against the server's 'no card', the same blank card looks changed — the defect", () => {
    // Why the comparison had to move, pinned so nobody moves it back.
    expect(keptCardChanged(blank(18), NO_CARD_REVISION)).toBe(true);
  });

  it("is sent once a score is on it", () => {
    const asLoaded = blank(18);
    const afterOneHole = [5, ...blank(17)];
    expect(keptCardChanged(afterOneHole, cardRevision(asLoaded))).toBe(true);
  });

  it("is not sent again once what was sent is what is held", () => {
    const sent = [5, 4, ...blank(16)];
    expect(keptCardChanged(sent, cardRevision(sent))).toBe(false);
  });

  it("is sent when a score is taken back off it", () => {
    // Clearing a hole is a change too, and the partner's card must lose it.
    const had = [5, ...blank(17)];
    expect(keptCardChanged(blank(18), cardRevision(had))).toBe(true);
  });

  it("is not sent when there is no card in hand at all", () => {
    expect(keptCardChanged(undefined, NO_CARD_REVISION)).toBe(false);
  });

  it("the Group view measures against what the phone last knew, in one place", () => {
    const src = readSource("src", "components", "GroupScoring.tsx");
    expect(src).toMatch(/keptCardChanged\(strokes, known\.current\)/);
    // Not against the revision the server gave, which is the conflict
    // protocol's and says "no card" for a partner who has not started.
    expect(src).not.toMatch(/cardRevision\(strokes\) !== revision\.current/);
  });
});

/**
 * ONE CARD ON ITS WAY AT A TIME.
 *
 * A card is sent with the revision the phone last heard, and hears the next
 * one only when the send comes back. A second card sent beside the first
 * carries a revision the first is about to make stale, and is answered as a
 * conflict with the phone's own hole — "this card changed while you were out
 * of signal", to a player who had only entered two holes quickly on a slow
 * connection (measured 2026-10-13: asked at 0.9s and 1.5s between holes on a
 * two-second save, not at 2.5s). `e2e/slow-signal-scoring.spec.ts` is that
 * measurement, kept. This is the rule the queue asks before it sends.
 */
describe("whether a card may be sent now", () => {
  it("goes when nothing is out", () => {
    expect(mayStartSend({ out: false, outForMs: 0 })).toBe(true);
  });

  it("waits while one is out — a slow save is not a lost one", () => {
    for (const outForMs of [0, 600, 2_000, 5_000, SEND_PATIENCE_MS - 1]) {
      expect(mayStartSend({ out: true, outForMs }), `${outForMs}ms`).toBe(false);
    }
  });

  it("stops waiting for one that has been out past patience: one at a time must not become none", () => {
    expect(mayStartSend({ out: true, outForMs: SEND_PATIENCE_MS })).toBe(true);
    expect(mayStartSend({ out: true, outForMs: SEND_PATIENCE_MS * 10 })).toBe(true);
  });

  it("is patient for longer than the retry timer, so the timer cannot start a second beside a slow first", () => {
    expect(SEND_PATIENCE_MS).toBeGreaterThan(RETRY_EVERY_MS);
  });

  it("the queue asks it before every send, marks only its own send as landed, and sends the newest card next", () => {
    const hook = readSource("src", "components", "usePendingCard.ts");
    expect(hook).toContain("if (!mayStartSend({ out: inFlight.current !== null, outForMs: Date.now() - lastAttempt.current })) return;");
    expect(hook).toContain("if (inFlight.current === done) {");
    expect(hook).toContain("if (value.current !== null && value.current !== sent) {");
    expect(hook).toContain("if (goAgain) void latestAttempt.current();");
    // And signing a card waits for a hole that is still on its way.
    const card = readSource("src", "components", "PlayerCard.tsx");
    const at = card.indexOf("await card.landed();");
    expect(at, "signing does not wait for a save that is out").toBeGreaterThan(0);
    expect(card.indexOf("const res = await saveScorecard(stageId, playerId, sent, revision.current);", at), "the wait is not before the save it protects").toBeGreaterThan(at);
  });
});

/**
 * THE HONEST CARD (2026-10-25): where each hole's score is.
 *
 * Worked out from the sender's own two values — the card it holds to send, and
 * what the last answered send read back from the server — and nothing else.
 * The property that matters, asserted over every combination below: a hole is
 * "Sent" only when the server holds exactly what the phone holds for it.
 */
describe("where each hole is", () => {
  const sync = (onPhone: (number | null)[], onServer: (number | null)[] | null, refused = false) =>
    holeSyncs({ onPhone, onServer, refused, holes: onPhone.length });

  it("calls a hole Sent only where the server holds what the phone holds", () => {
    expect(sync([4, 5, 3], [4, 5, 3])).toEqual(["sent", "sent", "sent"]);
    expect(sync([4, 5, 3], [4, 5, null])).toEqual(["sent", "sent", "phone"]);
    expect(sync([4, 5, 3], null)).toEqual(["phone", "phone", "phone"]);
  });

  it("says nothing about a hole that is empty in both places", () => {
    expect(sync([null, 4], [null, 4])).toEqual(["none", "sent"]);
    expect(sync([null], null)).toEqual(["none"]);
  });

  it("calls a score the server holds and the phone has changed 'On your phone', not Sent", () => {
    // The server still holds the 5; the 4 has not gone. "Sent" would be about the wrong number.
    expect(sync([4], [5])).toEqual(["phone"]);
  });

  it("calls a hole cleared on the phone and not on the server 'On your phone'", () => {
    // The server still has the old score, and that is the honest thing to say about it.
    expect(sync([null], [5])).toEqual(["phone"]);
  });

  it("calls every hole the server would not take 'Not sent', and only those", () => {
    expect(sync([4, 5, 3], [4, null, null], true)).toEqual(["sent", "refused", "refused"]);
  });

  it("PROPERTY: over every phone/server pair of values, Sent means equal and non-empty", () => {
    const values = [null, 1, 3, 4, 9];
    for (const p of values)
      for (const s of values)
        for (const refused of [false, true]) {
          const [h] = sync([p], [s], refused);
          if (h === "sent") expect(p, `sent with phone ${p} and server ${s}`).toBe(s);
          if (h === "sent") expect(p).not.toBeNull();
          if (p !== s) expect(h, `phone ${p}, server ${s}`).toBe(refused ? "refused" : "phone");
        }
  });

  it("works for a match's holes as well as a card's strokes", () => {
    expect(holeSyncs({ onPhone: ["A", "H", null], onServer: ["A", null, null], refused: false, holes: 3 })).toEqual(["sent", "phone", "none"]);
  });

  it("counts the holes that are not on the server", () => {
    const holes: HoleSync[] = ["sent", "phone", "refused", "none", "phone"];
    expect(unsentHoles(holes)).toBe(3);
  });

  it("gives the group's hole the worst of its cards: Sent only when every card on it is", () => {
    const mine: HoleSync[] = ["sent", "sent", "sent", "none"];
    const partner: HoleSync[] = ["sent", "phone", "refused", "sent"];
    expect(combineHoleSyncs([mine, partner], 4)).toEqual(["sent", "phone", "refused", "sent"]);
    expect(combineHoleSyncs([], 2)).toEqual(["none", "none"]);
  });

  it("takes what the server READ BACK over what was sent, and a held card as nothing heard", () => {
    expect(serverHoldsAfter({ serverHolds: [4, 5] }, [4, 6])).toEqual([4, 5]);
    expect(serverHoldsAfter("sent", [4, 6])).toEqual([4, 6]);
    expect(serverHoldsAfter("held", [4, 6])).toBeNull();
  });

  it("has three words, and they are the ones on the screen", () => {
    expect(HOLE_SYNC_WORDS).toEqual({ phone: "On your phone", sent: "Sent", refused: "Not sent" });
  });
});

describe("what the card says when the server says no, or the signal is gone a long time", () => {
  it("says the server's own sentence, and what to do", () => {
    const s = at({ queued: true, refused: true, refusal: "The committee has closed this round, so no more scores can be entered for it." });
    expect(s.label).toMatch(/^Not sent: The committee has closed this round/);
    expect(s.label).toMatch(/kept on this phone/);
    expect(s.label).toMatch(/committee/);
    expect(s.tone).toBe("warn");
    expect(s.safeToLeave).toBe(false);
  });

  it("keeps a plain sentence when the server gave none", () => {
    expect(at({ queued: true, refused: true }).label).toMatch(/^Not sent\. This card wouldn't save\./);
  });

  it("drops the framework's sentence for one a golfer can act on", () => {
    expect(refusalWords("An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.")).toBe("");
    expect(refusalWords("Failed to fetch")).toBe("");
    expect(refusalWords("  ")).toBe("");
    expect(refusalWords("That card has been approved.")).toBe("That card has been approved.");
  });

  it("does not warn about one or two holes in a dead spot, however long", () => {
    for (const unsent of [1, 2]) {
      const s = at({ queued: true, online: false, unsent, waitingMs: 20 * 60_000 });
      expect(s.label, `${unsent} hole(s)`).toMatch(/no signal/i);
      expect(s.tone).toBe("queued");
    }
  });

  it("does not warn about three holes typed in one breath — a player catching up", () => {
    const s = at({ queued: true, online: false, unsent: LONG_WAIT_HOLES, waitingMs: 5_000 });
    expect(s.label).toMatch(/no signal/i);
    expect(isLongWait(LONG_WAIT_HOLES, NAG_AFTER_MS - 1)).toBe(false);
  });

  it("warns at three holes left on the phone for longer than a slow save, and says what to do", () => {
    const s = at({ queued: true, online: false, unsent: LONG_WAIT_HOLES, waitingMs: NAG_AFTER_MS });
    expect(s.tone).toBe("warn");
    expect(s.label).toMatch(/^3 holes are only on this phone/);
    expect(s.label).toMatch(/send by themselves/);
    expect(s.label).toMatch(/show this card to the committee/i);
    // Read on a tee: no sentence of twelve words (`e2e/player-words.spec.ts`).
    for (const sentence of s.label.split(/(?<=[.!?])\s+/)) {
      expect(sentence.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length, sentence).toBeLessThan(12);
    }
    // Still kept, so still safe to play on.
    expect(s.safeToLeave).toBe(true);
  });

  it("warns about a single hole only after half an hour", () => {
    expect(at({ queued: true, online: false, unsent: 1, waitingMs: LONG_WAIT_MS - 1 }).label).toMatch(/no signal/i);
    expect(at({ queued: true, online: false, unsent: 1, waitingMs: LONG_WAIT_MS }).label).toMatch(/^1 hole is only on this phone/);
  });

  it("warns over a send that is out, rather than hiding behind Saving…", () => {
    expect(at({ queued: true, sending: true, unsent: 4, waitingMs: NAG_AFTER_MS }).label).toMatch(/^4 holes are only on this phone/);
  });

  it("never warns about a card held back on purpose, or one with nothing waiting", () => {
    expect(at({ queued: true, holding: true, unsent: 9, waitingMs: LONG_WAIT_MS }).label).toMatch(/whole card/);
    expect(at({ queued: false, unsent: 0, waitingMs: LONG_WAIT_MS }).label).toBe("Sent");
  });

  it("says when the phone would not keep the holes, so 'kept' is never a lie", () => {
    const s = at({ queued: true, online: false, unkept: true });
    expect(s.tone).toBe("warn");
    expect(s.label).toMatch(/won’t keep your holes/);
    expect(s.label).not.toMatch(/saved on this phone/i);
    expect(s.safeToLeave).toBe(false);
  });
});

/**
 * ONE RULE, ONE PLACE: the marks come from the sender.
 *
 * The screen must not be able to say "Sent" for a hole the queue still holds,
 * which is only true while there is ONE comparison and every card draws it.
 */
describe("the marks on every card come from the queue that sends it", () => {
  it("the queue works the holes out from what it holds to send and what the server read back", () => {
    const hook = readSource("src", "components", "usePendingCard.ts");
    expect(hook).toContain("const holes = holeSyncs({");
    expect(hook).toContain("onPhone: phoneCells,");
    expect(hook).toContain("onServer: serverCells,");
    // What it holds to send is set where the device copy is written, before any request.
    const push = hook.slice(hook.indexOf("const push = useCallback"));
    expect(push.indexOf("setOnPhone(next)")).toBeGreaterThan(push.indexOf("localStorage.setItem"));
    expect(push.indexOf("setOnPhone(next)")).toBeLessThan(push.indexOf("setTimeout(attempt"));
    // A read-back that disagrees with what was sent is not a landing.
    expect(hook).toContain("!sameCells(cellsOf.current(holds), cellsOf.current(sent))");
  });

  it("every card that keeps a queue draws its marks from it", () => {
    for (const file of ["PlayerCard.tsx", "PlayClient.tsx", "MatchKeeper.tsx", "MatchStrokeKeeper.tsx"]) {
      const src = readSource("src", "components", file);
      expect(src, file).toMatch(/usePendingCard</);
      expect(src, `${file} keeps a queue and draws no marks from it`).toMatch(/sync=\{(card|cardQueue|matchQueue|queue)\.holes\}/);
    }
    // The group card: the holder's own queue's marks, and each partner's from their own queue.
    const group = readSource("src", "components", "GroupScoring.tsx");
    expect(group).toMatch(/sync=\{groupSync\}/);
    expect(group).toMatch(/combineHoleSyncs\(\[mySync,/);
    expect(readSource("src", "components", "PlayerCard.tsx")).toMatch(/mySync=\{card\.holes\}/);
  });

  it("no screen spells the words itself", () => {
    // CONTROL: the sweep can see the words where they are meant to be.
    expect(readSource("src", "lib", "domain", "pending-card.ts")).toContain('"On your phone"');
    for (const file of ["HoleSync.tsx", "HoleByHoleCard.tsx", "HoleResultCard.tsx", "ScorecardTable.tsx", "PlayerCard.tsx", "PlayClient.tsx", "MatchKeeper.tsx", "MatchStrokeKeeper.tsx", "GroupScoring.tsx"]) {
      expect(readSource("src", "components", file), file).not.toContain('"On your phone"');
    }
  });
});
