import Link from "next/link";
import { headers } from "next/headers";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { printKit } from "@/lib/services/print-kit";
import { requestOrigin } from "@/lib/request-origin";
import { PrintKitClient, type HubDoc } from "@/components/print/PrintKitClient";
import { MoreInfo } from "@/components/MoreInfo";
import { cardsByFrom, docTitle, docsFrom, paperFrom, signsByFrom, type DocKind } from "@/lib/domain/print-kit";
import { screenName } from "@/lib/nav";
// The cards are set in the scoreboard's condensed face, from disk, so what the
// browser measures is what prints. Imported for its effect, and NOT hinted: a visit
// that shows no sheet downloads no Oswald (src/components/print-face.ts).
import "@/components/print-face";

export const metadata = screenMetadata("/print");

/** Ticked when nobody has said otherwise: the morning's paper. */
const DEFAULT_TICKED: readonly DocKind[] = ["cards", "cup", "slips", "signs", "spare", "start"];

/**
 * THE PRINT KIT: the secretary's morning checklist — every document the app can
 * make for one round, with the sheets themselves below it.
 *
 * ONE RENDERER, SEVERAL DOORS (panel ruling of 30 Oct 2026): this screen; the
 * Tee sheet's "Print…" (the primary door, where the groups are made); Reports →
 * Exports; the Team cup; and Round codes. Each opens this page with its own
 * documents ticked (`?docs=`). There is no second way to the printer, so there
 * is no second answer on paper.
 */
export default async function PrintKitPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string; docs?: string; paper?: string; stale?: string; cards?: string; signs?: string }>;
}) {
  const session = await requireScreen("print");
  const params = await searchParams;
  const kit = await printKit(session.eventId, {
    stageId: params.round,
    origin: requestOrigin(await headers()),
    cardsBy: cardsByFrom(params.cards),
    signsBy: signsByFrom(params.signs),
  });

  const asked = docsFrom(params.docs);
  const preticked = asked.length > 0 ? asked : [...DEFAULT_TICKED];
  const status = new Map(kit.statuses.map((s) => [s.key, s]));
  const docs: HubDoc[] = kit.docs.map((d) => ({
    kind: d.kind,
    title: docTitle(d.kind, kit.words),
    what: d.what,
    unavailable: d.unavailable,
    sheets: d.pages.map((p) => {
      const s = status.get(p.key);
      return { key: p.key, fp: p.fp, label: p.label, state: s?.state ?? "unprinted", printedVersion: s?.printedVersion ?? 0 };
    }),
  }));
  const Carts = kit.words.carts;

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div className="page-kicker">On the day</div>
        <h1 className="page-title">Print kit</h1>
        <MoreInfo short={`Everything the app can print for a round — scorecards, ${kit.words.cart} signs, the starting sheet — on one page.`} style={{ marginTop: 6 }}>
          Every card is the normal scorecard size, 9.5 × 3.75 in, two to a sheet with lines to cut on. Tick what you want
          and press Print: each card is stamped with when it was printed. If the groups, a tee time, the tees or the
          round code change afterwards, this page and the Tee sheet say which printed cards are out of date, and print
          just those again.
        </MoreInfo>
      </div>

      {!kit.round ? (
        <div className="card elev-sm" style={{ maxWidth: "62ch" }}>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            Nothing to print yet: this tournament has no rounds. Add one on{" "}
            <Link href="/stages">{screenName("/stages")}</Link>, draw its groups on the{" "}
            <Link href="/foursomes">{screenName("/foursomes")}</Link>, and its cards and signs appear here.
          </p>
        </div>
      ) : (
        <PrintKitClient
          // A new round is a new checklist: nothing ticked or stamped carries over.
          key={`${kit.round.id}-${kit.cardsBy}-${kit.signsBy}`}
          kit={kit}
          paper={paperFrom(params.paper, kit.paper)}
          docs={docs}
          preticked={preticked}
          staleOnly={params.stale === "1"}
          canGroupCards={!kit.card?.teamRound?.teams}
        >
          {kit.refusals.length > 0 && (
            <div role="alert" className="no-print card elev-sm" style={{ borderLeft: "3px solid var(--color-danger)", gap: 6, maxWidth: 760, marginBottom: 16 }}>
              <strong style={{ fontSize: 14 }}>Something on these sheets should not go on paper</strong>
              <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                Printed sheets are left in {Carts} and pinned up where anyone can read them, so they never carry an email,
                a phone number or an amount of money. Correct it where it was typed — usually a name on{" "}
                <Link href="/registration">{screenName("/registration")}</Link> — and reload: {kit.refusals.join(" · ")}
              </p>
            </div>
          )}
          {kit.sheet === "none" && (
            <p className="no-print text-muted" style={{ fontSize: 13.5, maxWidth: "62ch" }}>
              Most of these are printed from the round&rsquo;s groups. Draw them on the{" "}
              <Link href={`/foursomes?round=${kit.round.id}`}>{screenName("/foursomes")}</Link> and save the sheet.
            </p>
          )}
        </PrintKitClient>
      )}
    </>
  );
}
