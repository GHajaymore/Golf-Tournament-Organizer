"use client";

import { DARK_GROUND, LIGHT_GROUND } from "@/lib/themes";

/**
 * WHEN THE FRAME ITSELF FAILS (2026-10-02).
 *
 * `error.tsx` catches a screen that throws, inside the app's own layout. It
 * cannot catch the layout: an error in the root layout replaces the whole
 * document, and with nothing here Next served its bare default — an unstyled
 * "Application error" with no brand and no way back.
 *
 * So this renders its own <html> and <body>, because the layout that would
 * have provided them is the thing that failed. Its stylesheet has gone with
 * it, which is why the colours are written here — read from the two grounds in
 * `themes.ts` rather than typed as hex, so they cannot drift from the app's.
 * It follows the device's light or dark setting, since the club's own choice
 * is in the layout that did not load.
 *
 * Like `error.tsx`, it never shows the error's message — that is server detail
 * — only the digest, which is the id the real error is logged under.
 */
const css = `
:root { color-scheme: dark; --bg: ${DARK_GROUND.bg}; --fg: ${DARK_GROUND.text}; --card: ${DARK_GROUND.surface}; }
@media (prefers-color-scheme: light) {
  :root { color-scheme: light; --bg: ${LIGHT_GROUND.bg}; --fg: ${LIGHT_GROUND.text}; --card: ${LIGHT_GROUND.surface}; }
}
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { min-height: 100vh; display: flex; justify-content: center; padding: 64px 16px; box-sizing: border-box; }
.box { width: min(560px, 100%); }
.kicker { font-size: 13px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; margin: 0; }
h1 { font-size: 28px; line-height: 1.25; margin: 8px 0; }
p { margin: 0 0 20px; }
.row { display: flex; flex-wrap: wrap; gap: 10px; }
.row a, .row button { min-height: 44px; padding: 0 18px; border-radius: 10px; font: 600 15px/44px inherit; cursor: pointer;
  border: 1px solid var(--fg); background: var(--card); color: var(--fg); text-decoration: none; display: inline-block; }
.row button { background: var(--fg); color: var(--bg); }
code { font-size: 14px; }
`;

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong · TourneyHQ</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main>
          <div className="box">
            <p className="kicker">TourneyHQ</p>
            <h1>Something went wrong</h1>
            <p>
              Scores that were already saved are safe. Try again — if it keeps happening, quote the
              reference below when you report it.
            </p>
            <div className="row">
              <button type="button" onClick={() => reset()}>
                Try again
              </button>
              {/* A plain link, not next/link: the router belongs to the layout that failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/">TourneyHQ home</a>
            </div>
            {error.digest && (
              <p style={{ fontSize: 14, marginTop: 20 }}>
                Reference: <code>{error.digest}</code>
              </p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
