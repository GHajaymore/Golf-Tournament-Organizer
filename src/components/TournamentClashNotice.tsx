"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchEvent } from "@/app/actions/tournament";
import type { TournamentClash } from "@/lib/services/tournament-clash";
import { Icon } from "./Icon";

/**
 * "You're already playing one of these today."
 *
 * A quick round is private and temporary — its own field, its own pot, its own
 * card, deleted a day later. That is right for a Sunday fourball and wrong on
 * the morning of the club medal, where it produces two cards for one round of
 * golf: the one the club will score, and one that vanishes tomorrow taking the
 * skins with it.
 *
 * A WARNING AND NOT A REFUSAL. There are real reasons to build one anyway, and
 * the app is not better placed than somebody standing on the tee to judge it.
 * What it can do is name the round they are already in and hand them the two
 * screens that do what they were probably about to do here.
 *
 * The buttons SWITCH the active tournament before navigating, which is the
 * whole reason this is a client component rather than two links. The session
 * carries one active event; a plain link to /me lands wherever that happens to
 * point, which on this screen is very often the quick round they set up last
 * Sunday — sending somebody who is late for their tee time to a fourball that
 * finished a week ago.
 */
export function TournamentClashNotice({ clash }: { clash: TournamentClash }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (to: string) =>
    startTransition(async () => {
      await switchEvent(clash.eventId);
      router.push(to);
    });

  return (
    <div className="card elev-sm" style={{ marginBottom: 20, gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
      <span className="card-title" style={{ fontSize: 14.5 }}>
        <Icon name="warning-circle" /> You&rsquo;re playing {clash.eventName} today
      </span>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65 }}>
        {clash.roundLabel} is on {clash.dateLabel}
        {clash.teeSheetPublished
          ? ", and the tee sheet is out — your group and time are on it."
          : "."}{" "}
        Play that round there: the card counts towards the standings, and a round set up here does
        not.
        {clash.hasMoneyGame
          ? " The money is the club’s too — its pots are already running, and a second one here would split your fourball between two games."
          : " Any pot you want inside your fourball belongs on that tournament’s Group games screen, where it settles with everything else."}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: 13, minHeight: 44 }}
          disabled={pending}
          onClick={() => go("/me")}
        >
          {pending ? "Switching…" : "Go to today’s round"}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ fontSize: 13, minHeight: 44 }}
          disabled={pending}
          onClick={() => go("/group-games")}
        >
          Its group games
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.5 }}>
        Setting one up here anyway is fine — it just stays separate from that tournament.
      </p>
    </div>
  );
}
