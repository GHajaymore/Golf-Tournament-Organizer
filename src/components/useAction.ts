"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Call a server action, keep the screen disabled while it runs, and say so if
 * it is refused.
 *
 * EIGHT COMPONENTS WROTE THIS, and the copies had drifted in three ways that
 * a person would notice:
 *
 *   component            clears error   refusal with no message   refreshes
 *   ContestsClient       inside         "Couldn't save that."     no
 *   HandicapSetup        before         "Couldn't save that."     YES
 *   MoneySetup           inside         "Couldn't save that."     no
 *   RoundTeamScoring     before         NOTHING AT ALL            no
 *   SeriesClient         before         NOTHING AT ALL            no
 *   SkinsPotClient       before         NOTHING AT ALL            no
 *   TeamsClient          before         NOTHING AT ALL            no
 *   ThirdPlaceControl    inside         "Couldn't do that."       no
 *
 * THE MIDDLE COLUMN IS THE ONE THAT MATTERS. Four of them wrote
 * `if (!res.ok && res.error) setError(res.error)`, so a refusal carrying no
 * message set nothing: the control does not work, the screen says nothing, and
 * the person clicks it again. Nothing reaches those four in that shape today —
 * every refusal they can receive carries text — but `error` is OPTIONAL in the
 * signature, so it is one new action away, and the failure is silent by
 * construction rather than by accident.
 *
 * So a refusal always says something here. "Couldn't save that." is the
 * majority wording; `ThirdPlaceControl`'s "Couldn't do that." goes with it,
 * because one wording is the point.
 *
 * CLEARED INSIDE THE TRANSITION, which is what three of the eight did. The
 * other five cleared before it, so the old message vanished on click and the
 * new one arrived a moment later — a blink that reads as the error having been
 * fixed and come back. Inside, React has both updates in one pass.
 *
 * `refresh` stays an option because it is a real difference rather than a
 * drift: `HandicapSetup` changes what the server will render next and the
 * others do not.
 */
export function useAction({ refresh = false }: { refresh?: boolean } = {}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();

  /**
   * `after` runs only when the action succeeded — closing an editor, clearing
   * a field, posting a note. Four of the twelve copies had it, and every one
   * of them returned early on a refusal so it could not run. That is the
   * behaviour, not a detail: an editor that closes on a rejected save has
   * thrown away what the person typed.
   */
  const run = (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    after?: () => void,
  ) =>
    startTransition(async () => {
      setError("");
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Couldn't save that.");
        return;
      }
      after?.();
      if (refresh) router.refresh();
    });

  /**
   * `setError` is returned because some screens report their own failures too,
   * and `startTransition` because a few actions do not fit `run`.
   *
   * `TeamsClient` is the case: `autoDrawTeams` and `generateTeamMatches` can
   * come back `needsConfirm`, which is neither success nor refusal — it is the
   * server asking a question — so those two keep their own bodies. They share
   * this hook's transition rather than opening a second one, which is what
   * keeps `pending` meaning "this component is busy" instead of "one half of
   * it is".
   */
  return { pending, error, setError, run, startTransition };
}
