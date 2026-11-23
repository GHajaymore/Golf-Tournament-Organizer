import { BUILD_PREVIEW } from "@/lib/domain/console-merges";
import { STEPPER_PREVIEW } from "@/lib/domain/lifecycle-track";
import type { LockScope } from "@/lib/domain/tournament-status";

/**
 * THE PLAYERS ROOM'S TABS (R6), in a module with NO "use client": the pages and the tab strip both ask it.
 *
 * Players is Entries, Flights, Teams and Cup teams. Each tab is one of today's addresses and keeps its own
 * scope lock (`scope`), so each says why it is shut ONCE (`LockedOnce`). A tab the tournament has no use for
 * is not listed: Teams only where a round is played in a team format, Cup teams only where there is a cup session.
 */
export type PlayerTabKey = "entries" | "flights" | "teams" | "cup";

export interface PlayerTab {
  key: PlayerTabKey;
  label: string;
  path: string;
  /** The tab's own query, if it is a view of an address another tab also uses. */
  query: string;
  /** The machine's lock this tab asks (`scopeLockFor`). */
  scope: LockScope;
}

export const PLAYER_TABS: readonly PlayerTab[] = [
  { key: "entries", label: "Entries", path: "/registration", query: "", scope: "field" },
  { key: "flights", label: "Flights", path: "/grouping", query: "", scope: "flights" },
  { key: "teams", label: "Teams", path: "/teams", query: "", scope: "sides" },
  { key: "cup", label: "Cup teams", path: "/teams", query: "tab=cup", scope: "cup" },
];

/** The tabs this tournament lists: Entries and Flights always, the other two where they have something to do. */
export function playerTabsFor(facts: { hasTeamRound: boolean; hasCup: boolean }): PlayerTab[] {
  return PLAYER_TABS.filter((t) => (t.key === "teams" ? facts.hasTeamRound : t.key === "cup" ? facts.hasCup : true));
}

/** The preview's own two parameters out of a request's query, so a tab's link stays inside the preview. */
export function previewQuery(search: string): URLSearchParams {
  const q = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const k of [STEPPER_PREVIEW, BUILD_PREVIEW]) {
    const v = q.get(k);
    if (v !== null) out.set(k, v);
  }
  return out;
}

/** A tab's address: its own query first, then the preview's. */
export function playerTabHref(tab: PlayerTab, search: string): string {
  const q = new URLSearchParams(tab.query);
  for (const [k, v] of previewQuery(search)) q.set(k, v);
  const s = q.toString();
  return s ? `${tab.path}?${s}` : tab.path;
}

/**
 * WHERE THE CUP'S TEAMS ARE MADE: the Players room's Cup teams tab while Players is shown, the cup page
 * otherwise. The ONE answer both pages ask, so the two never mount them together and never neither.
 */
export function cupTeamsHome(playersShown: boolean): "players" | "cup" {
  return playersShown ? "players" : "cup";
}
