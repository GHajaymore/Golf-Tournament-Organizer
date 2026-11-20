"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { importCsvMembers, type MemberImportResult } from "@/app/actions/roster";
import { csvSizeRefusal } from "@/lib/csv";
import { ImportSummary } from "./RosterClient";
import { Icon } from "./Icon";

/**
 * "IMPORT MEMBERS": THE CLUB'S LIST, FROM ITS OWN SYSTEM, WHERE IT IS USED
 * (Cut A, event-first, Ajay 15 Nov 2026).
 *
 * The members list is never asked for before the first event. It is offered
 * here instead: on Entries, beside the roster it fills, and at the draw, when
 * the field is empty and so is the club's list. The file goes through the
 * Members screen's own import (`importCsvMembers`), so every member lands on
 * Members and nothing is typed twice; the screen is refreshed so the new names
 * are there to pick (the action revalidates the layout).
 */
export function ImportMembersButton({ primary = false }: { primary?: boolean }) {
  const [result, setResult] = useState<MemberImportResult | null>(null);
  const [pending, startTransition] = useTransition();
  const chooser = useRef<HTMLInputElement | null>(null);

  const onFile = async (file: File) => {
    setResult(null);
    // Over the body limit the request never reaches the server, so this is the
    // only place it can be explained (the same rule as the Members screen).
    const tooBig = csvSizeRefusal(file.size);
    const empty = { imported: 0, updated: 0, skippedDuplicates: 0, skippedInvalid: 0, unknownColumns: [] };
    if (tooBig) {
      setResult({ ...empty, error: tooBig });
    } else {
      const text = await file.text();
      startTransition(async () => {
        try {
          // The action revalidates the whole layout, so the new names are on the screen it returns to.
          setResult(await importCsvMembers(text));
        } catch {
          setResult({ ...empty, error: "That import didn't go through. Check your connection and try again — nothing was added." });
        }
      });
    }
  };

  /**
   * THE FILE BOX IS MADE ON THE PRESS, NOT DRAWN WITH THE PAGE. Entries already
   * carries the field's own CSV box, and two `input[type=file]` on one screen
   * is two answers to "the file box" for anything that looks for it — so this
   * one exists only between the press and the choice, and is gone after.
   */
  const choose = () => {
    chooser.current?.remove();
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      chooser.current = null;
      if (file) void onFile(file);
    });
    document.body.appendChild(input);
    chooser.current = input;
    input.click();
  };

  return (
    <div>
      <button type="button" className={`btn ${primary ? "btn-primary" : "btn-secondary"}`} disabled={pending} onClick={choose}>
        <Icon name="upload-simple" /> {pending ? "Importing…" : "Import members"}
      </button>
      {result && <ImportSummary result={result} onDismiss={() => setResult(null)} />}
    </div>
  );
}

/**
 * THE DRAW ASKS FOR THE MEMBERS (Cut A): a draw needs players, nobody has
 * entered, and the club's list is empty (`membersAsked`) — so it is asked for
 * here, with the import and the add-one way, rather than before the first
 * event. With a list and still nobody entered it says to pick from it.
 */
export function MembersAsk({ noun, asked, memberCount }: { noun: string; asked: boolean; memberCount: number }) {
  // One card in one place for both states, so the import's answer stays on
  // screen when the list it filled turns the ask into "pick who is playing".
  return (
    <div className="card elev-sm" role="region" aria-label="Your members" style={{ marginBottom: 16, gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
      <span className="card-title" style={{ fontSize: 15 }}>
        <Icon name="users-three" /> {asked ? "The draw needs players: add your members" : "The draw needs players: pick who is playing"}
      </span>
      <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.6 }}>
        {asked
          ? `Your ${noun}’s members list is empty. Import it as a CSV from your own system, or add players one at a time on Entries. Everyone goes on Members, so nothing is typed twice; then pick who is playing on Entries.`
          : `Your ${noun}’s members list has ${memberCount} ${memberCount === 1 ? "member" : "members"}. Tick who is playing on Entries, under Add from the club roster.`}
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
        <ImportMembersButton primary={asked} />
        <Link href="/registration" className={`btn ${asked ? "btn-secondary" : "btn-primary"}`}>
          <Icon name="user-plus" /> {asked ? "Add a player" : "Pick who is playing"}
        </Link>
      </div>
    </div>
  );
}
