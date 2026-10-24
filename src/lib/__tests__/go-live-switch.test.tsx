import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource, readVerbatim } from "./source";

// The switch's row: answered by each test, or thrown — a database fault.
let row: () => Promise<unknown> = async () => null;
vi.mock("@/lib/db", () => ({ prisma: { platformSetting: { findUnique: () => row() } } }));
// The two components that press something: rendered, never pressed, here.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/app/actions/owner", () => ({ setAccountsOpen: async () => ({ ok: true }) }));
vi.mock("@/app/actions/interest", () => ({ registerInterest: async () => ({ ok: true }) }));

import {
  FRONT_DOOR,
  HELD_FRONT_DOOR,
  INTEREST_PAGE,
  LAUNCH_SURFACES,
  NOT_SWITCHED,
  OWNER_CARD,
  SIGNINS_CLOSED_MESSAGE,
  SIGNINS_CLOSED_NOTICE,
  faqWords,
  launchStateOf,
  type LaunchState,
} from "@/lib/go-live";
import { holdRule, signInsClosed } from "@/lib/sign-in-gate";
import { launchState, signInsHeld } from "@/lib/services/signins-switch";
import { landingNav } from "@/components/landing/chrome";
import { LandingAuth } from "@/components/LandingAuth";
import { InterestForm } from "@/components/InterestForm";
import { OwnerAccounts } from "@/components/OwnerAccounts";
import { faqItem } from "@/lib/landing/faq";
import { landingPrices } from "@/lib/landing/pricing";
import { editionFor } from "@/lib/landing/edition";
import { parsePricingOverrides } from "@/lib/plans";

/**
 * THE ONE GO-LIVE SWITCH (Ajay, 2026-10-23: "I just need one switch to say let's go live and that
 * should change coming soon or any blockades to online").
 *
 *   the rule          which deployments hold, and why not when they do not — every case
 *   the answer        "held" or "live", and a database fault is HELD
 *   the inventory     `docs/go-live-switch.md` carries the module's tables, id for id
 *   every surface     rendered both ways through ONE checker, which must report a deaf control
 *   the owner card    lists every place, from the inventory, both ways
 *   the words         no held phrase and no word of the module's own anywhere but `go-live.ts`
 *
 * The pages themselves (async, behind headers and a database) are walked both ways in a browser by
 * `e2e/go-live-switch.spec.ts`, on a server that holds.
 */

/** What a person reads in rendered markup: tags out, entities decoded, spaces tidied. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

/**
 * THE CHECKER: what is wrong with one surface, rendered held and live — the held phrase only held,
 * the live phrase only live. Empty when it follows the switch both ways.
 */
function follows(render: (s: LaunchState) => string, held: string, live: string): string[] {
  const [h, l] = [text(render("held")), text(render("live"))];
  const wrong: string[] = [];
  if (!h.includes(held)) wrong.push(`held: does not say “${held}”`);
  if (h.includes(live)) wrong.push(`held: still says the live “${live}”`);
  if (!l.includes(live)) wrong.push(`live: does not say “${live}”`);
  if (l.includes(held)) wrong.push(`live: still says the held “${held}”`);
  return wrong;
}

const envKeys = ["VERCEL_ENV", "OWNER_EMAILS", "SIGNINS", "SIGNIN_ALLOW_EMAILS"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of envKeys) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of envKeys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  row = async () => null;
});

describe("which deployments hold, and the card is told why not", () => {
  const OWNER = "boss@example.invalid";
  it("production with an owner holds; the switch decides", () => {
    expect(holdRule({ VERCEL_ENV: "production", OWNER_EMAILS: OWNER })).toBe("holds");
  });
  it("an allow-list holds anywhere — the way to try the held state off production", () => {
    expect(holdRule({ VERCEL_ENV: "preview", SIGNIN_ALLOW_EMAILS: OWNER })).toBe("holds");
    expect(holdRule({ SIGNIN_ALLOW_EMAILS: OWNER })).toBe("holds");
  });
  it("SIGNINS=open is live whatever the switch says, and is named as the reason", () => {
    expect(holdRule({ VERCEL_ENV: "production", OWNER_EMAILS: OWNER, SIGNINS: " Open " })).toBe("signins-open");
    expect(holdRule({ SIGNIN_ALLOW_EMAILS: OWNER, SIGNINS: "open" })).toBe("signins-open");
  });
  it("production with nobody to let through never holds — it would lock everybody out", () => {
    expect(holdRule({ VERCEL_ENV: "production", OWNER_EMAILS: " , " })).toBe("no-owners");
  });
  it("dev, CI and previews never hold", () => {
    for (const VERCEL_ENV of [undefined, "", "preview", "development"]) expect(holdRule({ VERCEL_ENV, OWNER_EMAILS: OWNER })).toBe("not-production");
  });
  it("signInsClosed is exactly 'holds'", () => {
    for (const env of [{ VERCEL_ENV: "production", OWNER_EMAILS: OWNER }, { SIGNINS: "open" }, { VERCEL_ENV: "production" }, {}]) {
      expect(signInsClosed(env)).toBe(holdRule(env) === "holds");
    }
  });
  it("every reason has the card's sentence (empty only where the switch decides)", () => {
    expect(OWNER_CARD.rule.holds).toBe("");
    for (const r of ["signins-open", "no-owners", "not-production"] as const) expect(OWNER_CARD.rule[r].length).toBeGreaterThan(20);
  });
});

describe("the one answer", () => {
  beforeEach(() => {
    process.env.VERCEL_ENV = "production";
    process.env.OWNER_EMAILS = "boss@example.invalid";
    delete process.env.SIGNINS;
    delete process.env.SIGNIN_ALLOW_EMAILS;
  });

  it("held with no row, live once the row says open, held again when it says held", async () => {
    row = async () => null;
    expect(await launchState()).toBe("held");
    row = async () => ({ value: "open", updatedAt: new Date() });
    expect(await launchState()).toBe("live");
    row = async () => ({ value: "held", updatedAt: new Date() });
    expect(await launchState()).toBe("held");
  });

  it("A DATABASE FAULT KEEPS THE HOLD — it must not open the front door", async () => {
    row = async () => {
      throw new Error("zz: the database is not there");
    };
    expect(await signInsHeld()).toBe(true);
    expect(await launchState()).toBe("held");
  });

  it("launchStateOf is the switch's yes/no, no more", () => {
    expect(launchStateOf(true)).toBe("held");
    expect(launchStateOf(false)).toBe("live");
  });
});

describe("the inventory is the doc's, id for id", () => {
  const doc = readVerbatim("docs/go-live-switch.md");
  const [held, not] = doc.split("## What does NOT move with the switch");
  const ids = (s: string) => [...s.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);

  it("every place held, in order", () => {
    expect(ids(held)).toEqual(LAUNCH_SURFACES.map((s) => s.id));
  });
  it("everything that deliberately does not move, in order", () => {
    expect(ids(not)).toEqual(NOT_SWITCHED.map((s) => s.id));
  });
  it("the counts it states are the module's", () => {
    const m = /\*\*(\d+) places differ while held\. (\d+) already asked the switch\*\*/.exec(doc);
    const w = /\*\*(\d+) were wired that day\*\*/.exec(doc);
    expect(m && w, "the doc no longer states the counts").toBeTruthy();
    expect(Number(m![1])).toBe(LAUNCH_SURFACES.length);
    expect(Number(m![2])).toBe(LAUNCH_SURFACES.filter((s) => s.before === "followed").length);
    expect(Number(w![1])).toBe(LAUNCH_SURFACES.filter((s) => s.before === "wired").length);
  });
  it("ids are unique, and every place says what it shows both ways", () => {
    expect(new Set(LAUNCH_SURFACES.map((s) => s.id)).size).toBe(LAUNCH_SURFACES.length);
    for (const s of LAUNCH_SURFACES) {
      expect(s.held.length, s.id).toBeGreaterThan(5);
      expect(s.live.length, s.id).toBeGreaterThan(5);
      expect(s.held, s.id).not.toBe(s.live);
      if (s.probe) expect(s.probe.held, s.id).not.toBe(s.probe.live);
    }
  });
});

describe("every surface that renders here follows the switch, both ways", () => {
  const prices = landingPrices(editionFor("US"), parsePricingOverrides(undefined));
  const faq = (id: string) => (s: LaunchState) => renderToStaticMarkup(<>{faqItem(id).a({ prices, email: "zz@example.invalid", launch: s })}</>);
  const cases: Array<[string, (s: LaunchState) => string, string, string]> = [
    ["front-door-box", (s) => renderToStaticMarkup(<LandingAuth launch={s} defaultMode="signup" />), SIGNINS_CLOSED_NOTICE.lead, "Create your account"],
    ...(["home", "faq", "privacy", "terms", "interest"] as const).map(
      (at) => [`nav on ${at}`, (s: LaunchState) => renderToStaticMarkup(<>{landingNav(at, s)}</>), FRONT_DOOR.held.navCta, FRONT_DOOR.live.navCta] as [string, (s: LaunchState) => string, string, string],
    ),
    ["faq: can I try it for free", faq("try-free"), faqWords("held").tryFree, faqWords("live").tryFree],
    ["faq: do I need a card", faq("card"), faqWords("held").card, faqWords("live").card],
    ["interest-form", (s) => renderToStaticMarkup(<InterestForm launch={s} />), INTEREST_PAGE.held.reassure, INTEREST_PAGE.live.reassure],
    ["owner-card", (s) => renderToStaticMarkup(<OwnerAccounts switchSays={s} liveSince="" rule="holds" />), OWNER_CARD.willGoLive, OWNER_CARD.willHold],
  ];

  for (const [name, render, held, live] of cases) {
    it(name, () => {
      const wrong = follows(render, held, live);
      expect(wrong, wrong.join("\n")).toEqual([]);
    });
  }

  it("the nav's button leads where the words say: the early list held, the form live", () => {
    expect(renderToStaticMarkup(<>{landingNav("faq", "held")}</>)).toContain('href="/interest"');
    expect(renderToStaticMarkup(<>{landingNav("faq", "live")}</>)).toContain('href="/#signup"');
    expect(renderToStaticMarkup(<>{landingNav("home", "live")}</>)).toContain('href="#signup"');
  });

  it("CONTROL: a surface that ignores the switch is reported", () => {
    const deaf = () => renderToStaticMarkup(<LandingAuth launch="live" />);
    expect(follows(deaf, SIGNINS_CLOSED_NOTICE.lead, "Create your account").length).toBeGreaterThan(0);
  });
});

describe("the owner card says what one press will do, from the inventory", () => {
  const card = (s: LaunchState, rule: Parameters<typeof OwnerAccounts>[0]["rule"] = "holds", since = "") =>
    text(renderToStaticMarkup(<OwnerAccounts switchSays={s} liveSince={since} rule={rule} />));

  it("held: Go live, and every place's live line", () => {
    const held = card("held");
    expect(held).toContain(OWNER_CARD.held);
    expect(held).toContain(OWNER_CARD.goLive);
    for (const s of LAUNCH_SURFACES) expect(held, s.id).toContain(s.live);
  });

  it("live: since when, Hold again, and every place's held line", () => {
    const live = card("live", "holds", "Thursday, October 23, 2:05 PM");
    expect(live).toContain("Live since Thursday, October 23, 2:05 PM.");
    expect(live).toContain(OWNER_CARD.holdAgain);
    for (const s of LAUNCH_SURFACES) expect(live, s.id).toContain(s.held);
  });

  it("says so when the environment overrides it, and lists what never moves", () => {
    expect(card("held", "signins-open")).toContain("SIGNINS=open is set in Vercel");
    expect(card("held", "not-production")).toContain("never holds accounts");
    expect(card("held", "holds")).not.toContain("SIGNINS=open is set");
    for (const n of NOT_SWITCHED) expect(card("held"), n.id).toContain(n.what);
  });
});

describe("held and live words are written in one place", () => {
  /**
   * The phrases that mean "held for launch", and the live calls to action. Matched without case.
   * Each place they may legitimately appear outside the module is listed, with why — and each
   * listed place must still have them, so the list cannot rot into blanket permission.
   */
  const PHRASES = ["opens soon", "opening soon", "early list", "until launch", "at launch", "paused until", "25% off", "staff sign-in", "start free", "run an event", "run your first event", "live since"];
  const ALLOWED: Array<[file: string, phrase: string, why: string]> = [
    ["src/components/ClubEventsList.tsx", "opening soon", "a tournament's entries open soon: its own window, not launch"],
    ["src/lib/registration.ts", "opens soon", "a tournament's entry status"],
    ["src/lib/domain/club-event-card.ts", "opens soon", "a tournament's entry status"],
    ["src/lib/landing/faq.tsx", "opens soon", "the contact address, while it cannot receive mail (CONTACT_EMAIL_LIVE)"],
    ["src/app/privacy/page.tsx", "run an event", "the privacy notice's sentence about organizers' accounts"],
    ["src/lib/landing/styles.ts", "start free", "a comment inside the stylesheet's own text, naming the button it lays out"],
  ];

  /** Every string the module says, long enough to be a sentence of its own. */
  const own = new Set<string>();
  const collect = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.length >= 16 && !/@|https?:/.test(v)) own.add(v);
    } else if (typeof v === "function") collect((v as (...a: string[]) => unknown)("Zz", "zz"));
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") Object.values(v).forEach(collect);
  };
  collect([SIGNINS_CLOSED_MESSAGE, SIGNINS_CLOSED_NOTICE, HELD_FRONT_DOOR, FRONT_DOOR, INTEREST_PAGE, faqWords("held"), faqWords("live"), OWNER_CARD]);

  function offences(file: string, src: string): string[] {
    const out: string[] = [];
    const lower = src.toLowerCase();
    for (const p of PHRASES) {
      if (lower.includes(p) && !ALLOWED.some(([f, a]) => f === file && a === p)) out.push(`${file}: “${p}”`);
    }
    for (const w of own) if (src.includes(w)) out.push(`${file}: the module's own words “${w.slice(0, 50)}…”`);
    return out;
  }

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "__tests__") walk(rel);
      } else if (/\.(ts|tsx)$/.test(e.name) && rel !== "src/lib/go-live.ts") files.push(rel);
    }
  };
  walk("src");

  it("nowhere but src/lib/go-live.ts (comments aside)", () => {
    const found = files.flatMap((f) => offences(f, readSource(f)));
    expect(found, found.join("\n")).toEqual([]);
  });

  it("every allowance is still needed", () => {
    for (const [file, phrase] of ALLOWED) expect(readSource(file).toLowerCase(), `${file} no longer says “${phrase}” — drop it from the list`).toContain(phrase);
  });

  it("CONTROL: it sees a held phrase, and a sentence of the module's, typed into a screen", () => {
    expect(offences("src/components/Zz.tsx", "<p>Opening soon — be first</p>").length).toBeGreaterThan(0);
    expect(offences("src/components/Zz.tsx", `const s = ${JSON.stringify(INTEREST_PAGE.live.sub)};`).length).toBeGreaterThan(0);
    expect(own.size, "the module's words were not collected").toBeGreaterThan(30);
    expect(files.length, "the walk found no source").toBeGreaterThan(300);
  });
});
