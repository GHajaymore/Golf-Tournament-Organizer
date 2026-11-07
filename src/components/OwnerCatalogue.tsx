"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loadCourseCatalogue } from "@/app/actions/owner";
import { DIRECTORY_ATTRIBUTION } from "@/lib/domain/course-directory";
import { addCounts, chunkRows, countsInWords, NO_COUNTS, parseCatalogueFile, type LoadCounts } from "@/lib/domain/catalogue-load";

/**
 * LOAD COURSE CATALOGUE, on the owner console (Ajay, J29). The owner picks the file
 * `scripts/export-catalogue.ts` wrote; this reads it in the browser, checks it is a catalogue file of
 * a version the app knows, and sends it in small requests (a server action's body is limited, and so
 * is a function's time). The server judges every row again; this only counts and says.
 */
export function OwnerCatalogue({ withCards, lastLine }: { withCards: number; lastLine: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [progress, setProgress] = useState("");

  const load = (file: File) =>
    start(async () => {
      setSaid(null);
      const parsed = parseCatalogueFile(await file.text());
      if (!parsed.ok) {
        setSaid({ ok: false, text: parsed.error });
        return;
      }
      const chunks = chunkRows(parsed.file.courses);
      let total: LoadCounts = NO_COUNTS;
      for (let i = 0; i < chunks.length; i++) {
        setProgress(`Request ${i + 1} of ${chunks.length}…`);
        const res = await loadCourseCatalogue(chunks[i]);
        if (!res.ok || !res.counts) {
          setProgress("");
          setSaid({ ok: false, text: `${res.error ?? "That did not load."} Stopped at request ${i + 1} of ${chunks.length}; ${countsInWords(total)} Loading again is safe.` });
          router.refresh();
          return;
        }
        total = addCounts(total, res.counts);
      }
      setProgress("");
      setSaid({ ok: true, text: `Done: ${countsInWords(total)}` });
      router.refresh();
    });

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }} id="course-catalogue">
      <span className="card-title" style={{ fontSize: 15 }}>Course catalogue</span>
      <p style={{ fontSize: 14, margin: "6px 0 4px" }}>
        {withCards} courses with a usable scorecard are held here.
      </p>
      <p className="text-muted" style={{ fontSize: 13, margin: "0 0 6px" }}>
        Load the file made by the export script. Courses are added or updated, never removed; a card the app refuses is skipped, never stored blank; nothing from GolfCourseAPI is ever loaded. {DIRECTORY_ATTRIBUTION}
      </p>
      <input
        ref={input}
        id="catalogue-file"
        type="file"
        accept="application/json,.json"
        aria-label="Course catalogue file"
        disabled={pending}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) load(f);
          e.target.value = "";
        }}
        style={{ fontSize: 13 }}
      />
      {progress && <p role="status" style={{ fontSize: 13, margin: "8px 0 0" }}>{progress}</p>}
      {said && (
        <p role={said.ok ? "status" : "alert"} className={said.ok ? undefined : "form-error"} style={{ fontSize: 13, margin: "8px 0 0" }}>
          {said.text}
        </p>
      )}
      {lastLine && <p className="text-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>Last load: {lastLine}</p>}
    </div>
  );
}
