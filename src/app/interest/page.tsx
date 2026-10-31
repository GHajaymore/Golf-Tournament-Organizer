import type { Metadata } from "next";
import { signInsHeld } from "@/lib/services/signins-switch";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { editionSwaps, landingEdition, US_OVERRIDE_COOKIE } from "@/lib/landing/edition";
import { inDialect } from "@/lib/landing/dialect";
import { pageShareMeta } from "@/lib/landing/share-meta";
import { LANDING_CSS } from "@/lib/landing/styles";
import { LandingEffects } from "@/components/LandingEffects";
import { editionNote, iconSprite, landingFooter, landingNav } from "@/components/landing/chrome";
import { InterestForm } from "@/components/InterestForm";
import { INTEREST_COPY } from "@/lib/domain/interest";

const DESCRIPTION = "Register your interest in TourneyHQ and get a code for 25% off your first term when it opens.";

export const metadata: Metadata = {
  title: INTEREST_COPY.title,
  description: DESCRIPTION,
  alternates: { canonical: "/interest" },
  ...pageShareMeta({ path: "/interest", title: INTEREST_COPY.title, description: DESCRIPTION }),
};

/**
 * REGISTER YOUR INTEREST, BEFORE WE OPEN (2026-10-21).
 *
 * Ajay: "encourage them to send their interest … do you think we need a short
 * form … taking little more information from them like who are they?" Worded
 * with the panel's marketing manager. Its own page rather than a box inside the
 * front door's notice: the notice is drawn only while sign-ins are held, which
 * is production alone, so a box there could be walked by no test. The front
 * door links here; the form's words are all in `domain/interest.ts`.
 */
const FORM_CSS = `
.iv-wrap { display: grid; gap: 28px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { .iv-wrap { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); align-items: start; } }
.iv-points { margin: 0; padding-left: 20px; display: grid; gap: 10px; color: var(--ink); line-height: 1.55; }
.iv-fine { color: var(--ink); margin: 14px 0 0; }
.iv-form, .iv-sent { display: grid; gap: 18px; padding: 22px; border-radius: var(--r, 16px); background: var(--card); border: 1px solid var(--line); color: var(--ink); }
.iv-sent p { margin: 0; line-height: 1.6; }
.iv-field { display: grid; gap: 6px; min-width: 0; margin: 0; padding: 0; border: 0; }
.iv-field > label, .iv-field > legend { font-weight: 600; font-size: 15px; color: var(--ink); padding: 0; margin-bottom: 6px; }
.iv-opt { font-weight: 400; }
.iv-hint { font-size: 14px; color: var(--ink); }
.iv-field input:not([type="radio"]), .iv-field textarea { width: 100%; min-height: 46px; padding: 10px 12px; border-radius: 10px; border: 1.5px solid var(--line); background: var(--ground); color: var(--ink); font: 400 16px/1.4 var(--sans); }
.iv-field textarea { min-height: 90px; resize: vertical; }
.iv-field input:focus-visible, .iv-field textarea:focus-visible { outline: 3px solid var(--brass-ui); outline-offset: 1px; }
.iv-choices { display: grid; gap: 4px; }
.iv-choice { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 16px; color: var(--ink); cursor: pointer; }
.iv-choice input { width: 20px; height: 20px; accent-color: var(--brass-ui); flex: none; }
.iv-err { color: var(--color-danger); font-weight: 600; font-size: 14px; }
.iv-send { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
.iv-small { margin: 0; font-size: 14px; line-height: 1.55; color: var(--ink); }
.iv-small a, .iv-sent a { color: inherit; text-decoration: underline; }
.iv-copy { min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1.5px solid var(--ink); background: transparent; color: var(--ink); font: 600 14px var(--sans); cursor: pointer; }
.iv-hp { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; }
`;

export default async function InterestPage() {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  const { local, shown, overridden } = landingEdition(
    h.get("x-vercel-ip-country"),
    jar.get(US_OVERRIDE_COOKIE)?.value === "1",
  );

  const page = (
    <div className="thq" lang={shown.locale}>
      <style dangerouslySetInnerHTML={{ __html: LANDING_CSS + FORM_CSS }} />
      <LandingEffects />
      {iconSprite()}
      {landingNav("interest", await signInsHeld())}

      <main className="legal">
        <section className="fq-hero">
          <div className="wrap">
            <span className="label">{INTEREST_COPY.kicker}</span>
            <h1 className="h1">{INTEREST_COPY.h1}</h1>
            <p className="lead">{INTEREST_COPY.sub}</p>
          </div>
        </section>
        <div className="wrap lg-body">
          <div className="iv-wrap">
            <div>
              <ul className="iv-points">
                {INTEREST_COPY.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="iv-fine">
                Playing today? <Link href="/play">Enter your round code</Link> — that needs no account.
              </p>
            </div>
            <InterestForm register={shown.register} />
          </div>
          <p className="lg-back">
            <Link href="/">Back to TourneyHQ</Link>
          </p>
        </div>
      </main>

      {landingFooter("interest", editionNote(local, overridden))}
    </div>
  );

  return inDialect(page, editionSwaps(shown));
}
