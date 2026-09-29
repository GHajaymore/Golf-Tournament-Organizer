import type { ReactNode } from "react";
import { LOGO_SIZE } from "@/components/Logo";
import { Lockup } from "@/components/Lockup";
import type { Edition } from "@/lib/landing/edition";
import { EditionSwitch } from "./EditionSwitch";

/**
 * The front door's frame — its icons, its nav and its footer — shared by `/`
 * and `/faq`.
 *
 * FUNCTIONS, NOT COMPONENTS, on purpose: each page calls these while building
 * its tree, so the words inside them are part of that tree and the edition's
 * word swaps reach them (`inDialect` reads the tree as written and does not
 * run components). A `<LandingFooter />` would have kept "golf groups" in a
 * British visitor's footer.
 */

/** The contact address, in the one place it is written. */
export const CONTACT_EMAIL = "hello@tourneyhq.club";

/**
 * Whether mail to CONTACT_EMAIL actually arrives — and so whether the page may
 * publish it.
 *
 * NOT YET (2026-09-27): tourneyhq.club has no MX record, so every
 * @tourneyhq.club address bounces (TourneyHQv2 checked the zone and 8.8.8.8).
 * Ajay chose to set the domain up in Microsoft 365 rather than use another
 * address. Until that is done the page shows no address at all — a dead one
 * is worse than none — and "Talk to us" leads to sign-up. Flip this to true
 * once a test email to CONTACT_EMAIL has been received, and every link returns.
 */
export const CONTACT_EMAIL_LIVE = false;

/** The address to show, or null while it cannot receive mail. */
export const contactEmail: string | null = CONTACT_EMAIL_LIVE ? CONTACT_EMAIL : null;

/** The page's one icon set, drawn once and referenced with <use>. */
export function iconSprite() {
  const p = (d: string) => <path d={d} />;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="i-check" viewBox="0 0 24 24">{p("M20 6 9 17l-5-5")}</symbol>
        <symbol id="i-arrow" viewBox="0 0 24 24">{p("M5 12h14M12 5l7 7-7 7")}</symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" />{p("M7 11V7a5 5 0 0 1 10 0v4")}</symbol>
        <symbol id="i-board" viewBox="0 0 24 24">{p("M9 21V8h6v13M3 21v-8h6M15 21v-5h6v5M2 21h20")}{p("M12 3.2l.7 1.4 1.5.2-1.1 1.1.3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1.1 1.5-.2z")}</symbol>
        <symbol id="i-key" viewBox="0 0 24 24"><circle cx="7.5" cy="15.5" r="5.5" />{p("m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3")}</symbol>
        <symbol id="i-users" viewBox="0 0 24 24">{p("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2")}<circle cx="9" cy="7" r="4" />{p("M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75")}</symbol>
        <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" />{p("M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41")}</symbol>
        <symbol id="i-moon" viewBox="0 0 24 24">{p("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")}</symbol>
        <symbol id="i-shield" viewBox="0 0 24 24">{p("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z")}{p("m9 12 2 2 4-4")}</symbol>
        <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" />{p("M12 16v-4M12 8h.01")}</symbol>
        <symbol id="i-trophy" viewBox="0 0 24 24">{p("M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z")}</symbol>
        <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" />{p("M16 2v4M8 2v4M3 10h18")}</symbol>
        <symbol id="i-flag" viewBox="0 0 24 24">{p("M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7")}</symbol>
        <symbol id="i-heart" viewBox="0 0 24 24">{p("M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z")}</symbol>
        <symbol id="i-phone" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" />{p("M12 18h.01")}</symbol>
        <symbol id="i-home" viewBox="0 0 24 24">{p("m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z")}{p("M9 22V12h6v10")}</symbol>
        <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" />{p("M3 9h18M9 21V9")}</symbol>
        <symbol id="i-wallet" viewBox="0 0 24 24">{p("M21 12V7H5a2 2 0 0 1 0-4h14v4")}{p("M3 5v14a2 2 0 0 0 2 2h16v-5")}{p("M18 12a2 2 0 0 0 0 4h4v-4Z")}</symbol>
        <symbol id="i-star" viewBox="0 0 24 24">{p("m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z")}</symbol>
        <symbol id="i-building" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" />{p("M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01")}</symbol>
        <symbol id="i-apple-phone" viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="3" />{p("M10 4.5h4M11 19h2")}</symbol>
        <symbol id="i-android-phone" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" />{p("M5 18h14M12 20h.01M9 8l3 3 3-3M12 11V5")}</symbol>
        <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3" />{p("M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8")}</symbol>
        <symbol id="i-menu" viewBox="0 0 24 24">{p("M4 7h16M4 12h16M4 17h16")}</symbol>
        <symbol id="i-scale" viewBox="0 0 24 24">{p("M12 3v18M5 7h14M3 13l2-6 2 6a2.5 2.5 0 0 1-4 0zM17 13l2-6 2 6a2.5 2.5 0 0 1-4 0zM8 21h8")}</symbol>
        <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" />{p("M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z")}</symbol>
      </defs>
    </svg>
  );
}

/** An icon from the sprite. */
export function icon(id: string, className = "i") {
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      <use href={`#i-${id}`} />
    </svg>
  );
}

/**
 * The nav. On `/` the section links are in-page anchors; on `/faq` they lead
 * back to them. Sign-in and sign-up live on `/`, where the form is.
 */
export function landingNav(at: "home" | "faq") {
  const home = at === "home" ? "" : "/";
  // The product menu: every part of the page, with what it shows.
  const product: Array<[string, string, string, string]> = [
    [`${home}#round`, "01", "One Saturday, both sides", "The draw, the cards, the board, the money"],
    [`${home}#why`, "02", "Why it's different", "Voice scoring, round codes, the settle-up"],
    [`${home}#features`, "03", "Every feature", "The real app by screen, and the whole list"],
    [`${home}#formats`, "16", "Formats", "Stroke play to Chapman, one leaderboard"],
    [`${home}#money`, "04", "The money", "Outing costs split, prize money awarded"],
    [`${home}#yours`, "05", "Make it yours", "Your colors on every screen"],
  ];
  // One list for the desktop row and the phone menu, so they cannot disagree.
  const links: Array<[string, string]> = [
    [`${home}#compare`, "Compare"],
    [`${home}#pricing`, "Pricing"],
    ["/faq", "FAQ"],
  ];
  return (
    <header className="hdr band">
      <div className="wrap hdr-in">
        <a className="lockup" href={at === "home" ? "#top" : "/"} aria-label="TourneyHQ — home">
          <Lockup size={LOGO_SIZE.lg} />
        </a>
        <nav className="hnav" aria-label="Sections">
          {/* A native disclosure: opens by click or keyboard, needs no script. */}
          <details className="dd">
            <summary>Product<span className="chev" aria-hidden="true" /></summary>
            <div className="dd-panel">
              {product.map(([href, n, title, sub]) => (
                <a key={href} href={href}>
                  <span className="n">{n}</span>
                  <span><b>{title}</b><span>{sub}</span></span>
                </a>
              ))}
            </div>
          </details>
          {links.map(([href, label]) => (
            <a key={href} href={href} aria-current={at === "faq" && href === "/faq" ? "page" : undefined}>{label}</a>
          ))}
        </nav>
        <div className="hact">
          {/* Players have their own door: a round code needs no account. */}
          <a className="play" href="/play">Playing today? <u>Enter code</u></a>
          <a className="si" href={`${home}#signin`}>Sign in</a>
          <a className="btn sm" href={`${home}#signup`}>Start free</a>
          <details className="nav-menu">
            <summary aria-label="Menu">{icon("menu")}</summary>
            <nav className="menu-panel" aria-label="Sections">
              <a className="menu-cta" href={`${home}#signup`}>Start free</a>
              {product.map(([href, , title]) => <a key={href} href={href}>{title}</a>)}
              {links.map(([href, label]) => (
                <a key={href} href={href} aria-current={at === "faq" && href === "/faq" ? "page" : undefined}>{label}</a>
              ))}
              <hr />
              <a href="/play">Playing today? Enter your code</a>
              <a href={`${home}#signin`}>Sign in</a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

/**
 * Which prices and words this is, and the switch. A US visitor is told the
 * prices are in dollars and offered nothing, because there is nothing to
 * switch to; anyone else can flip to US $ and US terms and back.
 */
export function editionNote(local: Edition, overridden: boolean): ReactNode {
  if (local.key === "US") return <>Prices in US dollars.</>;
  if (overridden) {
    return (
      <>
        Showing US dollars and US golf terms.{" "}
        <EditionSwitch toUs={false}>Show {local.currency} for {local.name}</EditionSwitch>
      </>
    );
  }
  return (
    <>
      Prices in {local.currency} for {local.name}.{" "}
      <EditionSwitch toUs>Show US $ and US terms</EditionSwitch>
    </>
  );
}

export function landingFooter(at: "home" | "faq", editionNoteNode: ReactNode) {
  const home = at === "home" ? "" : "/";
  const col = (title: string, items: Array<[string, string]>) => (
    <div>
      <h4>{title}</h4>
      <ul>{items.map(([href, label]) => <li key={label}><a href={href}>{label}</a></li>)}</ul>
    </div>
  );
  return (
    <footer className="ftr band">
      <div className="wrap">
        <div className="ftr-top">
          <div>
            <a className="lockup" href={at === "home" ? "#top" : "/"} aria-label="TourneyHQ — home">
              <Lockup size={LOGO_SIZE.lg} />
            </a>
            <p>Golf tournament and league management for clubs, leagues and golf groups — from registration to recognition.</p>
          </div>
          {col("Product", [
            [`${home}#round`, "One Saturday, both sides"],
            [`${home}#features`, "Every feature"],
            [`${home}#formats`, "Formats"],
            [`${home}#money`, "The money"],
            [`${home}#pricing`, "Pricing"],
          ])}
          {col("Compare", [
            [`${home}#why`, "Why it's different"],
            [`${home}#compare`, "The usual way"],
            [`${home}#compare`, "Club platforms"],
            [`${home}#compare`, "League & group apps"],
          ])}
          {col("Help", [
            ["/faq", "FAQ"],
            ["/faq#q-stores", "Install on your phone"],
            ["/play", "Enter a round code"],
            ...(contactEmail ? [[`mailto:${contactEmail}`, "Contact"] as [string, string]] : []),
            ["/privacy", "Privacy"],
          ])}
        </div>
        <div className="ftr-word" aria-hidden="true">TourneyHQ</div>
        <div className="ftr-base">
          <span>&copy; {new Date().getFullYear()} TourneyHQ &middot; Made by AjAi Labs</span>
          <span>Every screen on this site is an unedited capture of the app, on invented demo data.</span>
          <span className="ed-note">{editionNoteNode}</span>
        </div>
      </div>
    </footer>
  );
}
