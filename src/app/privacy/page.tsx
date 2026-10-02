import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { privacyContact } from "@/lib/domain/privacy-contact";
import { PLANS, PAR_LIFESPAN_DAYS } from "@/lib/plans";
import { RETAIN_AFTER_CANCEL_DAYS } from "@/lib/domain/billing";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { pageShareMeta } from "@/lib/landing/share-meta";
import { LANDING_CSS } from "@/lib/landing/styles";
import { LandingEffects } from "@/components/LandingEffects";
import { editionNote, iconSprite, landingFooter, landingNav } from "@/components/landing/chrome";

/**
 * The privacy policy, reachable without an account.
 *
 * Public on purpose: most of the people described by the data in this app
 * never signed up for it. A club uploads its member roster and those members
 * become players in a tournament without ever seeing a login screen, so a
 * policy behind the login would be unreadable by exactly the people it is
 * about. It is also a hard requirement for the app stores.
 *
 * Every statement here is checked against what the code actually does. Where
 * something is not implemented it is not promised. The deletion it describes is
 * built (2026-09-29): `par-sweep` and the daily `/api/cron/expire-rounds`, for
 * clubs on Par's terms — and its numbers and plan names are read from
 * `plans.ts`, so this page cannot drift from the rule it states.
 *
 * Dressed as the front door since 2026-09-30: the footer's "Privacy" link had
 * landed on the app's dark serif page, with no way back but a text link, and
 * read as a different site. The words follow the visitor's edition as `/` does.
 */

const PRIVACY_DESCRIPTION =
  "What TourneyHQ collects about organizers and players, why, who it is shared with, and how to have it removed.";

export const metadata: Metadata = {
  // "Privacy", not "Privacy — TourneyHQ": the root layout now appends the
  // product with a template, and carrying it here too rendered
  // "Privacy — TourneyHQ · TourneyHQ".
  title: "Privacy",
  description: PRIVACY_DESCRIPTION,
  // Its own, because a canonical inherited from the root would tell a crawler
  // this page is a duplicate of the landing page.
  alternates: { canonical: "/privacy" },
  // And its own link preview, or it is shared as the landing page (share-meta.ts).
  ...pageShareMeta({ path: "/privacy", title: "Privacy", description: PRIVACY_DESCRIPTION }),
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="lg-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default async function PrivacyPage() {
  /**
   * Resolved per render rather than at module load, so the address follows the
   * deployment's configuration rather than whatever was set when this module
   * was first evaluated. `privacyContact` refuses a reserved address, so an
   * unset variable and an example one both land in the same branch below.
   */
  const contact = privacyContact(process.env.PRIVACY_CONTACT_EMAIL);
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const { local, shown, overridden } = landingEdition(
    h.get("x-vercel-ip-country"),
    jar.get(US_OVERRIDE_COOKIE)?.value === "1",
  );
  const kept = [PLANS.society.name, PLANS.club.name, PLANS.enterprise.name];

  const page = (
    <div className="thq" lang={shown.locale}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <LandingEffects />
      {iconSprite()}
      {landingNav("privacy")}

      <main className="legal">
      <section className="fq-hero">
        <div className="wrap">
          <span className="label">Privacy</span>
          <h1 className="h1">What we keep, <span className="o">and why.</span></h1>
          <p className="lead">
            What we collect, why, who else sees it, and how to have it removed. Written to describe
            what the software actually does, not what sounds reassuring.
          </p>
        </div>
      </section>
      <div className="wrap lg-body">

      <Section title="Who holds your data">
        <p>
          TourneyHQ is used by golf clubs, societies and event organizers to run competitions. When a
          club enters you into a tournament, <strong>the club decides</strong> what to collect and
          why. We store and process it on their behalf and act on their instructions.
        </p>
        <p>
          In data-protection terms the club is the <em>controller</em> and TourneyHQ is the{" "}
          <em>processor</em>. In practice that means: if you want your details corrected or removed,
          your club can do it directly, and that is usually the fastest route. If they cannot,{" "}
          {contact.kind === "address" ? (
            <>
              write to us at <a href={`mailto:${contact.email}`}>{contact.email}</a> and we will act
              on it.
            </>
          ) : (
            <>ask your club to raise it with us, and we will act on it.</>
          )}
        </p>
        <p>
          <strong>You may be in here without ever having signed up.</strong> That is normal for club
          golf — an organizer enters the field from the club&rsquo;s own membership records. It does
          not reduce your rights below, and it is why this page is readable without an account.
        </p>
      </Section>

      <Section title="What is collected">
        <p>About players in a tournament, from the club:</p>
        <ul>
          <li>Name</li>
          <li>Email address and phone number, where the club provides them</li>
          <li>Handicap index, and whether it is a 9 or 18-hole index</li>
          <li>Scores, results and any note attached to a card</li>
          <li>Weekly availability, in leagues that ask</li>
        </ul>
        <p>About people who sign in to run an event:</p>
        <ul>
          <li>Email address and name</li>
          <li>A password, stored only as a hash — we cannot read it</li>
        </ul>
        <p>About the club itself: its name, town or region, colors and logo.</p>
        <p>
          If an organizer opens self-service registration, whatever a person types into that form —
          typically the same name, contact details and handicap.
        </p>
      </Section>

      <Section title="What is not collected">
        <p>
          No payment card details. When a club pays for a plan it pays on Stripe&rsquo;s own page, and
          the card goes to Stripe, never to us. Money in a tournament &mdash; entry fees, skins,
          payouts &mdash; is worked out and recorded, never taken. No location tracking. No
          advertising identifiers, and no third-party analytics or advertising trackers.
        </p>
        <p>
          Sign-in and abuse limits are counted against a <strong>hashed</strong> identifier. The code
          that stores those counts never receives the original value.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          One cookie signs you in and keeps you signed in. It holds a signed reference to your
          account and nothing else. A second, similar cookie is used when a player joins a round with
          a code instead of an account.
        </p>
        <p>They are not used to track you between sites or to build a profile.</p>
      </Section>

      <Section title="Who else sees it">
        <p>Only what is needed to run the service:</p>
        <ul>
          <li>
            <strong>Vercel</strong> — hosting. Serves the app and keeps standard server logs.
          </li>
          <li>
            <strong>Our database provider</strong> — stores the tournament data described above.
          </li>
          <li>
            <strong>Stripe</strong> — only when a club pays for a plan. Stripe receives the
            club&rsquo;s name and the email address of the person who buys, and takes the payment.
            No player&rsquo;s details are sent.
          </li>
          <li>
            <strong>Sentry</strong> — error reports, where they are switched on. When a page fails on
            our server, a report of the fault is sent: the address of the page, with any link token
            and email address removed, and the technical details of the error. No cookies and no IP
            address are included.
          </li>
          <li>
            <strong>Anthropic</strong> — only for the features your club switches on, and only when
            someone uses them:
            <ul>
              <li>
                <em>Reading a scorecard from a photo.</em> The photograph is sent, along with the
                name of the player whose scores are being read. A photograph of a card may also show
                other players&rsquo; names and scores, and handwriting.
              </li>
              <li>
                <em>AI-written commentary.</em> Current standings, which include player names, are
                sent to generate a line of text.
              </li>
              <li>
                <em>Describing a tournament in words.</em> Only the sentence the organizer types is
                sent. No player data is included.
              </li>
              <li>
                <em>Drafting an announcement.</em> A summary of the event is sent: its name, the
                size of the field, the rounds, the leading players by name with their scores or
                points, and, where a league runs skins, who is up or down on the season and by how
                much. Contact details are never included.
              </li>
            </ul>
            Nothing is sent unless the feature is enabled and someone uses it. Photographs are sent
            to be read and are not stored by us; only the scores a person confirms are kept.
          </li>
        </ul>
        <p>We do not sell personal data, and we do not share it for advertising.</p>
      </Section>

      <Section title="Public leaderboards">
        <p>
          An organizer can publish a leaderboard on a link anyone can open, for a clubhouse screen or
          to share with a field. It shows what a leaderboard shows: names, scores and standings. It
          does not show email addresses or phone numbers.
        </p>
        <p>
          Whether to publish one is the organizer&rsquo;s decision, and they can stop sharing it at
          any time.
        </p>
      </Section>

      <Section title="How long it is kept">
        <p>
          <strong>On {PLANS.free.name}, the free plan</strong>, a tournament is deleted for good — its
          entries, cards, results and money — when its organizer marks it Completed, or{" "}
          {PAR_LIFESPAN_DAYS} days after its first round is played, whichever comes first. This applies
          to clubs that joined after the free plan&rsquo;s terms were introduced on 29 September 2026; a
          free club that joined before then keeps its tournaments as the paid plans do.
        </p>
        <p>
          <strong>On {kept.join(", ").replace(/, ([^,]*)$/, " and $1")}</strong>, tournament data is
          kept until the club deletes it or asks us to. When a paid plan ends, every tournament is
          kept for {RETAIN_AFTER_CANCEL_DAYS} more days, and then the free plan&rsquo;s terms apply
          &mdash; see the <Link href="/terms">terms</Link>.
        </p>
        <p>
          A casual round is deleted 24 hours after it is set up unless its organizer keeps it. On{" "}
          {PLANS.free.name}, for clubs that joined after those terms were introduced, it cannot be kept.
        </p>
        <p>An organizer can remove a player, or a member from the club roster, at any time.</p>
      </Section>

      <Section title="Your rights">
        <p>
          Depending on where you live you may have the right to see the personal data held about you,
          have it corrected, have it deleted, or object to how it is used.
        </p>
        <p>
          <strong>Ask your club first</strong> — they hold the relationship and can act immediately.
          If that does not resolve it,{" "}
          {contact.kind === "address" ? (
            <>
              write to <a href={`mailto:${contact.email}`}>{contact.email}</a> and we will action it,
              and tell the club we have.
            </>
          ) : (
            <>ask your club to raise it with us, and we will action it.</>
          )}
        </p>
      </Section>

      <Section title="Children">
        <p>
          Junior competitions are part of club golf, and a club may enter players under 18. Where it
          does, the club is responsible for having the right permission from a parent or guardian.
          TourneyHQ collects nothing extra from a junior player, and no account is needed to appear
          in a field or on a leaderboard.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Traffic is encrypted in transit. Passwords are stored only as hashes. Access to a
          tournament is scoped to the organization that owns it, and checked on the server rather
          than only hidden in the interface.
        </p>
        <p>No system is perfect; if you believe you have found a problem, please tell us.</p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes in a way that affects what is collected or who it is shared with, the
          date below changes and the change is described here rather than made quietly.
        </p>
        <p>
          <strong>2 October 2026:</strong> Stripe is listed, for clubs that pay for a plan, and
          Sentry, for error reports; a paid plan that ends keeps its tournaments for{" "}
          {RETAIN_AFTER_CANCEL_DAYS} days.
        </p>
        <p>
          <strong>30 September 2026:</strong> &ldquo;How long it is kept&rdquo; now describes the
          deletion on the free plan, which is built and running; the icon stylesheet on a public CDN is
          no longer listed, because the icons are now part of the page and nothing is fetched from it.
        </p>
        <p className="lg-date">Last updated 2 October 2026.</p>
      </Section>

      <p className="lg-back">
        <Link href="/">Back to TourneyHQ</Link>
      </p>
      </div>
      </main>

      {landingFooter("privacy", editionNote(local, overridden))}
    </div>
  );

  return inDialect(page, editionSwaps(shown));
}
