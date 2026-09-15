"use client";
import { useState, useTransition } from "react";
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
import { Icon } from "./Icon";

export interface LifecycleSummary {
  name: string;
  dates: string;
  course: string;
  format: string;
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
}: {
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
}) {
  const [confirming, setConfirming] = useState(false);
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
          <span className={`tag ${meta.tag}`} style={{ fontSize: 12 }}>
            {status === "live" && <Icon name="circle" weight="fill" style={{ fontSize: 7, marginRight: 5 }} />}
            {meta.label}
          </span>
          {/* The observed state, beside the stored one rather than instead of
              it. "Draft" is a true fact about a column the organizer owns;
              "Being played" is a true fact about the golf. Printing only the
              first is what made this screen read as nonsense, and printing
              only the second would be this file correcting a status it has
              said all along it must only report. See LifecycleWarning.chip. */}
          {mismatch && (
            <span className="tag tag-accent" style={{ fontSize: 12 }}>
              <Icon name="golf" style={{ marginRight: 5 }} />
              {mismatch.chip}
            </span>
          )}
          {locked && (
            <span className="text-muted" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="lock-simple" /> Configuration locked
            </span>
          )}
          <div style={{ flex: 1 }} />
          {isAdmin && action && (
            <button
              type="button"
              className="btn btn-primary"
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
                startTransition(async () => {
                  const res = await setEventStatus(to);
                  if (res && !res.ok) setRefused(res.error ?? "That could not be done.");
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
          <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
            <span style={{ fontWeight: 600 }}>{mismatch.title}.</span> {mismatch.detail}
          </p>
        )}
        {isAdmin && isLaunched(status) && (
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
          <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
            {refused || blockedReason}
          </p>
        </div>
      )}

      {/* The second Launch button lived here, in a card of its own, and it is
          gone deliberately rather than merely moved. `nextLifecycleAction`
          returns Launch for exactly the tournaments this banner used to fire
          on, so the button in the card above IS this button — offering it
          twice was the duplication, not the placement. */}

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
                  ["Format", summary.format === "stroke" ? "Stroke play" : "Match play"],
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
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await launchTournament();
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
