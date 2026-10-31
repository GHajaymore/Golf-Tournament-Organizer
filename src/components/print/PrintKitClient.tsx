"use client";
import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { StampContext } from "./PrintStamp";
import { PrintPages } from "./PrintPages";
import { recordPrinted } from "@/app/actions/print-kit";
import { PAPER_MM, PAPER_NAME, sheetsFor, staleSentence, type CardsBy, type DocKind, type PaperSize, type SignsBy } from "@/lib/domain/print-kit";
import type { PrintKit } from "@/lib/services/print-kit";

export interface HubDoc {
  kind: DocKind;
  title: string;
  what: string;
  unavailable: string;
  /** Each card or page of it, in order, with the fingerprint it was drawn with. */
  sheets: Array<{ key: string; fp: string; label: string; state: "unprinted" | "current" | "stale"; printedVersion: number }>;
}

/**
 * THE SECRETARY'S MORNING CHECKLIST: every document the app can make for this
 * round, ticked or not, the paper it goes on, how many SHEETS that is, and one
 * button. Cards are two to a sheet (the ruling of 30 Oct), so the count is of
 * paper, not of cards — said on the button before anyone presses it.
 *
 * The pages are laid out here, from what is ticked, so "reprint only the
 * out-of-date ones" is the fewer sheets it should be; the press records what went
 * to the printer and stamps each card before the printer is asked (`recordPrinted`).
 */
export function PrintKitClient({
  kit,
  paper: paperDefault,
  docs,
  preticked,
  staleOnly,
  canGroupCards,
  children,
}: {
  kit: PrintKit;
  paper: PaperSize;
  docs: HubDoc[];
  preticked: DocKind[];
  staleOnly: boolean;
  /** Scorecards may print one per group — an individual format only. */
  canGroupCards: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const stageId = kit.round!.id;
  const [paper, setPaper] = useState<PaperSize>(paperDefault);
  const [ticked, setTicked] = useState<Set<DocKind>>(new Set(preticked));
  /**
   * REPRINTING: just these cards, by key. Held as the keys rather than as "whatever is
   * stale", because the press makes them current — and a page that showed "the stale ones"
   * would go blank the moment the reprint it was showing had been recorded.
   */
  const staleAtFirst = docs.flatMap((d) => (d.unavailable ? [] : d.sheets.filter((s) => s.state === "stale").map((s) => s.key)));
  const [only, setOnly] = useState<string[] | null>(staleOnly && staleAtFirst.length > 0 ? staleAtFirst : null);
  const onlyStale = only !== null;
  const [stamps, setStamps] = useState<Record<string, { words: string; version: number }>>({});
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const offered = docs.filter((d) => !d.unavailable && d.sheets.length > 0);
  const stale = offered.flatMap((d) => d.sheets.filter((s) => s.state === "stale"));
  const everySheet = offered.flatMap((d) => d.sheets);
  const chosen = only ? everySheet.filter((s) => only.includes(s.key)) : offered.filter((d) => ticked.has(d.kind)).flatMap((d) => d.sheets);
  const chosenKeys = useMemo(() => new Set(chosen.map((s) => s.key)), [chosen]);

  /** Every card and page the kit can print, with its shape — for the sheet count and the fold-outs. */
  const units = useMemo(() => kit.docs.flatMap((d) => d.pages.map((p) => ({ key: p.key, doc: d.kind, format: p.format, label: p.label, why: p.formatWhy }))), [kit.docs]);
  const chosenUnits = units.filter((u) => chosenKeys.has(u.key));
  const sheets = sheetsFor(chosenUnits);
  const folded = chosenUnits.filter((u) => u.format === "fold-out");

  const { w, h } = PAPER_MM[paper];
  const css = `
@page pk-portrait { size: ${w}mm ${h}mm; margin: 0; }
@page pk-landscape { size: ${h}mm ${w}mm; margin: 0; }`;

  const toggle = (kind: DocKind) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const go = (keys: Array<{ key: string; fp: string }>, staleMode: boolean) =>
    startTransition(async () => {
      setError("");
      setOnly(staleMode ? keys.map((k) => k.key) : null);
      const res = await recordPrinted(stageId, keys, { cards: kit.cardsBy, signs: kit.signsBy });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStamps((prev) => ({ ...prev, ...res.stamps }));
      // Two frames: the stamps and the selection are on the page before the printer reads it.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      window.print();
      router.refresh();
    });

  const hrefWith = (over: { round?: string; cards?: CardsBy; signs?: SignsBy }) => {
    const q = new URLSearchParams({
      round: over.round ?? stageId,
      docs: [...ticked].join(","),
      paper,
      cards: over.cards ?? kit.cardsBy,
      signs: over.signs ?? kit.signsBy,
    });
    return `/print?${q.toString()}`;
  };
  const sheetWord = (n: number) => `${n} ${n === 1 ? "sheet" : "sheets"}`;

  const choice = (kind: DocKind) => {
    if (kind === "cards" && canGroupCards)
      return (
        <ChoiceRow
          name="cards-by"
          value={kit.cardsBy}
          options={[
            ["player", "One card per player"],
            ["group", "One per group"],
          ]}
          onPick={(v) => router.push(hrefWith({ cards: v as CardsBy }))}
        />
      );
    if (kind === "signs")
      return (
        <ChoiceRow
          name="signs-by"
          value={kit.signsBy}
          options={[
            ["cart", `One per ${kit.words.cart}`],
            ["group", "One per group (walking)"],
          ]}
          onPick={(v) => router.push(hrefWith({ signs: v as SignsBy }))}
        />
      );
    return null;
  };

  return (
    <>
      <style>{css}</style>
      <div className="no-print pk-controls" style={{ display: "grid", gap: 14, marginBottom: 18, maxWidth: 760 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "end" }}>
          {kit.rounds.length > 1 && (
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              Round
              <select className="input" value={stageId} onChange={(e) => router.push(hrefWith({ round: e.target.value }))} style={{ minHeight: "var(--tap-min, 40px)" }}>
                {kit.rounds.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 12, alignItems: "center" }}>
            <legend style={{ fontSize: 13, marginBottom: 4 }}>Paper</legend>
            {(["a4", "letter"] as const).map((p) => (
              <label key={p} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
                <input type="radio" name="paper" value={p} checked={paper === p} onChange={() => setPaper(p)} />
                {PAPER_NAME[p]}
              </label>
            ))}
          </fieldset>
        </div>

        {stale.length > 0 && (
          <div role="status" className="card elev-sm" style={{ borderLeft: "3px solid var(--color-accent)", gap: 8 }}>
            <strong style={{ fontSize: 15 }}>
              <Icon name="warning-circle" /> {staleSentence(stale.length)}
            </strong>
            <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
              The groups, a tee time, the tees, a handicap or the round code have changed since these were printed:{" "}
              {stale.slice(0, 12).map((s) => s.label).join(" · ")}
              {stale.length > 12 ? ` and ${stale.length - 12} more` : ""}.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => go(stale.map((s) => ({ key: s.key, fp: s.fp })), true)}
                style={{ minHeight: "var(--tap-min, 40px)" }}
              >
                <Icon name="printer" /> Reprint these
              </button>
            </div>
            {error && onlyStale && (
              <p role="alert" style={{ margin: 0, color: "var(--color-danger)", fontSize: 14 }}>
                <Icon name="warning-circle" /> {error}
              </p>
            )}
          </div>
        )}
        {kit.gone.length > 0 && (
          <div className="card elev-sm" style={{ gap: 6 }}>
            <strong style={{ fontSize: 14 }}>Printed sheets that are no longer on the Tee sheet — collect them</strong>
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>{kit.gone.slice(0, 12).map((g) => g.label).join(" · ")}</p>
          </div>
        )}

        <fieldset className="card elev-sm" style={{ gap: 2 }}>
          <legend className="card-title" style={{ fontSize: 15 }}>What to print for this round</legend>
          {docs.map((d) => {
            const off = !!d.unavailable || d.sheets.length === 0;
            const outOfDate = d.sheets.filter((s) => s.state === "stale").length;
            const printed = d.sheets.filter((s) => s.state !== "unprinted").length;
            const paperOf = sheetsFor(units.filter((u) => u.doc === d.kind));
            const status = off
              ? d.unavailable
              : outOfDate > 0
                ? `${outOfDate} out of date`
                : printed === d.sheets.length
                  ? `Printed · version ${Math.max(...d.sheets.map((s) => s.printedVersion))}`
                  : printed > 0
                    ? `${printed} of ${d.sheets.length} printed`
                    : "Not printed yet";
            return (
              <div key={d.kind} style={{ padding: "8px 0", borderTop: "1px solid var(--color-divider)", opacity: off ? 0.6 : 1 }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <input
                    type="checkbox"
                    checked={!off && ticked.has(d.kind)}
                    disabled={off}
                    onChange={() => {
                      setOnly(null);
                      toggle(d.kind);
                    }}
                    style={{ marginTop: 3, width: 18, height: 18 }}
                    aria-describedby={`pk-${d.kind}-status`}
                  />
                  <span style={{ display: "grid", gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>
                      {d.title}
                      {!off && (
                        <span className="text-muted" style={{ fontWeight: 400 }}>
                          {" "}
                          — {d.what} · {d.sheets.length} {d.kind === "start" ? (d.sheets.length === 1 ? "page" : "pages") : d.sheets.length === 1 ? "card" : "cards"}
                          {d.kind === "start" ? "" : ` on ${sheetWord(paperOf)}`}
                        </span>
                      )}
                    </span>
                    <span id={`pk-${d.kind}-status`} className="text-muted" style={{ fontSize: 13 }}>
                      {status}
                    </span>
                  </span>
                </label>
                {!off && choice(d.kind)}
              </div>
            );
          })}
        </fieldset>

        {folded.length > 0 && (
          <p className="text-muted" role="note" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            {folded.length === 1 ? "1 card prints as a fold-out" : `${folded.length} cards print as fold-outs`}, twice the height, to fold once to
            the normal card: {folded.slice(0, 8).map((u) => u.label.split(" — ")[0]).join(", ")}
            {folded.length > 8 ? ` and ${folded.length - 8} more` : ""}, because {[...new Set(folded.map((u) => u.why))].join("; ")}.
          </p>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || chosen.length === 0}
            onClick={() => go(chosen.map((s) => ({ key: s.key, fp: s.fp })), onlyStale)}
            style={{ minHeight: 44 }}
          >
            <Icon name="printer" /> {onlyStale ? `Print ${sheetWord(sheets)} again` : `Print ${sheetWord(sheets)}`}
          </button>
          {onlyStale && (
            <button type="button" className="btn btn-secondary" onClick={() => setOnly(null)} style={{ minHeight: 44 }}>
              Show everything ticked
            </button>
          )}
          <span className="text-muted" style={{ fontSize: 13 }}>
            {PAPER_NAME[paper]}, two cards to a sheet. Print at Actual size (100%) · headers and footers off. Cut on the lines, and
            measure the 50 mm line on the first sheet.
          </span>
        </div>
        {error && !(onlyStale && stale.length > 0) && (
          <p role="alert" style={{ margin: 0, color: "var(--color-danger)", fontSize: 14 }}>
            <Icon name="warning-circle" /> {error}
          </p>
        )}
      </div>
      {children}
      <StampContext.Provider value={{ nowWords: kit.nowWords, printed: stamps }}>
        <PrintPages kit={kit} chosen={chosenKeys} paper={paper} />
      </StampContext.Provider>
    </>
  );
}

function ChoiceRow({ name, value, options, onPick }: { name: string; value: string; options: Array<[string, string]>; onPick: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label={name === "cards-by" ? "Scorecards" : "Signs"} style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "6px 0 0 28px", fontSize: 13.5 }}>
      {options.map(([v, label]) => (
        <label key={v} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onPick(v)} />
          {label}
        </label>
      ))}
    </div>
  );
}
