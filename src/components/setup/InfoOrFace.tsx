"use client";
import type { ReactNode } from "react";
import FieldInfo from "@/components/FieldInfo";

/**
 * A SENTENCE THAT EXPLAINS A SETTING, drawn on the face of today's screen and behind its ⓘ on the redesigned one (R4d;
 * phase 1 section 2.3: "text that leaves the face for the ⓘ").
 *
 * `redesign` is false on the old screen, which is live in production and must not change: the words are handed to `face`
 * (the caller's own wrapper, so the old markup is byte for byte what it was) or drawn bare. True draws the SAME words,
 * unchanged, inside a `FieldInfo` that names what it explains. One component holds the choice, so a screen cannot move
 * a sentence by copying it.
 */
export function InfoOrFace({
  redesign,
  label,
  face,
  children,
}: {
  redesign: boolean;
  /** What the ⓘ explains, announced to a screen reader (`FieldInfo`'s label). */
  label: string;
  /** The old screen's wrapper around the words; absent means the words alone. */
  face?: (words: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  if (redesign) {
    return (
      <FieldInfo label={label}>
        <p>{children}</p>
      </FieldInfo>
    );
  }
  return <>{face ? face(children) : children}</>;
}
