import Link from "next/link";
import { Icon } from "./Icon";
import { screenName } from "@/lib/nav";

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
  /** Whether any card has been returned, which is what "finishing" needs. */
  scored: boolean;
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

export function TournamentJourney({ setup, launched, scored, hasBracket }: TournamentJourneyProps) {
  const phases: Phase[] = [
    {
      key: "setup",
      title: "Set up",
      icon: "sliders",
      blurb: "The name and venue, the rounds, the field, and how it divides.",
      screens: ["/event", "/stages", "/registration", "/grouping"],
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
      screens: ["/prizes", "/reports"],
    },
  ];

  /**
   * Where the tournament actually is.
   *
   * Read from what has happened rather than from a stored stage, so it cannot
   * disagree with the screens either side of it: setting up is finished when
   * the rail says so, playing has started when a card has been returned.
   */
  const current: JourneyPhase = scored ? "results" : launched ? "play" : setup?.complete ? "launch" : "setup";
  const order: JourneyPhase[] = ["setup", "launch", "play", "results"];
  const currentIndex = order.indexOf(current);

  return (
    <div className="card elev-sm">
      <span className="card-title" style={{ fontSize: 15 }}>
        How a tournament runs
      </span>
      <p className="text-muted" style={{ fontSize: 12, margin: "-2px 0 2px" }}>
        You are on step {currentIndex + 1} of {order.length}.
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
