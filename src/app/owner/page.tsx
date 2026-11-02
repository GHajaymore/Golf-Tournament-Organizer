import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { ownerCounts, interestShown } from "@/lib/services/owner-counts";
import { demoMark, demoStatus } from "@/lib/services/demo-club";
import { OwnerDemoClub } from "@/components/OwnerDemoClub";
import { ownerMetrics } from "@/lib/domain/owner-metrics";
import { PLANS, PRICED_PLANS, PLAN_CURRENCIES, planFor, planTagline, effectivePrice, effectiveLimit, enforcementEnabled, LIMIT_KEYS } from "@/lib/plans";
import { golfTermsFor } from "@/lib/domain/golf-terms";
import { wholeMoney } from "@/lib/domain/money-format";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { storedLimitOverrides } from "@/lib/services/platform-limits";
import { listDiscountCodes } from "@/lib/services/platform-discounts";
import { OwnerPricing } from "@/components/OwnerPricing";
import { OwnerLimits } from "@/components/OwnerLimits";
import { OwnerClubPlan } from "@/components/OwnerClubPlan";
import { peopleOwningSeveralParClubs } from "@/lib/services/close-terms";
import { OwnerDiscounts } from "@/components/OwnerDiscounts";
import { OwnerAccounts } from "@/components/OwnerAccounts";
import { launchSwitch } from "@/lib/services/signins-switch";
import { ownerClockInWords } from "@/lib/services/owner-clock";
import { earlyListStatus } from "@/lib/services/early-list";
import { DEFAULT_LOCALE, formatDay } from "@/lib/domain/locale";
import { NOINDEX } from "@/lib/site";
import { roleLabel, sizeLabel } from "@/lib/domain/interest";
import { deliveryWords } from "@/lib/domain/email-delivery";

/** How many registrations the console lists; the rest are a query away. */
const INTEREST_SHOWN = 200;

/**
 * THE OWNER CONSOLE — the whole business on one screen, for the people who run
 * TourneyHQ.
 *
 * Every other screen answers about one tournament; this reads ACROSS all of
 * them. It is gated on `isOwner` against `OWNER_EMAILS`, and a stranger gets a
 * 404, not a "forbidden" — a console that shows every club's numbers must not
 * even admit to existing. It is noindex for the same reason, belt to the robots
 * braces.
 *
 * IT COUNTS AND NEVER NAMES A PERSON. Every figure is an aggregate; the only
 * names on it are customer ORGANIZATIONS, which are the owner's own accounts to
 * see, never a member or a player. Revenue is projected from the SAME
 * `effectivePrice` a customer is quoted (see `owner-metrics.ts`), so the number
 * here and the number on the pricing page move together.
 *
 * Its figures are about REAL clubs: the demo club is in none of them
 * (`services/owner-counts.ts`). The controls that write are the cards, each
 * through `actions/owner.ts`.
 */

export const metadata: Metadata = { title: "Owner console", robots: NOINDEX };

// Live business data behind a per-request owner check — never statically cached.
export const dynamic = "force-dynamic";

// The owner console is the PLATFORM's own view, not a club's, so it formats in
// DEFAULT_LOCALE rather than resolving a club locale it does not have — the one
// place `no-hardcoded-locale` allows a caller to reach for the default.
function usd(n: number): string {
  return `$${Math.round(n).toLocaleString(DEFAULT_LOCALE)}`;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString(DEFAULT_LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

export default async function OwnerConsolePage() {
  const session = await getSession();
  // Fail closed: no session, or a signed-in person who is not on the owner
  // allow-list, gets exactly what a non-existent page gives.
  if (!session || !isOwner(session.email)) notFound();

  // Real clubs only: the demo club is in none of these (`services/owner-counts.ts`).
  const [{ totalOrgs, orgsByPlan, orgsByKind, eventsByStatus, totalPlayers, orgsWithNoEvents, recentOrgs, liveEvents }, severalParClubs, demo] =
    await Promise.all([ownerCounts(), peopleOwningSeveralParClubs(), demoStatus(demoMark())]);

  // The owner's own price overrides, so the projected MRR here and the price
  // the editor below shows both reflect what customers are actually quoted.
  const overrides = await storedPricingOverrides();

  const m = ownerMetrics(
    {
      totalOrgs,
      orgsByPlan: orgsByPlan.map((r) => ({ plan: r.plan, count: r._count._all })),
      orgsByKind: orgsByKind.map((r) => ({ kind: r.kind, count: r._count._all })),
      eventsByStatus: eventsByStatus.map((r) => ({ status: r.status, count: r._count._all })),
      totalPlayers,
      orgsWithNoEvents,
    },
    overrides,
  );

  // Priced tiers only — Albatross is "Let's talk" and has no price to set.
  const tiers = PRICED_PLANS.map((p) => ({
    key: p.key,
    name: p.name,
    monthly: effectivePrice(p, overrides),
    free: p.key === "free",
  }));

  // Every paid tier in every plan currency, through the same reader a club's
  // settings panel quotes from, so this line and that panel cannot disagree.
  const localTiers = Object.values(PLANS)
    .filter((p) => p.priceMonthly > 0)
    .map((p) => ({
      key: p.key,
      name: p.name,
      prices: PLAN_CURRENCIES.map((c) => wholeMoney(effectivePrice(p, overrides, c), c, DEFAULT_LOCALE)),
    }));

  // The tier LIMITS the owner can tune, and whether they're enforced at all —
  // the effective value per tier (an override if set, else the plan default),
  // so the editor opens on the numbers actually in force.
  const limitOverrides = await storedLimitOverrides();
  const limitTiers = Object.values(PLANS).map((p) => ({
    key: p.key,
    name: p.name,
    limits: Object.fromEntries(
      LIMIT_KEYS.map((k) => [k, effectiveLimit(p, k, limitOverrides)]),
    ) as Record<(typeof LIMIT_KEYS)[number], number | null>,
  }));

  // Discount codes the owner has generated, with their usage rendered ready for
  // the client (which stays free of Date objects and locale calls).
  const interest = await interestShown(INTEREST_SHOWN);
  const discountRows = await listDiscountCodes();
  const discounts = discountRows.map((c) => ({
    code: c.code,
    percentOff: c.percentOff,
    label: c.label,
    active: c.active,
    uses: c.maxRedemptions == null ? String(c.timesRedeemed) : `${c.timesRedeemed} / ${c.maxRedemptions}`,
    expires: c.expiresAt ? shortDate(c.expiresAt) : "",
  }));

  // THE GO-LIVE SWITCH, and when it went live — on the owner's own club's clock (the first club they
  // belong to that has said where it is), or in UTC, said so, when none has.
  const sw = await launchSwitch();
  const liveSince = sw.liveSince ? await ownerClockInWords(session.userId, sw.liveSince) : "";
  // Once live, the early-list codes: who is waiting, and what a press of Send would do today.
  const early = await earlyListStatus();
  const earlyList = early
    ? {
        owed: early.owed.length,
        sent: early.sent,
        limit: early.limit,
        now: early.now,
        later: early.later,
        nextAt: early.nextAt ? await ownerClockInWords(session.userId, early.nextAt) : "",
        previewName: early.owed[0]?.name ?? "",
      }
    : null;

  const stat = (label: string, value: string, sub?: string) => (
    <div className="card elev-sm" style={{ flex: 1, minWidth: 150, gap: 2 }}>
      <span className="card-kicker">{label}</span>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: 26 }}>{value}</div>
      {sub && <span className="text-muted" style={{ fontSize: 12 }}>{sub}</span>}
    </div>
  );

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 64px" }}>
      <div style={{ marginBottom: 8 }}>
        <span className="card-kicker">TourneyHQ</span>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 28, margin: "2px 0 0" }}>
          Owner console
        </h1>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          The whole business, read-only. Signed in as {session.email}.
        </p>
      </div>

      {/* PEOPLE WHO REGISTERED INTEREST before launch (/interest, 2026-10-21),
          newest first — who to write to with their 25% code when it opens.
          First, because it is the list that grows while nothing else can. */}
      <section id="interest" className="card elev-sm" style={{ margin: "16px 0" }} aria-label="Registered interest">
        <span className="card-title" style={{ fontSize: 15 }}>
          Registered interest ({interest.length === INTEREST_SHOWN ? `latest ${INTEREST_SHOWN}` : interest.length})
        </span>
        {interest.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>Nobody yet. The form is at /interest, linked from the front door.</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Club or group</th>
                  <th>Who</th>
                  <th>Size</th>
                  <th>Note</th>
                  <th>From</th>
                  <th>Copy to inquiries@</th>
                </tr>
              </thead>
              <tbody>
                {interest.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{shortDate(r.createdAt)}</td>
                    <td>{r.name}</td>
                    <td>
                      <a href={`mailto:${r.email}`}>{r.email}</a>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.phone ? <a href={`tel:${r.phone.replace(/[^\d+]/g, "")}`}>{r.phone}</a> : ""}</td>
                    <td>{r.club}</td>
                    <td>{roleLabel(r.role)}</td>
                    <td>{sizeLabel(r.members)}</td>
                    <td style={{ minWidth: 160 }}>{r.note}</td>
                    <td className="text-muted" style={{ fontSize: 12, minWidth: 140 }}>{r.source || "direct"}</td>
                    {(() => {
                      const d = deliveryWords(r.notifyStatus);
                      return (
                        <td style={{ fontSize: 12, minWidth: 150, color: d.trouble ? "var(--color-danger)" : undefined }} title={r.notifyDetail || undefined}>
                          {d.words}
                          {d.trouble && r.notifyDetail ? <span className="text-muted" style={{ display: "block" }}>{r.notifyDetail}</span> : null}
                        </td>
                      );
                    })()}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Headline numbers */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "16px 0" }}>
        {stat("Organizations", m.totalOrgs.toLocaleString(DEFAULT_LOCALE), `${m.paidOrgs} paid · ${m.freeOrgs} free`)}
        {stat("Est. MRR", usd(m.estMrrMonthly), `${usd(m.estArr)} ARR at today's prices`)}
        {stat("Tournaments", m.totalEvents.toLocaleString(DEFAULT_LOCALE), `${m.liveEvents} live now`)}
        {stat("Players", m.totalPlayers.toLocaleString(DEFAULT_LOCALE), "across every event")}
      </div>

      {/* The go-live switch first: the one control that decides who can get in, and what every
          public page says about it. */}
      <OwnerAccounts switchSays={sw.switchSays} liveSince={liveSince} rule={sw.rule} earlyList={earlyList} />

      {/* The demo club a visitor can watch (2026-10-24): built and rebuilt from here, and nowhere else. */}
      <OwnerDemoClub
        built={demo.built}
        when={demo.builtAt ? shortDate(demo.builtAt) : ""}
        day={demo.day ? formatDay(demo.day, DEFAULT_LOCALE) : ""}
        holesIn={demo.holesIn}
        links={demo.links}
      />

      {/* The controls that write: the price every screen quotes, and the caps
          every entry gate reads. */}
      <OwnerPricing tiers={tiers} />
      {/* The local prices, read-only. They are set per currency rather than
          converted, so the USD editor above does not move them. An override
          goes in the same pricing row, under `byCurrency`. */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Local prices</span>
        <p className="text-muted" style={{ fontSize: 12.5, margin: "4px 0 8px" }}>
          Monthly, set per currency rather than converted. A club is quoted in its own currency when it is one of these, otherwise in US dollars.
        </p>
        {localTiers.map((t) => (
          <p key={t.key} style={{ fontSize: 13, margin: "3px 0", fontVariantNumeric: "tabular-nums" }}>
            <span style={{ fontWeight: 500 }}>{t.name}</span>
            {": "}
            {t.prices.join(" · ")}
          </p>
        ))}
      </div>
      <OwnerLimits tiers={limitTiers} enforce={enforcementEnabled(limitOverrides)} />
      {/* The owner's own screen belongs to no club, so the plans are named in
          the app's default golf — the US register. */}
      <OwnerClubPlan tiers={Object.values(PLANS).map((p) => ({ key: p.key, name: p.name, tagline: planTagline(p, golfTermsFor("us")) }))} />
      <OwnerDiscounts codes={discounts} />

      {/* Tier mix */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Tier mix</span>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Plan</th>
                <th style={{ textAlign: "right" }}>Clubs</th>
                <th style={{ textAlign: "right" }}>Price / mo</th>
                <th style={{ textAlign: "right" }}>MRR</th>
              </tr>
            </thead>
            <tbody>
              {m.tierMix.map((t) => (
                <tr key={t.plan}>
                  <td style={{ fontWeight: 500 }}>{t.name}</td>
                  <td style={{ textAlign: "right" }}>{t.count.toLocaleString(DEFAULT_LOCALE)}</td>
                  <td style={{ textAlign: "right" }}>{t.monthly === 0 ? "—" : usd(t.monthly)}</td>
                  <td style={{ textAlign: "right" }}>{t.mrr === 0 ? "—" : usd(t.mrr)}</td>
                </tr>
              ))}
              {m.tierMix.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-muted" style={{ fontSize: 13, padding: 16 }}>
                    No subscriptions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two side-by-side breakdowns */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 240 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Organizations by kind</span>
          <div style={{ marginTop: 8 }}>
            {m.kinds.map((k) => (
              <div key={k.kind} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                <span style={{ textTransform: "capitalize" }}>{k.kind}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{k.count.toLocaleString(DEFAULT_LOCALE)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card elev-sm" style={{ flex: 1, minWidth: 240 }}>
          <span className="card-title" style={{ fontSize: 15 }}>Tournaments by stage</span>
          <div style={{ marginTop: 8 }}>
            {m.statuses.map((s) => (
              <div key={s.status} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
                <span style={{ textTransform: "capitalize" }}>{s.status}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.count.toLocaleString(DEFAULT_LOCALE)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Worth attention */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Worth a look</span>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
          <li>
            <strong>{m.orgsWithNoEvents.toLocaleString(DEFAULT_LOCALE)}</strong> organization
            {m.orgsWithNoEvents === 1 ? " has" : "s have"} signed up but never run a tournament — onboarding drop-off.
          </li>
          <li>
            <strong>{m.freeOrgs.toLocaleString(DEFAULT_LOCALE)}</strong> on the free tier
            {m.paidOrgs > 0 ? `, against ${m.paidOrgs} paying` : ""} — the conversion pool.
          </li>
          <li>
            <strong>{m.liveEvents.toLocaleString(DEFAULT_LOCALE)}</strong> tournament{m.liveEvents === 1 ? " is" : "s are"} live right now.
          </li>
          {/* Watched rather than walled (2026-09-29): one person running
              several free Par clubs side by side. Near zero means no problem. */}
          <li>
            <strong>{severalParClubs.toLocaleString(DEFAULT_LOCALE)}</strong>{" "}
            {severalParClubs === 1 ? "person owns" : "people own"} more than one free {PLANS.free.name} club
            {severalParClubs === 0 ? " — nobody is splitting a group to stay free." : " — worth a look if this climbs."}
          </li>
        </ul>
      </div>

      {/* Recent signups */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Newest organizations</span>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Kind</th>
                <th>Plan</th>
                <th style={{ textAlign: "right" }}>Events</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {recentOrgs.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 500 }}>{o.name}</td>
                  <td className="text-muted" style={{ textTransform: "capitalize" }}>{o.kind}</td>
                  {/* The plan's NAME, through planFor as the Tier mix above reads it. The stored key
                      ("club") was printed here under a line saying "is now on Eagle" (2026-10-21). */}
                  <td className="text-muted">{planFor(o.subscription?.plan).name}</td>
                  <td style={{ textAlign: "right" }}>{o._count.events}</td>
                  <td className="text-muted">{shortDate(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live now */}
      {liveEvents.length > 0 && (
        <div className="card elev-sm">
          <span className="card-title" style={{ fontSize: 15 }}>Live right now</span>
          <div style={{ marginTop: 8 }}>
            {liveEvents.map((e) => (
              <div key={e.id} style={{ fontSize: 13, padding: "3px 0" }}>
                <span style={{ fontWeight: 500 }}>{e.name}</span>
                <span className="text-muted"> · {e.organization.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
