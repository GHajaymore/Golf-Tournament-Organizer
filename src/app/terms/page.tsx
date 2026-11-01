import type { Metadata } from "next";
import { launchState } from "@/lib/services/signins-switch";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { privacyContact } from "@/lib/domain/privacy-contact";
import { PLANS, PAR_LIFESPAN_DAYS } from "@/lib/plans";
import { KEPT_AFTER_COMPLETE_DAYS } from "@/lib/domain/close-terms";
import { ARCHIVE_MONTHS, ARCHIVE_NOTICE_DAYS } from "@/lib/domain/club-archive";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { pageShareMeta } from "@/lib/landing/share-meta";
import { LANDING_CSS } from "@/lib/landing/styles";
import { LandingEffects } from "@/components/LandingEffects";
import { editionNote, iconSprite, landingFooter, landingNav } from "@/components/landing/chrome";

/**
 * The terms of service, reachable without an account (2026-10-02).
 *
 * Written for the day a club pays for a plan, which it cannot do without terms
 * to agree to. The same discipline as `/privacy`: every statement is checked
 * against what the code does, and nothing is promised that is not built.
 * Numbers and plan names come from `plans.ts` and `domain/billing.ts`, so this
 * page cannot drift from the rules it states:
 *
 *   - a failed payment keeps the plan while Stripe retries (`clubStatusFor`),
 *     and the plan ends when Stripe stops retrying (`unpaid`) or it is cancelled;
 *   - an ended plan keeps every tournament the club held as a read-only archive
 *     for ARCHIVE_MONTHS from Stripe's end date, with notices before it goes,
 *     and choosing a plan again lifts it (`domain/club-archive.ts`);
 *   - a price change does not reach an existing subscription, because each
 *     checkout writes its own `price_data` (`checkoutLineItem`);
 *   - golf money is calculated and recorded, never moved (CLAUDE.md, rule 7).
 *
 * NOT LEGAL ADVICE, AND NOT YET REVIEWED. A lawyer should read this before
 * billing is switched on; the governing law is deliberately not stated until
 * one has.
 */

const TERMS_DESCRIPTION =
  "The terms a club agrees to when it uses TourneyHQ: plans and billing, what happens when a plan ends, and who is responsible for what.";

export const metadata: Metadata = {
  title: "Terms",
  description: TERMS_DESCRIPTION,
  alternates: { canonical: "/terms" },
  ...pageShareMeta({ path: "/terms", title: "Terms", description: TERMS_DESCRIPTION }),
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="lg-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default async function TermsPage() {
  const contact = privacyContact(process.env.PRIVACY_CONTACT_EMAIL);
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const { local, shown, overridden } = landingEdition(
    h.get("x-vercel-ip-country"),
    jar.get(US_OVERRIDE_COOKIE)?.value === "1",
  );
  const par = PLANS.free;
  const paid = [PLANS.society.name, PLANS.club.name].join(" and ");
  // Only named when one is configured. Without it the sentences that would
  // carry it are left out rather than pointed somewhere that is not there.
  const writeTo = contact.kind === "address" ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : null;

  const page = (
    <div className="thq" lang={shown.locale}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS }} />
      <LandingEffects />
      {iconSprite()}
      {landingNav("terms", await launchState())}

      <main className="legal">
      <section className="fq-hero">
        <div className="wrap">
          <span className="label">Terms</span>
          <h1 className="h1">The terms, <span className="o">in plain words.</span></h1>
          <p className="lead">
            What you agree to when your club uses TourneyHQ: what each plan includes, how paying and
            cancelling work, and who is responsible for what.
          </p>
        </div>
      </section>
      <div className="wrap lg-body">

      <Section title="Who these terms are between">
        <p>
          TourneyHQ is made by AjAi Labs (&ldquo;we&rdquo;). These terms are between us and the club,
          league, golf group or organizer that uses it (&ldquo;the club&rdquo;). Whoever creates a club on
          TourneyHQ accepts them on the club&rsquo;s behalf, and confirms they are allowed to.
        </p>
        <p>
          Players entered into a tournament do not need an account and are not party to these terms.
          What happens to their details is set out in the <Link href="/privacy">privacy policy</Link>.
        </p>
      </Section>

      <Section title="Accounts and access">
        <p>
          A club&rsquo;s owners and admins decide who else can run its tournaments, and are
          responsible for what the people they add do there. Keep your sign-in to yourself; if you
          think someone else has used it, reset your password from the sign-in page and tell us.
        </p>
      </Section>

      <Section title="The club's data">
        <p>
          The club owns what it puts into TourneyHQ: its members, fields, scores and results. We
          store and process it to run the service, as the privacy policy describes, and for no other
          purpose.
        </p>
        <p>
          The club is responsible for having the right to enter the people it enters &mdash; most
          clubs enter their members from their own records, and that is the club&rsquo;s
          relationship with them, not ours.
        </p>
      </Section>

      <Section title="Plans">
        <p>
          <strong>{par.name}</strong> is free. It runs {par.limits.activeEvents} tournament at a time,
          for up to {par.limits.playersPerEvent} players, with {par.limits.staffSeats} organizer. When a
          tournament on {par.name} is completed, its board, results and settle-up stay open to view,
          read-only, for {KEPT_AFTER_COMPLETE_DAYS} days. After that it is deleted for good. A tournament
          nobody completes is deleted {PAR_LIFESPAN_DAYS} days after its first round is played. To keep
          it, move to a paid plan before then.
          {/* DRAFT FOR THE OWNER'S LAWYER (2026-10-21): the marketing panel's wording of Ajay's
              "keep it for 15 days"; he reviews the terms right before launch. */}
        </p>
        <p>
          <strong>{paid}</strong> are paid plans, billed monthly or yearly in advance. What each
          includes is shown on the pricing page and in Club settings, under Your plan.{" "}
          <strong>{PLANS.enterprise.name}</strong> is arranged with us directly.
        </p>
      </Section>

      <Section title="Paying for a plan">
        <p>
          A club buys a plan in Club settings, and pays on Stripe&rsquo;s own checkout page. Card
          details go to Stripe and never reach TourneyHQ. The price charged is the one on that page
          before you confirm.
        </p>
        <ul>
          <li>
            <strong>It renews automatically</strong> at the end of each month or year, at the same
            price, until it is cancelled.
          </li>
          <li>
            <strong>A change to our prices does not change a plan you already pay for.</strong> It
            applies to plans bought after it.
          </li>
          <li>
            <strong>If a payment fails, the club keeps its plan</strong> while Stripe tries the card
            again, and Club settings asks the club&rsquo;s owners to update it. If Stripe stops trying
            and the payment still has not been taken, the plan ends as described below.
          </li>
          <li>
            <strong>Cancel at any time</strong> from Club settings &rarr; Your plan &rarr; Manage
            billing. The plan runs to the end of the period already paid for. Payments already made
            are not refunded for the unused part of a period, unless the law where you are requires
            it.
          </li>
        </ul>
      </Section>

      <Section title="When a paid plan ends">
        {/* DRAFT FOR THE OWNER'S LAWYER (2026-10-21, decisions A4 and A8): Ajay reviews the
            terms with a lawyer before launch, and this section has not been reviewed. */}
        <p>
          <strong>Every tournament the club has on the day its plan ends is kept, read-only, for{" "}
          {ARCHIVE_MONTHS} months</strong> &mdash; finished and unfinished alike. Its boards,
          results, reports and money records stay open to view and to download. Nothing in them can
          be changed or scored: an unfinished tournament is paused where it stands. Club settings
          shows the date it is kept until.
        </p>
        <p>
          <strong>Choosing a plan again at any time in those {ARCHIVE_MONTHS} months</strong> lifts
          this, and every tournament carries on exactly where it stopped.
        </p>
        <p>
          Otherwise, at the end of the {ARCHIVE_MONTHS} months those tournaments are deleted for good.
          The club&rsquo;s owners are emailed {ARCHIVE_NOTICE_DAYS[0]} days before, and again{" "}
          {ARCHIVE_NOTICE_DAYS[1]} days before; nothing is deleted until {ARCHIVE_NOTICE_DAYS[1]} days
          after the second notice.
        </p>
        <p>
          Meanwhile the club is on {par.name}, and a tournament it starts after its plan ended is a{" "}
          {par.name} tournament, on {par.name}&rsquo;s terms above. The kept tournaments do not count
          against {par.name}&rsquo;s limits.
        </p>
      </Section>

      <Section title="Money in tournaments">
        <p>
          TourneyHQ <strong>works out and records</strong> entry fees, skins, side games, payouts and
          shared costs. <strong>It never holds or moves that money.</strong> Paying it is between the
          people involved, and the club&rsquo;s own records of who has paid are the club&rsquo;s.
        </p>
      </Section>

      <Section title="Results and handicaps">
        <p>
          TourneyHQ calculates results from the scores and handicaps the club enters. The club&rsquo;s
          committee decides a competition&rsquo;s result, as the Rules of Golf provide, and can correct
          any card or figure in the app.
        </p>
        <p>
          A handicap index is whatever the club enters for a player. TourneyHQ does not calculate
          official handicap indexes and is not affiliated with any handicapping authority.
        </p>
      </Section>

      <Section title="Fair use">
        <p>Don&rsquo;t use TourneyHQ to:</p>
        <ul>
          <li>enter people&rsquo;s details you have no right to hold;</li>
          <li>get into a club, tournament or account that isn&rsquo;t yours;</li>
          <li>probe, overload or work around the limits of the service;</li>
          <li>copy the service or its content in bulk.</li>
        </ul>
        <p>
          We may suspend access that breaks these rules. Where we can, we will tell the club first
          and give it a chance to put it right.
        </p>
      </Section>

      <Section title="The service">
        <p>
          We work to keep TourneyHQ running and its data safe, and we change and improve it over
          time. We cannot promise it will never be interrupted or free of faults, and it is provided
          on that basis.
        </p>
        <p>
          To the extent the law allows, we are not liable for indirect or consequential losses, and
          our total liability to a club is limited to what it paid us in the twelve months before the
          claim. Nothing here limits a liability the law does not allow to be limited.
        </p>
      </Section>

      <Section title="Ending">
        <p>
          A club can stop using TourneyHQ at any time. Its owner can delete the club from Club settings:
          every tournament, card, result, money record, the roster and the settings go at once, for
          good. A paid plan has to be cancelled first, so nothing goes on being billed for a club that
          no longer exists.
          {writeTo ? <> A club can also ask us to delete its data by writing to {writeTo}.</> : null}
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If these terms change, the date below changes and the change is described here rather than
          made quietly.
        </p>
        <p>
          <strong>21 October 2026 (draft):</strong> when a paid plan ends, the club&rsquo;s tournaments
          are kept read-only for {ARCHIVE_MONTHS} months, in place of 30 days followed by the free
          plan&rsquo;s terms; and a plan ends when Stripe stops retrying a failed payment.
        </p>
        <p>
          <strong>3 October 2026:</strong> a club&rsquo;s owner can now delete the club from Club
          settings.
        </p>
        <p className="lg-date">Last updated 21 October 2026.</p>
      </Section>

      {writeTo && (
        <Section title="Contact">
          <p>Questions about these terms: {writeTo}.</p>
        </Section>
      )}

      <p className="lg-back">
        <Link href="/">Back to TourneyHQ</Link>
      </p>
      </div>
      </main>

      {landingFooter("terms", editionNote(local, overridden))}
    </div>
  );

  return inDialect(page, editionSwaps(shown));
}
