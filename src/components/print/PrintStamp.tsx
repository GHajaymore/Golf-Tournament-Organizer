"use client";
import { createContext, useContext } from "react";

/**
 * THE STAMP AT THE FOOT OF EVERY PRINTED SHEET (decision D): when it was
 * printed, on the club's clock, and which version of the sheet it is.
 *
 * The moment is the server's answer from the press of Print — the hub records
 * what went to the printer and hands back each sheet's stamp before the
 * printer is asked — so the paper says when it was printed, not when the page
 * happened to be opened. Until then the preview shows the time the page was
 * drawn and the version printing it would carry.
 */
export interface Stamps {
  /** "8:12 AM, 23 Oct 2026" — what an unprinted preview says. */
  nowWords: string;
  /** Recorded at the press of Print, by sheet. */
  printed: Record<string, { words: string; version: number }>;
}

export const StampContext = createContext<Stamps>({ nowWords: "", printed: {} });

export function PrintStamp({ sheetKey, nextVersion, groupsAsOf }: { sheetKey: string; nextVersion: number; groupsAsOf: string }) {
  const stamps = useContext(StampContext);
  const done = stamps.printed[sheetKey];
  const words = done?.words ?? stamps.nowWords;
  const version = done?.version ?? nextVersion;
  return (
    <span className="pk-stamp">
      Printed {words} · version {version}
      {groupsAsOf ? ` · groups as of ${groupsAsOf}` : ""}
    </span>
  );
}
