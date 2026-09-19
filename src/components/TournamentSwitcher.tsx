import { enterTournament } from "@/app/actions/auth";
import type { Switcher } from "@/lib/domain/tournament-switcher";
import { Icon } from "./Icon";

/**
 * THE TOURNAMENT ON SCREEN, AND THE WAY TO ANOTHER ONE.
 *
 * A strip under the play shell's header. It names the tournament every tab is
 * showing — the header never did, so a member who opened someone else's board
 * from the events list had no way to tell that was why their card had gone —
 * and opens onto every other tournament the member can go to, entered or not.
 *
 * A `<details>`, not a client dialog. It needs no JavaScript to open, it is a
 * control the platform already makes accessible, and every choice in it is a
 * plain form posting to `enterTournament` — the same guarded action the
 * events list and the chooser use, so nothing here decides who may open what.
 * `"player"` keeps an organizer who switches from here inside the play shell.
 *
 * WATCHING is stated in words and in a chip, never by colour alone: it is the
 * one fact that explains why the card tab says there is nothing to fill in.
 */
export function TournamentSwitcher({ switcher }: { switcher: Switcher }) {
  const { current, others } = switcher;
  if (!current && others.length === 0) return null;

  return (
    <nav
      aria-label="Tournament"
      className="no-print"
      style={{
        borderBottom: "1px solid var(--color-divider)",
        background: "var(--color-surface)",
      }}
    >
      {/* Keyed on the tournament: the layout survives the navigation a switch
          makes, so without a fresh element the list stayed open over the
          tournament somebody had just chosen. */}
      <details key={current?.eventId ?? "none"} style={{ maxWidth: 620, margin: "0 auto" }}>
        <summary
          style={{
            gap: 10,
            padding: "6px calc(16px + env(safe-area-inset-right, 0px)) 6px calc(16px + env(safe-area-inset-left, 0px))",
            cursor: "pointer",
            listStyle: "none",
          }}
        >
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span className="text-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {current ? "Tournament" : "Choose a tournament"}
            </span>
            {current && (
              <span
                style={{
                  fontWeight: 600,
                  fontSize: 14.5,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {current.name}
              </span>
            )}
            {current?.note && !current.watching && (
              <span className="text-muted" style={{ fontSize: 11.5 }}>
                {current.note}
              </span>
            )}
          </span>
          {current?.watching && (
            <span
              style={{
                flex: "none",
                fontSize: 11.5,
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: 999,
                border: "1px solid var(--color-divider)",
                color: "var(--color-text)",
                whiteSpace: "nowrap",
              }}
            >
              Watching · read-only
            </span>
          )}
          {others.length > 0 && (
            <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: "var(--color-accent-300)", fontWeight: 600 }}>
              Switch <Icon name="caret-down" />
            </span>
          )}
        </summary>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: "4px calc(16px + env(safe-area-inset-right, 0px)) 14px calc(16px + env(safe-area-inset-left, 0px))",
          }}
        >
          {others.map((o) => (
            <form key={o.eventId} action={enterTournament.bind(null, o.eventId, "player")}>
              <button
                type="submit"
                className="btn btn-secondary"
                style={{
                  width: "100%",
                  minHeight: 52,
                  justifyContent: "space-between",
                  textAlign: "left",
                  gap: 10,
                }}
              >
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {o.name}
                  </span>
                  {o.note && (
                    <span className="text-muted" style={{ fontSize: 12, fontWeight: 500 }}>
                      {o.note}
                    </span>
                  )}
                </span>
                <Icon name="arrow-right" />
              </button>
            </form>
          ))}
          {/* The full list — entering, dates, results — is the Events tab now,
              so there is no second link to it here. */}
        </div>
      </details>
    </nav>
  );
}
