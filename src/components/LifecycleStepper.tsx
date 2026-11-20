"use client";

import Link from "next/link";
import { useId } from "react";
import { usePathname } from "next/navigation";
import "./lifecycle-stepper.css";
import { Icon } from "./Icon";
import {
  STATE_WORD,
  keepPreview,
  stepperOpenOn,
  trackCount,
  type LifecycleTrack,
  type TrackPhase,
  type TrackState,
  type TrackStep,
} from "@/lib/domain/lifecycle-track";

/**
 * THE LIFECYCLE STEPPER (backlog B03; the panel's ruling, 9 Nov): the "Setting
 * up n of 5" rail grown to the whole tournament — Set up · Tee times · Play ·
 * Results — drawn from `lifecycleTrack(status, tournamentJob(...))` and nothing
 * else, under the tournament bar on every console screen.
 *
 *   OPEN on the dashboard always, and on Tournament details while setting up:
 *   the track (a list, the current stop `aria-current="step"`, every state said
 *   in words), "Set up · 4 of 5 done", the current stop's reason, and "Every
 *   step" with each stop's reason. Off the dashboard, a finished phase is one
 *   tick.
 *
 *   FOLDED everywhere else to one line: "Round 1 · 18 of 24 cards in ›".
 *
 * THE ONE BUTTON is the dashboard's (`tournamentJob`, which its status card
 * presses). Here it is never a filled button: off the dashboard a quiet link,
 * on the screen where the job is done nothing at all, and refused it is a real
 * disabled button with the machine's refusal, word for word, beside it
 * (`aria-describedby`) and its way out.
 *
 * A CLIENT component for one reason: the console's LAYOUT draws it, and a
 * layout is not drawn again as an organizer moves between its screens — so the
 * screen it sits on is read here (`usePathname`). The track itself is the
 * server's. While it is shown, the rail and the journey card it replaces stand
 * aside (`lifecycle-stepper.css`): never a second rail beside the first.
 */
export function LifecycleStepper({
  track,
  here: told,
  preview = false,
}: {
  track: LifecycleTrack | null;
  /** The screen it is drawn on — read from the router; given only by a test. */
  here?: string;
  /** Drawn by `?stepper=1` while the switch is off: links keep the preview on. */
  preview?: boolean;
}) {
  const path = usePathname();
  const why = useId();
  if (!track) return null;
  const here = told ?? path ?? "";
  const cur = track.steps[track.current];
  const press = track.press;
  const keep = (href: string) => (preview ? keepPreview(href) : href);
  const jobScreen = press.href.split("?")[0];
  /** No action where the job is done, and none on the dashboard, whose status card holds the button. */
  const offered = here !== "/dashboard" && here !== jobScreen;
  const wayOut = press.wayOut && press.wayOut.href !== here ? press.wayOut : null;

  if (!stepperOpenOn(here, track.step)) {
    // FOLDED: one line, 48px at most on a phone.
    return (
      <section className="ls ls-folded" aria-label="Where this tournament is" data-state={cur.state}>
        {/* The machine's chip, said here once (the tournament bar no longer repeats it). */}
        <span className="ls-chip">{track.chip}</span>
        {cur.state === "held" && (
          <span className="ls-chip" data-state="held">
            {STATE_WORD.held}
          </span>
        )}
        <span className="ls-line">{press.enabled && press.text ? press.text : cur.label}</span>
        {offered && !press.enabled && wayOut && (
          <Link href={keep(wayOut.href)} className="ls-link">
            {wayOut.says} <Icon name="caret-right" />
          </Link>
        )}
        {offered && press.enabled && press.action && (
          <Link href={keep(press.href)} className="ls-link">
            {press.action} <Icon name="caret-right" />
          </Link>
        )}
      </section>
    );
  }

  const collapse = here !== "/dashboard";
  return (
    <section className="ls" aria-label="Where this tournament is" data-state={cur.state}>
      <div className="ls-head">
        <span className="ls-kick">{track.chip}</span>
        <p className="ls-title">{trackCount(track)}</p>
        {preview && <span className="ls-preview">Preview</span>}
      </div>

      <ol className="ls-track">
        {track.phases.map((phase) => (
          <li key={phase.key} className="ls-phase" data-state={phase.state} style={{ flexGrow: stopsOf(phase, cur, collapse).length }}>
            <span className="ls-phase-title">{phase.title}</span>
            <ol className="ls-stops">
              {stopsOf(phase, cur, collapse).map((s) => (
                <li key={s.key} className="ls-stop" data-state={s.state} aria-current={s === cur ? "step" : undefined}>
                  <Link href={keep(s.href)} className="ls-stop-link">
                    <Dot state={s.state} />
                    <span className="ls-stop-label">{s.label}</span>
                    <span className="ls-stop-word">{STATE_WORD[s.state]}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>

      <div className="ls-focus" data-state={cur.state}>
        <p className="ls-focus-head">
          <span className="ls-chip" data-state={cur.state}>
            {STATE_WORD[cur.state]}
          </span>
          <b>{cur.label}</b>
        </p>
        <p className="ls-reason" id={why}>
          {cur.reason}
        </p>
        {offered && (
          <div className="ls-press">
            {!press.enabled ? (
              <>
                <button type="button" className="ls-press-off" disabled aria-describedby={why}>
                  {press.action}
                </button>
                {wayOut && (
                  <Link href={keep(wayOut.href)} className="ls-link">
                    {wayOut.says} <Icon name="arrow-right" />
                  </Link>
                )}
              </>
            ) : press.action ? (
              <Link href={keep(press.href)} className="ls-link">
                {press.action} <Icon name="arrow-right" />
              </Link>
            ) : null}
          </div>
        )}
      </div>

      <details className="ls-every">
        <summary>Every step, with its reason</summary>
        <div className="ls-cols">
          {track.phases.map((phase) => (
            <div key={phase.key} className="ls-col">
              <p className="ls-col-title">{phase.title}</p>
              <ul className="ls-rows">
                {phase.steps.map((s) => (
                  <li key={s.key} className="ls-row" data-state={s.state} data-current={s === cur ? "" : undefined}>
                    <Dot state={s.state} />
                    <span className="ls-row-body">
                      <Link href={keep(s.href)} className="ls-row-label">
                        {s.label}
                      </Link>{" "}
                      <span className="ls-row-word">{STATE_WORD[s.state]}</span>
                      {s.reason && <span className="ls-row-reason">{s.reason}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

/**
 * A phase's stops as the track draws them. Off the dashboard a finished phase is ONE tick (the panel,
 * 9 Nov), so the track stays short where it is not the screen's subject.
 */
export function stopsOf(phase: TrackPhase, cur: TrackStep, collapse: boolean): TrackStep[] {
  if (!collapse || phase.state !== "done" || phase.steps.includes(cur)) return phase.steps;
  return [{ key: `${phase.key}-all`, phase: phase.key, label: phase.title, href: phase.steps[0]?.href ?? "/dashboard", state: "done", reason: "", optional: false, roundId: null }];
}

/** A stop's mark: ticked, ringed, flagged or dashed — the shape says it as well as the colour. */
function Dot({ state }: { state: TrackState }) {
  return (
    <span className="ls-dot" data-state={state} aria-hidden="true">
      {state === "done" ? <Icon name="check" /> : state === "held" ? "!" : null}
    </span>
  );
}
