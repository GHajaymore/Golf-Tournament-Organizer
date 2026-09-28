"use client";

import { useSearchParams } from "next/navigation";
import { SCREEN_ACCESS } from "@/lib/roles";
import { screenName } from "@/lib/nav";

/**
 * WHY YOU ARE HERE AND NOT WHERE YOU CLICKED — on a refused visit.
 *
 * `deniedLanding` (page-helpers.ts) sends a refused visit to the role's landing
 * screen with `?denied=<screen key>`. This says what happened: an assistant who
 * clicks "change on Tournament details" from Registration used to land on the
 * dashboard with nothing said, and read the app as broken.
 *
 * It prints the NAME of a screen it knows, never the parameter: a key that is
 * not in `SCREEN_ACCESS` renders nothing, so a crafted link cannot put its own
 * words on the page.
 */
export function DeniedNotice({ organizer = "organizer" }: { organizer?: string } = {}) {
  const key = useSearchParams().get("denied") ?? "";
  if (!key || !(key in SCREEN_ACCESS)) return null;
  const name = screenName(`/${key}`);
  if (!name) return null;
  return (
    <p
      role="status"
      style={{
        margin: "0 0 14px",
        padding: "10px 12px",
        borderRadius: 10,
        fontSize: 13,
        lineHeight: 1.5,
        background: "var(--color-surface-2)",
      }}
    >
      <strong>{name}</strong> is for the tournament&rsquo;s {organizer}, so it can&rsquo;t open for you. If
      something there needs changing, ask them.
    </p>
  );
}
