import { describe, it, expect } from "vitest";
import {
  cardRevision,
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
  it("says saved, and means it, when nothing is waiting", () => {
    const s = at({});
    expect(s.label).toBe("Saved");
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
