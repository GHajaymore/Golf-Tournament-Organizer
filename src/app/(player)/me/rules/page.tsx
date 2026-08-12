import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, scoringFrom } from "@/lib/services/tournament";
import { prisma } from "@/lib/db";
import { RULES, RULE_SOURCE_LABEL, tournamentTerms, ruleFor } from "@/lib/rules";
import type { TiebreakerKey } from "@/lib/domain";

/**
 * The rules, for a player standing on the course.
 *
 * The console's version leads with the governing Rules, because an organizer
 * is setting a competition up. A player already knows how golf is played and
 * is asking one of two much narrower questions: what has THIS tournament
 * decided, and what does THIS course say. So the order is inverted — the two
 * tiers specific to today come first, and the governing rules sit underneath
 * as reference.
 */
export default async function PlayRulesPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const stage = state.activeStage ?? state.stages[0] ?? null;
  const tiebreakers: TiebreakerKey[] = scoringFrom(state.event).tiebreakers;
  const terms = stage
    ? tournamentTerms({
        format: stage.format,
        type: stage.type,
        holes: stage.holes === 9 ? 9 : 18,
        scoringBasis: stage.scoringBasis,
        handicapAllowance: stage.handicapAllowance,
        countBest: stage.countBest,
        tiebreakers,
        cutEnabled: stage.cutEnabled,
        cutMode: stage.cutMode,
        cutCount: stage.cutCount,
        cutPercent: stage.cutPercent,
        carryForwardEnabled: stage.carryForwardEnabled,
        carryForwardPct: stage.carryForwardPct,
      })
    : [];

  const courses = await prisma.course.findMany({
    where: { events: { some: { eventId: state.event.id } }, localRules: { not: "" } },
    select: { id: true, name: true, localRules: true },
    orderBy: { name: "asc" },
  });

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: "0 0 16px" }}>Rules</h1>

      <section>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 17, margin: "0 0 10px" }}>
          This tournament
        </h2>
        {terms.length ? (
          <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
            {terms.map((t, i) => {
              const r = t.rule ? ruleFor(t.rule) : null;
              return (
                <div
                  key={t.label}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "11px 14px",
                    borderTop: i === 0 ? undefined : "1px solid var(--color-divider)",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{ minWidth: 112, fontSize: 12, fontWeight: 600, color: "var(--color-neutral-400)" }}
                  >
                    {t.label}
                  </span>
                  <span style={{ flex: 1, minWidth: 150, fontSize: 14, lineHeight: 1.5 }}>
                    {t.value}
                    {r && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "block",
                          marginTop: 2,
                          fontSize: 11.5,
                          color: "var(--color-neutral-400)",
                          textDecoration: "none",
                        }}
                      >
                        <i className="ph ph-book-open" aria-hidden style={{ marginRight: 4 }} />
                        under {RULE_SOURCE_LABEL[r.source]} {r.number}
                      </a>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: 14, color: "var(--color-neutral-400)", margin: 0 }}>No round set up yet.</p>
        )}
      </section>

      {courses.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 17, margin: "0 0 10px" }}>This course</h2>
          {courses.map((c) => (
            <div key={c.id} className="card elev-sm" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 5 }}>{c.name}</div>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {c.localRules}
              </p>
            </div>
          ))}
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 17, margin: "0 0 4px" }}>
          The Rules of Golf
        </h2>
        <p style={{ margin: "0 0 10px", fontSize: 12.5, lineHeight: 1.55, color: "var(--color-neutral-400)" }}>
          Published by the USGA and The R&amp;A. Links open their site.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {Object.values(RULES).map((r) => (
            <a
              key={r.key}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card elev-sm"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                textDecoration: "none",
                color: "inherit",
                padding: "12px 14px",
              }}
            >
              <span style={{ fontSize: 14 }}>
                <span style={{ color: "var(--color-accent-300)", marginRight: 6 }}>{r.number}</span>
                {r.title}
              </span>
              <i className="ph ph-arrow-square-out" aria-hidden style={{ color: "var(--color-neutral-400)" }} />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
