/**
 * WHERE THE CREATE ENDS (journey budgets, cut B, 14 Nov 2026).
 *
 * "Create tournament" on a first event used to land on the dashboard, and the
 * very next job was always the same: Entries, then Open entries. The create
 * now ends where entries are opened. Nothing is removed: the Entries screen
 * carries the console menu, so the dashboard is still one press away.
 *
 * A COPY keeps its old landing: it moves the entry window with the dates, so
 * the dashboard's What's next is the better first look at it.
 */
export type CreateKind = "created" | "copied";

export function landingAfterCreate(kind: CreateKind): string {
  return kind === "created" ? "/registration" : "/dashboard";
}
