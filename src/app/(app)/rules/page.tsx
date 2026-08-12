import { requireScreen } from "@/lib/page-helpers";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadEventState, scoringFrom } from "@/lib/services/tournament";
import { RULES, RULE_SOURCE_LABEL, TIER_LABEL, tournamentTerms, ruleFor } from "@/lib/rules";
import type { TiebreakerKey } from "@/lib/domain";

/**
 * The three tiers a competition is actually played under.
 *
 *   Rules of Golf     — the governing rules. Cited and linked, never copied.
 *   Tournament rules  — this event's own terms, DERIVED from its configuration
 *                       rather than typed, so the published terms and the way
 *                       the app scores cannot drift apart. That drift is the
 *                       whole failure mode of a hand-written hard card.
 *   Course rules      — the club's Local Rules, optional, in the club's words.
 *
 * The audience is whoever has to defend a result. A professional asked why a
 * tie broke that way, or which allowance was applied, answers from here.
 */

export default async function RulesPage() {
  await requireScreen("rules");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);

  const stage = state?.activeStage ?? state?.stages[0] ?? null;
  // Via scoringFrom rather than parsing the column here: it already carries the
  // default order for a malformed value, and a reference page that stated a
  // different tiebreak order from the engine would be worse than one that said
  // nothing at all.
  const tiebreakers: TiebreakerKey[] = state ? scoringFrom(state.event).tiebreakers : [];

  const terms =
    state && stage
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

  // Local Rules for the courses this tournament is actually played on, so a
  // club with a dozen courses shows the ones that matter today.
  const courses = state
    ? await prisma.course.findMany({
        where: { events: { some: { eventId: state.event.id } }, localRules: { not: "" } },
        select: { id: true, name: true, localRules: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div style={{ maxWidth: 780 }}>
      <div className="page-kicker">Reference</div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 28, margin: "6px 0 0", textWrap: "balance" }}>
        The rules this competition runs under
      </h1>
      <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
        Three tiers, most general first. Each one is applied within the one above it.
      </p>

      {/* ── 1 ─────────────────────────────────────────────────────────── */}
      <Tier
        n={1}
        title={TIER_LABEL["rules-of-golf"]}
        blurb="How the game is played. Published by the USGA and The R&A. We cite and link — never reproduce — so what you read is always the current text."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {Object.values(RULES).map((r) => (
            <a
              key={r.key}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card elev-sm"
              style={{ display: "block", textDecoration: "none", color: "inherit", padding: "13px 15px" }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  <span style={{ color: "var(--color-accent-300)", marginRight: 7 }}>{r.number}</span>
                  {r.title}
                </span>
                <i className="ph ph-arrow-square-out" aria-hidden style={{ color: "var(--color-neutral-400)" }} />
              </div>
              <p style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--color-neutral-400)" }}>
                <span style={{ color: "var(--color-neutral-500)" }}>{RULE_SOURCE_LABEL[r.source]}</span> · {r.why}
              </p>
            </a>
          ))}
        </div>
      </Tier>

      {/* ── 2 ─────────────────────────────────────────────────────────── */}
      <Tier
        n={2}
        title={TIER_LABEL.tournament}
        blurb={
          stage
            ? `What ${state?.event.name ?? "this tournament"} has decided within those rules. Read from the round's own settings, so these terms and the way scores are actually worked out cannot disagree.`
            : "Set up a round and its terms will be stated here automatically."
        }
      >
        {terms.length > 0 ? (
          <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
            {terms.map((t, i) => {
              const r = t.rule ? ruleFor(t.rule) : null;
              return (
                <div
                  key={t.label}
                  style={{
                    display: "flex",
                    gap: 14,
                    padding: "12px 15px",
                    borderTop: i === 0 ? undefined : "1px solid var(--color-divider)",
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ minWidth: 128, fontSize: 12.5, fontWeight: 600, color: "var(--color-neutral-400)" }}>
                    {t.label}
                  </span>
                  <span style={{ flex: 1, minWidth: 180, fontSize: 14, lineHeight: 1.5 }}>
                    {t.value}
                    {r && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "block",
                          marginTop: 3,
                          fontSize: 11.5,
                          color: "var(--color-neutral-400)",
                          textDecoration: "none",
                          borderBottom: 0,
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
          <p style={{ fontSize: 13.5, color: "var(--color-neutral-400)", margin: 0 }}>
            No round configured yet.
          </p>
        )}
      </Tier>

      {/* ── 3 ─────────────────────────────────────────────────────────── */}
      <Tier
        n={3}
        title={TIER_LABEL.local}
        blurb="The club's own Local Rules for the course being played. Optional, and in the club's words — these are the ones that override everything above for the ground you are standing on."
      >
        {courses.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {courses.map((c) => (
              <div key={c.id} className="card elev-sm" style={{ padding: "14px 15px" }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{c.name}</div>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.localRules}</p>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--color-neutral-400)", margin: 0, lineHeight: 1.6 }}>
            None recorded. Add them on the course, under Club settings, and they will appear here and travel with
            every tournament played there.
          </p>
        )}
      </Tier>

      <p style={{ marginTop: 30, fontSize: 12, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
        The Rules of Golf and the Rules of Handicapping are published by the USGA and The R&amp;A and are their
        copyright. TourneyHQ links to them and does not reproduce them. Where a Local Rule or a condition of
        competition differs, that governs — not this page.
      </p>
    </div>
  );
}

function Tier({
  n,
  title,
  blurb,
  children,
}: {
  n: number;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 30 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
        <span
          aria-hidden
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--color-accent)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {n}
        </span>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 19, margin: 0 }}>{title}</h2>
      </div>
      <p style={{ margin: "5px 0 14px", fontSize: 13, lineHeight: 1.55, color: "var(--color-neutral-400)" }}>
        {blurb}
      </p>
      {children}
    </section>
  );
}
