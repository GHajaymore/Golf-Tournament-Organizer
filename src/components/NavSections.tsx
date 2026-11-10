import Link from "next/link";
import type { CSSProperties } from "react";
import type { NavItem, NavSection } from "@/lib/nav";
import { activeEntryKey } from "@/lib/nav-lifecycle";
import { STATE_WORD, keepPreview } from "@/lib/domain/lifecycle-track";
import { Icon } from "./Icon";

/**
 * THE MENU'S SECTIONS AND LINKS — one drawing for the sidebar and the phone's drawer, which each
 * drew their own copy of this list.
 *
 * It draws what it is handed. The flat menu (`navForRole`) comes out exactly as both drew it
 * before. The menu that follows the lifecycle (`lifecycleNav`, shown where the stepper is) adds
 * three things, each only when the section or entry carries it:
 *
 *   scope      "Event", once, over the four stops
 *   stop       the stop the tournament is on says so in words ("Now", "Needs you") and is
 *              `aria-current="step"`, as the stepper's own stop is
 *   children   the screens grouped beneath an entry, indented under it
 *
 * `preview`: drawn by `?stepper=1` while the switch is off, so every link keeps the preview on.
 */
const HEADING: CSSProperties = {
  fontSize: 13,
  letterSpacing: "0.13em",
  textTransform: "uppercase",
  color: "var(--color-neutral-500)",
  margin: "12px 8px 3px",
};

export function NavSections({
  sections,
  pathname,
  preview = false,
  onNavigate,
  headEmpty = false,
}: {
  sections: NavSection[];
  pathname: string | null;
  preview?: boolean;
  /** The drawer closes itself when a link is pressed. */
  onNavigate?: () => void;
  /** The drawer draws a section's heading row even when it has no words (its first row's spacing). */
  headEmpty?: boolean;
}) {
  const here = activeEntryKey(sections, pathname);
  const link = (it: NavItem, beneath: boolean) => (
    <Link
      key={it.key}
      href={preview ? keepPreview(it.href) : it.href}
      className="side-link"
      aria-current={here === it.key ? "page" : undefined}
      onClick={onNavigate}
      // Beneath its entry: set in by the icon's width and the gap, so it reads as part of it.
      style={beneath ? { paddingLeft: 40 } : undefined}
    >
      {!beneath && <Icon name={it.icon} />}
      <span>{it.label}</span>
    </Link>
  );

  return (
    <>
      {sections.map((sec) => (
        <div key={sec.stop?.key ?? (sec.label || sec.items[0]?.key)} data-nav-stop={sec.stop?.key} data-state={sec.stop?.state}>
          {sec.scope && (
            <div
              data-nav-scope=""
              style={{ ...HEADING, margin: "14px 8px 0", paddingTop: 10, borderTop: "1px solid var(--color-divider)", color: "var(--color-text-muted)", fontWeight: 600 }}
            >
              {sec.scope}
            </div>
          )}
          {/* An EMPTY label renders NO heading in the sidebar, which is what the dashboard wants:
              it is home, and a one-item section under a word is a heading apologising for itself. */}
          {(sec.label || headEmpty) && (
            <div style={HEADING} data-nav-heading={sec.stop ? "" : undefined} aria-current={sec.stop?.current ? "step" : undefined}>
              {sec.label}
              {sec.stop?.current && sec.stop.state !== "done" && (
                <span style={{ color: "var(--color-text)", fontWeight: 600 }}> · {STATE_WORD[sec.stop.state]}</span>
              )}
            </div>
          )}
          {sec.detail && (
            <div className="text-muted" style={{ fontSize: 13, margin: "0 8px 3px" }}>
              {sec.detail}
            </div>
          )}
          {sec.items.map((it) =>
            it.children ? (
              <div key={it.key}>
                {link(it, false)}
                {it.children.map((c) => link(c, true))}
              </div>
            ) : (
              link(it, false)
            ),
          )}
        </div>
      ))}
    </>
  );
}
