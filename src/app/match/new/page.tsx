import Link from "next/link";
import { requireSession } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { parseHoleArray } from "@/lib/courses";
import { NewMatchForm } from "@/components/NewMatchForm";
import { Logo, LOGO_SIZE } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";
import { Icon } from "@/components/Icon";
import { NOINDEX } from "@/lib/site";

export const metadata = { title: "Set up a round", robots: NOINDEX };

/**
 * Two people, one round, one screen.
 *
 * It sits outside the (app) shell on purpose. Every screen in there runs
 * through `requireEventSession`, which needs a tournament to already exist —
 * and the whole point of this one is that it is where a match comes from. Same
 * reason `/choose` lives out here.
 */
export default async function NewMatchPage() {
  const session = await requireSession();

  /**
   * The club's own courses, if there are any.
   *
   * Read from the organizations this person belongs to rather than from an
   * active tournament, because there may not be one — somebody who has just
   * signed up and wants to play their mate on Sunday has no event at all, and
   * a query hanging off one would send them to the picker screen instead.
   */
  const memberships = await prisma.organizationMember.findMany({
    where: { user: { email: session.email } },
    select: { organizationId: true },
  });
  const courses = await prisma.course.findMany({
    where: { organizationId: { in: memberships.map((m) => m.organizationId) } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, city: true, pars: true, strokeIndex: true },
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 20px 64px",
        background:
          "radial-gradient(1100px 650px at 85% -140px, var(--color-accent-900), transparent 62%), " +
          "radial-gradient(900px 500px at -10% 110%, var(--color-accent-2-900), transparent 55%), " +
          "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ width: "min(560px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div
            style={{
              width: 40,
              height: 40,
              display: "grid",
              placeItems: "center",
              borderRadius: 11,
              background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
            }}
          >
            <Logo size={LOGO_SIZE.md} style={{ color: "var(--color-accent)" }} />
          </div>
          <BrandMark />
        </div>

        {/* The heading and the form have to describe the same screen.

            Both of these said "match play, two people" — which was the whole
            of this page, and stopped being true the moment the form learned
            about round types and pairs. A stale heading is not cosmetic here:
            it is the first thing read, so a fourball arriving to be told the
            screen is for two people leaves before scrolling to the list that
            offers exactly what they came for. */}
        <div className="page-kicker">One round, no apparatus</div>
        <h1 style={{ fontSize: 30, margin: "8px 0 4px" }}>Set up a round</h1>
        <p className="text-muted" style={{ fontSize: 14, margin: "0 0 24px", lineHeight: 1.6 }}>
          A match, a medal or a fourball — scored properly, with nothing to configure.
          Pick what you&rsquo;re playing and who&rsquo;s in it; everything else has an answer
          already, and every one of them can be changed afterwards.
        </p>

        <NewMatchForm
          courses={courses.map((c) => ({
            id: c.id,
            name: c.name,
            city: c.city,
            // Shown, not hidden: a course with no card is still where you are
            // playing, and a level match does not need one.
            hasCard: parseHoleArray(c.pars) !== null && parseHoleArray(c.strokeIndex) !== null,
          }))}
          myName={session.name}
        />

        {/* The way back out. Somebody who wanted a field, flights and a
            sequence of rounds is one click from the screen that builds one —
            this page narrows the app deliberately, and a narrowing with no
            exit is a trap. */}
        <p className="text-muted" style={{ fontSize: 12.5, marginTop: 18, lineHeight: 1.6 }}>
          <Icon name="users-three" /> Running something bigger — a field, flights, several rounds?{" "}
          <Link href="/choose?stay=1" style={{ color: "var(--color-accent-300)" }}>
            Create a tournament instead
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
