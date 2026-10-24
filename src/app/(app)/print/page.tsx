import Link from "next/link";
import { headers } from "next/headers";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { printKit } from "@/lib/services/print-kit";
import { requestOrigin } from "@/lib/request-origin";
import { PrintPages } from "@/components/print/PrintPages";
import { PrintKitClient, type HubDoc } from "@/components/print/PrintKitClient";
import { MoreInfo } from "@/components/MoreInfo";
import { DOC_TITLE, docsFrom, paperFrom, type DocKind } from "@/lib/domain/print-kit";
import { screenName } from "@/lib/nav";

export const metadata = screenMetadata("/print");

/** Ticked when nobody has said otherwise: the morning's paper, without the Tee sheet's old group card. */
const DEFAULT_TICKED: readonly DocKind[] = ["cards", "cup", "slips", "signs", "spare", "start"];

/**
 * THE PRINT KIT (2026-10-23): the secretary's morning checklist — every
 * document the app can make for one round, with the pages themselves below
 * it, one sheet of paper each.
 *
 * ONE RENDERER, TWO DOORS (decision A): this screen, and the "Print…" button
 * on the Tee sheet and the Team cup, which open it with their own documents
 * ticked (`?docs=`). The Tee sheet's old "Print scorecards" and the round
 * signs on Tournament details print through here now; there is no second way
 * to the printer, so there is no second answer on paper.
 */
export default async function PrintKitPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string; docs?: string; paper?: string; stale?: string }>;
}) {
  const session = await requireScreen("print");
  const params = await searchParams;
  const kit = await printKit(session.eventId, { stageId: params.round, origin: requestOrigin(await headers()) });

  const asked = docsFrom(params.docs);
  const preticked = asked.length > 0 ? asked : [...DEFAULT_TICKED];
  const status = new Map(kit.statuses.map((s) => [s.key, s]));
  const docs: HubDoc[] = kit.docs.map((d) => ({
    kind: d.kind,
    title: DOC_TITLE[d.kind],
    what: d.what,
    unavailable: d.unavailable,
    sheets: d.pages.map((p) => {
      const s = status.get(p.key);
      return { key: p.key, fp: p.fp, label: p.label, state: s?.state ?? "unprinted", printedVersion: s?.printedVersion ?? 0 };
    }),
  }));

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div className="page-kicker">On the day</div>
        <h1 className="page-title">Print kit</h1>
        <MoreInfo short="Everything the app can print for a round — cards, cart signs, the starting sheet — on one page." style={{ marginTop: 6 }}>
          Tick what you want and press Print: each sheet comes out on a page of its own, stamped with when it was
          printed. If the groups, a tee time, the tees or the round code change afterwards, this page and the Tee sheet
          say which printed sheets are out of date, and print just those again.
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
          key={kit.round.id}
          stageId={kit.round.id}
          rounds={kit.rounds}
          roundId={kit.round.id}
          paper={paperFrom(params.paper, kit.paper)}
          docs={docs}
          preticked={preticked}
          staleOnly={params.stale === "1"}
          gone={kit.gone.map((g) => g.label)}
          nowWords={kit.nowWords}
        >
          {kit.refusals.length > 0 && (
            <div role="alert" className="no-print card elev-sm" style={{ borderLeft: "3px solid var(--color-danger)", gap: 6, maxWidth: 760, marginBottom: 16 }}>
              <strong style={{ fontSize: 14 }}>Something on these sheets should not go on paper</strong>
              <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                Printed sheets are left in carts and pinned up where anyone can read them, so they never carry an email,
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
          <PrintPages kit={kit} />
        </PrintKitClient>
      )}
    </>
  );
}
