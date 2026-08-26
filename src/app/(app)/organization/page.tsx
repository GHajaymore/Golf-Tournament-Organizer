import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { OrganizationClient } from "@/components/OrganizationClient";
import { HandicapSetup } from "@/components/HandicapSetup";
import { integrationSetup } from "@/lib/services/integrations";
import { ThemePicker } from "@/components/ThemePicker";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { OrganizationAccess } from "@/components/OrganizationAccess";
import { organizationAccessReport } from "@/lib/services/access";
import { PlaySettings } from "@/components/PlaySettings";
import { PlanPanel } from "@/components/PlanPanel";
import { MoneySetup } from "@/components/MoneySetup";
import { cleanSettings } from "@/lib/tournament-settings";
import { isAppearance, DEFAULT_APPEARANCE } from "@/lib/themes";

export default async function OrganizationPage() {
  const session = await requireScreen("organization");

  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { organizationId: true },
  });
  if (!event) redirect("/choose");

  const org = await prisma.organization.findUnique({
    where: { id: event.organizationId },
    include: {
      subscription: true,
      _count: { select: { events: true, members: true } },
    },
  });
  if (!org) redirect("/dashboard");

  const user = await prisma.user.findUnique({ where: { email: session.email } });
  const membership = user
    ? await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      })
    : null;

  // Mirrors the server action's rule: organization owners/admins, plus an
  // event organizer whose membership predates the organization layer.
  const handicaps = await integrationSetup(org.id);
  const canEdit =
    membership?.role === "owner" ||
    membership?.role === "admin" ||
    (session.role === "admin" && !membership);

  const report = await organizationAccessReport(org.id);

  return (
    <>
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
      <div style={{ marginTop: 16 }}>
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
      </div>
      {/* Beside the theme, because it is the same kind of decision: one
          setting belonging to the club that every screen showing an amount
          reads. Owners and admins only, like the branding above it. */}
      {canEdit && (
        <div style={{ marginTop: 16 }}>
          <section className="card elev-sm">
            <span className="card-title" style={{ fontSize: 15 }}>Money</span>
            <CurrencyPicker currency={org.currency} />
          </section>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
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
      </div>

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
      <div style={{ marginTop: 16 }}>
        <HandicapSetup view={{ ...handicaps, canEdit }} />
      </div>

      <div style={{ marginTop: 16 }}>
        <MoneySetup
          mode="organization"
          orgMode={org.moneyMode}
          orgKind={org.kind}
          clubName={org.shortName || org.name}
          canEdit={canEdit}
        />
      </div>

      {/* What the club is on, and what it is losing by being on it.
          Club settings is where an organizer already comes to decide how the
          club runs, so it is where the question of what the club is paying
          for belongs. */}
      <div style={{ marginTop: 16 }}>
        <PlanPanel planKey={org.subscription?.plan ?? "free"} />
      </div>

      <div style={{ marginTop: 16 }}>
        <OrganizationAccess report={report} canEdit={canEdit} />
      </div>
    </>
  );
}
