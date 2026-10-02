import type { Instrumentation } from "next";

/**
 * SERVER ERRORS, REPORTED (2026-10-02). Off until `SENTRY_DSN` is set.
 *
 * The failure this exists for is the one CLAUDE.md keeps describing: a screen
 * that throws on every request while the build is clean and every test is
 * green. In production the only witness was the person who hit it. Next calls
 * `onRequestError` for every uncaught error in a server component, a route
 * handler or a server action, which is exactly that class.
 *
 * SERVER ONLY, deliberately. The browser SDK would add weight to every page,
 * the landing page included, and the errors that cost a club its afternoon are
 * the server's. A client-side report is a later decision with its own cost.
 *
 * NOTHING LEAVES UNSCRUBBED. Every report goes through `scrubReport`, which
 * removes the share, entry and reset tokens that live in this app's URLs, and
 * every email address. `sendDefaultPii` stays false, so no cookie and no IP
 * address is attached in the first place.
 *
 * The SDK is imported only when a DSN is set, and only on the Node runtime, so
 * with error reporting off this file loads nothing and costs nothing.
 */

const dsn = () => process.env.SENTRY_DSN?.trim() || null;

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !dsn()) return;
  const [Sentry, { scrubReport }] = await Promise.all([
    import("@sentry/nextjs"),
    import("@/lib/domain/error-report"),
  ]);
  Sentry.init({
    dsn: dsn()!,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    sendDefaultPii: false,
    // Errors only. Performance tracing is a separate decision and a separate bill.
    tracesSampleRate: 0,
    beforeSend: (event) => scrubReport(event),
    beforeBreadcrumb: (crumb) => scrubReport(crumb),
  });
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !dsn()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
