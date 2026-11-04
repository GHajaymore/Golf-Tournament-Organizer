import Link from "next/link";
import { Icon } from "./Icon";
import { screenName } from "@/lib/nav";
import { setupScreens } from "@/lib/domain/setup-flow";

/**
 * THE WHOLE OF RUNNING A TOURNAMENT, ON ONE CARD.
 *
 * This was a flat `<ol>` of seven lines — correct, and completely inert. It
 * said the same four setup steps the rail at the top of the same screen was
 * already showing LIVE, with `Now` and `Done` against them, and then three
 * more nobody could tell they had reached. An organizer read it once and never
 * again, because it never changed.
 *
 * So it stops competing with the rail and does the thing the rail cannot: the
 * rail is where you are inside SETTING UP, and this is the shape of the whole
 * journey — set up, launch, play, finish — with setting up collapsed to one
 * phase that reports its own progress rather than restating its four steps.
 *
 * WHY IT IS NOT JUST DECORATION. Every screen named here is named by
 * `screenName`, so the card cannot come to call a screen something the sidebar
 * does not — the fault this list has already had twice, with "Rounds & format"
 * and with "Prizes & Reports", neither of which is a screen. And every phase
 * after the current one is deliberately quiet: a guide that shouts every step
 * at once is the flat list again in brighter colours.
 */

export type JourneyPhase = "setup" | "launch" | "play" | "results";

export interface TournamentJourneyProps {
  /**
   * How far setting up has got. Null for an event with no setup flow.
   *
   * `doneHrefs` is WHICH of them are finished, and it exists because the count
   * alone is a number nobody can act on. This card said "3 of 5 done" over
   * five chips that looked identical, so an organizer reading it knew two
   * parts were outstanding and had to open each of the five to find out which
   * — on the card whose whole job is telling them where they are.
   *
   * The flow already knew: `SetupStep.done` is on every step. It simply was
   * not passed, which is the same shape as most of what this file's neighbours
   * record — the right answer one field away from the screen that needed it.
   */
  setup: {
    doneCount: number;
    total: number;
    complete: boolean;
    doneHrefs: readonly string[];
    /** Every step this tournament has — see `setupScreens`. */
    hrefs?: readonly string[];
    /**
     * The one step to do NEXT — `flow.current.href`, the first unfinished one.
     *
     * Ticks alone answered "how far am I" and left every remaining chip
     * identical, so the card never answered "what now", which is the question
     * somebody opens this screen with.
     *
     * Deliberately the SAME source the rail uses (`flow.current`), because a
     * second way of saying which step is current is how two panels come to
     * disagree about it. The rail's "Now" is a different fact since
     * 2026-10-16 — the step being SHOWN, on a setup screen; this card sits on
     * no step, so its "Now" can only mean the first one to do. Optional, and an
     * empty string marks nothing — setup being complete is exactly that case.
     */
    currentHref?: string;
  } | null;
  /**
   * WHERE THE TOURNAMENT IS — the state machine's `journey`
   * (`tournamentStatus(facts).journey`, PR 3), never worked out here.
   *
   * This card took the status and "any card returned" and derived the phase
   * itself (`tournamentPhase`), from a setup rail that held a medal with no
   * flights at Flights — so on one screen the Launch button said go while this
   * card said "Set up" (D1). The machine answers it once: Finish when the
   * tournament is completed; Play once it is launched or any round has a
   * result (a knockout's recorded ties included, D2); Launch once nothing
   * holds launch; Set up before that.
   */
  journey: JourneyPhase;
  /** Knockout tournaments only — see the bracket gate in EventSetupClient. */
  hasBracket: boolean;
}

interface Phase {
  key: JourneyPhase;
  title: string;
  icon: string;
  /** What this phase is FOR, in the organizer's words — never a screen name. */
  blurb: string;
  screens: string[];
}

export function TournamentJourney({
  setup,
  journey,
  hasBracket,
}: TournamentJourneyProps) {
  const phases: Phase[] = [
    {
      key: "setup",
      title: "Set up",
      icon: "sliders",
      blurb: "The name and venue, the rounds, the field, how it divides, and what it costs.",
      /**
       * `SETUP_ORDER`, not a hand-written copy of it.
       *
       * It was a literal four-element array, and the test below this file had
       * to read it out of the source as prose to check it agreed with the
       * rail. That is the third-list problem this whole order exists to fix,
       * one layer down: adding the money step to the guide would have left
       * this card silently describing four steps while the rail walked five,
       * with a count under it reading "0 of 5".
       *
       * Through `setupScreens`, which is SETUP_ORDER filtered to the steps
       * this tournament has — so a team event shows Teams & pairs and a medal
       * does not, and the chips always match the count beside them.
       */
      screens: setupScreens(setup?.hrefs),
    },
    {
      key: "launch",
      title: "Launch",
      icon: "flag",
      blurb: "Setup locks, and the tournament becomes real.",
      screens: [],
    },
    {
      key: "play",
      title: "Play",
      icon: "golf",
      blurb: "Send them out, take the scores as they come in.",
      screens: hasBracket ? ["/foursomes", "/entry", "/bracket"] : ["/foursomes", "/entry"],
    },
    {
      key: "results",
      title: "Finish",
      icon: "trophy",
      blurb: "Settle the money, then send everyone the result.",
      /* Prizes & payouts appears here AND in Set up, deliberately: the mode is
         decided before anybody is asked for money and the pots are settled
         after they have played. Two visits to one screen, which is what a
         card about phases should say rather than hide. */
      screens: ["/prizes", "/reports"],
    },
  ];

  /**
   * Where the tournament actually is — the machine's `journey`, handed in.
   *
   * The reasoning that used to live here (`finished` is a decision, `launched
   * || scored` is play having started, a card count only ever moves this
   * FORWARD to Play) is the machine's now: `tournamentStatus` answers it for
   * this card, the dashboard and the public event page alike.
   */
  const order: JourneyPhase[] = ["setup", "launch", "play", "results"];
  const currentIndex = order.indexOf(journey);

  return (
    <div className="card elev-sm">
      <span className="card-title" style={{ fontSize: 15 }}>
        How a tournament runs
      </span>
      {/* NO COUNTER HERE ANY MORE (state machine PR 3; UI/UX, panel 8.3 Q4).
          "You are on phase N of 4" sat on /event below the rail's "N of 6
          done": two counters with two denominators on one screen is exactly
          the shape of D1. The chip is the step, the rail is the only counter
          during setup, and this card keeps its pictures and links — "You are
          here" marks the phase. */}

      <ol style={{ listStyle: "none", margin: "4px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {phases.map((phase, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "now" : "todo";
          const accent =
            state === "now" ? "var(--color-accent)" : state === "done" ? "var(--color-accent-700)" : "var(--color-divider)";
          return (
            <li key={phase.key} style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
              {/* The rail down the left: a marker per phase, joined by a line,
                  so the four read as one journey rather than four cards. */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 22, flex: "none" }}>
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 13,
                    fontWeight: 600,
                    color: state === "todo" ? "var(--color-text-muted)" : "var(--color-bg)",
                    background: state === "todo" ? "transparent" : accent,
                    boxShadow: state === "todo" ? `inset 0 0 0 1px ${accent}` : "none",
                  }}
                >
                  {state === "done" ? <Icon name="check" /> : i + 1}
                </span>
                {i < phases.length - 1 && (
                  <span
                    aria-hidden
                    style={{ flex: 1, width: 2, minHeight: 14, background: i < currentIndex ? accent : "var(--color-divider)" }}
                  />
                )}
              </div>

              <div style={{ paddingBottom: i < phases.length - 1 ? 12 : 0, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <Icon name={phase.icon} style={{ color: state === "todo" ? "var(--color-text-muted)" : accent }} />
                  <span style={{ fontSize: 13.5, fontWeight: state === "now" ? 600 : 500 }}>{phase.title}</span>
                  {state === "now" && (
                    <span className="tag tag-accent" style={{ fontSize: 13 }}>
                      You are here
                    </span>
                  )}
                  {/* "N of M done" is the rail's, and only the rail's (PR 3):
                      the chips below say which parts are done and which is
                      next, without a second count. */}
                </div>
                <p className="text-muted" style={{ fontSize: 13, margin: "2px 0 0", lineHeight: 1.5 }}>
                  {phase.blurb}
                </p>
                {/* Chips rather than bare link text: these are up to four
                    destinations in a row, and underlined words run together
                    into a sentence the reader then has to parse back into a
                    list. */}
                {phase.screens.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                    {phase.screens.map((href) => {
                      /**
                       * WHICH ONES ARE DONE, not just how many.
                       *
                       * Only the setup phase can answer this — it is the one
                       * with a flow behind it, and the same reason the "N of 5
                       * done" line above appears on that phase alone. A tick
                       * on a Play chip would be a claim nothing computes.
                       *
                       * `check-circle` filled, in the secondary accent, is the
                       * mark `SetupFlowRail` already uses for a finished step
                       * on this same screen. A third visual language for
                       * "done" is how two panels come to disagree about what a
                       * tick means.
                       */
                      /**
                       * `?.` on the ARRAY as well as on `setup`, though the
                       * type requires it. This is a whole-screen panel, and a
                       * caller that spreads `any` props — `render.test.tsx`
                       * does, which is how a missing `doneHrefs` got past tsc
                       * and threw here — should get an unmarked chip rather
                       * than take `/event` down with it. Marking nothing is
                       * the safe failure; throwing is not.
                       */
                      const done = phase.key === "setup" && !!setup?.doneHrefs?.includes(href);
                      /**
                       * The one to do next, marked the way the rail marks it.
                       * `?.` for the same reason as `doneHrefs` above: a caller
                       * spreading `any` should get an unmarked chip, never a
                       * thrown page.
                       */
                      const isNext =
                        phase.key === "setup" && !done && !!setup?.currentHref && setup.currentHref === href;
                      return (
                        <Link
                          key={href}
                          href={href}
                          style={{
                            fontSize: 13,
                            textDecoration: "none",
                            padding: "3px 8px",
                            borderRadius: 999,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            background: done
                              ? "color-mix(in srgb, var(--color-accent-2) 12%, transparent)"
                              : isNext
                                ? "color-mix(in srgb, var(--color-accent) 16%, transparent)"
                                : "color-mix(in srgb, var(--color-text) 6%, transparent)",
                            boxShadow: done
                              ? "inset 0 0 0 1px color-mix(in srgb, var(--color-accent-2) 30%, transparent)"
                              : isNext
                                ? "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 55%, transparent)"
                                : "inset 0 0 0 1px color-mix(in srgb, var(--color-text) 10%, transparent)",
                            color: done
                              ? "var(--color-accent-2-200)"
                              : isNext
                                ? "var(--color-accent-200)"
                                : state === "todo"
                                  ? "var(--color-text-muted)"
                                  : "var(--color-text)",
                            fontWeight: isNext ? 600 : undefined,
                            whiteSpace: "nowrap",
                          }}
                          aria-current={isNext ? "step" : undefined}
                        >
                          {done && <Icon name="check-circle" weight="fill" />}
                          {isNext && <Icon name="arrow-right" />}
                          {screenName(href)}
                          {/* The word, not only the colour. The rail beside
                              this says "Now" for the same step, and a chip
                              distinguished by hue alone says nothing to
                              somebody who cannot see the difference — these
                              are the two brand colours, orange and green. */}
                          {isNext && (
                            <span style={{ fontSize: 13, opacity: 0.85, letterSpacing: "0.04em" }}>NOW</span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
