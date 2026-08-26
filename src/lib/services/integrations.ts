import "server-only";
import { prisma } from "../db";
import { handicapAuthority, scoreReporter } from "../integrations/registry";
import type { IntegrationCredential, IntegrationStatus } from "../integrations/types";
import { handicapPolicyOf, type HandicapPolicy } from "../domain/handicap-policy";

/**
 * A club's association setup, and the ONE place a credential is read.
 *
 * `Integration.secret` is the first real secret this app stores: a key that
 * lets somebody act as the club against their association. Every other module
 * gets `IntegrationSetup` below, which carries a STATUS and never a value —
 * "connected" is the fact a screen needs, and the key is not.
 *
 * `integration-secrecy.test.ts` enforces that by reading the source, because
 * the way this rule breaks is not malice: it is somebody building a perfectly
 * reasonable settings screen that shows the current value so an organizer can
 * check it.
 */

/** What a screen may know about a club's association setup. Never the key. */
export interface IntegrationSetup {
  policy: HandicapPolicy;
  handicap: {
    providerId: string;
    label: string;
    status: IntegrationStatus;
    howToEnable: string;
  };
  scores: {
    enabled: boolean;
    providerId: string;
    label: string;
    status: IntegrationStatus;
    howToEnable: string;
  };
}

/**
 * The credential itself. Server-only, and deliberately awkward to reach.
 *
 * Not exported as part of the setup above, and not returned by anything a page
 * calls. The only caller should be the code actually making a request to the
 * association.
 */
async function credentialFor(
  organizationId: string,
  providerId: string,
  capability: "handicap" | "scores",
): Promise<IntegrationCredential | null> {
  const row = await prisma.integration.findUnique({
    where: {
      organizationId_providerId_capability: { organizationId, providerId, capability },
    },
    select: { providerId: true, secret: true, settings: true },
  });
  if (!row) return null;

  let settings: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.settings || "{}");
    if (parsed && typeof parsed === "object") settings = parsed as Record<string, string>;
  } catch {
    // Malformed settings are not a reason to fail a lookup. The secret is what
    // matters; a bad settings blob means a provider gets defaults.
  }
  return { providerId: row.providerId, secret: row.secret, settings };
}

/**
 * What this club has set up, as a screen may see it.
 *
 * Reports `unconfigured` for a provider that no longer exists rather than
 * falling back to the first one registered — a club whose stored provider is
 * unknown has a settings problem, and quietly reading indexes from a DIFFERENT
 * association would produce figures that look entirely plausible and belong to
 * somebody else's system.
 */
export async function integrationSetup(organizationId: string): Promise<IntegrationSetup> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      handicapPolicy: true,
      handicapAuthorityId: true,
      scoreReportingEnabled: true,
      scoreReporterId: true,
    },
  });

  const authorityId = org?.handicapAuthorityId ?? "ghin";
  const reporterId = org?.scoreReporterId ?? "ghin";
  const authority = handicapAuthority(authorityId);
  const reporter = scoreReporter(reporterId);

  const [handicapCred, scoreCred] = await Promise.all([
    authority ? credentialFor(organizationId, authority.id, "handicap") : null,
    reporter ? credentialFor(organizationId, reporter.id, "scores") : null,
  ]);

  return {
    policy: handicapPolicyOf(org?.handicapPolicy),
    handicap: {
      providerId: authorityId,
      label: authority?.label ?? authorityId,
      status: authority ? authority.status(handicapCred) : "unconfigured",
      howToEnable: authority?.howToEnable ?? "",
    },
    scores: {
      enabled: !!org?.scoreReportingEnabled,
      providerId: reporterId,
      label: reporter?.label ?? reporterId,
      status: reporter ? reporter.status(scoreCred) : "unconfigured",
      howToEnable: reporter?.howToEnable ?? "",
    },
  };
}

/**
 * Whether this club can actually read indexes right now.
 *
 * The question a roster screen asks before telling an organizer their club is
 * on GHIN but nothing has been fetched. A policy without a working integration
 * is the state `handicapStanding` was written for, and it is a state a club
 * can sit in for a whole season without noticing unless a screen says so.
 */
export async function handicapReadable(organizationId: string): Promise<boolean> {
  const setup = await integrationSetup(organizationId);
  return setup.policy === "ghin" && setup.handicap.status === "ready";
}
