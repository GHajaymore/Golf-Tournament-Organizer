"use client";
import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  ARCHIVE_LOCKED_CONTROLS,
  ARCHIVE_REFUSED_EVENTS,
  NEW_TOURNAMENT_ATTRIBUTE,
  READS_ATTRIBUTE,
  archiveLeavesLive,
  archiveLocksScreen,
} from "@/lib/domain/archive-read-only";

type Control = HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Disable every control under `root` that changes a record (`archiveLeavesLive` says which do not). */
function lockControls(root: HTMLElement) {
  root.querySelectorAll<Control>(ARCHIVE_LOCKED_CONTROLS).forEach((el) => {
    if (el.disabled) return;
    const live = archiveLeavesLive({
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") ?? "").toLowerCase(),
      role: el.getAttribute("role") ?? "",
      expands: el.hasAttribute("aria-expanded"),
      reads: el.closest(`[${READS_ATTRIBUTE}]`) !== null,
      makesNew: el.closest(`[${NEW_TOURNAMENT_ATTRIBUTE}]`) !== null,
    });
    if (!live) el.disabled = true;
  });
}

const refuse = (e: Event) => {
  e.preventDefault();
  e.stopPropagation();
};

/**
 * AN ARCHIVED TOURNAMENT'S SCREENS, READ-ONLY IN ONE PLACE — see
 * `domain/archive-read-only.ts` for the rule and what stays live.
 *
 * Wraps the console's screens in the layout. On a locked screen of an archived
 * tournament every control that writes is disabled natively — and kept so: a
 * control that renders later (an opened panel, an armed confirm) or that a
 * component re-enables (`disabled={pending}` going false) is disabled again as
 * it appears. A form sent anyway and a drag are refused before any handler
 * runs. Links and everything that only changes the view stay live; the banner
 * above (`ArchiveBanner`) says why, once, in the archive's own sentence.
 *
 * `display: contents`, so the wrapper adds no box and no screen's layout moves.
 */
export function ArchiveReadOnly({ archived, children }: { archived: boolean; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const locked = archived && archiveLocksScreen(pathname);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!locked || !root) return;
    lockControls(root);
    const watch = new MutationObserver(() => lockControls(root));
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    for (const type of ARCHIVE_REFUSED_EVENTS) root.addEventListener(type, refuse, true);
    return () => {
      watch.disconnect();
      for (const type of ARCHIVE_REFUSED_EVENTS) root.removeEventListener(type, refuse, true);
    };
  }, [locked]);

  return (
    <div
      ref={ref}
      // A screen moving between locked and not (to Club settings, say) starts
      // afresh, so no control keeps a disabled state the archive gave it.
      key={locked ? "archive-read-only" : "writable"}
      data-archive-read-only={locked ? "" : undefined}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  );
}
