"use client";

/**
 * A Save you can reach from the top of the form it belongs to.
 *
 * Tournament details is two long forms stacked. Measured on the demo data:
 * the setup form is 1,898px with 1,125px between its first field and its
 * Save, and Players & scoring is 2,455px with 1,897px. An organizer changing
 * the first thing in either has one to two and a third phone screens to
 * scroll before reaching the only control that keeps it, and nothing on the
 * way down says a Save exists at all.
 *
 * ONE BUTTON PER FORM, STILL. `PlaySettings` sets out why in its own words —
 * "Two save models on one screen is how a club changes something, presses
 * Save, and finds half of it kept" — so the button moves rather than
 * multiplies. Per-group saves would fix the distance by breaking the thing
 * that is right.
 *
 * STICKY ONLY WHILE DIRTY. A screen nobody has touched carries no floating
 * chrome, which is also what stops two of these hovering at once on a page
 * that holds two forms.
 *
 * AND STICKY TO THE BOTTOM, which is what scopes it. A bottom-stuck element
 * pins only while its containing block is on screen, so each form's Save
 * follows you inside that form and is gone outside it. That matters here
 * more than usual: a Save hovering over the other form's controls would be
 * lying about what it saves.
 *
 * THE NOTE IS NOT DECORATION. A button that has followed you up the page has
 * left the heading that said what it belongs to, and this screen has two
 * Saves whose idle labels are both "Saved". While it floats, it says which.
 *
 * Extracted rather than written twice: the second copy was about to be
 * pasted into `EventSetupClient`, which is how a screen ends up with two
 * behaviours for one act — the fault this file's own subject is a fix for.
 */
export function StickySave({
  dirty,
  note,
  children,
}: {
  /** Whether there is anything to save. Decides both the pin and the note. */
  dirty: boolean;
  /** What is unsaved, in the reader's words. Shown only while it floats. */
  note: string;
  /** The Save button itself, so each form keeps its own label and action. */
  children: React.ReactNode;
}) {
  return (
    <div
      style={
        dirty
          ? {
              position: "sticky",
              bottom: 12,
              zIndex: 5,
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--color-surface)",
              boxShadow: "0 2px 14px color-mix(in srgb, var(--color-text) 18%, transparent)",
              border: "1px solid var(--color-divider)",
            }
          : { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }
      }
    >
      {children}
      {dirty && (
        <span className="text-muted" style={{ fontSize: 12 }}>
          {note}
        </span>
      )}
    </div>
  );
}
