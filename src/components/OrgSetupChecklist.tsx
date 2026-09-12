import Link from "next/link";
import type { OrgSetupState } from "@/lib/domain/org-setup";
import { Icon } from "./Icon";

/**
 * What is left to set up for the ORGANIZATION, and what each undone step costs.
 *
 * Distinct from `SetupChecklist`, which walks one TOURNAMENT into shape. This
 * one is about the club or society that owns them — its kind, its course, its
 * roster — and is answered once rather than per event. Kept as a separate
 * component rather than a mode of that one: they take different data, appear
 * in different places, and merging them would put an "add your members" row
 * inside a per-tournament list where it does not belong.
 *
 * THE CLUB ROWS ARE NOT A GATE ON EACH OTHER. Any of them, in any order,
 * because organizers do not work in order and blocking one behind another just
 * invites a placeholder member to unlock the next step.
 *
 * THE TOURNAMENT ROW IS A GATE, and only before the first one exists. The club
 * and the tournament are not peers on one list: a club is set up once and its
 * tournaments are many, so its name and its members are the ground every
 * tournament stands on. Presenting that row as a live equal fifth, beside three
 * unanswered club questions, is what produced a tournament named after its
 * secretary with an empty roster. See `org-setup.ts` for the whole reasoning
 * and for why the course card and the money setting are deliberately NOT
 * prerequisites.
 *
 * Either way it is honest about consequences rather than silent. A step that
 * costs something while undone says so on the row ("pairings cannot be drawn
 * from an empty field"), and a row that cannot be clicked says which answer it
 * is waiting for. The enforcement itself is in `createEvent`, because a row
 * that does not link stops nobody.
 *
 * Renders nothing once everything that applies is done. A checklist that stays
 * on screen congratulating itself is clutter on every visit afterwards.
 */
export function OrgSetupChecklist({
  state,
  currentPath,
}: {
  state: OrgSetupState;
  /**
   * The path this checklist is being rendered on.
   *
   * A step whose href IS this page must not be a link. On `/choose` the
   * "Create your first tournament" row pointed at `/choose?stay=1` — the page
   * it was already on, directly above the form that does it. Correct on the
   * dashboard, a link to nowhere here.
   *
   * The row still renders, and still counts: it is a real step and it is the
   * one a brand-new organizer does next, so dropping it would understate the
   * work and break the "0 of 5 done" count. Only the LINK is wrong, so only
   * the link goes.
   */
  currentPath?: string;
}) {
  if (state.ready) return null;

  const doneCount = state.steps.length - state.remaining.length;
  const anyBlocked = state.steps.some((s) => s.blocked);

  return (
    <section className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>
          Setting up your {state.profile.noun}
        </span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>
          {doneCount} of {state.steps.length} done.{" "}
          {/* "Work through them in any order — nothing here is locked" was
              FALSE on a brand-new account, where three of the four rows lead
              to screens that live inside a tournament and bounce back here
              without one. The sentence has to follow the rows: a promise the
              screen breaks on the organizer's first click is worse than no
              promise. Read off the steps rather than off the event count, so
              the two cannot come to disagree. */}
          {/* AND IT STOPPED BEING "start with the tournament".
              The club is set up once and its tournaments are many, so naming
              it, adding its members and settling how its money works come
              first — all three live outside a tournament now. The one row that
              still waits for one is the course card, which is on /event
              because /event IS a tournament.

              THREE SENTENCES, because there are three true states and the
              wrong one is a promise the screen breaks on the first click.
              Order matters: the setup gate is checked FIRST, because when the
              club still owes answers "nothing here is locked" is false about
              the very next row — which is exactly the fault this comment was
              written about, reintroduced in a new place and caught by reading
              the rendered line on 2026-09-11. */}
          {state.blockedByClubSetup
            ? `Your ${state.profile.noun} comes first — the tournament step opens once ${
                state.outstanding.length === 1 ? "that one is" : "those are"
              } answered. Everything else you can do in any order.`
            : anyBlocked
              ? `Work through them in any order — only the course card waits on your first tournament.`
              : "Work through them in any order — nothing here is locked, and you can come back to it."}
        </p>
      </div>

      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {state.steps.map((step) => {
          const isNext = step.key === state.next?.key;
          // Query strings and hashes are not part of "which page is this".
          // `/choose?stay=1` and `/choose` are the same screen, and the whole
          // point of `?stay=1` is to keep THIS page up.
          const here = currentPath !== undefined && step.href.split(/[?#]/)[0] === currentPath;
          const rowStyle = {
            display: "flex",
            alignItems: "flex-start",
            gap: 11,
            padding: "11px 13px",
            borderRadius: "var(--radius-md)",
            background: isNext
              ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
              : "color-mix(in srgb, var(--color-text) 3%, transparent)",
            border: isNext
              ? "1px solid var(--color-accent)"
              : "1px solid color-mix(in srgb, var(--color-text) 10%, transparent)",
          } as const;
          /**
           * A row is a link only where the link goes somewhere.
           *
           * Two reasons it does not, and they read differently to an organizer:
           * `here` is "you are already on it", `notYet` is "not yet". Both
           * render as plain text rather than a click that reloads the page or
           * bounces off a guard — a dead link on the first screen of a new
           * account is the worst possible first impression, because the honest
           * reading of it is that the product is broken.
           *
           * WHY IT IS NOT A LINK comes from two separate rules, combined HERE,
           * in the one place that has to render a single sentence, and nowhere
           * in the domain.
           *
           * `step.blocked` is "the screen cannot be opened yet". The setup
           * gate is not that: `/choose` is perfectly reachable — it is the
           * page this row is usually rendered on — so the gate is a fact about
           * the ACTION and lives on the state. Merging them in `org-setup.ts`
           * would have made `blocked` mean two things, and the test that holds
           * that marking to the actual route guards would have read the merge
           * as a bug in `/choose`.
           */
          const notYet = step.blocked || (step.key === "tournament" ? state.blockedByClubSetup : "");
          const inert = here || !!notYet;
          const Row = inert
            ? ({ children }: { children: React.ReactNode }) => (
                <div style={{ ...rowStyle, opacity: notYet ? 0.72 : 1 }}>{children}</div>
              )
            : ({ children }: { children: React.ReactNode }) => (
                <Link href={step.href} className="link-reset" style={rowStyle}>
                  {children}
                </Link>
              );
          return (
            <li key={step.key}>
              <Row>
                <Icon name={step.done ? "ph-fill ph-check-circle" : "ph ph-circle-dashed"}
                  style={{
                    fontSize: 19,
                    marginTop: 1,
                    flex: "none",
                    color: step.done ? "var(--color-accent-2)" : "var(--color-neutral-500)",
                  }}
                  aria-hidden="true"
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      fontSize: 13.5,
                      fontWeight: 500,
                      // Not struck through: a finished step is still somewhere
                      // an organizer goes back to, not a crossed-off chore.
                      color: step.done ? "var(--color-neutral-500)" : "var(--color-text)",
                    }}
                  >
                    {step.title}
                    {isNext && <span className="tag tag-neutral">Next</span>}
                  </span>
                  <span
                    className="text-muted"
                    style={{ display: "block", fontSize: 12, marginTop: 2, lineHeight: 1.5 }}
                  >
                    {step.blurb}
                  </span>
                  {/* WHY IT IS NOT A LINK, on the row. Before the consequence,
                      because "pairings cannot be drawn from an empty field"
                      is advice about a screen this organizer cannot open yet
                      — and a warning they cannot act on is the thing that
                      teaches them to stop reading the next one. */}
                  {notYet && (
                    <span
                      className="text-muted"
                      style={{ display: "block", fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}
                    >
                      <Icon name="lock-simple" aria-hidden="true" /> {notYet}
                    </span>
                  )}
                  {!step.done && !notYet && step.consequence && (
                    <span
                      className="text-muted"
                      style={{ display: "block", fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}
                    >
                      <Icon name="warning-circle" aria-hidden="true" /> {step.consequence}
                    </span>
                  )}
                  {here && !notYet && (
                    // Says where the step is instead of offering a click that
                    // reloads the page under it. No direction ("scroll down"),
                    // because this component does not know where on the screen
                    // it has been mounted.
                    <span
                      className="text-muted"
                      style={{ display: "block", fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}
                    >
                      <Icon name="arrow-elbow-down-right" aria-hidden="true" /> You do this
                      one on this page.
                    </span>
                  )}
                </span>
              </Row>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
