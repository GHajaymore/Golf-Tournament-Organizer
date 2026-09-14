import Link from "next/link";
import { Icon } from "./Icon";
import { screenName } from "@/lib/nav";
import { SETUP_ORDER } from "@/lib/domain/setup-flow";

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
  /** How far setting up has got. Null for an event with no setup flow. */
  setup: { doneCount: number; total: number; complete: boolean } | null;
  /** Whether the tournament has been launched — play has begun. */
  launched: boolean;
  /**
   * Whether any card has been returned.
   *
   * This said "which is what 'finishing' needs", and the code below believed
   * it. A returned card is evidence that play has STARTED — it is what the
   * first phase of scoring looks like, not the last.
   */
  scored: boolean;
  /**
   * Whether the organizer has declared it over.
   *
   * `launched` cannot answer this: it is `status === "live" || status ===
   * "completed"`, so by the time it reaches here the two are the same value.
   * Finishing is a decision somebody makes, not a threshold a card count
   * crosses — see `current` below.
   */
  finished: boolean;
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
  launched,
  scored,
  finished,
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
       */
      screens: [...SETUP_ORDER],
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
   * Where the tournament actually is.
   *
   * Read from what has happened rather than from a stored stage, so it cannot
   * disagree with the screens either side of it: setting up is finished when
   * the rail says so, playing has started when a card has been returned.
   *
   * THE FIRST TEST USED TO BE `scored`, AND IT ANSWERED THE WRONG QUESTION.
   * One returned card sent the whole card to "Finish", so it ticked Launch and
   * Play as done and told the organizer to settle the money and send everyone
   * the result — on a tournament whose second round was in progress.
   *
   * Demo Cup on 2026-09-14 is the case it was reported from, and it is worse
   * than it looks: `status` is "draft", so `launched` is FALSE. The card
   * claimed a tournament had finished that had never started. `scored` was
   * tested first, so the two phases it skipped were never consulted.
   *
   * The order is the fix, and so is what each test now means:
   *
   *   finished           a decision somebody made — `status === "completed"`.
   *                      Nothing derived, because nothing derived can know:
   *                      four rounds with one played and four rounds with
   *                      four played both have cards.
   *   launched || scored play has started. `launched` is the ordinary route;
   *                      `scored` is the evidence route, kept because it was
   *                      the sound half of the original idea — a card that has
   *                      come in means somebody is out there whatever the
   *                      status says.
   *
   * So a card count can now only ever move this FORWARD to Play, never to
   * Finish, which is the direction it is capable of being right about.
   */
  const current: JourneyPhase = finished
    ? "results"
    : launched || scored
      ? "play"
      : setup?.complete
        ? "launch"
        : "setup";
  const order: JourneyPhase[] = ["setup", "launch", "play", "results"];
  const currentIndex = order.indexOf(current);

  return (
    <div className="card elev-sm">
      <span className="card-title" style={{ fontSize: 15 }}>
        How a tournament runs
      </span>
      <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 2px" }}>
        {/* PHASE, NOT STEP — this card counts something else.
            On /event this sentence sits about two thousand pixels below the
            rail's "Setup is done — all 5 parts", and the rail's own progress
            line reads "N of 5 done". Two counters, two denominators, and this
            one was the only thing on the screen calling its four PHASES
            "steps" — which is also what this file's own type calls them
            (`JourneyPhase`) and what every comment in it says. So a reader
            met "step 4 of 4" under a banner saying five and had no way to
            tell they were different questions. */}
        You are on phase {currentIndex + 1} of {order.length}.
      </p>

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
                    fontSize: 11,
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
                    <span className="tag tag-accent" style={{ fontSize: 10.5 }}>
                      You are here
                    </span>
                  )}
                  {/* The one phase that can report progress does. The rail at
                      the top of this screen owns the detail; this owns the
                      fact that there IS detail, and how much is left. */}
                  {phase.key === "setup" && setup && !setup.complete && (
                    <span className="text-muted" style={{ fontSize: 11.5 }}>
                      {setup.doneCount} of {setup.total} done
                    </span>
                  )}
                </div>
                <p className="text-muted" style={{ fontSize: 12, margin: "2px 0 0", lineHeight: 1.5 }}>
                  {phase.blurb}
                </p>
                {/* Chips rather than bare link text: these are up to four
                    destinations in a row, and underlined words run together
                    into a sentence the reader then has to parse back into a
                    list. */}
                {phase.screens.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                    {phase.screens.map((href) => (
                      <Link
                        key={href}
                        href={href}
                        style={{
                          fontSize: 11.5,
                          textDecoration: "none",
                          padding: "3px 8px",
                          borderRadius: 999,
                          background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
                          boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-text) 10%, transparent)",
                          color: state === "todo" ? "var(--color-text-muted)" : "var(--color-text)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {screenName(href)}
                      </Link>
                    ))}
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
