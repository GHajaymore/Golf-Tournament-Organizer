import FieldInfo from "@/components/FieldInfo";
import { useMoney } from "@/components/CurrencyProvider";

/**
 * Who is up on the year.
 *
 * A league settles every week, so this is a record rather than a debt — the
 * money has already changed hands. It answers the one question a league
 * actually asks in the bar, and deliberately nothing more.
 *
 * A server component: there is nothing to interact with, so there is no
 * reason to ship it to the browser.
 */

export interface SkinsSeasonRowView {
  playerId: string;
  name: string;
  netCents: number;
  weeksPlayed: number;
}

/** Digits only, with the right number of them for this club's currency. */

export function SkinsSeason({ rows }: { rows: SkinsSeasonRowView[] }) {
  const { plain: money } = useMoney();
  if (rows.length === 0) return null;

  return (
    <div className="card elev-sm" style={{ gap: 10, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Skins — the season</span>
        <FieldInfo label="the season table">
          <p>
            Every week&rsquo;s result added up. Each week has already been settled on the night, so
            this is a record of how the year has gone rather than money still owed.
          </p>
          <p>Weeks counts the pots a player was in, not the rounds they played.</p>
        </FieldInfo>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Player</th>
              <th style={{ textAlign: "center" }}>Weeks</th>
              <th style={{ textAlign: "right" }}>Up / down</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId}>
                <td>{r.name}</td>
                <td style={{ textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{r.weeksPlayed}</td>
                <td
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: 500,
                    color:
                      r.netCents < 0
                        ? "var(--color-danger)"
                        : r.netCents > 0
                          ? "var(--color-accent-2)"
                          : "inherit",
                  }}
                >
                  {r.netCents > 0 ? "+" : ""}{money(r.netCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
