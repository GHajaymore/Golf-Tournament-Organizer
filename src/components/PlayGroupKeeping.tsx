"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { keepGroup, handOverGroup, confirmPlayMatch, disputePlayMatch, disputePlayCard, certifyPlayCard } from "@/app/actions/play";
import { Icon } from "./Icon";
import { useAction } from "./useAction";
import { holeNumber } from "@/lib/domain/hole-number";
import { matchStandingText, resolveMatch } from "@/lib/domain/match";
import { matchSideLabels, sideMarks } from "@/lib/domain/match-sides";
import { pendingKey } from "@/lib/domain/pending-card";
import {
  FOLLOWING_DETAIL,
  handOverQuestion,
  keptOnSentence,
  nobodyKeepsSentence,
  refusedSentence,
  takeOverQuestion,
  youKeepSentence,
  type KeepingRole,
} from "@/lib/domain/keeping-words";
import type { HoleResult } from "@/lib/domain";
import type { KeptMatch } from "@/lib/services/match-card";

/**
 * ONE PHONE KEEPS THE GROUP'S CARD, AND NOBODY IS SHUT OUT (2026-11-05,
 * sprint 2 part B, phase 2).
 *
 * The round-code screen's half of "one scorer per group" (`Stage.scoreKeeping:
 * "group"`). The phone that confirmed the group first keeps its card
 * (`claimPlayerSlot` claims it); every other phone in the group is told whose
 * phone it is, follows the card read-only — refreshed as the scores go in —
 * and can take it over with one confirmation (`keepGroup({ takeOver: true })`).
 * The keeper can hand it to somebody named in the group (`handOverGroup`).
 *
 * A take-over moves the group's epoch on, so the phone that was keeping it is
 * refused from its next save IN WORDS (`mayKeep`) — never silently. That
 * refusal flips the phone to following here (`refusedBy`) and stops the pad
 * claiming progress it never made.
 */

/** Who keeps this player's group, as the page drew it (`keeperFor`). */
export interface GroupKeepingView {
  /** The sheet's name for the group ("Group 3"), or "Your group" / "Your match". */
  title: string;
  /** The session's player. */
  me: string;
  members: Array<{ id: string; name: string }>;
  keeperId: string | null;
  keeperName: string;
  /** The epoch this phone holds when it is the keeper — sent with every save. */
  epoch: number | null;
  /**
   * Each member's card as stored, for following a stroke round read-only.
   * Absent on a match round, where the match card is followed instead.
   */
  cards?: Record<string, (number | null)[]>;
}

/** How often a following phone asks for the card again. */
const FOLLOW_EVERY_MS = 20_000;

/**
 * A FOLLOWING PHONE STAYS CURRENT: the page is drawn again every twenty
 * seconds while it is on screen, and at once when the phone comes back to it.
 * `router.refresh` keeps the page's own state; nothing here is a second source
 * of the card.
 */
export function useFollowRefresh(on: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!on) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = setInterval(tick, FOLLOW_EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [on, router]);
}

/**
 * The holes this phone had not sent, forgotten — once the card is kept on
 * another phone they can never be sent, and a copy left behind would be sent
 * the day this phone took the card back, over the scores entered since.
 */
export function forgetUnsent(stageId: string, keys: readonly string[]): void {
  for (const k of keys) {
    try {
      window.localStorage.removeItem(pendingKey(stageId, k));
    } catch {
      /* blocked storage holds nothing to forget */
    }
  }
}

/**
 * THE LINE ABOVE THE CARD: who keeps it, and the one press each phone has.
 *
 *   keeper     "You're keeping score for Group 3."   Hand over …
 *   follower   "Group 3 is being kept on Ann's phone."   Take over the card
 *   open       "Nobody is keeping Group 3's card yet."   Keep score for the group
 */
export function KeepingBar({
  view,
  role,
  refusedBy,
  boardHref,
  onKept,
}: {
  view: GroupKeepingView;
  role: KeepingRole;
  /** Set when this phone's save was just refused because the card moved. */
  refusedBy: string | null;
  boardHref?: string;
  /** This phone keeps the card now, at this epoch. */
  onKept: (epoch: number) => void;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState<null | "take" | { to: string; name: string }>(null);
  const [handing, setHanding] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const keeperName = refusedBy ?? view.keeperName;
  const others = view.members.filter((m) => m.id !== view.me);

  const take = (takeOver: boolean) =>
    startTransition(async () => {
      setError("");
      const res = await keepGroup({ takeOver });
      if (!res.ok || res.epoch === undefined) {
        // Refused in words, never silently: the server's own sentence.
        setError(res.error ?? "Couldn't take over the card.");
        if (res.keeperName) router.refresh();
        return;
      }
      setAsking(null);
      onKept(res.epoch);
      router.refresh();
    });

  const handTo = (to: string) =>
    startTransition(async () => {
      setError("");
      const res = await handOverGroup(to);
      if (!res.ok) {
        setError(res.error ?? "Couldn't hand the card over.");
        return;
      }
      setAsking(null);
      setHanding(false);
      router.refresh();
    });

  return (
    <section
      aria-label="Who keeps the card"
      className="card elev-sm"
      data-keeping={role}
      style={{ gap: 8, marginBottom: 12, borderLeft: "4px solid var(--color-accent)" }}
    >
      {role === "keeper" && (
        <>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            <Icon name="users-three" /> {youKeepSentence(view.title)}
          </p>
          <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            Enter everyone&rsquo;s scores here. The others can follow the card on their phones.
          </p>
          {others.length > 0 && !handing && asking === null && (
            <button type="button" className="btn btn-secondary" style={{ minHeight: 44, alignSelf: "flex-start" }} onClick={() => setHanding(true)}>
              Hand the card to someone else
            </button>
          )}
          {handing && asking === null && (
            <div role="group" aria-label="Hand the card to" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {others.map((m) => (
                <button key={m.id} type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => setAsking({ to: m.id, name: m.name })}>
                  {m.name}
                </button>
              ))}
              <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setHanding(false)}>
                Cancel
              </button>
            </div>
          )}
          {asking !== null && asking !== "take" && (
            <div role="group" aria-label="Hand over the card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 15 }}>{handOverQuestion(asking.name)}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={() => handTo(asking.to)}>
                  {pending ? "Handing over…" : `Yes, hand it to ${asking.name.split(" ")[0]}`}
                </button>
                <button type="button" className="btn btn-secondary" style={{ minHeight: 48 }} disabled={pending} onClick={() => setAsking(null)}>
                  No, keep it
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {role === "follower" && (
        <>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }} role="status">
            <Icon name="users-three" /> {keptOnSentence(view.title, keeperName)}
          </p>
          <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            {refusedBy !== null ? refusedSentence(keeperName) : FOLLOWING_DETAIL}
          </p>
          {asking === "take" ? (
            <div role="group" aria-label="Take over the card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ margin: 0, fontSize: 15 }}>{takeOverQuestion(keeperName)}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={() => take(true)}>
                  {pending ? "Taking over…" : "Yes, take over"}
                </button>
                <button type="button" className="btn btn-secondary" style={{ minHeight: 48 }} disabled={pending} onClick={() => setAsking(null)}>
                  No, keep following
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} onClick={() => setAsking("take")}>
                Take over the card
              </button>
              {boardHref && (
                <a href={boardHref} className="btn" style={{ minHeight: 44 }}>
                  <Icon name="ranking" /> Leaderboard
                </a>
              )}
            </div>
          )}
        </>
      )}

      {role === "open" && (
        <>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            <Icon name="users-three" /> {nobodyKeepsSentence(view.title)}
          </p>
          <button type="button" className="btn btn-primary" style={{ minHeight: 48, alignSelf: "flex-start" }} disabled={pending} onClick={() => take(false)}>
            {pending ? "One moment…" : "Keep score for the group"}
          </button>
        </>
      )}

      {error && (
        <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}

/**
 * THE GROUP'S STROKE CARDS, READ-ONLY — what a following phone sees. One row a
 * player, a column a hole, the total and how far they have got. Wide, so it
 * scrolls inside its own box (`overflow-x: auto`), never the page.
 */
export function GroupCardFollow({
  view,
  holes,
  firstHole = 1,
  pars,
}: {
  view: GroupKeepingView;
  holes: number;
  firstHole?: number;
  pars: number[];
}) {
  const cards = view.cards ?? {};
  const cols = Array.from({ length: holes }, (_, i) => i);
  return (
    <section aria-label="The group's card" className="card elev-sm" style={{ gap: 8 }}>
      <span className="card-title">The group&rsquo;s card</span>
      <div style={{ overflowX: "auto", minWidth: 0 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left", padding: "4px 8px" }}>Hole</th>
              {cols.map((i) => (
                <th key={i} scope="col" style={{ padding: "4px 6px", minWidth: 24 }}>{holeNumber(i, firstHole)}</th>
              ))}
              <th scope="col" style={{ padding: "4px 8px" }}>Total</th>
            </tr>
            {pars.length > 0 && (
              <tr className="text-muted">
                <th scope="row" style={{ textAlign: "left", padding: "2px 8px", fontWeight: 400 }}>Par</th>
                {cols.map((i) => (
                  <td key={i} style={{ padding: "2px 6px", textAlign: "center" }}>{pars[i] ?? ""}</td>
                ))}
                <td />
              </tr>
            )}
          </thead>
          <tbody>
            {view.members.map((m) => {
              const card = cards[m.id] ?? [];
              const played = card.filter((v) => typeof v === "number" && v > 0);
              return (
                <tr key={m.id} data-player={m.id}>
                  <th scope="row" style={{ textAlign: "left", padding: "4px 8px", whiteSpace: "nowrap" }}>{m.name}</th>
                  {cols.map((i) => (
                    <td key={i} style={{ padding: "4px 6px", textAlign: "center" }}>{card[i] ?? "·"}</td>
                  ))}
                  <td style={{ padding: "4px 8px", textAlign: "center", fontWeight: 600 }}>
                    {played.length ? played.reduce<number>((sum, v) => sum + (v ?? 0), 0) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Updates on its own as the scores go in.</p>
    </section>
  );
}

/** THE MATCH, READ-ONLY — who won each hole and how it stands, named as drawn. */
export function MatchFollow({ match, holes, firstHole = 1 }: { match: KeptMatch; holes: number; firstHole?: number }) {
  const cells: HoleResult[] = Array.from({ length: holes }, (_, i) => match.holes?.[i] ?? null);
  const [aLabel, bLabel] = matchSideLabels(match);
  const [aMark, bMark] = sideMarks(aLabel, bLabel);
  const standing = matchStandingText(resolveMatch(cells), aLabel, bLabel);
  return (
    <section aria-label="The match" className="card elev-sm" style={{ gap: 8 }}>
      <span className="card-title">
        {match.aName} v {match.bName}
      </span>
      <p role="status" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{standing}</p>
      <div style={{ overflowX: "auto", minWidth: 0 }}>
        <ol aria-label="Who won each hole" style={{ display: "flex", gap: 4, listStyle: "none", margin: 0, padding: 0 }}>
          {cells.map((h, i) => (
            <li
              key={i}
              aria-label={`Hole ${holeNumber(i, firstHole)}: ${h === "A" ? `${aLabel} won` : h === "B" ? `${bLabel} won` : h === "H" ? "halved" : "not played"}`}
              style={{
                minWidth: 30,
                padding: "4px 2px",
                textAlign: "center",
                fontSize: 13,
                border: "1px solid var(--color-divider)",
                borderRadius: 6,
              }}
            >
              <span className="text-muted" style={{ display: "block" }}>{holeNumber(i, firstHole)}</span>
              <b>{h === "A" ? aMark : h === "B" ? bMark : h === "H" ? "½" : "·"}</b>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>Updates on its own as the scores go in.</p>
    </section>
  );
}

/** The end-of-round check's state for this phone, as the page drew it. */
export type EndCheckView =
  | {
      kind: "match";
      matchId: string;
      /** The match is decided (`matchIsOver`) — there is a result to check. */
      over: boolean;
      status: "pending" | "confirmed" | "disputed";
      /** This phone's player entered the result: they wait for the other side. */
      author: boolean;
      /** This phone's player is in the match at all. */
      inMatch: boolean;
      /** The other side agreed; the committee still approves. */
      agreed: boolean;
    }
  | {
      kind: "card";
      /** Every hole of this player's own card is in. */
      complete: boolean;
      status: string;
      /** The round's end-of-round check is on, so the card may be disputed as well as confirmed. */
      disputable: boolean;
    };

/**
 * THE END-OF-ROUND CHECK, on a round whose `endCheck` is on.
 *
 * Match play: the other side confirms the result (`confirmPlayMatch`) or says
 * it is not right (`disputePlayMatch`). Stroke play: each player confirms
 * their OWN card (`certifyPlayCard`, Rule 3.3b) or disputes it
 * (`disputePlayCard`). A disagreement goes to the committee and is held off
 * the board until they settle it (`heldFromBoard`) — said here, where it
 * happened.
 */
export function EndCheckPanel({ check }: { check: EndCheckView }) {
  // The one way a press reports its refusal (`useAction`): always in words, and the page redrawn after.
  const { run: act, pending, error } = useAction({ refresh: true });
  const [asking, setAsking] = useState(false);
  const [status, setStatus] = useState<string>(check.status);
  const [agreed, setAgreed] = useState(check.kind === "match" ? check.agreed : false);

  /** Confirm or dispute; on yes, the panel says what is true now. */
  const run = (press: () => Promise<{ ok: boolean; error?: string; status?: string; agreed?: boolean }>, next: string) =>
    act(async () => {
      const res = await press();
      if (res.ok) {
        setAsking(false);
        setStatus(res.status ?? next);
        if (res.agreed) setAgreed(true);
      }
      return res;
    });

  const disputed = (
    <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }} data-check="disputed">
      <Icon name="warning-circle" /> Disputed. It&rsquo;s held off the leaderboard until the committee settles it.
    </p>
  );

  if (check.kind === "match") {
    if (!check.over) return null;
    return (
      <section aria-label="Check the result" className="card elev-sm" style={{ gap: 8, marginTop: 12 }}>
        <span className="card-title">Check the result</span>
        {status === "disputed" ? (
          disputed
        ) : status === "confirmed" ? (
          <p role="status" style={{ margin: 0, fontSize: 14 }} data-check="confirmed">
            <Icon name="check" /> Both sides agree. The result is confirmed.
          </p>
        ) : agreed ? (
          <p role="status" style={{ margin: 0, fontSize: 14 }} data-check="agreed">
            <Icon name="check" /> Both sides agree. The committee approves it next.
          </p>
        ) : check.author ? (
          <p className="text-muted" role="status" style={{ margin: 0, fontSize: 14 }} data-check="waiting">
            You entered this result, so the other side confirms it.
          </p>
        ) : !check.inMatch ? (
          <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>The players in the match confirm the result.</p>
        ) : asking ? (
          <div role="group" aria-label="Dispute the result" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 15 }}>Tell the committee this result isn&rsquo;t right? It stays off the leaderboard until they settle it.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={() => run(() => disputePlayMatch(check.matchId), "disputed")}>
                Yes, it&rsquo;s not right
              </button>
              <button type="button" className="btn btn-secondary" style={{ minHeight: 48 }} disabled={pending} onClick={() => setAsking(false)}>
                Go back
              </button>
            </div>
          </div>
        ) : (
          <>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>Is this the result you agree on?</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={() => run(() => confirmPlayMatch(check.matchId), "confirmed")}>
                <Icon name="check" /> Confirm the result
              </button>
              <button type="button" className="btn btn-secondary" style={{ minHeight: 48 }} disabled={pending} onClick={() => setAsking(true)}>
                That&rsquo;s not right
              </button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
            <Icon name="warning-circle" /> {error}
          </p>
        )}
      </section>
    );
  }

  // A stroke card: this player's own, entered by whoever kept the group.
  if (!check.complete && status !== "disputed") return null;
  const signed = status === "certified" || status === "approved";
  return (
    <section aria-label="Check your card" className="card elev-sm" style={{ gap: 8, marginTop: 12 }}>
      <span className="card-title">Check your card</span>
      {status === "disputed" ? (
        disputed
      ) : signed ? (
        <p role="status" style={{ margin: 0, fontSize: 14 }} data-check="confirmed">
          <Icon name="check" /> You&rsquo;ve confirmed your card.
        </p>
      ) : asking ? (
        <div role="group" aria-label="Dispute your card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 15 }}>Tell the committee something on your card is wrong? It stays off the leaderboard until they settle it.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={() => run(() => disputePlayCard(), "disputed")}>
              Yes, something&rsquo;s wrong
            </button>
            <button type="button" className="btn btn-secondary" style={{ minHeight: 48 }} disabled={pending} onClick={() => setAsking(false)}>
              Go back
            </button>
          </div>
        </div>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>Check your scores on the group&rsquo;s card, then confirm them.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={() => run(() => certifyPlayCard(), "certified")}>
              <Icon name="check" /> Confirm my card
            </button>
            {check.disputable && (
              <button type="button" className="btn btn-secondary" style={{ minHeight: 48 }} disabled={pending} onClick={() => setAsking(true)}>
                Something&rsquo;s wrong
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}
