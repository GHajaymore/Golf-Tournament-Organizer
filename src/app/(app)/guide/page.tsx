import { screenMetadata } from "@/lib/screen-metadata";
import { requireScreen } from "@/lib/page-helpers";
import { PageHeader } from "@/components/PageHeader";
import { Icon } from "@/components/Icon";

/**
 * HOW TOURNEYHQ WORKS, in the console (Ajay, 2026-10-01: "include it as part
 * of the organizer view in the app … a new submenu like documentations").
 *
 * The high-level map of the product: who uses it, a tournament's life, a round
 * on the day, handicaps, money, casual rounds, plans and the platform. The
 * same content ships as a PDF in /public/guide, and the diagrams are images
 * exported from it, so the page, the download and the diagrams say one thing.
 *
 * Static on purpose: it reads nothing from the database, so it renders the
 * same for every club at every stage of a tournament. The detailed step-by-step
 * user guide joins the Help section when it is written.
 */

export const metadata = screenMetadata("/guide");

const PDF = "/guide/how-tourneyhq-works.pdf";

function Diagram({ src, width, height, alt }: { src: string; width: number; height: number; alt: string }) {
  return (
    <figure style={{ margin: 0, overflowX: "auto" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static diagrams exported at 2x from the guide's PDF */}
      <img
        src={src}
        width={width / 2}
        height={height / 2}
        alt={alt}
        loading="lazy"
        style={{ display: "block", width: "100%", minWidth: 560, height: "auto", borderRadius: 12 }}
      />
    </figure>
  );
}

function Section({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 34 }}>
      <div>
        <div className="page-kicker">{kicker}</div>
        <h2 id={`${id}-h`} style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: "4px 0 0", textWrap: "balance" }}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Cards({ items }: { items: { title: string; where?: string; lines: string[] }[] }) {
  return (
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))" }}>
      {items.map((c) => (
        <div key={c.title} className="card elev-sm" style={{ padding: "14px 15px", gap: 6, minWidth: 0 }}>
          {c.where && <div className="card-kicker">{c.where}</div>}
          <div style={{ fontWeight: 600, fontSize: 15 }}>{c.title}</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.55, color: "var(--color-text-muted)" }}>
            {c.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: 0, maxWidth: 720, fontSize: 14.5, lineHeight: 1.65 }}>{children}</p>
);

const FORMATS = [
  "Stroke Play", "Stableford", "Modified Stableford", "Match Play", "Four-Ball", "Best Ball", "Foursomes",
  "Alternate Shot", "Greensomes", "Chapman / Pinehurst", "Shamble", "Scramble", "Texas Scramble", "Skins",
  "Nassau", "Other, by hand",
];

export default async function GuidePage() {
  await requireScreen("guide");

  return (
    <div style={{ maxWidth: 980 }}>
      <PageHeader
        kicker="Help"
        title="How TourneyHQ works"
        subtitle="A high-level map of the product: who uses it, how a tournament runs from setup to prize-giving, and what happens on the course in between. A step-by-step user guide follows later."
        actions={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn btn-secondary" href="/guide/steps">
              <Icon name="ph ph-list-numbers" /> Step-by-step guide
            </a>
            <a className="btn btn-primary" href={PDF} download>
              <Icon name="ph ph-file-pdf" /> Download PDF
            </a>
          </div>
        }
      />

      <Section id="people" kicker="Who uses it" title="Four kinds of people, three ways in">
        <P>
          Organizers run things from this console. Players use the player app on their phone. Anyone with a club&rsquo;s
          link can watch the public board without signing in.
        </P>
        <Cards
          items={[
            { where: "Console", title: "Organizer", lines: ["The club secretary, society or league organizer", "Sets up tournaments, the field, rounds and money", "Publishes the draw, approves cards, closes the event"] },
            { where: "Console", title: "Staff", lines: ["Assistants added by the organizer", "Help run the day: the field, the draw, entering cards", "Each one takes a staff seat on the club's plan"] },
            { where: "Player app", title: "Player", lines: ["Signs up for events, sees their tee time and group", "Scores their card on the phone, even with no signal", "Follows the board, their money and the club calendar"] },
            { where: "Public board", title: "Spectator", lines: ["Opens a shared link: a clubhouse screen, a group chat", "No login. Names and scores only.", "Nothing appears until the organizer publishes"] },
          ]}
        />
      </Section>

      <Section id="lifecycle" kicker="A tournament's life" title="From a name to the honours board">
        <P>
          A tournament needs only a name to exist. Everything else is added as it becomes known, and stays editable through
          the event. Multi-round events go back to the draw for each round; a stroke-play cut is applied automatically when
          the round it depends on is marked finished, keeping the top N and ties.
        </P>
        <Diagram
          src="/guide/lifecycle.png"
          width={1920}
          height={562}
          alt="Before the day: Create, then Rounds, Field, Flights and Draw. On the day and after: Play, Results, Money, Prizes and Complete."
        />
      </Section>

      <Section id="round" kicker="A round on the day" title="Between the first tee and the last putt">
        <P>The same card feeds every screen, so the console leaderboard, the player&rsquo;s board and the public board all read from one source.</P>
        <Diagram
          src="/guide/round.png"
          width={1920}
          height={846}
          alt="The organizer publishes the tee sheet; each player gets their tee time on Today and by push notification; hole scores save as they are entered and queue on the phone without signal; standings update for everyone; players certify cards; the organizer approves cards, settles ties and finishes the round, and results become final."
        />
        <Cards
          items={[
            { title: "Three ways to score", lines: ["Each player scores their own card, hole by hole", "Or the whole card at once, to check against the paper one", "Staff enter paper cards in Score entry"] },
            { title: "No account needed", lines: ["With round codes on, a player types an eight-character code to reach their card", "The code leaves out letters that look alike"] },
            { title: "Built for the course", lines: ["Voice entry: say “par” or “bogey”", "Text at sunlight contrast on every screen", "Installs from the browser, with no app store"] },
          ]}
        />
      </Section>

      <Section id="handicaps" kicker="Scoring and handicaps" title="From a handicap index to a stroke on the 7th">
        <P>Handicaps follow the World Handicap System, and every figure is worked out from the course the round is actually played on.</P>
        <Diagram
          src="/guide/handicaps.png"
          width={1920}
          height={364}
          alt="Handicap index, then course handicap from the course's slope and rating, then playing handicap with the round's allowance, then strokes received on holes by stroke index, giving net scores, Stableford points, match holes and skins."
        />
        <P>Sixteen formats settle onto one leaderboard. Fifteen are scored automatically; &ldquo;Other&rdquo; is a club&rsquo;s own format, scored by hand.</P>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {FORMATS.map((f) => (
            <span key={f} className="tag tag-outline">{f}</span>
          ))}
        </div>
      </Section>

      <Section id="money" kicker="Money" title="Worked out and written down, never moved">
        <div className="card elev-sm" style={{ padding: "14px 16px", gap: 4, borderLeft: "4px solid var(--color-accent-300)" }}>
          <div style={{ fontWeight: 600 }}>TourneyHQ calculates and records money. It never moves money.</div>
          <div className="text-muted" style={{ fontSize: 13.5 }}>
            Skins, side bets, prize splits and shared costs are arithmetic and a record of who owes whom. Paying happens between people, outside the app.
          </div>
        </div>
        <Diagram
          src="/guide/money.png"
          width={1920}
          height={578}
          alt="Entries and stakes lead to a question: can the amount still change? While the round is live, players see only their exposure. Once the result is final, the ledger records skins, bets and prizes, together with shared costs, and the settle-up shows who pays whom."
        />
        <P>A pot is paid only when its amount can no longer change, which is why skins wait for the round to finish. A Nassau segment that is already decided is paid as it happens.</P>
      </Section>

      <Section id="casual" kicker="Casual rounds" title="A quick game at the course, or a planned event">
        <P>A casual round is set up in a minute on the first tee, for a few friends and a friendly bet. Anything planned ahead is a tournament, which is free to start on Par.</P>
        <div className="card elev-sm" style={{ padding: 0, overflowX: "auto" }}>
          <table className="table" style={{ minWidth: 520 }}>
            <thead>
              <tr><th></th><th>Casual round</th><th>Tournament</th></tr>
            </thead>
            <tbody>
              <tr><td>For</td><td>2 to 8 players, decided on the day</td><td>A club, society or league event</td></tr>
              <tr><td>Rounds</td><td>One</td><td>One or many, with cuts, flights and brackets</td></tr>
              <tr><td>Who runs it</td><td>The player who set it up, for that round only</td><td>The organizer and staff, in the console</td></tr>
              <tr><td>Money</td><td>A game between the players</td><td>Skins, side bets, prizes and shared costs</td></tr>
              <tr><td>Afterwards</td><td>Expires after its window</td><td>Kept, except on Par, where it is removed on close</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="plans" kicker="Plans" title="The golf is never behind a paywall">
        <P>Every format, the scoring, the boards and the money work on every plan. Plans differ in size, administration and how much is kept.</P>
        <Cards
          items={[
            { title: "Par", where: "Free", lines: ["Up to 10 players, one tournament at a time, one organizer", "A tournament is removed when it is closed, after a prompt to download it"] },
            { title: "Birdie", where: "Leagues and societies", lines: ["Bigger fields", "Seasons across tournaments, honours boards"] },
            { title: "Eagle", where: "Clubs", lines: ["No field cap", "More staff seats"] },
            { title: "Albatross", where: "Associations", lines: ["By conversation"] },
          ]}
        />
      </Section>

      <Section id="platform" kicker="Under the hood" title="One app, every screen">
        <P>A single web application serves this console, the player app and the public board, and is packaged for phones and desktop.</P>
        <Diagram
          src="/guide/platform.png"
          width={1920}
          height={1202}
          alt="Browser, installable phone app, iOS and Android, and desktop all use one Next.js app on Vercel, whose server actions check permission on every call and read and write a PostgreSQL database, and send push notifications for tee times."
        />
      </Section>
    </div>
  );
}
