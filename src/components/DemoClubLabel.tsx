import { isDemoOrganization } from "@/lib/services/demo-guard";
import { DEMO_LABEL, DEMO_LABEL_NOTE } from "@/lib/domain/demo-club";

/**
 * "DEMO CLUB, INVENTED PLAYERS" — on every page of the demo club a visitor can
 * open: the board, the clubhouse screen, the event page and the report
 * (2026-10-24; docs/claude/demo-club.md). Nothing for any other club.
 *
 * A label, not a branch: the page around it is drawn exactly as it is for any
 * club. `data-demo-club` is how the hourly canary recognises a demo board and
 * refuses to watch it in place of a real one (`scripts/prod-smoke.mjs`).
 */
export async function DemoClubLabel({ organizationId, large = false }: { organizationId: string; large?: boolean }) {
  if (!(await isDemoOrganization(organizationId))) return null;
  return (
    <aside
      data-demo-club=""
      aria-label={DEMO_LABEL}
      style={{
        // Fallbacks for the report page, which draws in its own sheet rather than the club's tokens.
        border: "1px dashed var(--color-divider, currentColor)",
        borderRadius: 10,
        padding: large ? "12px 18px" : "8px 12px",
        margin: "0 0 16px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "4px 10px",
        minWidth: 0,
      }}
    >
      <strong style={{ fontSize: large ? 24 : 14, letterSpacing: "0.02em" }}>{DEMO_LABEL}</strong>
      <span style={{ fontSize: large ? 18 : 13, color: "var(--color-neutral-400, inherit)" }}>{DEMO_LABEL_NOTE}</span>
    </aside>
  );
}
