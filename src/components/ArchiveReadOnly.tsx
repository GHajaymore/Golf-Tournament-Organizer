"use client";
import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  ARCHIVE_LOCKED_CONTROLS,
  ARCHIVE_REFUSED_EVENTS,
  NEW_TOURNAMENT_ATTRIBUTE,
  READS_ATTRIBUTE,
  THIS_TOURNAMENT_ATTRIBUTE,
  archiveLocksControl,
  archiveLocksScreen,
} from "@/lib/domain/archive-read-only";

type Control = HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Disable every control under `root` the archive locks on this screen (`archiveLocksControl`). */
function lockControls(root: HTMLElement, screenLocked: boolean) {
  root.querySelectorAll<Control>(ARCHIVE_LOCKED_CONTROLS).forEach((el) => {
    if (el.disabled) return;
    const locks = archiveLocksControl(screenLocked, {
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") ?? "").toLowerCase(),
      role: el.getAttribute("role") ?? "",
      expands: el.hasAttribute("aria-expanded"),
      reads: el.closest(`[${READS_ATTRIBUTE}]`) !== null,
      makesNew: el.closest(`[${NEW_TOURNAMENT_ATTRIBUTE}]`) !== null,
      thisTournament: el.closest(`[${THIS_TOURNAMENT_ATTRIBUTE}]`) !== null,
    });
    if (locks) el.disabled = true;
  });
}

/**
 * AN ARCHIVED TOURNAMENT'S SCREENS, READ-ONLY IN ONE PLACE — see
 * `domain/archive-read-only.ts` for the rule and what stays live.
 *
 * Wraps the console's screens in the layout. On a locked screen of an archived
 * tournament every control that writes is disabled natively — and kept so: a
 * control that renders later (an opened panel, an armed confirm) or that a
 * component re-enables (`disabled={pending}` going false) is disabled again,
 * once per animation frame however many changes the frame held. A form sent
 * anyway and a drag are refused before any handler runs. On a screen the
 * archive leaves open (the club's), only the tournament's own part is locked.
 * Links and everything that only changes the view stay live; the banner above
 * (`ArchiveBanner`) says why, once, in the archive's own sentence.
 *
 * `display: contents`, so the wrapper adds no box and no screen's layout moves.
 */
export function ArchiveReadOnly({ archived, children }: { archived: boolean; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const locked = archived && archiveLocksScreen(pathname);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!archived || !root) return;
    lockControls(root, locked);
    // Batched: one scan per frame, not one per mutation (a long list re-rendering is hundreds).
    let frame = 0;
    const watch = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        lockControls(root, locked);
      });
    });
    watch.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    const refuse = (e: Event) => {
      const inTournamentPart = e.target instanceof Element && e.target.closest(`[${THIS_TOURNAMENT_ATTRIBUTE}]`) !== null;
      if (!locked && !inTournamentPart) return;
      e.preventDefault();
      e.stopPropagation();
    };
    for (const type of ARCHIVE_REFUSED_EVENTS) root.addEventListener(type, refuse, true);
    return () => {
      watch.disconnect();
      if (frame) cancelAnimationFrame(frame);
      for (const type of ARCHIVE_REFUSED_EVENTS) root.removeEventListener(type, refuse, true);
    };
  }, [archived, locked]);

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
