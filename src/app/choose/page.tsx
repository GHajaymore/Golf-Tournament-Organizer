import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { enterTournament, signOutAction } from "@/app/actions/auth";
import { homeFor } from "@/lib/roles";
import { safeNextPath } from "@/lib/domain/safe-next";
import { prisma } from "@/lib/db";
import { accessibleEvents } from "@/lib/services/access";
import { NOINDEX } from "@/lib/site";

// Behind a session, and it lists the tournaments this person can reach.
export const metadata = { title: "Choose a tournament", robots: NOINDEX };
import { ROLE_LABEL } from "@/lib/roles";
import { Logo, LOGO_SIZE } from "@/components/Logo";
import { BrandMark } from "@/components/BrandMark";
import { CreateFirstTournament } from "@/components/CreateFirstTournament";
import { orgProfile } from "@/lib/domain/org-profile";
import { OrgSetupChecklist } from "@/components/OrgSetupChecklist";
import { orgSetupFactsFor, organizationsForOrganizer } from "@/lib/services/organization";
import { orgSetupState } from "@/lib/domain/org-setup";
import { Icon } from "@/components/Icon";

export default async function ChooseTournamentPage({
  searchParams,
}: {
  searchParams: Promise<{ stay?: string; next?: string }>;
}) {
  const session = await requireSession();
  const { stay, next } = await searchParams;

  // Includes tournaments reached through organization membership, not just
  // those with an explicit per-event account — otherwise a club admin can't
  // see events their colleagues created.
  const access = await accessibleEvents(session.email);
  const events = await prisma.event.findMany({
    where: { id: { in: access.map((a) => a.eventId) } },
    include: { _count: { select: { players: true } }, organization: { select: { name: true, kind: true } } },
    orderBy: { createdAt: "desc" },
  });
  // Null for anybody who runs no organization of their own, which is every
  // player invited to somebody else's tournament.
  const facts = await orgSetupFactsFor(session.email, session.name);
  const setup = facts ? orgSetupState(facts) : null;

  const roleByEvent = new Map(access.map((a) => [a.eventId, a]));
  const accounts = events.map((event) => ({
    id: event.id,
    eventId: event.id,
    role: roleByEvent.get(event.id)?.role ?? "player",
    source: roleByEvent.get(event.id)?.source ?? "event",
    event,
  }));

  // With exactly one tournament there's nothing to choose between, so don't
  // make people click through a list of one — the common case for players.
  // `?stay=1` keeps the picker visible for anyone who wants to create another.
  //
  // No active-event cookie is set here: cookies can only be written from a
  // Server Action or Route Handler, not during a render. It isn't needed
  // either — with a single account, getSession's "most recent tournament"
  // fallback already resolves to this one.
  if (accounts.length === 1 && !stay) {
    /**
     * The remembered destination wins, when there is one.
     *
     * This is where a deep link finally lands: somebody followed a link to the
     * tee sheet, was asked to sign in, and this is the first point at which
     * their one tournament is known. Re-validated rather than trusted — it
     * arrived as a query parameter and could say anything.
     *
     * Only in the single-tournament branch. With several, `next` says nothing
     * about WHICH one was meant, and sending them somewhere on the wrong
     * tournament is worse than showing the picker they would have seen anyway.
     *
     * Falls back to landing BY ROLE. A player with one tournament used to be
     * sent to /dashboard — the organizer's screen, emptied by the role guards —
     * while the player app sat one hand-typed URL away.
     */
    redirect(safeNextPath(next) ?? homeFor(accounts[0].role));
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 24px",
        background:
          "radial-gradient(1100px 650px at 85% -140px, var(--color-accent-900), transparent 62%), " +
          "radial-gradient(900px 500px at -10% 110%, var(--color-accent-2-900), transparent 55%), " +
          "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ width: "min(640px, 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
          <form action={signOutAction}>
            <button type="submit" className="btn btn-secondary" style={{ fontSize: 12 }}>
              <Icon name="sign-out" /> Sign out
            </button>
          </form>
        </div>

        <div className="page-kicker">Signed in as {session.name}</div>
        <h1 style={{ fontSize: 32, margin: "8px 0 4px" }}>
          {accounts.length === 0 ? "Welcome to TourneyHQ" : "Which tournament?"}
        </h1>
        <p className="text-muted" style={{ fontSize: 14, margin: "0 0 28px" }}>
          {accounts.length === 0
            ? "Your account is ready. If an organizer has invited you to a tournament, it appears here as soon as they add your email — otherwise create your own below."
            : `You have access to ${accounts.length} tournament${accounts.length === 1 ? "" : "s"}.`}
        </p>

        {/* The organization checklist lives HERE, and this is the only place
            it can. Every screen in the (app) shell goes through
            requireEventSession, which bounces anybody without an active
            tournament straight back to this page — so an organizer who has
            just signed up can reach nothing else. This app is event-first: the
            club settings hang off a tournament rather than the other way
            round.

            It renders nothing at all for somebody who runs no organization (a
            player invited to a tournament) and nothing once everything that
            applies is done, so the common case is unchanged.

            `currentPath` matters here specifically: the "Create your first
            tournament" step points at `/choose?stay=1`, which is THIS page —
            and `CreateFirstTournament`, the form that does it, is a few lines
            below. The row stays and still counts; it just stops offering a
            click that reloads the page under it. */}
        {setup && (
          <div style={{ marginBottom: 18 }}>
            <OrgSetupChecklist state={setup} currentPath="/choose" />
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {accounts.map((a) => (
            <form key={a.id} action={enterTournament.bind(null, a.eventId)}>
              <button
                type="submit"
                className="card elev-sm"
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  // `.card` is `display: flex; flex-direction: column`, so an
                  // inline `display: flex` sets the display it already had and
                  // leaves the COLUMN in place. This row rendered as a centred
                  // stack — name, meta, then the tag and arrow underneath —
                  // with `space-between` distributing it vertically and
                  // `textAlign: left` overruled by `alignItems: center`.
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  cursor: "pointer",
                  border: "1px solid var(--color-divider)",
                }}
              >
                <div>
                  <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 17 }}>
                    {a.event.name || "Untitled tournament"}
                  </div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>
                    {a.event.dates || "No dates set"}
                    {a.event.course ? ` · ${a.event.course}` : ""} · {a.event._count.players} players
                    {/* Whose name is worth showing: a tenant shared with other
                        people, so the row says which one. A personal organizer's
                        org name is their own and adds nothing. Asked via the
                        profile rather than compared, so a society gets it too. */}
                    {a.event.organization && orgProfile(a.event.organization.kind).sharedRoster
                      ? ` · ${a.event.organization.name}`
                      : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>
                  {/* Makes inherited access legible: "why can I see this?"
                      The sentence that answered it was in a `title`, so on a
                      phone the tag said "via club" and nothing else — and it
                      said CLUB to a society, which is the noun #253 taught the
                      console to stop assuming. Per row, because each of these
                      tournaments belongs to a different outfit; the sentence
                      is under the list, said once. */}
                  {a.source === "organization" && (
                    <span className="tag tag-neutral">
                      <Icon name="buildings" /> via {orgProfile(a.event.organization?.kind).noun}
                    </span>
                  )}
                  <span className={`tag ${a.role === "admin" ? "tag-accent" : "tag-neutral"}`}>{ROLE_LABEL[a.role] ?? a.role}</span>
                  <Icon name="arrow-right" style={{ color: "var(--color-accent-300)" }} />
                </div>
              </button>
            </form>
          ))}
        </div>

        {/* Said once, under the list, rather than in a tooltip on every row.
            "Why can I see this one?" is asked of a tournament nobody named you
            on — and the answer only appeared on hover, which is no answer at
            all on the device this list is opened on. */}
        {accounts.some((a) => a.source === "organization") && (
          <p className="text-muted" style={{ fontSize: 12, margin: "10px 0 0", lineHeight: 1.5 }}>
            Tournaments marked <b>via</b> are ones you reach through your role in the organization
            that runs them, rather than because somebody added you to that tournament.
          </p>
        )}

        {/* OFFERED BEFORE THE TOURNAMENT BUILDER, and above it on the page.
            Not because it matters more, but because it is the request this
            screen was worst at: somebody who wants to play one person over
            eighteen holes had to answer "what shape of tournament is this?"
            with three options, none of which is a match, and then find their
            way through entries, flights and a format picker to a fixture whose
            two players they knew before they started. Walked end to end on
            2026-09-07, that was six screens; this is one.

            It is a LINK, not a form. Everything the match screen asks — two
            names, holes, whether shots are given — belongs together on one
            page, and half of it inline here would be the same decision split
            across two places again. */}
        <Link
          href="/match/new"
          className="card elev-sm"
          style={{
            marginTop: 18,
            display: "flex",
            // See the tournament button above: `.card` is a COLUMN, and an
            // inline `display: flex` does not undo that. Without this the
            // icon, the wording and the arrow stacked vertically, centred.
            flexDirection: "row",
            alignItems: "center",
            gap: 14,
            textDecoration: "none",
            color: "var(--color-text)",
            border: "1px solid var(--color-divider)",
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              flex: "none",
              display: "grid",
              placeItems: "center",
              borderRadius: 10,
              background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)",
            }}
          >
            <Icon name="sword" style={{ color: "var(--color-accent-2)", fontSize: 18 }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 500, fontSize: 16 }}>
              Just playing a round?
            </div>
            {/* Kept in step with the same door on the tournament switcher and
                with the screen itself — three places describing one screen is
                three places to drift, and all three said "two players" the day
                that stopped being true. */}
            <div className="text-muted" style={{ fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
              A match, a medal or a fourball. Up to eight players, one round, no tournament
              needed.
            </div>
          </div>
          <Icon name="arrow-right" style={{ color: "var(--color-accent-300)", marginLeft: "auto", flex: "none" }} />
        </Link>

        {/* Keyed on the count so the form remounts (and collapses) once the
            first tournament exists, instead of staying open from its initial
            "no tournaments yet" state. */}
        <CreateFirstTournament
          key={accounts.length}
          first={accounts.length === 0}
          /* Whether "Who's running this?" is a real question — see the prop.
             Every organization has a name from birth, so this is the derived
             one, not the presence of a string. */
          organizationNamed={facts?.named ?? false}
          /* The club answers the first tournament waits on — see the prop.
             The same list the checklist above renders, from the same call, so
             a step cannot be outstanding in one and satisfied in the other. */
          clubSteps={(setup?.outstanding ?? []).map((s) => ({
            key: s.key,
            title: s.title,
            href: s.href,
          }))}
          /* Names the outfit in the app's own words wherever this screen
             mentions it — "Name your society", "Change it later on Society
             settings". Empty resolves to `personal`, which is what somebody
             with no organization yet is about to be given. */
          orgKind={facts?.kind ?? ""}
          /* Only asked when there is more than one — see the prop. Each one
             carries its own plan, so the retention warning follows the pick. */
          organizations={await organizationsForOrganizer(session.email)}
        />

        {/* A player given a round code but never added by email lands here with
            nothing to enter — accessibleEvents only knows people an organizer
            put on the roster. This is their way in: the existing /play code
            entry, not a new sign-up path. Shown only in the empty state, where
            "I was sent a code" is the likeliest reason someone sees no events. */}
        {accounts.length === 0 && (
          <div
            style={{
              marginTop: 18,
              paddingTop: 18,
              borderTop: "1px solid var(--color-divider)",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Given a round code?</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                Playing today but not on the list yet — enter the code from your organizer.
              </div>
            </div>
            <Link href="/play" className="btn btn-secondary" style={{ flex: "none" }}>
              <Icon name="flag" /> Join with a round code
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
