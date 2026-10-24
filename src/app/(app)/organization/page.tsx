import { screenMetadataForEvent } from "@/lib/screen-metadata";
import { requireOrgScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { OrganizationClient } from "@/components/OrganizationClient";
import { HandicapSetup } from "@/components/HandicapSetup";
import { integrationSetup } from "@/lib/services/integrations";
import { ThemePicker } from "@/components/ThemePicker";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { LocalePicker } from "@/components/LocalePicker";
import { TimeZonePicker } from "@/components/TimeZonePicker";
import { clubClockInWords, timeZoneChoices } from "@/lib/domain/club-clock";
import { SeasonPicker } from "@/components/SeasonPicker";
import { OrgNounPicker } from "@/components/OrgNounPicker";
import { GolfTermsPicker } from "@/components/GolfTermsPicker";
import { golfRegister, golfTermsFor } from "@/lib/domain/golf-terms";
import { OrgKindPicker } from "@/components/OrgKindPicker";
import { OrganizationAccess } from "@/components/OrganizationAccess";
import { pendingAsks } from "@/lib/services/join-requests";
import { limitStatus } from "@/lib/services/limits";
import { organizationAccessReport } from "@/lib/services/access";
import { organizationAccess } from "@/lib/services/org-access";
import { PlaySettings } from "@/components/PlaySettings";
import { discountNoteFor } from "@/lib/services/platform-discounts";
import { PlanPanel } from "@/components/PlanPanel";
import { billingEnabled } from "@/lib/services/billing";
import { clubArchiveSummary } from "@/lib/services/club-archive";
import { paidPlanRunning } from "@/lib/domain/club-deletion";
import { DeleteClub } from "@/components/DeleteClub";
import { orgProfile } from "@/lib/domain/org-profile";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { MoneySetup } from "@/components/MoneySetup";
import { houseDefaultsOf } from "@/lib/tournament-settings";
import { isAppearance, DEFAULT_APPEARANCE } from "@/lib/themes";
import type { SettingsSection } from "@/components/SettingsNav";
import { SettingsTabs, SettingsTabPanel } from "@/components/SettingsTabs";
import { OrganizationHeading } from "@/components/OrganizationClient";

export const generateMetadata = () => screenMetadataForEvent("/organization");

export default async function OrganizationPage() {
  /**
   * THE CLUB, NOT THE TOURNAMENT THAT HAPPENS TO BE OPEN.
   *
   * This read the active event purely to learn its `organizationId` — the club
   * was reached by standing inside one of its tournaments. So a brand-new club
   * could not name itself, set its colours or choose its handicap policy until
   * it had invented a tournament, which is the second thing, done first.
   *
   * `primaryOrganizationFor` still prefers the open tournament's club, so an
   * organizer who has one sees exactly what they saw before and switching
   * tournament still switches this screen. It only falls back when there is no
   * tournament at all — which is precisely the new club this screen is for.
   */
  const { session, organizationId } = await requireOrgScreen("organization");

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      subscription: true,
      /**
       * The events count is shown under the kicker "Tournaments", so it counts
       * tournaments. A casual round is stored as an Event because that is what
       * the app hangs a card off, not because it is one — the same distinction
       * `activeEventCount` draws for billing.
       *
       * Without the filter the club's settings page and its plan allowance
       * disagreed about the same number, on the same screen.
       */
      _count: {
        select: { events: { where: { shape: { not: "match" } } } },
      },
    },
  });
  if (!org) redirect("/dashboard");

  /**
   * ONE STAFF NUMBER, and it is the one that can refuse somebody.
   *
   * The Staff card read `_count.members` — rows in `OrganizationMember` — while
   * the plan panel a few hundred lines below reads `limitStatus`, which counts
   * a SEAT: anybody holding organizer or assistant rights anywhere in the club,
   * including on a single event, deduplicated by email. `limits.ts` explains
   * why it has to be that way, and the sentence is the whole argument: counting
   * club membership alone "would have made the limit meaningless … anyone could
   * add unlimited staff by granting them on each event instead".
   *
   * So the two disagreed on the same screen. Measured on a club with an event
   * organizer and a league secretary and no OrganizationMember rows at all: the
   * card said 0, the allowance said 2. On the free plan, which includes one
   * seat, that club is refused the next person it adds while its own settings
   * page shows it has none.
   *
   * The events number beside it had exactly this bug and it is already fixed —
   * see the comment on the `_count` above, which ends "disagreed about the same
   * number, on the same screen". This is the other half of that fix.
   */
  const standing = await limitStatus(org.id);
  const handicaps = await integrationSetup(org.id);

  /**
   * The SAME rule the actions enforce, through the same function.
   *
   * The comment here used to say "Mirrors the server action's rule" above a
   * hand-rolled copy of it, and the copy had not been updated when the rule
   * changed. `session.role === "admin" && !membership` reads "I am an
   * organizer somewhere and not a member of this club" — which is true of a
   * guest brought in to run one Saturday medal, and was the escalation
   * `canAdministerOrganization` was written to close. It survived in exactly
   * one place in `src`: this line. Everywhere else it appears only inside
   * comments describing the fix.
   *
   * Nothing could be written through it — every action refused — so this was
   * never an escalation. What the guest actually got was branding, theme,
   * currency, play settings, handicap and money setup all rendered enabled,
   * and "Only an organization owner or admin can change these settings." on
   * every save. A screen that offers a control the server refuses is a bug
   * report waiting to be filed against the wrong thing.
   *
   * `organizationAccess` also counts members, which is the part a mirror
   * cannot fake: the ownerless-club escape hatch has to know whether ANYBODY
   * holds the club, not whether the caller does.
   */
  const access = await organizationAccess(session);
  const canEdit = access?.canEdit ?? false;
  // An explicit OWNER membership of this club — not `canEdit`, which an admin
  // and the ownerless escape hatch also have. The delete action reads the same.
  const isClubOwner =
    (await prisma.organizationMember.count({
      where: { organizationId: org.id, userId: session.userId, role: "owner" },
    })) > 0;

  const report = await organizationAccessReport(org.id);
  // Who is waiting to be let in. Almost always empty; see OrganizationAccess.
  const asks = await pendingAsks(org.id);

  /**
   * What this page contains, in the order it contains it — one TAB each now
   * (Ajay, 2026-10-21: "change the structure as needed"; see SettingsTabs).
   *
   * Written once and read by the tabs; the ids are on the sections themselves,
   * and they are the hashes every other screen links to (`#plan`, `#access`,
   * `#money`), so they do not change.
   *
   * Staff & access carries a count when somebody is waiting to be let in: the
   * requests used to be on the one long page for anybody scrolling past, and
   * behind a tab they would be seen only by somebody who went looking.
   */
  const sections: SettingsSection[] = [
    { id: "identity", label: "Name & branding" },
    { id: "theme", label: "Colour" },
    { id: "defaults", label: "House defaults" },
    { id: "handicaps", label: "Handicaps" },
    { id: "money", label: "Money" },
    { id: "plan", label: "Plan" },
    { id: "access", label: "Staff & access", count: asks.length },
  ];
  const outfit = orgProfile(org.kind, org.country, org.communityNoun);

  return (
    <>
      {/* The heading above the tabs, so it is on every one of them. */}
      <OrganizationHeading kind={org.kind} country={org.country} communityNoun={org.communityNoun} />
      <SettingsTabs sections={sections} label={`${outfit.settingsLabel}: sections`}>
      <SettingsTabPanel id="identity">
      <OrganizationClient
        name={org.name}
        shortName={org.shortName}
        logoUrl={org.logoUrl}
        city={org.city}
        region={org.region}
        country={org.country}
        brandDisplay={org.brandDisplay}
        kind={org.kind}
        communityNoun={org.communityNoun}
        plan={org.subscription?.plan ?? "free"}
        eventCount={org._count.events}
        memberCount={standing.staffSeats.current}
        canEdit={canEdit}
      />
        {/* WHO THIS IS, BESIDE WHAT IT IS CALLED. These three cards sat under
            Money, between the currency and the money default, because that is
            where the page had room when each was added. Each is about the
            outfit's identity — what kind it is, the word it goes by, the words
            its golfers use — which is this section's subject, and the name and
            country they are read with are in the card just above. */}
        <div style={{ marginTop: 16 }}>
        {/* ONLY A COMMUNITY is asked what it is called, because it is the only
            kind whose noun travels badly. A club is a club and an outing is an
            outing wherever they are played; offering either of them a word to
            change would be asking a question with no right answer behind it.

            The country on this page already picks a default — a society in
            Britain and Ireland, a league in the United States — and a country
            is only ever a good guess. This is where the outfit overrules it. */}
        {/* WHAT THIS IS, above what it is CALLED — the order they are decided
            in, and the kind is what makes the noun question exist at all.

            It had no control anywhere until 2026-09-17: the kind was written
            when the organization came into being and never again, so a
            society whose tenant was created lazily was a "personal" account
            for ever — called an outing on every screen, and with no members
            list, because `sharedRoster` is read off the kind. */}
        {canEdit && (
          <section className="card elev-sm" style={{ marginBottom: 16 }}>
            <span className="card-title" style={{ fontSize: 15 }}>What this is</span>
            <p className="text-muted" style={{ fontSize: 13, margin: "-2px 0 4px" }}>
              It decides what the console calls this outfit, what setup asks you for, and what
              money does by default.
            </p>
            <OrgKindPicker kind={org.kind} country={org.country} noun={org.communityNoun} />
          </section>
        )}
        {canEdit && org.kind === "community" && (
          <section className="card elev-sm" style={{ marginBottom: 16 }}>
            <span className="card-title" style={{ fontSize: 15 }}>What we are called</span>
            <OrgNounPicker noun={org.communityNoun} country={org.country} />
          </section>
        )}
        {/* Every kind, unlike the noun above: a club in Scotland and a league
            in Ohio both have a word for the cart. */}
        {canEdit && (
          <section className="card elev-sm" style={{ marginBottom: 16 }}>
            <span className="card-title" style={{ fontSize: 15 }}>Golf words</span>
            <GolfTermsPicker terms={org.golfTerms} country={org.country} />
          </section>
        )}
        </div>

        {/* For the owner alone, at the foot of the club's own section — where
            the outfit itself is described, and where a settings screen puts the
            one act that ends it. The rule and its reasons are in
            domain/club-deletion.ts. */}
        {isClubOwner && (
          <div style={{ marginTop: 16 }}>
            <DeleteClub
              clubName={org.name}
              noun={outfit.noun}
              paidPlanRunning={paidPlanRunning(org.subscription)}
            />
          </div>
        )}
      </SettingsTabPanel>
      <SettingsTabPanel id="theme">
        <ThemePicker
          theme={{
            accentKey: org.themeKey,
            accentHex: org.themeHex,
            secondaryKey: org.themeSecondaryKey,
            secondaryHex: org.themeSecondaryHex,
            // Stored as free text, so it is narrowed here rather than cast —
            // a bad row shouldn't crash the settings screen.
            appearance: isAppearance(org.themeAppearance) ? org.themeAppearance : DEFAULT_APPEARANCE,
          }}
          readOnly={!canEdit}
        />
      </SettingsTabPanel>
      <SettingsTabPanel id="defaults">
        <PlaySettings
          mode="organization"
          settings={houseDefaultsOf(org)}
          canEdit={canEdit}
        />
      </SettingsTabPanel>

      {/* The club's money default, on the screen the setup checklist has
          always pointed at. `SETUP_HREF.money` was `/organization`, and until
          then this page had no money control on it — the club default was a
          collapsed disclosure inside a card titled "Money in this tournament",
          over on Prizes & payouts. So the step could not be ticked by
          following its own link, and `orgSetupState` reads exactly the column
          that disclosure writes. It is `/organization#money` since the page
          became tabs: the plain address opens Name & branding, which would be
          the same fault again one tab along. */}
      {/* Where handicaps come from, beside the club's other house rules.
          It belongs here rather than on the roster: it is a decision about
          the club, not about any one member. */}
      <SettingsTabPanel id="handicaps">
        <HandicapSetup view={{ ...handicaps, canEdit }} />
      </SettingsTabPanel>

      {/* ONE MONEY SECTION, NOT TWO.
          The currency sat up beside the theme, three sections away, under a
          card also titled "Money" — so the page had two things by that name
          with House defaults and Handicaps between them, and the jump-to nav
          had to invent "Currency" and "Money" to tell them apart.

          The note that put it there said it belongs beside the theme because
          it is "the same kind of decision: one setting belonging to the club".
          True, and true of every setting on this page — it does not separate
          this one from anything. The SUBJECT is money, and subject is what a
          reader navigates by.

          Both are still their own card, because they are two decisions: what
          symbol every amount is shown in, and how money works at the club. */}
      <SettingsTabPanel id="money">
        {/* THE CURRENCY CARD STAYS WITH MONEY, WHOLE (2026-10-21). It holds
            the currency, how dates and amounts are written, the time zone and
            the season, and the last three are not money — so moving them to
            Name & branding under "Region & calendar" was weighed. Kept here
            because the card's own notes chain each one to the one before it:
            the conventions are "two halves of one answer" with the currency (a
            club set to euros that still wrote "€1,234.00"), the time zone is
            "where the 12th ENDS, beside how it is written", the season sits
            beside how a date is written. Split, a club could set one half and
            not the other, which is the state its first note says looked right
            and was wrong. The tab is Money because the card's title is. */}
        {canEdit && (
          <section className="card elev-sm" style={{ marginBottom: 16 }}>
            {/* "Currency", which is what it is. It was "Money", which is also
                what the card below it is called. */}
            <span className="card-title" style={{ fontSize: 15 }}>Currency</span>
            <CurrencyPicker currency={org.currency} />
            {/* Beside it, because they are two halves of one answer: the
                currency was already the club's and the CONVENTIONS it was
                written in were American, so a club set to euros still read
                "€1,234.00". Same card rather than a new section — a club
                setting one and not the other is the state that looked right
                and was wrong. */}
            <div style={{ marginTop: 14 }}>
              <LocalePicker locale={org.locale} />
            </div>
            {/* And where the 12th ENDS, beside how it is written — the other
                half of what a closing date means. See domain/club-clock.ts. */}
            <div style={{ marginTop: 14 }}>
              <TimeZonePicker
                timeZone={org.timeZone}
                zones={timeZoneChoices()}
                clock={clubClockInWords(org.timeZone, org.locale)}
              />
            </div>
            {/* The club's season, beside how it writes a date — the same kind
                of setting, answered once and read by every screen that lists
                tournaments. See domain/club-season.ts. */}
            <div style={{ marginTop: 14 }}>
              <SeasonPicker startsOn={org.seasonStartsOn} endsOn={org.seasonEndsOn} />
            </div>
          </section>
        )}
        <MoneySetup
          mode="organization"
          orgMode={org.moneyMode}
          orgKind={org.kind}
          clubName={org.shortName || org.name}
          canEdit={canEdit}
        />
      </SettingsTabPanel>

      {/* What the club is on, and what it is losing by being on it.
          Club settings is where an organizer already comes to decide how the
          club runs, so it is where the question of what the club is paying
          for belongs. */}
      <SettingsTabPanel id="plan">
        {/* The SAME `standing` the Staff card above is drawn from, resolved
            once. Two calls would be two truths the moment one of them moved. */}
        <PlanPanel
          planKey={org.subscription?.plan ?? "free"}
          termsApply={org.subscription?.planTermsApply === true}
          standing={standing}
          overrides={await storedPricingOverrides()}
          currency={org.currency}
          locale={org.locale}
          terms={golfTermsFor(golfRegister(org.country, org.golfTerms))}
          billing={{
            enabled: billingEnabled(),
            hasSubscription: Boolean(org.subscription?.providerSubscriptionId) && org.subscription?.status !== "canceled",
            pastDue: org.subscription?.status === "past_due",
            canEdit,
            archive: await clubArchiveSummary(org.id),
            unpaid: org.subscription?.status === "unpaid",
            // The code the club gave at sign-up, offered at checkout; judged again there.
            discountCode: org.discountCode,
            discountNote: org.discountCode ? await discountNoteFor(org.discountCode) : undefined,
          }}
        />
      </SettingsTabPanel>

      <SettingsTabPanel id="access">
        {/* The SAME seat number the stat card at the top prints, from the one
            function that defines a seat. See the prop's note: this table and
            that card both said "staff" about two different sets and disagreed
            in both directions on real rows. */}
        <OrganizationAccess
          report={report}
          canEdit={canEdit}
          asks={asks}
          seats={standing.staffSeats.current}
          organizer={golfTermsFor(golfRegister(org.country, org.golfTerms)).organizer}
        />
      </SettingsTabPanel>
      </SettingsTabs>
    </>
  );
}
