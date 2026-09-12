import { screenMetadataForEvent } from "@/lib/screen-metadata";
import { requireOrgScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { OrganizationClient } from "@/components/OrganizationClient";
import { HandicapSetup } from "@/components/HandicapSetup";
import { integrationSetup } from "@/lib/services/integrations";
import { ThemePicker } from "@/components/ThemePicker";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { OrganizationAccess } from "@/components/OrganizationAccess";
import { organizationAccessReport } from "@/lib/services/access";
import { organizationAccess } from "@/lib/services/org-access";
import { PlaySettings } from "@/components/PlaySettings";
import { PlanPanel } from "@/components/PlanPanel";
import { MoneySetup } from "@/components/MoneySetup";
import { cleanSettings } from "@/lib/tournament-settings";
import { isAppearance, DEFAULT_APPEARANCE } from "@/lib/themes";
import { SettingsNav, SettingsSectionAnchor, type SettingsSection } from "@/components/SettingsNav";

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
        select: { events: { where: { shape: { not: "match" } } }, members: true },
      },
    },
  });
  if (!org) redirect("/dashboard");

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

  const report = await organizationAccessReport(org.id);

  /**
   * What this page contains, in the order it contains it.
   *
   * Written once and read by the nav; the ids are on the sections themselves.
   * "Currency" and "Money" are two entries because the page genuinely has two
   * money sections — the symbol every amount is shown in, and how money works
   * at the club — and a nav offering the same word twice is worse than the
   * scroll it replaces.
   */
  const sections: SettingsSection[] = [
    { id: "identity", label: "Name & branding" },
    { id: "theme", label: "Colour" },
    { id: "defaults", label: "House defaults" },
    { id: "handicaps", label: "Handicaps" },
    { id: "money", label: "Money" },
    { id: "plan", label: "Plan" },
    { id: "access", label: "Staff & access" },
  ];

  return (
    <>
      <SettingsNav sections={sections} />
      <section id="identity" style={{ scrollMarginTop: 118 }}>
      <OrganizationClient
        name={org.name}
        shortName={org.shortName}
        logoUrl={org.logoUrl}
        city={org.city}
        region={org.region}
        country={org.country}
        brandDisplay={org.brandDisplay}
        kind={org.kind}
        plan={org.subscription?.plan ?? "free"}
        eventCount={org._count.events}
        memberCount={org._count.members}
        canEdit={canEdit}
      />
      </section>
      <SettingsSectionAnchor id="theme">
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
      </SettingsSectionAnchor>
      <SettingsSectionAnchor id="defaults">
        <PlaySettings
          mode="organization"
          settings={cleanSettings({
            leaderboardVisibility: org.defaultLeaderboardVisibility,
            scoreEntryBy: org.defaultScoreEntryBy,
            scoreEntryWindow: org.defaultScoreEntryWindow,
            voiceEntry: org.defaultVoiceEntry,
            playerAccess: org.defaultPlayerAccess,
            scoreApproval: org.defaultScoreApproval,
          })}
          canEdit={canEdit}
        />
      </SettingsSectionAnchor>

      {/* The club's money default, on the screen the setup checklist has
          always pointed at. `SETUP_HREF.money` is `/organization`, and until
          now this page had no money control on it — the club default was a
          collapsed disclosure inside a card titled "Money in this tournament",
          over on Prizes & payouts. So the step could not be ticked by
          following its own link, and `orgSetupState` reads exactly the column
          that disclosure writes. */}
      {/* Where handicaps come from, beside the club's other house rules.
          It belongs here rather than on the roster: it is a decision about
          the club, not about any one member. */}
      <SettingsSectionAnchor id="handicaps">
        <HandicapSetup view={{ ...handicaps, canEdit }} />
      </SettingsSectionAnchor>

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
      <SettingsSectionAnchor id="money">
        {canEdit && (
          <section className="card elev-sm" style={{ marginBottom: 16 }}>
            {/* "Currency", which is what it is. It was "Money", which is also
                what the card below it is called. */}
            <span className="card-title" style={{ fontSize: 15 }}>Currency</span>
            <CurrencyPicker currency={org.currency} />
          </section>
        )}
        <MoneySetup
          mode="organization"
          orgMode={org.moneyMode}
          orgKind={org.kind}
          clubName={org.shortName || org.name}
          canEdit={canEdit}
        />
      </SettingsSectionAnchor>

      {/* What the club is on, and what it is losing by being on it.
          Club settings is where an organizer already comes to decide how the
          club runs, so it is where the question of what the club is paying
          for belongs. */}
      <SettingsSectionAnchor id="plan">
        <PlanPanel planKey={org.subscription?.plan ?? "free"} />
      </SettingsSectionAnchor>

      <SettingsSectionAnchor id="access">
        <OrganizationAccess report={report} canEdit={canEdit} orgKind={org.kind} />
      </SettingsSectionAnchor>
    </>
  );
}
