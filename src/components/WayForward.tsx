import Link from "next/link";
import { Icon } from "@/components/Icon";

/**
 * A ROW OF WAYS OUT, FOR A SCREEN WITH NOTHING ON IT.
 *
 * Every player screen can be reached in a state where it has nothing to show:
 * a card for somebody not entered, a board the club has not published, a round
 * the app cannot rank. Each one said so in a sentence and stopped there, so the
 * player's only move was the tab bar — which is how a screen that is working
 * correctly reads as one that is broken.
 *
 * `/me/card` already did this for match play ("See my match", "See the board")
 * and was the only one. This is that row, so the next refusal written gets it
 * without anybody remembering to.
 *
 * The first link is the primary one: what the person most likely came to do.
 */
export function WayForward({
  links,
}: {
  links: { href: string; label: string; icon: string }[];
}) {
  if (links.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
      {links.map((l, i) => (
        <Link key={l.href} className={i === 0 ? "btn btn-primary" : "btn btn-secondary"} href={l.href}>
          <Icon name={l.icon} /> {l.label}
        </Link>
      ))}
    </div>
  );
}
