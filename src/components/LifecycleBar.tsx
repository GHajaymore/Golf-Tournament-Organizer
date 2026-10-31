"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { setEventStatus, launchTournament, setConfigUnlocked } from "@/app/actions/tournament";
import { STATUS_META } from "@/lib/format";
import {
  lifecycleMismatch,
  nextLifecycleAction,
  configurationLocked,
  isLaunched,
  LAUNCH_DOES,
  VISIBILITY_IS_ELSEWHERE,
} from "@/lib/domain/lifecycle-state";
import { WIPE_ON_CLOSE, LIFESPAN_DAYS, KEPT_AFTER_COMPLETE_DAYS } from "@/lib/domain/close-terms";
import { warningText, launchRows, type LaunchCheck } from "@/lib/domain/launch-check";
import { Icon } from "./Icon";
import { MoreInfo } from "./MoreInfo";

export interface LifecycleSummary {
  name: string;
  dates: string;
  course: string;
  format: string;
  /** The overall result in words — `overallResultLabel`, e.g. "Stableford points". */
  overall: string;
  players: number;
  flights: number;
  rounds: number;
}

export function LifecycleBar({
  status,
  isAdmin,
  configUnlocked,
  summary,
  resultsIn = 0,
  blockedReason,
  unplayedAsk,
  launchOpen,
  deletesOnComplete = false,
  keepOffer,
  closesOn,
  archived = false,
}: {
  /** In a lapsed club's read-only archive (`archiveRefusalFor`): Unlock is not offered. */
  archived?: boolean;
  /**
   * The upgrade that would keep it — "Birdie keeps every tournament for good —
   * $49 a month." — asked BEFORE anything is deleted, on the card from the
   * start and first in the dialog (Ajay, 2026-09-29). The rule does not change;
   * the club is told how to keep its results while it still can.
   */
  keepOffer?: string;
  /**
   * The day it closes on its own, once the daily sweep has seen its golf begin
   * (`closesAt`, never moved). Undefined before then, when the rule is stated
   * instead of a date.
   */
  closesOn?: string;
  /**
   * Completing this tournament starts the fifteen days after which it is deleted — the Free plan's terms for a club
   * created on them (`wipesOnCloseFor`). The button then asks first, with the
   * way to Reports in front of the organizer.
   */
  deletesOnComplete?: boolean;
  status: string;
  isAdmin: boolean;
  configUnlocked: boolean;
  summary: LifecycleSummary;
  /**
   * Results recorded so far, so the status can be checked against reality.
   *
   * Every round and both sources — `state.resultsIn`, not `matchProgress`,
   * which counts the active stage's matches alone and so left a stroke-play
   * tournament played entirely in draft with no warning at all.
   */
  resultsIn?: number;
  /**
   * Why the next phase cannot be entered yet, or undefined when it can.
   *
   * Computed on the server from `phase-gate.ts`, so the button and the action
   * refuse for the same reason in the same words. The action refuses anyway —
   * a disabled button stops nobody, and a `"use server"` export is a public
   * HTTP endpoint — but an organizer should not have to press a thing to find
   * out it will not work.
   */
  blockedReason?: string;
  /**
   * The question completing must ask first, when some rounds have no scores (`completingCheckFor`,
   * the action's own check). Asked before the free plan's notice — one topic per dialog — and the
   * server asks it too, for a page that has sat open while a round's cards went in or came out.
   */
  unplayedAsk?: string;
  /**
   * What setup still has open that does not stop a launch — no tee sheet, no
   * money answer, no flights (`launchCheck`, the setup flow's own steps). Said
   * in the launch dialog, plain text, before the organizer presses (gap G3,
   * 2026-10-31). Refusals disable the button instead; these never do.
   */
  launchOpen?: Pick<LaunchCheck, "warnings" | "stepsOpen" | "steps">;
}) {
  const [confirming, setConfirming] = useState(false);
  /** What the server said when it refused a launch — shown in the dialog. */
  const [launchRefused, setLaunchRefused] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /**
   * COMPLETING AND REOPENING ARE CONFIRMED (2026-10-10). Completing publishes
   * the result as final and closes every open round; it took one click, and
   * nothing on screen undid it. Every club system asks before it finalizes, and
   * lets the committee reopen to correct a card — so both ask here, and the
   * completed tournament offers its Reopen.
   */
  const [confirmingStatus, setConfirmingStatus] = useState<"completed" | "live" | null>(null);
  /** The unplayed-rounds question while it is open, and whether it has been answered "Complete anyway". */
  const [askingUnplayed, setAskingUnplayed] = useState("");
  const [unplayedConfirmed, setUnplayedConfirmed] = useState(false);
  const [pending, startTransition] = useTransition();
  /**
   * What the server said when it refused.
   *
   * Kept even though the button is disabled ahead of time: the two are
   * computed from separate reads a moment apart, so a card submitted while the
   * page sat open is exactly the case where the button is live and the answer
   * is still no. Silence there would read as a click that did nothing.
   */
  const [refused, setRefused] = useState("");
  /** What the server answered, whichever dialog pressed: its question, the free plan's, or a refusal. */
  const answered = (res: Awaited<ReturnType<typeof setEventStatus>> | undefined) => {
    if (res?.needsUnplayedConfirm) {
      setUnplayedConfirmed(false);
      setAskingUnplayed(res.error ?? "");
    } else if (res?.needsDeleteConfirm) setConfirmingDelete(true);
    else if (res && !res.ok) setRefused(res.error ?? "That could not be done.");
  };
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  // The same answer the server gives — `configurationLocked` is what
  // `isSetupLocked` and `assertUnlocked` both call. This component could not
  // reach the old copy: it lived in a `server-only` module.
  const locked = configurationLocked({ status, configUnlocked });
  const mismatch = lifecycleMismatch({ status, resultsIn, playersEntered: summary.players });

  /**
   * The one next step, decided in `domain/lifecycle-state.ts`.
   *
   * It was a ladder of `if`s here, and being local is what let it be wrong:
   * on a draft tournament with results in it, it offered "Start taking
   * entries" while the warning underneath offered "Launch tournament", so the
   * card and the banner disagreed about the next step in the space of two
   * inches. One function answers it now, and the dashboard reads the same one
   * to decide whether its own header still deserves a primary button.
   */
  const action = nextLifecycleAction({ status, resultsIn });

  return (
    <>
      {/**
       * ONE CARD FOR THE LIFECYCLE, because it used to be two that argued.
       *
       * The status card said "Draft" with a primary button offering to take
       * entries, and a separate warning card directly beneath it said 47
       * results were in with its own primary button offering to launch. Two
       * cards, two primary buttons, one subject — and the screen stating a
       * fact in the first and apologising for it in the second.
       *
       * They are one card now: the state, what disagrees with it, and the
       * single thing to do about it.
       */}
      <div
        className="card elev-sm"
        style={{
          gap: 8,
          marginBottom: 16,
          // The accent edge is the warning's, kept only while there IS one, so
          // an ordinary tournament's status card stays quiet furniture.
          borderLeft: mismatch ? "3px solid var(--color-accent)" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span className="card-kicker">Tournament status</span>
          <span className={`tag ${meta.tag}`} style={{ fontSize: 13 }}>
            {status === "live" && <Icon name="circle" weight="fill" style={{ fontSize: 13, marginRight: 5 }} />}
            {meta.label}
          </span>
          {/* The observed state, beside the stored one rather than instead of
              it. "Draft" is a true fact about a column the organizer owns;
              "Being played" is a true fact about the golf. Printing only the
              first is what made this screen read as nonsense, and printing
              only the second would be this file correcting a status it has
              said all along it must only report. See LifecycleWarning.chip. */}
          {mismatch && (
            <span className="tag tag-accent" style={{ fontSize: 13 }}>
              <Icon name="golf" style={{ marginRight: 5 }} />
              {mismatch.chip}
            </span>
          )}
          {locked && (
            <span className="text-muted" style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="lock-simple" /> Configuration locked
            </span>
          )}
          <div style={{ flex: 1 }} />
          {isAdmin && action && (
            <button
              type="button"
              className={action.to === "live" ? "btn btn-secondary" : "btn btn-primary"}
              disabled={pending || !!blockedReason}
              // The reason travels with the control, so a disabled button is
              // never a dead end somebody has to guess at.
              title={blockedReason}
              onClick={() => {
                setRefused("");
                if (action.kind === "launch") {
                  setConfirming(true);
                  return;
                }
                const to = action.to;
                if (!to) return;
                if (to === "completed" && unplayedAsk) {
                  setUnplayedConfirmed(false);
                  setAskingUnplayed(unplayedAsk);
                  return;
                }
                if (to === "completed" && deletesOnComplete) {
                  setConfirmingDelete(true);
                  return;
                }
                if (to === "completed" || (to === "live" && status === "completed")) {
                  setConfirmingStatus(to);
                  return;
                }
                startTransition(async () => {
                  // The server asks too — it is the one that knows for certain.
                  answered(await setEventStatus(to));
                });
              }}
            >
              {action.kind === "launch" && <Icon name="rocket-launch" />} {action.label}
            </button>
          )}
        </div>

        {/* The disagreement, in the card that shows the status it disagrees
            with. One idea and one sentence: what launching DOES is on the
            dialog that launching opens, which is where somebody deciding
            whether to press it is actually standing. */}
        {mismatch && (
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600 }}>{mismatch.title}.</span> {mismatch.detail}
          </p>
        )}
        {/* THE ALERT, from the start rather than at the last click: the free
            plan deletes this tournament when it is completed, and the time to
            decide to keep it is before then. */}
        {deletesOnComplete && status !== "completed" && (
          <p role="note" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            <Icon name="warning-circle" style={{ color: "var(--color-danger)" }} />{" "}
            <span style={{ fontWeight: 600 }}>
              Once completed, this tournament is kept read-only for {KEPT_AFTER_COMPLETE_DAYS} days, then deleted.
            </span>{" "}
            {closesOn
              ? `If nobody completes it, it closes on ${closesOn} and is deleted then.`
              : `If nobody completes it, it closes ${LIFESPAN_DAYS} days after its first round is played.`}{" "}
            {keepOffer}{" "}
            <Link href="/organization#plan">Upgrade to keep it</Link>
          </p>
        )}
        {/* AND AFTER: completed on the free plan, it is read-only until the
            day it goes (2026-10-21) — said here, where the organizer lands,
            with the two ways to keep it. */}
        {deletesOnComplete && status === "completed" && (
          <p role="note" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            <Icon name="warning-circle" style={{ color: "var(--color-danger)" }} />{" "}
            <span style={{ fontWeight: 600 }}>
              {closesOn ? `Completed. Kept read-only until ${closesOn}, then deleted.` : "Completed. Kept read-only for now, then deleted."}
            </span>{" "}
            Save the <Link href="/reports/final">final report</Link> to keep a copy. {keepOffer}{" "}
            <Link href="/organization#plan">Upgrade to keep it</Link>
          </p>
        )}
        {/* Not offered on a lapsed club's read-only archive: there is nothing
            to unlock it FOR, and the banner above every screen says why. */}
        {isAdmin && isLaunched(status) && !archived && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={pending}
            onClick={() => startTransition(() => setConfigUnlocked(!configUnlocked))}
          >
            <Icon name={configUnlocked ? "ph ph-lock-simple" : "ph ph-lock-simple-open"} />{" "}
            {configUnlocked ? "Lock configuration" : "Unlock configuration"}
          </button>
        )}
      </div>

      {/**
       * WHY THE NEXT STEP IS NOT AVAILABLE, said in full and in place.
       *
       * A greyed-out button with no explanation is the worst of both: it stops
       * the organizer and tells them nothing, so they go looking for a bug.
       * Both messages name the screen that fixes it, because a refusal that
       * does not say what to do next makes the app the obstacle.
       *
       * `refused` takes precedence: if the server said no, that is the newer
       * and more specific answer.
       */}
      {isAdmin && (refused || blockedReason) && (
        <div
          className="card elev-sm"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--color-accent)", gap: 6 }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name="warning-circle" /> Not yet — {action?.label.toLowerCase()}
          </span>
          {/* Its first sentence, the rest an ⓘ away (2026-10-05). The words
              are the server's own refusal, unchanged — only folded, so the
              dashboard's "Needs you now" and this card do not both spell out
              the same dispute in full. */}
          {(() => {
            const reason = refused || blockedReason || "";
            const cut = reason.indexOf(". ");
            return cut < 0 ? (
              <p className="text-muted" style={{ fontSize: 14, margin: 0, lineHeight: 1.55 }}>
                {reason}
              </p>
            ) : (
              <MoreInfo short={reason.slice(0, cut + 1)}>{reason}</MoreInfo>
            );
          })()}
        </div>
      )}

      {/* The second Launch button lived here, in a card of its own, and it is
          gone deliberately rather than merely moved. `nextLifecycleAction`
          returns Launch for exactly the tournaments this banner used to fire
          on, so the button in the card above IS this button — offering it
          twice was the duplication, not the placement. */}

      {/* ROUNDS NOBODY HAS PLAYED, asked before anything else (2026-10-31). Completing closes
          them as not played; a committee may mean that — weather, a short day — so it is asked,
          in the panel's words, and never done on the way past. Answering it IS the confirmation
          on a paid plan; on the free plan the keeping question follows, one topic per dialog. */}
      {askingUnplayed && (
        <div className="dialog-backdrop" onClick={() => setAskingUnplayed("")}>
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="complete-unplayed-title"
            aria-describedby="complete-unplayed-body"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-title" id="complete-unplayed-title">Complete “{summary.name}”?</div>
            <div className="dialog-body" id="complete-unplayed-body">
              {askingUnplayed}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setAskingUnplayed("")}>Keep playing</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => {
                  setAskingUnplayed("");
                  setUnplayedConfirmed(true);
                  if (deletesOnComplete) {
                    setConfirmingDelete(true);
                    return;
                  }
                  startTransition(async () => answered(await setEventStatus("completed", false, true)));
                }}
              >
                Complete anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingDelete && (
        <div className="dialog-backdrop" onClick={() => setConfirmingDelete(false)}>
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="complete-delete-title"
            aria-describedby="complete-delete-body"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-title" id="complete-delete-title">Complete “{summary.name}”?</div>
            <div className="dialog-body" id="complete-delete-body">
              {/* The upgrade FIRST, before the terms and the delete button —
                  asked before anything goes, never after. */}
              {keepOffer && (
                <div
                  style={{
                    padding: "10px 12px",
                    marginBottom: 10,
                    borderRadius: "var(--radius-md)",
                    background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>Want to keep it?</span> {keepOffer}{" "}
                  <Link href="/organization#plan">Upgrade to keep it</Link>
                </div>
              )}
              {WIPE_ON_CLOSE}
            </div>
            <div className="dialog-actions">
              {/* Completing starts the fifteen days after which it is deleted
                  (Ajay, 2026-10-21), so the report is offered here to keep —
                  to print, or save as a PDF (2026-10-19). */}
              <Link className="btn btn-secondary" href="/reports/final">
                <Icon name="trophy" /> Open the final report
              </Link>
              <Link className="btn btn-secondary" href="/reports">
                <Icon name="download-simple" /> Go to Reports
              </Link>
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmingDelete(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    // Completes it and starts its fifteen days, read-only; a
                    // refusal (a disputed card) comes back here.
                    const res = await setEventStatus("completed", true, unplayedConfirmed);
                    setConfirmingDelete(false);
                    answered(res);
                  })
                }
              >
                <Icon name="check-circle" /> Complete it
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingStatus && (
        <div className="dialog-backdrop" onClick={() => setConfirmingStatus(null)}>
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="status-dialog-title"
            aria-describedby="status-dialog-body"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-title" id="status-dialog-title">
              {confirmingStatus === "completed" ? `Complete “${summary.name}”?` : `Reopen “${summary.name}”?`}
            </div>
            <div className="dialog-body" id="status-dialog-body">
              {confirmingStatus === "completed"
                ? "The result becomes final: every round still open is closed, and the boards read Final. You can reopen it from here to correct a card."
                : "The boards stop reading Final. Rounds stay closed — re-open one on Rounds & formats to change its cards — and you can complete the tournament again afterwards."}
            </div>
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmingStatus(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => {
                  const to = confirmingStatus;
                  startTransition(async () => {
                    const res = await setEventStatus(to);
                    setConfirmingStatus(null);
                    answered(res);
                  });
                }}
              >
                {confirmingStatus === "completed" ? "Complete tournament" : "Reopen tournament"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirming && (
        <div className="dialog-backdrop" onClick={() => setConfirming(false)}>
          {/* ANNOUNCED AS A DIALOG, WHICH IT WAS NOT — see PlayerSignOut for
              the sweep that found it. A backdrop and a centred box with no
              `role` and no `aria-modal` is a modal to everybody except the
              people who most need to be told one has opened, and this is the
              dialog that launches a tournament. Labelled by its own title so
              the announcement carries the tournament's name. */}
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="launch-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-title" id="launch-dialog-title">Launch “{summary.name}”?</div>
            {/* WHAT SETUP STILL HAS OPEN (gap G3, 2026-10-31), first, and in a block
                of its own rather than inside `.dialog-body`: that one is dimmed, and
                these have to read in sunlight. At most three rows; a fourth and on
                is counted on the third. */}
            {launchOpen && launchOpen.warnings.length > 0 && (
              <section
                className="launch-warnings"
                aria-label="Still open"
                style={{ margin: "0 0 12px", padding: "10px 12px", fontSize: 13, lineHeight: 1.55, color: "var(--color-text)", background: "var(--color-surface-2)", border: "1px solid var(--color-divider)", borderRadius: 8 }}
              >
                <b>
                  {launchOpen.stepsOpen > 0
                    ? `${launchOpen.stepsOpen} of ${launchOpen.steps} setup steps still open — you can launch without ${launchOpen.stepsOpen === 1 ? "it" : "them"}.`
                    : "Setup is done — one thing you may still want."}
                </b>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {launchRows(launchOpen.warnings).rows.map((w) => (
                    <li key={w.says} title={warningText(w)}>
                      {w.says} <Link href={w.href}>{w.fix}</Link>
                      {w.afterLaunch === "unlock" ? " — after launch, this needs Unlock first." : " — you can still do this after launch."}
                    </li>
                  ))}
                  {launchRows(launchOpen.warnings).alsoOpen.length > 0 && (
                    <li className="launch-also-open">
                      Also open:{" "}
                      {launchRows(launchOpen.warnings).alsoOpen.map((w, i) => (
                        <span key={w.href}>
                          {i > 0 && " · "}
                          <Link href={w.href} title={warningText(w)}>{w.screen}</Link>
                        </span>
                      ))}
                    </li>
                  )}
                </ul>
              </section>
            )}
            <div className="dialog-body">
              {/**
               * THE THIRD COPY OF A CLAIM THAT WAS MEASURED FALSE, and the one
               * nobody swept for.
               *
               * This read: "Once launched, registered participants receive
               * Player access and can view their schedule, matches,
               * scorecards, leaderboard and tournament information."
               *
               * `lifecycle-state.ts` records the measurement that killed that
               * sentence on two other screens — 2026-09-11, signed in as a
               * player on a tournament whose status was `draft`: `/me`
               * rendered, `/me/board` rendered the standings, `/me/card`
               * rendered a full scorecard offering "Certify my card". What a
               * player may see is decided by `canSeeLeaderboard`, which reads
               * `leaderboardVisibility` and nothing else.
               *
               * The sweep that fixed the other two listed the two files it
               * knew about, so this survived in the one place the claim
               * actually costs something — the dialog an organizer reads while
               * deciding to press the button. Sweep the class, not the
               * instance; the test now sweeps this file too.
               *
               * The role grant IS real and is kept: `launchTournament` runs an
               * `account.updateMany` setting every non-staff account to
               * `player`. What was false is the implication that viewing waits
               * on it.
               */}
              Every non-staff account gets the Player role. {LAUNCH_DOES}{" "}
              {VISIBILITY_IS_ELSEWHERE}
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {[
                  ["Dates", summary.dates || "—"],
                  ["Course", summary.course || "—"],
                  /**
                   * "Overall result", not "Format", and this is the row where
                   * the old word did the most damage: it sat two lines above
                   * "Rounds", so a tournament with eleven of them read
                   * "Format: Stroke play / Rounds: 11" — one coarse word
                   * contradicting the count directly beneath it.
                   *
                   * Same name as the control on Tournament details that sets
                   * it, so there is one name for one thing.
                   */
                  ["Overall result", summary.overall],
                  ["Registered players", String(summary.players)],
                  ["Flights", String(summary.flights)],
                  ["Rounds", String(summary.rounds)],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, borderBottom: "1px solid var(--color-divider)", paddingBottom: 4 }}>
                    <span className="text-muted">{k}</span>
                    <span style={{ fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* THE REFUSAL, WHERE THE PRESS WAS (2026-10-16). The dialog awaited
                `launchTournament` and closed whatever it answered, so a launch
                the server refused — a date missing, a round that cannot be
                scored — closed the dialog and changed nothing, in silence. */}
            {launchRefused && (
              <p role="alert" style={{ fontSize: 13, margin: "0 0 10px", lineHeight: 1.55, color: "var(--color-danger)" }}>
                <Icon name="warning-circle" /> Not launched. {launchRefused}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => { setLaunchRefused(""); setConfirming(false); }}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setLaunchRefused("");
                    const res = await launchTournament();
                    if (res && !res.ok) {
                      setLaunchRefused(res.error ?? "The tournament could not be launched.");
                      return;
                    }
                    setConfirming(false);
                  })
                }
              >
                <Icon name="rocket-launch" /> Launch tournament
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
