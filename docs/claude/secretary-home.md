# secretary-home


## Moved from CLAUDE.md (20 Nov 2026): The secretary's home: what's next, and copy last event

The panel's item 4 (approved by Ajay, 2026-10-24). The dashboard's **What's next** is one line for
each job waiting on the person in every tournament they run at the open tournament's club — entries
awaiting approval, a tee sheet for the next fortnight unpublished, a launch, the next draw or week,
cards not returned, results not released — soonest first. Per-round facts come from the screens' own
functions (`services/whats-next.ts`: `awaitingApproval`, `nextUnplayedRound`, `boardProgress`); each
tournament's own job is the state machine's `nextAction`, with its refusal and way out
(`lifecycleJob`), never worked out on the home. `whatsNext` in `domain/needs-you-now.ts` only words
and orders them, so the home cannot disagree with the screen it sends you to. Buttons only with the
club's `canEdit`; a job in another tournament opens it through `enterTournament(eventId, screen)`,
which honours `JOB_SCREENS` (`/registration`, `/foursomes`, `/stages`, `/entry`, `/dashboard`) and nothing else.

**Copy last event** is `cloneEvent` given a first day: `copiedCalendar` moves the entry window and the
rounds by the same distance against the club's own today, side games come across as games with nobody
in them (`CLONED_CONTEST_FIELDS` and its two siblings in `clone.ts`), and the copy is made only by the
club's Commissioner or an Admin (`organizationAccessFor`). **The journeys are MEASURED and RATCHETED**
(row 0b, 14 Nov): seven walks at a person's pace — sign-up to an entry link, a first event somebody can
PLAY (held under ten minutes), copy last event, a member's and a guest's first hole, a signed-out member,
a whole card on one bar — print one `JOURNEY {…}` line each, and fail CI over OR under their ceilings in
`e2e/journey-budgets.ts`. Read `docs/claude/journeys.md` before touching one or answering a breach.

