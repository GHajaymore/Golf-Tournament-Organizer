import Link from "next/link";
import { requireSession } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { NOINDEX } from "@/lib/site";
import { orgSetupFactsFor, organizationsForOrganizer } from "@/lib/services/organization";
import { orgSetupState } from "@/lib/domain/org-setup";
import { clubToday } from "@/lib/domain/club-clock";
import { golfRegister } from "@/lib/domain/golf-terms";
import { resolveLocale } from "@/lib/domain/locale";
import { teeViewsOf } from "@/lib/services/handicaps";
import { Lockup } from "@/components/Lockup";
import { LOGO_SIZE } from "@/components/Logo";
import { SetupQuestions, type SetupCourse, type SetupOrg } from "@/components/SetupQuestions";

// Behind a session; it reads the club's own courses.
export const metadata = { title: "Set up a tournament", robots: NOINDEX };

/**
 * THE SETUP QUESTIONNAIRE (2 Nov) — the first way to create a tournament: a
 * few plain questions, each already answered with the commonest choice, then
 * the draft to change, the scorecard to check, and one button. The panel's
 * record: `TourneyHQ Documents/Setup questionnaire - panel 2 Nov.md`.
 *
 * Everything the screen needs is read here, on the server: the club's today in
 * its own time zone (the default first day), which golf it speaks (the default
 * format), and its courses with each set of tees' card resolved by the same
 * rule a round is scored with (`teeViewsOf`).
 */
export default async function NewTournamentPage() {
  const session = await requireSession();
  const [facts, organizations] = await Promise.all([
    orgSetupFactsFor(session.email, session.name),
    organizationsForOrganizer(session.email),
  ]);
  const setup = facts ? orgSetupState(facts) : null;
  const ids = organizations.map((o) => o.id);
  const [orgRows, courseRows] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: ids } },
      select: { id: true, timeZone: true, locale: true, country: true, golfTerms: true },
    }),
    prisma.course.findMany({
      where: { organizationId: { in: ids } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        organizationId: true,
        name: true,
        pars: true,
        yards: true,
        strokeIndex: true,
        verifiedAt: true,
        tees: {
          orderBy: [{ position: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            gender: true,
            courseRating: true,
            slopeRating: true,
            par: true,
            pars: true,
            yards: true,
            strokeIndex: true,
          },
        },
      },
    }),
  ]);
  // `organizationsForOrganizer` returns them in the order a new tournament is
  // filed by, so its first is the default; a lookup by id has no order.
  const byId = new Map(orgRows.map((o) => [o.id, o]));
  const orgs: SetupOrg[] = organizations.map((o) => {
    const row = byId.get(o.id);
    return {
      id: o.id,
      name: o.name,
      today: clubToday(row?.timeZone ?? ""),
      locale: resolveLocale(row ?? null),
      register: golfRegister(row?.country ?? o.country, row?.golfTerms),
    };
  });
  const courses: SetupCourse[] = courseRows.map((c) => ({
    id: c.id,
    organizationId: c.organizationId,
    name: c.name,
    checked: c.verifiedAt !== null,
    tees: teeViewsOf(c).map((t) => ({
      id: t.id,
      name: t.name,
      gender: t.gender,
      courseRating: t.courseRating,
      slopeRating: t.slopeRating,
      par: t.par,
      rated: t.rated,
      pars: t.pars,
      yards: t.yards,
      strokeIndex: t.strokeIndex,
    })),
  }));
  // Nobody with no organization yet: the one about to be made is a personal
  // one, on the server's day until it is given a zone, in US golf words.
  const fallback: SetupOrg = { id: "", name: "", today: clubToday(""), locale: resolveLocale(null), register: golfRegister(facts?.country ?? "") };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "40px 16px 64px",
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ width: "min(760px, 100%)", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, gap: 12 }}>
          <Lockup size={LOGO_SIZE.md} />
          <Link href="/choose?stay=1" className="btn btn-secondary" style={{ fontSize: 13 }}>
            Set it up yourself
          </Link>
        </div>
        <SetupQuestions
          orgs={orgs.length ? orgs : [fallback]}
          courses={courses}
          organizationNamed={facts?.named ?? false}
          clubSteps={(setup?.outstanding ?? []).map((s) => ({ key: s.key, title: s.title, href: s.href }))}
          orgKind={facts?.kind ?? ""}
          orgCountry={facts?.country ?? ""}
          orgNoun={facts?.communityNoun ?? ""}
        />
      </div>
    </main>
  );
}
