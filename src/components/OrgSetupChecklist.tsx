import Link from "next/link";
import type { OrgSetupState } from "@/lib/domain/org-setup";

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
 * Deliberately NOT a gate. Every row is a live link whether or not the ones
 * above it are done, because organizers do not work in order — the tournament
 * often exists before the roster does, and blocking that just invites a
 * placeholder member to unlock the next step.
 *
 * What it does instead is be honest about consequences. A step that costs
 * something while undone says so on the row ("pairings cannot be drawn from an
 * empty field"), so nobody discovers it later from a button that will not
 * work. The refusal still belongs at the point of consequence; this is the
 * warning, not the enforcement.
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

  return (
    <section className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>
          Setting up your {state.profile.noun}
        </span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>
          {doneCount} of {state.steps.length} done. Work through them in any order — nothing here is
          locked, and you can come back to it.
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
          const Row = here
            ? ({ children }: { children: React.ReactNode }) => <div style={rowStyle}>{children}</div>
            : ({ children }: { children: React.ReactNode }) => (
                <Link href={step.href} className="link-reset" style={rowStyle}>
                  {children}
                </Link>
              );
          return (
            <li key={step.key}>
              <Row>
                <i
                  className={step.done ? "ph-fill ph-check-circle" : "ph ph-circle-dashed"}
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
                  {!step.done && step.consequence && (
                    <span
                      className="text-muted"
                      style={{ display: "block", fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}
                    >
                      <i className="ph ph-warning-circle" aria-hidden="true" /> {step.consequence}
                    </span>
                  )}
                  {here && (
                    // Says where the step is instead of offering a click that
                    // reloads the page under it. No direction ("scroll down"),
                    // because this component does not know where on the screen
                    // it has been mounted.
                    <span
                      className="text-muted"
                      style={{ display: "block", fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}
                    >
                      <i className="ph ph-arrow-elbow-down-right" aria-hidden="true" /> You do this
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
