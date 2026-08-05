import { requireScreen } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { OrganizationClient } from "@/components/OrganizationClient";

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
  const canEdit =
    membership?.role === "owner" ||
    membership?.role === "admin" ||
    (session.role === "admin" && !membership);

  return (
    <OrganizationClient
      name={org.name}
      shortName={org.shortName}
      logoUrl={org.logoUrl}
      kind={org.kind}
      plan={org.subscription?.plan ?? "free"}
      eventCount={org._count.events}
      memberCount={org._count.members}
      canEdit={canEdit}
    />
  );
}
