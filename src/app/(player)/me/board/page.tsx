import { Icon } from "@/components/Icon";
import { WayForward } from "@/components/WayForward";
import Link from "next/link";
import { screenMetadata } from "@/lib/screen-metadata";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, standingRows, settingsOf, cutLineNote } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { PlayerLeaderboard } from "@/components/PlayerLeaderboard";
import { boardKind } from "@/lib/formats";
import { roundKicker, roundLabel } from "@/lib/domain/round-label";
import { holesPlayed } from "@/lib/domain/handicap";
import { resultLinesFor } from "@/lib/services/tournament-result";
import { teamStandings } from "@/lib/services/teams";
import { TeamStandingsTable, teamBoardNote } from "@/components/TeamLeaderboard";
import { ResultLines } from "@/components/ResultLines";

export const metadata = screenMetadata("/me/board");

/**
 * The board, as a player reads it.
 *
 * The same PlayerLeaderboard the public share link renders — one component,
 * so a player checking the app and a spectator following the link cannot be
 * shown different standings.
 *
 * The tournament's own visibility setting still applies. A club that has not
 * published the leaderboard has not published it to its players either, and
 * hiding the tab while leaving the route open would be theatre.
 */
export default async function PlayBoardPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  if (!canSeeLeaderboard(settingsOf(state.event), session.viewRole)) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>Board</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          The organizer hasn&rsquo;t published standings for this tournament yet.
        </p>
        <WayForward
          links={[
            { href: "/me", label: "Back to today", icon: "flag" },
            { href: "/me/card", label: "My card", icon: "cards" },
          ]}
        />
      </div>
    );
  }

  // The round this board shows, and whether IT is stroke-scored — both
  // from the state, which is where the four screens that used to work this
  // out for themselves now agree. See `boardIsStroke`.
  const stage = state.boardStage;
  const holes = holesPlayed(stage?.holes);

  // The same branch the console leaderboard, Reports and /live make (D8). A
  // player looking at their own board is the last person who should be shown a
  // ranking the app cannot actually compute for this round — they will read it
  // as where they stand.
  const kind = boardKind(stage?.format);
  if (kind !== "standard") {
    /**
     * A TEAM ROUND HAS A BOARD; IT IS JUST NOT A BOARD OF PLAYERS.
     *
     * This screen used to say "Ask your organizer for the team board" and then
     * print the round's winning side four lines below it, out of
     * `ResultLines` — one screen telling a member to go and ask a human for an
     * answer it was already showing them. Read off the seeded club's foursomes
     * on 2026-09-20.
     *
     * So it shows the sides, through the table the organizer's leaderboard and
     * the public board both render. `canSeeLeaderboard` above still decides
     * whether standings are published at all; this branch is about the format,
     * and a club that has published its standings has published these.
     */
    // The ROUND's card, from the state — `strokeCourseFor` is the resolver
    // every screen that scores a card here goes through, so a round played at
    // another venue or over the back nine is priced off its own card rather
    // than off the tournament's.
    const roundCard = stage ? state.strokeCourseFor(stage.id) : null;
    const sides =
      kind === "team" && stage && roundCard
        ? await teamStandings(
            state.event.id,
            stage.id,
            stage.format,
            roundCard.pars,
            roundCard.holeDifficulty,
            stage.scoringBasis,
            stage.handicapAllowance,
            stage.allowanceWeights,
            stage.countBest,
          )
        : null;
    const stableford = (stage?.scoringBasis ?? "") === "stableford";
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>Board</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          {kind === "manual"
            ? "This round is scored by hand — the committee works out the result and posts it when it's settled."
            : kind === "team"
              ? `This round ranks sides rather than players. ${teamBoardNote(
                  stage?.format ?? "",
                  sides?.length ?? 0,
                  stableford,
                )}`
              : "This round is scored a different way. Ask your organizer for the current standings."}
        </p>
        {sides && (
          <div style={{ marginTop: 14 }}>
            <TeamStandingsTable stableford={stableford} rows={sides} />
          </div>
        )}
        {/* THE RESULT STILL BELONGS HERE (2026-09-19). A team round or a round
            scored by hand has no player ranking — which is why this branch
            exists — and that is exactly the day whose result a member cannot
            work out for themselves. Walked on the seeded club's foursomes:
            the board refused, the card refused, and nothing anywhere said who
            had won.

            Not in the branch above it: a club that has not PUBLISHED its
            standings has not published them, and listing each round's winner
            underneath would be the app overruling that. This branch is about
            the format, not about what the club has chosen to show. */}
        <ResultLines lines={await resultLinesFor(state)} kind={state.event.playKind} />
        <WayForward
          links={[
            { href: "/me", label: "Back to today", icon: "flag" },
            { href: "/me/card", label: "My card", icon: "cards" },
          ]}
        />
      </div>
    );
  }

  const rows = standingRows(state);
  // The day's own result, round by round — see services/tournament-result.ts.
  const lines = await resultLinesFor(state);

  // Which row is theirs, by the registration email — the same linkage every
  // score guard uses, rather than matching on a name two people can share.
  const me = state.players.find(
    (p) => p.email.trim().toLowerCase() === session.email.trim().toLowerCase(),
  );

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--color-neutral-400)",
        }}
      >
        {/* A LABEL SLOT, so it takes the description only where that reads as
            a label. Demo Cup's is a whole sentence and arrived here upper-cased
            across two lines above a heading saying "Board". See roundKicker. */}
        {roundKicker(stage?.description, roundLabel(state.stages, stage?.id ?? "") || stage?.type || "Standings")}
      </div>
      {/* "Board", the word on the tab the player just tapped.
          This screen called itself "Board" in both of its refusal states and
          "Leaderboard" here, so the same page had two names depending on what
          it could show. Its sibling tabs both use their tab's own word — "My
          card", "Rules" — so this was also the one breaking the app's own
          convention. The kicker above already names the round, which is the
          part a player actually needs. */}
      {/* The heading, and Rules beside it — Rules left the tab bar for Events
          (2026-09-19), and "how are ties broken?" is a question the board
          raises. */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, margin: "6px 0 18px" }}>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: 0 }}>Board</h1>
        <Link
          href="/me/rules"
          style={{ fontSize: 13, fontWeight: 600, color: "var(--color-accent-300)", display: "inline-flex", alignItems: "center", gap: 4, minHeight: 44 }}
        >
          <Icon name="book-open" /> Rules
        </Link>
      </div>

      {/* WHAT HAPPENED, ROUND BY ROUND (2026-09-19). A day with more than one
          round is more than one result — a team nine, a pairs match and a
          medal — and until now a member had to visit each board and remember.
          Headed with whatever the club called this one: "Outing result",
          "League result". Only where there is more than one round, because on
          a single-round medal the board below IS the result. */}
      <ResultLines lines={lines} kind={state.event.playKind} />

      <PlayerLeaderboard
        isStroke={state.boardIsStroke}
        isStableford={stage?.scoringBasis === "stableford"}
        rows={rows}
        holes={holes}
        youId={me?.id ?? ""}
        // What the column actually measures, from the same place the board
        // totals it — the state now says, rather than the screen assuming.
        unit={state.boardIsStroke ? state.strokeUnitLabel : "match points"}
        // Why the cut line falls where it does. The player on the wrong side
        // of it is the one person who most needs that sentence, and it was
        // rendered only on the organizer's console.
        cutNote={cutLineNote(state) ?? ""}
      />
    </div>
  );
}
