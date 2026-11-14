import { NOINDEX } from "@/lib/site";
import { PlayerLinkOpener } from "@/components/PlayerLinkOpener";

/**
 * /p — a guest's personal player link opens here (J39/J40 PR 1). The code is
 * in the fragment and never reaches this server; the page posts it only on a
 * tap (`PlayerLinkOpener`, S1). NOINDEX, no Referer, and no analytics
 * (`SiteAnalytics` renders nothing here and `scrubAnalyticsEvent` drops a page
 * view of it — S3). There is no `/p/[code]` route, on purpose.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Your player link", robots: NOINDEX, referrer: "no-referrer" as const };

export default async function PlayerLinkPage({ searchParams }: { searchParams: Promise<{ ended?: string }> }) {
  const { ended } = await searchParams;
  return <PlayerLinkOpener ended={ended === "1"} />;
}
