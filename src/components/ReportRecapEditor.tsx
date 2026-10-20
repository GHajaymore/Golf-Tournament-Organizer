"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReportRecap } from "@/app/actions/cup";

/**
 * The organizer writes the final report's story in their own words: the
 * weather, the delay, the shot everybody will talk about — what the results
 * cannot say. Left empty, the report tells the story from the results.
 */
export function ReportRecapEditor({ recap }: { recap: string }) {
  const router = useRouter();
  const [text, setText] = useState(recap);
  const [saved, setSaved] = useState(recap);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const changed = text.trim() !== saved.trim();

  const save = (value: string) =>
    start(async () => {
      setMessage(null);
      const r = await saveReportRecap(value);
      if (!r.ok) {
        setMessage({ ok: false, text: r.error ?? "The story wasn't saved. Try again." });
        return;
      }
      setSaved(value);
      setText(value);
      setMessage({ ok: true, text: value.trim() ? "Story saved." : "The report tells the story from the results again." });
      router.refresh();
    });

  return (
    <div className="card elev-sm" style={{ maxWidth: "70ch" }}>
      <label htmlFor="report-recap" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
        The story
      </label>
      <p className="text-muted" style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.55 }}>
        Write it in your own words — a blank line starts a new paragraph. Leave it empty and the report tells the story
        from the results.
      </p>
      <textarea
        id="report-recap"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={7}
        maxLength={4000}
        style={{ width: "100%", fontSize: 15, lineHeight: 1.55 }}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" className="btn btn-primary" disabled={pending || !changed} style={{ minHeight: 44 }} onClick={() => save(text)}>
          {pending ? "Saving…" : "Save the story"}
        </button>
        {saved.trim() && (
          <button type="button" className="btn" disabled={pending} style={{ minHeight: 44 }} onClick={() => save("")}>
            Use the results&rsquo; story
          </button>
        )}
        {message && (
          <span role={message.ok ? "status" : "alert"} style={{ fontSize: 13.5, color: message.ok ? "var(--color-text)" : "var(--color-danger)" }}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
