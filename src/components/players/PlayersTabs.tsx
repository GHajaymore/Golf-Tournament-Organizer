import Link from "next/link";
import { playerTabHref, type PlayerTab, type PlayerTabKey } from "@/lib/domain/players-tabs";

/**
 * THE PLAYERS ROOM'S TAB STRIP (R6): Entries, Flights, Teams and Cup teams, one of them current.
 *
 * It computes nothing: `tabs` is `playerTabsFor`'s list and `search` is the request's preview query, so a
 * link stays inside the preview. Each tab is a link to its own address (the tab's lock banner and its
 * payload stay its own), drawn as a row that scrolls sideways before it pushes a phone wide.
 */
export function PlayersTabs({ tabs, active, search }: { tabs: readonly PlayerTab[]; active: PlayerTabKey; search: string }) {
  return (
    <nav aria-label="Players" data-players-tabs style={{ margin: "0 0 16px", minWidth: 0 }}>
      <ul style={{ display: "flex", gap: 6, listStyle: "none", margin: 0, padding: 0, overflowX: "auto", minWidth: 0 }}>
        {tabs.map((t) => {
          const current = t.key === active;
          return (
            <li key={t.key} style={{ flex: "none" }}>
              <Link
                href={playerTabHref(t, search)}
                aria-current={current ? "page" : undefined}
                data-players-tab={t.key}
                className={current ? "btn" : "btn btn-secondary"}
                style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
