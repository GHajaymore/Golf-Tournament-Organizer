import Link from "next/link";
import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { redirect } from "next/navigation";
import { pts, shortName } from "@/lib/format";
import { drawBrackets, isBracketMode, type BracketMode } from "@/lib/domain";

export default async function QualificationPage() {
  const session = await requireScreen("qualification");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const { event, groupStandings, overall, advancingCount, advancingIds, overallCutoff, qualifiers } = state;

  /**
   * From the DRAW, not from arithmetic this screen invented.
   *
   * It hardcoded the split — half to Winners, half to Consolation — and never
   * read `bracketMode` at all, so it described a draw the tournament was not
   * going to make. Under "One bracket" it told an organizer that four of eight
   * qualifiers were going into a second bracket that does not exist, and then
   * the bracket screen showed all eight in one. Under "Main + plate" it
   * claimed four to a Consolation before anybody had lost, when a plate is
   * filled from the first round's losers and is empty at that moment.
   *
   * `drawBrackets` is what the real draw uses, so asking it is the only way
   * these numbers cannot drift from what happens next.
   */
  const mode: BracketMode = isBracketMode(event.bracketMode) ? event.bracketMode : "split";
  const draw = drawBrackets(qualifiers, mode);
  const toWinners = draw.main.length;
  const toConsolation = draw.second.length;
  // Empty for "One bracket", which has no second draw to describe — so the
  // card is not rendered at all rather than reading "To Consolation: 0".
  const secondLabel = draw.secondLabel;
  const groupByPlayer = new Map(
    state.groups.flatMap((g, i) => state.confirmed.filter((p) => p.groupId === g.id).map((p) => [p.id, i + 1])),
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="page-kicker">Manage</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Qualification</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Advance the top players from each flight, or the top players overall. The preview shows exactly who qualifies.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="tag tag-accent">
            {event.qualifyMode === "overall" ? `Top ${event.qualifyOverall} overall` : `Top ${event.qualifyPerGroup}/flight`}
          </span>
          <Link className="btn btn-secondary" href="/stages">
            <i className="ph ph-sliders" /> Configure in Rounds &amp; format
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 140, gap: 2 }}>
          <span className="card-kicker">Advancing</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{advancingCount} / {state.confirmed.length}</div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 140, gap: 2 }}>
          <span className="card-kicker">To Winners bracket</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{toWinners}</div>
        </div>
        {secondLabel && (
          <div className="card elev-sm" style={{ flex: 1, minWidth: 140, gap: 2 }}>
            <span className="card-kicker">To {secondLabel}</span>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{toConsolation}</div>
          </div>
        )}
        <div className="card elev-sm" style={{ flex: 1, minWidth: 140, gap: 2 }}>
          <span className="card-kicker">Cutoff pts</span>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 24 }}>{overallCutoff === null ? "—" : pts(overallCutoff)}</div>
        </div>
      </div>

      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="card-title" style={{ fontSize: 15 }}>
            {qualifiers.length} players qualify for the knockout round
          </span>
          <span className="tag tag-accent">
            {event.qualifyMode === "overall" ? `Top ${event.qualifyOverall} overall` : `Top ${event.qualifyPerGroup}/flight`}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0 24px", marginTop: 6 }}>
          {overall
            .filter((r) => advancingIds.has(r.player.id))
            .map((r, i) => (
              <div key={r.player.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "5px 0", borderBottom: "1px solid var(--color-divider)" }}>
                <span style={{ width: 18, color: "var(--color-neutral-500)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.player.name}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>Flight {groupByPlayer.get(r.player.id) ?? "—"}</span>
                <span style={{ fontWeight: 600, color: "var(--color-accent-200)", fontVariantNumeric: "tabular-nums", width: 40, textAlign: "right" }}>{pts(r.stats.totalPoints)}</span>
              </div>
            ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {groupStandings.map((gs, gi) => (
          <div key={gs.group.id} className="card elev-sm">
            <span style={{ fontWeight: 600, fontSize: 14 }}>Flight {gi + 1}</span>
            <table className="table" style={{ fontSize: 13 }}>
              <tbody>
                {gs.ranked.map((r) => {
                  const advancing = advancingIds.has(r.player.id);
                  return (
                    <tr key={r.player.id} style={advancing ? { background: "var(--color-accent-900)" } : undefined}>
                      <td style={{ width: 26, color: "var(--color-neutral-500)" }}>{r.rank}</td>
                      <td style={{ fontWeight: 500 }}>{shortName(r.player.name)}</td>
                      <td>
                        <span className={`tag ${advancing ? "tag-accent" : "tag-neutral"}`}>
                          {advancing ? "Advancing" : "Eliminated"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {pts(r.stats.totalPoints)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
