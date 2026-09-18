import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";
import { runMark } from "../scripts/run-mark.mjs";
import { seedLeague } from "./league-fixture.mjs";

/**
 * The tournament the end-to-end tests run against.
 *
 * Marked `zz-e2e` and torn down in global teardown, following the same rule as
 * every other fixture in this repo: invented names, `@example.invalid`
 * addresses, and never a row that could be mistaken for a real member. The
 * suite must be safe to run against a developer database that also holds real
 * tournaments.
 *
 * Shaped to exercise the things that keep breaking rather than a happy path:
 * a drawn tee sheet, a part-finished card, a card in each approval state, and
 * a course with local rules.
 */

/**
 * PER WORKTREE, so one run's teardown cannot reach into another's rows.
 *
 * This was the bare string `"zz-e2e"`, shared by every run on the machine —
 * and `seed()` opens by deleting everything that starts with it. Two sessions
 * in parallel worktrees therefore wiped each other's fixture mid-run, and the
 * resulting cascade reads exactly like the dead-server signature CLAUDE.md
 * documents. See `scripts/run-mark.mjs` for the measurement and for why the
 * suffix is the worktree rather than a uuid.
 *
 * Still begins `zz-e2e`, so it is recognisable as a fixture at a glance and a
 * deliberate sweep can still find every run's rows.
 */
export const MARK = runMark("zz-e2e");

/**
 * LONG, AND AWKWARD IN THE WAYS REAL ONES ARE.
 *
 * These were `GC`, `Bushwood` and `Championship` — eight characters at the
 * longest, and that shortness was quietly doing work. `layout.spec` asserts
 * that screens do not scroll sideways, and such an assertion is only ever as
 * good as the longest string the fixture happens to contain: the suite was
 * certifying layouts it had never actually stressed.
 *
 * Demonstrated by accident on 2026-09-14. Keying the fixture mark per worktree
 * made every name seven characters longer, and `/roster` went red immediately
 * — a `width: auto` select sized to its longest option, one of which reads
 * "only those in <tournament name>". Seven characters. The bug had been there
 * the whole time and a real event called "Saturday Medal — Men's & Ladies'
 * Championship" would have found it on day one. The fixture change did not
 * break that test; it stopped it lying.
 *
 * WHICH CHARACTERS, AND WHY THESE ONES. Padding to length would prove almost
 * nothing — `aaaaaaaaaaaaaaaa` is wide and otherwise harmless. What breaks
 * things is a name that lands INSIDE another sentence and carries punctuation:
 *
 *   —  an EM DASH (U+2014) and
 *   ’  a CURLY apostrophe (U+2019)
 *      are the two this repo has already been bitten by, coming back as
 *      mojibake when a file was round-tripped through PowerShell. A straight
 *      ASCII apostrophe would test the width and none of the encoding, so
 *      these are deliberately the curly ones. Every club with a "Men's" or
 *      "Ladies'" competition carries one.
 *   &  an ampersand, which is the character an HTML escape gets wrong.
 *   é  an accent, for the same encoding reason one layer out.
 *
 * ONE TRAP, SINCE IT CAUGHT THE PERSON WHO WROTE THIS. "Château" contains
 * `â` — U+00E2, a perfectly correct French letter — and a naive mojibake check
 * that greps for a bare `â` reports eight hits on `/entry` and looks exactly
 * like an encoding failure. It is not. Real mojibake from this repo's
 * PowerShell round-trip is U+00E2 followed by U+20AC, or the U+00C3 family;
 * a lone U+00E2 between two ASCII letters is just a word. Check the codepoints
 * on either side before reporting anything.
 *
 * Written as codepoints rather than as the characters themselves ON PURPOSE.
 * Spelling the sequence out here would put a literal mojibake string into a
 * file that is perfectly healthy, and the next sweep looking for one would
 * report this comment as its first hit — the same trap `readSource` exists to
 * close, where the prose above a guard satisfies the search for the guard.
 *
 * So a run of this suite now exercises width and encoding at once, and a
 * regression in either shows up as a failing layout or a mojibake string
 * rather than as nothing at all.
 *
 * Invented, and marked, like every other fixture here — no real club, course
 * or person.
 */
const CLUB_NAME = "Blue Ash Men’s & Ladies’ Golf Society";
const COURSE_NAME = "Château Bushwood — Old Course";
const EVENT_NAME = "Saturday Medal — Men’s & Ladies’ Championship";

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const YARDS = [380, 510, 165, 420, 395, 405, 150, 410, 525, 400, 385, 175, 430, 540, 395, 160, 415, 405];

const sign = (v) => {
  const secret = process.env.AUTH_SECRET ?? "dev-secret";
  return `${v}.${createHmac("sha256", secret).update(v).digest("base64url")}`;
};

/**
 * A calendar day N days from today, as the yyyy-mm-dd the app stores.
 *
 * Relative rather than fixed, because the availability card's whole job is to
 * split the season around *today*: hard-coded dates would quietly stop
 * exercising the split the moment they all fell into the past.
 */
const dayOffset = (n) => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

export async function teardown() {
  const prisma = new PrismaClient();
  try {
    const events = await prisma.event.findMany({
      where: { name: { startsWith: MARK } },
      select: { id: true },
    });
    const ids = events.map((e) => e.id);
    if (ids.length) {
      for (const model of ["scorecard", "match", "player", "stage", "account", "eventCourse"]) {
        await prisma[model].deleteMany({ where: { eventId: { in: ids } } }).catch(() => {});
      }
    }
    await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.course.deleteMany({ where: { name: { startsWith: MARK } } });
    await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
}

export async function seed() {
  // Always from clean: a half-torn-down run from last time would otherwise
  // make the next one fail for reasons that have nothing to do with the code.
  await teardown();

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.create({
      data: { name: `${MARK}-${CLUB_NAME}`, kind: "club", themeAppearance: "auto" },
    });
    const course = await prisma.course.create({
      data: {
        organizationId: org.id,
        name: `${MARK}-${COURSE_NAME}`,
        city: "Cincinnati, OH",
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(YARDS),
        strokeIndex: JSON.stringify(SI),
        localRules: "Internal out of bounds: left of the 4th, defined by white stakes.",
      },
    });
    const event = await prisma.event.create({
      data: {
        name: `${MARK}-${EVENT_NAME}`,
        organizationId: org.id,
        /**
         * A STATUS THE APP ACTUALLY WRITES.
         *
         * This said "active", which is not one of them. The app writes exactly
         * "draft", "live" and "completed"; `STATUS_META` labels those five
         * (with "registration" and "ready"), and an unknown status falls back
         * to the DRAFT label. So the whole suite rendered a launched
         * tournament that called itself a draft, and three behaviours differed
         * from production on every screen it touched:
         *
         *   - the status tag read "Draft" on a tournament with cards in it;
         *   - `nextLifecycleAction` returned NULL rather than "Complete
         *     tournament", so the dashboard offered no way to finish, and no
         *     test has ever exercised that control from this fixture;
         *   - the live dot beside the name never appeared.
         *
         * `isLaunched` treats "active" as launched — it is simply not on the
         * pre-launch list — which is why setup locking and everything reading
         * that behaved correctly and hid the rest. Exactly the divergence
         * `lifecycle-state.ts` predicts in its own comment: the two lists
         * "agree today because the two sets happen to cover every status, and
         * they would diverge the moment a sixth is added".
         */
        status: "live",
        shape: "single",
        format: "stroke",
        dates: "May 2026",
        course: "Bushwood",
        city: "Cincinnati, OH",
        address: "",
        regDeadline: "",
        sideStyle: "individual",
        shareToken: `${MARK}-token`,
        // Published, so the /live page renders a board rather than a 404. The
        // first run of this suite missed it, and the spec that checks the
        // public leaderboard "passed" against a not-found page — a 404 has no
        // horizontal overflow either.
        leaderboardVisibility: "public",
        customPars: JSON.stringify(PARS),
        customYards: JSON.stringify(YARDS),
        customStrokeIndex: JSON.stringify(SI),
        tiebreakers: JSON.stringify(["toughest-6", "toughest-3", "lower-handicap"]),
        // A weekly league, so the availability card renders at all. With the
        // default "everyone" there is no question to ask and the whole feature
        // is invisible to the suite.
        attendanceMode: "opt-out",
      },
    });
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: course.id } });

    /**
     * One of these is deliberately long and awkward, for the same reason the
     * club and event names are — see the note above them.
     *
     * A player's name is rendered in the TIGHTEST column in the app: a
     * leaderboard row, a scorecard header, a tee-sheet group. "Priya Nair" is
     * ten characters and was never going to stress any of them. The
     * replacement carries an accent, a curly apostrophe and a hyphen, which is
     * an entirely ordinary shape for a name and exercises width and encoding
     * at the same time.
     *
     * Invented, like the rest of this fixture. The others stay short on
     * purpose: a field where EVERY name is long tests the wide case and quietly
     * stops testing the ordinary one.
     */
    const names = ["Aj Moore", "Marcus Webb", "Síle Ní Bhraonáin-O’Dwyer", "Sang-woo Kim"];
    const players = [];
    for (const [i, name] of names.entries()) {
      players.push(
        await prisma.player.create({
          data: {
            eventId: event.id,
            name,
            email: `${MARK}-${i}@example.invalid`,
            handicap: 4 + i * 4,
            seed: i + 1,
            status: "confirmed",
          },
        }),
      );
    }

    const teeSheet = JSON.stringify({
      savedAt: new Date().toISOString(),
      startType: "tee",
      groups: [{ name: "Group 1", startHole: 1, time: "08:10", playerIds: players.map((p) => p.id) }],
    });
    /**
     * The round the play screens open on: the most recent one PLAYED.
     *
     * A week ago, carrying the drawn sheet and the cards — which is what a
     * round that has been played looks like. loadEventState reads the current
     * round off the calendar for a dated stroke-play league, so this is the
     * round /me and the console open on while the weeks ahead sit in front of
     * it on the availability card.
     */
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        description: "Round 1",
        type: "Stroke Play Round",
        format: "Individual Stroke Play",
        holes: 18,
        scoringBasis: "net",
        handicapAllowance: 95,
        teeSheet,
        /**
         * PUBLISHED, because this round has been played.
         *
         * `me.ts` reads a tee sheet only when it is published — the 2026-08-12
         * audit found a draft draw reaching a player's phone the moment an
         * organizer saved it, which defeats the point of being able to shuffle
         * a draw and sleep on it. That guard is right, and this fixture was
         * never updated to satisfy it, so four player tests have been asserting
         * a tee time the app correctly refused to show.
         *
         * A round played a week ago with cards against it certainly had its
         * draw published.
         */
        teeSheetPublished: true,
        playedOn: dayOffset(-7),
        optDeadline: dayOffset(-8),
      },
    });

    // Three weeks still to come: one imminent — the "next round" the
    // availability card must lift out and emphasise — and two beyond it. Dates
    // are relative to the day the suite runs, so the split around today stays
    // real however long this fixture lives.
    for (const [i, offset] of [3, 10, 17].entries()) {
      await prisma.stage.create({
        data: {
          eventId: event.id,
          position: i + 1,
          description: `Round ${i + 2}`,
          type: "Stroke Play Round",
          format: "Individual Stroke Play",
          holes: 18,
          scoringBasis: "net",
          handicapAllowance: 95,
          playedOn: dayOffset(offset),
          optDeadline: dayOffset(offset - 1),
        },
      });
    }

    // One card per approval state, plus the part-finished one that the card
    // screen must open on rather than blanking.
    const full = PARS.map((p) => p);
    const partial = PARS.map((p, i) => (i < 9 ? p : null));
    const states = [
      { player: players[0], strokes: partial, status: "entered" },
      { player: players[1], strokes: full, status: "certified" },
      { player: players[2], strokes: full, status: "approved" },
      { player: players[3], strokes: full, status: "disputed" },
    ];
    for (const s of states) {
      await prisma.scorecard.create({
        data: {
          eventId: event.id,
          stageId: stage.id,
          playerId: s.player.id,
          strokes: JSON.stringify(s.strokes),
          status: s.status,
        },
      });
    }

    /**
     * AND THE MODE THAT TURNS IT ON.
     *
     * `usesExpenses` asks the money MODE, not whether any expense exists —
     * deliberately, because guessing from "has anyone entered a line yet" was
     * wrong in both directions, and the comment on it says so at length. A
     * club defaults to `none`, which correctly hides the settle-up.
     *
     * So a fixture that seeds expenses WITHOUT setting the mode seeds a ledger
     * nobody can open, and a test written against it reports the app as broken
     * when the app is right. That is what happened on the first run of
     * money-nav.spec.
     */
    await prisma.event.update({
      where: { id: event.id },
      data: { moneyMode: "split" },
    });

    /**
     * MONEY, which this fixture has never had.
     *
     * Every money screen in the app — prizes, group games, the settle-up, the
     * week view's block — was reachable in the suite and empty in it, so the
     * only thing any test could prove was that an empty state rendered. That
     * is why the 2026-08-25 audit listed a navigation sweep as outstanding:
     * there was nothing to sweep.
     *
     * Deliberately small and deliberately awkward. One bill split three ways
     * that does not divide evenly, one part-payment against it, and a prize.
     * The odd penny is the point: an even split proves nothing about the
     * arithmetic, and every screen below has to agree about where it went.
     */
    const bill = await prisma.expense.create({
      data: {
        eventId: event.id,
        description: `${MARK} buggies`,
        // 4001 across three: 1334 / 1334 / 1333. Nothing here divides.
        amountCents: 4001,
        paidBy: players[0].id,
        category: `cart`,
        shares: {
          create: [
            { playerId: players[0].id, weight: 1 },
            { playerId: players[1].id, weight: 1 },
            { playerId: players[2].id, weight: 1 },
          ],
        },
      },
    });

    // A part-payment, so the settle-up shows a REMAINING balance rather than
    // a clean zero. A screen that only ever renders nothing-owed is a screen
    // whose arithmetic has never been looked at.
    await prisma.settlement.create({
      data: {
        eventId: event.id,
        fromPlayerId: players[1].id,
        toPlayerId: players[0].id,
        cents: 1000,
        recordedBy: "O. Ganizer",
      },
    });

    await prisma.prize.create({
      data: {
        eventId: event.id,
        position: 1,
        category: `${MARK} Winner`,
        amount: 50,
      },
    });
    /**
     * Two announcements, one pinned.
     *
     * The fixture had NONE, so every sweep of /announcements — including the
     * on-course touch-minimum sweep, which grades that route — only ever
     * measured the empty state. The pin and delete controls on a posted
     * notice, which is the whole screen once anybody has used it, had never
     * been measured by anything at any viewport.
     *
     * Both rows, because pinned and unpinned draw different controls: the
     * pinned one carries a tag that the unpinned one does not, and a row that
     * fits without it is not evidence the other fits.
     */
    await prisma.announcement.create({
      data: {
        eventId: event.id,
        title: `${MARK} Round 2 tee times are up`,
        body: "First tee at 8:10. Groups 5 to 8 start on the back nine.",
        pinned: true,
      },
    });
    await prisma.announcement.create({
      data: {
        eventId: event.id,
        title: `${MARK} Halfway house is open`,
        body: "",
        pinned: false,
      },
    });

    // Two accounts: the organizer, and a player who is players[0] — matched by
    // email, which is how the app resolves "me".
    const organizer = await prisma.user.create({
      data: { email: `${MARK}-organizer@example.invalid`, name: "O. Ganizer", password: "x:unusable" },
    });
    await prisma.account.create({
      data: { eventId: event.id, name: "O. Ganizer", email: organizer.email, role: "admin" },
    });
    /**
     * SOMEBODY WAITING TO BE LET IN, so the panel that answers them is on a
     * screen the layout sweep already walks at every viewport.
     *
     * The alternative was a spec of its own, and this is better: `/organization`
     * is in `layout.spec`'s filesystem sweep, so one fixture row buys the
     * request panel a width check at 320, 393 and 1280 on every run, for ever,
     * without anybody remembering to write one.
     *
     * It is the exact class that has already bitten twice. The Guest role added
     * a fourth option to a segmented control and pushed `/organization` past a
     * 320px phone (#429); the league shipped across five pull requests with no
     * screen ever rendered by a test (#430). A control is exactly as wide as
     * the data it is given, and a fixture with no request in it measures a
     * panel that is not there.
     *
     * The note is deliberately long and awkward, for the same reason the club
     * and course names above are: a short one would prove nothing about the
     * row it sits in.
     */
    /**
     * A ROSTER, AND ONE MEMBER NOBODY HAS AN INDEX FOR.
     *
     * The club had no `Member` rows at all, so `/roster` rendered empty in
     * every end-to-end run: the layout sweep measured a blank screen at three
     * viewports and no browser has ever seen a member row.
     *
     * The third row is the one that matters. `handicapSource: "none"` is how
     * the app says nobody has claimed a figure — written deliberately by
     * `upsertMember` for a club playing off association indexes — and until
     * 2026-09-18 every screen printed the stored 0 beside it, which reads as a
     * scratch golfer. `handicap-policy.ts` calls that outcome catastrophic.
     * Now a browser sees the difference on every run.
     */
    await prisma.member.createMany({
      data: [
        {
          organizationId: org.id,
          name: "Aj Moore",
          email: `${MARK}-0@example.invalid`,
          handicap: 12.4,
          handicapType: "18",
          handicapSource: "manual",
        },
        {
          // A genuine scratch player, so "no index" cannot be implemented by
          // hiding every zero — the direction a careless fix breaks.
          organizationId: org.id,
          name: "Pat Scratch",
          email: `${MARK}-scratch@example.invalid`,
          handicap: 0,
          handicapType: "18",
          handicapSource: "manual",
        },
        {
          organizationId: org.id,
          name: "Síobhán O’Donnell-Fitzgerald",
          email: `${MARK}-noindex@example.invalid`,
          ghin: "1234567",
          handicap: 0,
          handicapType: "18",
          handicapSource: "none",
        },
      ],
    });

    const asker = await prisma.user.create({
      data: {
        email: `${MARK}-asks-to-join@example.invalid`,
        name: "Síobhán O’Donnell-Fitzgerald",
        password: "x:unusable",
      },
    });
    await prisma.joinRequest.create({
      data: {
        organizationId: org.id,
        userId: asker.id,
        note: "I run the Thursday night draw with Dana — we should be one society, not two.",
      },
    });

    const player = await prisma.user.create({
      data: { email: `${MARK}-0@example.invalid`, name: "Aj Moore", password: "x:unusable" },
    });
    await prisma.account.create({
      data: { eventId: event.id, name: "Aj Moore", email: player.email, role: "player" },
    });

    /**
     * A SECOND EVENT IN THE SAME CLUB: the interclub league.
     *
     * Separate rather than bolted onto the medal above, because a league is a
     * different tournament — clubs as flights, four-ball rounds, pairs
     * nominated weekly — and giving the medal club groups would change what
     * every other spec sees on `/roster`, `/grouping` and the leaderboard.
     * A club running both is also the ordinary case.
     */
    const league = await seedLeague(prisma, { org, mark: MARK, sign, dayOffset, randomBytes });

    return {
      eventId: event.id,
      shareToken: event.shareToken,
      organizer: { session: sign(organizer.id), event: sign(event.id) },
      player: { session: sign(player.id), event: sign(event.id) },
      league,
      partialHolesFilled: partial.filter((s) => s != null).length,
      /**
       * Enough to PUT THE PART-FINISHED CARD BACK.
       *
       * The offline spec enters a hole and, once the signal returns, that
       * write reaches the database — so it mutates the very fixture that
       * player.spec asserts the shape of. Exported here so that spec can
       * restore it rather than every other test being written around the
       * damage.
       */
      /**
       * The money the sweep reads. Exported rather than repeated in the spec:
       * a fixture and a test that each hold their own copy of an amount will
       * disagree the first time one of them changes.
       */
      money: {
        billId: bill.id,
        billCents: 4001,
        settledCents: 1000,
        prizeLabel: `${MARK} Winner`,
      },
      partialCard: {
        stageId: stage.id,
        playerId: players[0].id,
        strokes: partial,
      },
    };
  } finally {
    await prisma.$disconnect();
  }
}
