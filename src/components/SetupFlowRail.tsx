import Link from "next/link";
import { Icon } from "./Icon";
import { positionOf, canAdvance, type SetupFlow } from "@/lib/domain/setup-flow";
import { LAUNCH_DOES, VISIBILITY_IS_ELSEWHERE } from "@/lib/domain/lifecycle-state";

/**
 * Where you are in setting the tournament up, and what is next.
 *
 * A server component, deliberately: it is four links and a count, and shipping
 * a client bundle to render them would put JavaScript between an organizer and
 * the one thing on the screen that tells them where they are.
 *
 * It renders NOTHING once setup is complete and the tournament has been
 * launched. A progress rail reading "4 of 4" across the top of every screen
 * for the rest of the season is furniture, and these screens are worked for
 * months after setup is done.
 *
 * The one thing between those two states is the hand-off below.
 */
export function SetupFlowRail({ flow, href }: { flow: SetupFlow | null; href: string }) {
  // Null for a match — nothing to set up, so nothing to guide through. Taken
  // here rather than at four call sites, so a screen cannot forget.
  if (!flow) return null;

  /**
   * FINISHED, AND NOT YET LAUNCHED.
   *
   * The gap this closes was in the first version of this rail: it guided an
   * organizer through four steps and then vanished, at the exact moment the
   * tournament became real. Nothing said they were finished, and nothing said
   * what launching would do.
   *
   * THIS HEADER USED TO SAY "still invisible to everybody in it" — that until
   * it is launched, nobody in the field can see their schedule, their card or
   * the leaderboard. That is false, and the comment thirty lines below says so
   * from a measurement: on 2026-09-11, as a player on a `draft` tournament,
   * the board rendered, the card rendered, and it offered to certify.
   * `launchTournament` writes status, launchedAt and configUnlocked and
   * nothing else; visibility is `leaderboardVisibility`, which is a different
   * setting on a different screen.
   *
   * So the copy was corrected and this paragraph was not — leaving the file
   * asserting in its header the thing it disproves in its body, which is the
   * version a reader skimming for context takes away. Same disease as two
   * screens disagreeing, one layer down: see `LAUNCH_DOES`, which both the
   * live copy here and the dashboard warning now read so they cannot drift.
   *
   * One card, on the setup screens only, and it clears itself the moment the
   * tournament is launched. It offers the launch rather than performing it:
   * launching locks configuration, which is an organizer's decision and not a
   * tidy-up this component may do for them.
   */
  if (flow.readyToLaunch) {
    return (
      <div
        className="card elev-sm"
        style={{ marginBottom: 16, gap: 8, borderLeft: "3px solid var(--color-accent-2)" }}
      >
        <span className="card-title" style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 7 }}>
          <Icon name="check-circle" weight="fill" style={{ color: "var(--color-accent-2)" }} /> Setup is
          done — all {flow.steps.length} parts
        </span>
        {/* NAMES THE SCREEN, NOT A BUTTON ON IT.
            "Launch it from the dashboard" was wrong for the commonest case:
            a tournament still in draft is offered "Start taking entries"
            there, not "Launch", so this would have sent an organizer looking
            for a control that is two lifecycle steps away. Same fault as a
            refusal telling somebody to press a button that no longer exists —
            and the dashboard's own status bar already walks the steps. */}
        {/* IT DOES NOT HAND OUT ACCESS, and this used to say it did:
            "Nobody in the field can see any of it yet … that is what opens
            their schedule, their card and the leaderboard to them."

            Measured on 2026-09-11 as a player on a `draft` tournament — the
            board rendered, the card rendered, and it offered to certify.
            `launchTournament` writes status, launchedAt and configUnlocked and
            nothing else; `canSeeLeaderboard` reads `leaderboardVisibility`.
            See `LAUNCH_DOES` in domain/lifecycle-state.ts, which both this and
            the dashboard warning now read so they cannot drift apart again. */}
        {/* ONE THING LEFT, when the launch gate still says no.
            The steps take a date OR a venue; launching needs a date. This
            panel promised "take it live" over a Launch button the dashboard
            then disabled — so it asks the gate and says what it said, in the
            gate's own words, before sending anybody anywhere. */}
        {flow.launchBlocked ? (
          <p style={{ fontSize: 13, margin: 0, lineHeight: 1.6, maxWidth: "68ch" }}>
            <b>One thing before it can go live.</b> {flow.launchBlocked}
          </p>
        ) : (
          <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6, maxWidth: "68ch" }}>
            The dashboard is where you open entries and take it live. {LAUNCH_DOES}{" "}
            {VISIBILITY_IS_ELSEWHERE}
          </p>
        )}
        {/* To the screen that fixes it. With every step done the gate can
            only be refusing the DATE — the steps already require a round and a
            field — and dates are set on Tournament details, not the dashboard. */}
        {flow.launchBlocked ? (
          <Link href="/event" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
            <Icon name="calendar-blank" /> Open {flow.steps.find((s) => s.href === "/event")?.label ?? "Tournament details"}
          </Link>
        ) : (
          <Link href="/dashboard" className="btn btn-primary" style={{ alignSelf: "flex-start" }}>
            <Icon name="rocket-launch" /> Go to the dashboard
          </Link>
        )}
      </div>
    );
  }

  if (flow.complete) return null;
  const { step } = positionOf(flow, href);

  return (
    <div className="card elev-sm" style={{ marginBottom: 16, gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="card-kicker">Setting up</span>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {flow.doneCount} of {flow.steps.length} done
        </span>
      </div>

      {/* Scrolls rather than wraps at narrow widths: four steps in a broken
          row lose the left-to-right reading that IS the progress. The page
          body never scrolls sideways — this container does. */}
      <div style={{ overflowX: "auto", margin: "0 -2px", padding: "0 2px" }}>
        <ol
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 6,
            listStyle: "none",
            margin: 0,
            padding: 0,
            minWidth: "min-content",
          }}
        >
          {flow.steps.map((s, i) => {
            const here = s.href === href;
            // The 300 steps, which are the TEXT steps. This is an 11px bold
            // uppercase label, and the "Now" pill sits on a 12% tint of the
            // accent — where step 500 measures 3.05:1 for the worst club
            // palette, on both grounds. See accent-is-not-a-text-colour.test.ts.
            const tone = s.done
              ? "var(--color-accent-2-300)"
              : s.state === "current"
                ? "var(--color-accent-300)"
                : "var(--color-neutral-500)";
            return (
              <li key={s.key} style={{ flex: "1 1 0", minWidth: 132 }}>
                {/* Every step stays a link, including the ones still to do.
                    The guide is the emphasis and the Next button, not a
                    barrier — an organizer running their ninth event of the
                    season knows which screen they want. */}
                <Link
                  href={s.href}
                  aria-current={here ? "step" : undefined}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                    height: "100%",
                    minHeight: 44,
                    padding: "8px 10px",
                    borderRadius: 9,
                    textDecoration: "none",
                    color: "var(--color-text)",
                    background: here ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "transparent",
                    border: `1px solid ${here ? "var(--color-accent)" : "var(--color-divider)"}`,
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: tone, fontWeight: 700 }}>
                    {s.done ? <Icon name="check-circle" weight="fill" /> : <span>{i + 1}</span>}
                    <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {s.done ? "Done" : s.state === "current" ? "Now" : "To do"}
                    </span>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ol>
      </div>

      {/* The question this screen answers, and what is still missing — said
          on the screen itself rather than only in a checklist somewhere else.
          Shown only while this step is unfinished, so a screen revisited to
          change a date is not told it is incomplete. */}
      {step && !step.done && (
        <p style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
          <b>{step.question}</b>{" "}
          <span className="text-muted">{step.missing}</span>
        </p>
      )}
      {step?.done && flow.current && (
        <p className="text-muted" style={{ fontSize: 12.5, margin: 0, lineHeight: 1.6 }}>
          {/* "Still to do", not "Next": the outstanding step is often BEHIND
              this one — anybody who reaches Rounds first has a finished
              screen pointing back at Tournament details — and calling that
              "next" sends a reader looking forwards for it. */}
          <Icon name="check-circle" /> This part is done. Still to do:{" "}
          <Link href={flow.current.href} style={{ color: "var(--color-accent-300)" }}>
            {flow.current.label}
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/**
 * Back and onward, at the bottom of the screen where the work ends.
 *
 * At the BOTTOM, and that is the whole point of it being a second component.
 * "It's hard to go back" is a complaint about arriving at the end of a long
 * settings screen with nothing there — the only way onward being to scroll all
 * the way up and find the next name in a sidebar of twenty. A control that
 * appears where the reading stops costs one tap; the same control at the top
 * costs a scroll and a search.
 */
export function SetupFlowFooter({ flow, href }: { flow: SetupFlow | null; href: string }) {
  // Nothing at the foot of the page once setup is done — the hand-off in the
  // rail above says the one remaining thing, and saying it twice on one screen
  // would make it an instruction rather than an offer.
  if (!flow || flow.complete) return null;
  const { step, back, next } = positionOf(flow, href);
  if (!step) return null;
  const ready = canAdvance(step);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        marginTop: 20,
        paddingTop: 16,
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      {back ? (
        <Link href={back.href} className="btn btn-secondary">
          <Icon name="arrow-left" /> {back.label}
        </Link>
      ) : (
        <span />
      )}
      <div style={{ flex: 1 }} />
      {next && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {/* Says WHY it is waiting rather than sitting there greyed out. A
              disabled control with no reason is the app refusing to explain
              itself, and this is the exact moment somebody gives up. */}
          {!ready && (
            <span className="text-muted" style={{ fontSize: 12, textAlign: "right" }}>
              {step.missing}
            </span>
          )}
          {ready ? (
            <Link href={next.href} className="btn btn-primary">
              Next: {next.label} <Icon name="arrow-right" />
            </Link>
          ) : (
            /* A real disabled button rather than a dimmed link, so a tap does
               nothing instead of navigating somewhere the organizer is not
               ready for. */
            <button type="button" className="btn btn-primary" disabled>
              Next: {next.label} <Icon name="arrow-right" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
