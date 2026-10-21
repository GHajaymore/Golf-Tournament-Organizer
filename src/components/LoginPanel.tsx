"use client";
import { useEffect, useState, useTransition } from "react";
import { signInWithPassword, claimPassword, signUp, requestPasswordReset } from "@/app/actions/auth";
import { askForBotCheck } from "@/lib/bot-check-fetch";
import { MIN_PASSWORD_LENGTH, passwordHint } from "@/lib/domain/password";
import { signupMissing } from "@/lib/domain/signup-missing";
import type { OrgKind } from "@/lib/domain/org-profile";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { Icon } from "./Icon";

/**
 * Standard two-tab auth: Log in / Sign up.
 *
 * Two extra states hang off Log in rather than being tabs of their own,
 * because you only reach them from a login attempt:
 *   claim  - the email was invited by an organizer but has no password yet
 *   forgot - password reset request
 *
 * Everything is inside a real <form>. It was a stack of inputs with an Enter
 * handler bolted onto the password field, which meant Enter did nothing from
 * the email field and password managers had no form to recognise — the two
 * things people actually notice about a sign-in box.
 */
type Mode = "login" | "signup";
type Extra = null | "claim" | "forgot" | "forgot-sent" | "forgot-unsent";

/**
 * The sign-up question, in an organizer's own words.
 *
 * These map onto OrgKind, but the wording deliberately does not: nobody
 * signing up knows what a "kind" is, and everybody knows whether they are a
 * club or a few friends. The order runs from most structured to least.
 *
 * The club and the society are separated because they fall on opposite sides
 * of the ledger — a club's shop takes the money, a society sorts it out
 * between themselves — which is the single most consequential thing this
 * answer decides. A two-way "club or society" split could not tell them apart.
 */
const SIGNUP_KINDS: Array<{ value: OrgKind; label: string; help: string }> = [
  {
    value: "club",
    label: "A golf club or course",
    help: "Competitions for members and guests. The shop takes the entry fee and pays the winner.",
  },
  {
    value: "community",
    label: "A society, league or regular group",
    help: "You play together through the season and sort the money out between yourselves.",
  },
  {
    value: "personal",
    label: "A one-off outing with friends",
    help: "Just this once, with your own list of players.",
  },
];

export function LoginPanel({
  initialMode = "login",
  autoFocusFields = true,
  organizers = "organizers",
  signupClosed = false,
}: {
  initialMode?: Mode;
  autoFocusFields?: boolean;
  /**
   * Sign-ins held until launch (`sign-in-gate.ts`): no Sign up tab and no sign-up form at all,
   * only signing in, for the owners the hold lets through. Ajay, 2026-10-21: "it still allow to
   * sign up" — the server refused every stranger, but a working form under the notice said otherwise.
   */
  signupClosed?: boolean;
  /**
   * The visitor's word for the people who run events — "organisers" on the UK
   * edition (`golf-terms.ts`). A client component cannot reach the landing's
   * server-side dialect, so the page hands it in.
   */
  organizers?: string;
} = {}) {
  const [mode, setMode] = useState<Mode>(signupClosed ? "login" : initialMode);
  const [extra, setExtra] = useState<Extra>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<OrgKind | "">("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [discountCode, setDiscountCode] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);

  // A sign-up link that carries a code (?code=…) opens the box filled in.
  // Read after mount, never while rendering, for the reason `intendedNext` gives.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("code");
    if (fromLink) {
      setDiscountCode(fromLink);
      setCodeOpen(true);
    }
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setExtra(null);
    setError("");
    setPassword("");
  };

  /**
   * Where this visitor was heading before being asked to sign in.
   *
   * Read at SUBMIT time rather than during render, on purpose: reading
   * `window.location` while rendering would differ between the server pass and
   * the browser one and produce a hydration mismatch, and nothing needs it
   * until a form is actually sent.
   *
   * Passed on as-is. The server re-validates it — `afterSignIn` runs it through
   * `safeNextPath` — because a `"use server"` export is a public endpoint and
   * anything arriving from this component is only a suggestion.
   */
  const intendedNext = () => {
    if (typeof window === "undefined") return undefined;
    return new URLSearchParams(window.location.search).get("next") ?? undefined;
  };

  const submitLogin = () => {
    setError("");
    startTransition(async () => {
      const result = await signInWithPassword(email, password, intendedNext());
      // A successful sign-in redirect()s server-side and never returns here.
      if (result.needsClaim) {
        setExtra("claim");
        setPassword("");
        return;
      }
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  const submitSignup = () => {
    // The button always presses; pressing it early says what is still
    // missing instead of sitting grey with no reason given.
    const missing = signupMissing({ name, email, password, kind });
    if (missing) {
      setError(missing);
      return;
    }
    setError("");
    startTransition(async () => {
      // The one request on this page the bot check is FOR — and so the only
      // one that waits for it (`lib/bot-check-fetch.ts`).
      askForBotCheck(Date.now());
      const result = await signUp(name, email, password, kind, intendedNext(), discountCode);
      /**
       * Same branch signing in takes. An email that was invited but never
       * claimed goes to "Set your password", which says whose account it is,
       * rather than silently having a password attached by the sign-up form.
       */
      if (result.needsClaim) {
        setExtra("claim");
        setPassword("");
        return;
      }
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  const submitClaim = () => {
    setError("");
    startTransition(async () => {
      const result = await claimPassword(email, password, intendedNext());
      if (!result.ok) setError(result.error ?? "Something went wrong.");
    });
  };

  const submitForgot = () => {
    setError("");
    startTransition(async () => {
      const result = await requestPasswordReset(email);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      // `sent: false` is a fact about this installation (no mail provider),
      // the same for every address — so the screen can say so honestly without
      // saying anything about whether the address has an account.
      setExtra(result.sent === false ? "forgot-unsent" : "forgot-sent");
    });
  };

  /* ── Presentation ────────────────────────────────────────────────── */

  /** A defined card rather than fields floating on the page. */
  const shell = (children: React.ReactNode) => (
    <div
      style={{
        width: "min(400px, 100%)",
        display: "flex",
        flexDirection: "column",
        gap: 18,
        padding: 26,
        borderRadius: 16,
        background: "var(--color-surface)",
        boxShadow: [
          "0 0 0 1px color-mix(in srgb, var(--color-text) 10%, transparent)",
          "0 2px 6px -1px rgba(0,0,0,0.16)",
          "0 22px 56px -20px rgba(0,0,0,0.45)",
          "inset 0 1px 0 0 color-mix(in srgb, var(--color-accent) 16%, transparent)",
        ].join(", "),
      }}
    >
      {children}
    </div>
  );

  const Title = ({ title, sub }: { title: string; sub: React.ReactNode }) => (
    <div>
      <h3 style={{ margin: 0, fontSize: 20, letterSpacing: "-0.022em" }}>{title}</h3>
      <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.5 }}>
        {sub}
      </p>
    </div>
  );

  // A tinted block with role="alert", so the failure is both visible and
  // announced. Plain red text below a field is easy to miss and invisible to
  // a screen reader that has already moved on.
  const errorBlock = error ? (
    <p
      role="alert"
      style={{
        fontSize: 13,
        margin: 0,
        lineHeight: 1.5,
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "9px 11px",
        borderRadius: 9,
        color: "var(--color-danger)",
        background: "var(--color-danger-bg)",
        boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-danger) 32%, transparent)",
      }}
    >
      <Icon name="warning-circle" style={{ fontSize: 14, marginTop: 1, flex: "none" }} />
      <span>{error}</span>
    </p>
  ) : null;

  /* ── Password reset ──────────────────────────────────────────────── */

  if (extra === "forgot-sent") {
    return shell(
      <>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            display: "grid",
            placeItems: "center",
            background: "color-mix(in srgb, var(--color-accent-2) 15%, transparent)",
            color: "var(--color-accent-2-200)",
          }}
        >
          <Icon name="envelope-simple" style={{ fontSize: 18 }} />
        </div>
        <Title
          title="Check your email"
          sub={
            <>
              If <b>{email}</b> has an account, a reset link is on its way. It expires in 15 minutes.
              Nothing after a few minutes? Check your spam folder, or write to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </>
          }
        />
        <BackLink onClick={() => { setExtra(null); setError(""); }} label="Back to log in" />
      </>,
    );
  }

  /**
   * The honest version (2026-10-11): this site cannot send mail, so no link
   * was sent, and here is who to write to. It used to show "Check your email"
   * whatever had happened, to somebody who would then wait for nothing.
   */
  if (extra === "forgot-unsent") {
    return shell(
      <>
        <Title
          title="We can’t email a reset link"
          sub={
            <>
              This site isn&rsquo;t set up to send email yet, so no reset link was sent. Write to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and we&rsquo;ll get you back in.
            </>
          }
        />
        <BackLink onClick={() => { setExtra(null); setError(""); }} label="Back to log in" />
      </>,
    );
  }

  if (extra === "forgot") {
    return shell(
      <form
        onSubmit={(e) => { e.preventDefault(); submitForgot(); }}
        style={{ display: "contents" }}
      >
        <Title title="Reset your password" sub="We'll email a link to set a new password." />
        <Field label="Email" boxId="forgot-email">
          <input
            id="forgot-email"
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoFocus={autoFocusFields}
          />
        </Field>
        {errorBlock}
        <button type="submit" className="btn btn-primary btn-block" disabled={pending || !email.trim()}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
        <BackLink onClick={() => { setExtra(null); setError(""); }} label="Back to log in" />
      </form>,
    );
  }

  /* ── First-time password for an invited account ──────────────────── */

  if (extra === "claim") {
    return shell(
      <form
        onSubmit={(e) => { e.preventDefault(); submitClaim(); }}
        style={{ display: "contents" }}
      >
        <Title
          title="Set your password"
          sub={
            <>
              <b>{email}</b> has been invited to a tournament. Choose a password to finish setting up
              your account.
            </>
          }
        />
        {/* The email is stated above but not in the form, which leaves a
            password manager nothing to file the new credential against. */}
        <input type="hidden" name="email" value={email} autoComplete="username" readOnly />
        {/* Claiming a provisioned account creates a password too, so it states
            the same rule live rather than only in a vanishing placeholder. */}
        <Field label="Create password" boxId="claim-password" hint={passwordHint(password, { email })}>
          <PasswordInput
            id="claim-password"
            describedBy="claim-password-hint"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder="Choose a password"
            autoFocus={autoFocusFields}
          />
        </Field>
        {errorBlock}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={pending || password.length < MIN_PASSWORD_LENGTH}
        >
          {pending ? "Saving…" : "Set password & continue"}
        </button>
        <BackLink onClick={() => { setExtra(null); setError(""); setPassword(""); }} label="Back to log in" />
      </form>,
    );
  }

  /* ── Log in / Sign up ────────────────────────────────────────────── */

  const login = signupClosed || mode === "login";

  return shell(
    <>
      {/* A sliding pill rather than two bordered halves — the segmented
          control every current interface uses for exactly this choice. */}
      {/* `keep-grid`: phones stack inline grids inside <main> (globals.css), and
          this control is two halves of one choice — stacked, it read as two
          separate buttons, one of them unexplained. */}
      {!signupClosed && (
      <div
        role="tablist"
        aria-label="Log in or sign up"
        className="keep-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 3,
          padding: 3,
          borderRadius: 11,
          background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
        }}
      >
        {(["login", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            style={{
              appearance: "none",
              border: "none",
              cursor: "pointer",
              padding: "7px 10px",
              // The platform minimum: this was 30px tall, measured on the
              // landing at every width (2026-09-28). See touch.spec's
              // signed-out sweep, which is what now measures this form.
              minHeight: 44,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: mode === m ? 600 : 500,
              fontFamily: "var(--font-heading)",
              color: mode === m ? "var(--color-text)" : "var(--color-text-muted)",
              background: mode === m ? "var(--color-surface)" : "transparent",
              boxShadow:
                mode === m
                  ? "0 0 0 1px color-mix(in srgb, var(--color-text) 9%, transparent), 0 1px 2px rgba(0,0,0,0.14)"
                  : "none",
              transition: "background 120ms var(--ease), color 120ms var(--ease)",
            }}
          >
            {m === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>
      )}

      <Title
        title={signupClosed ? "Already have access?" : login ? "Welcome back" : "Create your account"}
        sub={
          signupClosed
            ? "Log in here. New accounts open at launch."
            : login
              ? "Log in to reach the tournaments you have access to."
              : `For ${organizers} running an event, and for players invited to one.`
        }
      />

      <form
        // `if/else`, not a ternary used as a statement. Both branches are here
        // for their side effects, and a ternary in that position reads as
        // though it produces something — which is what the lint rule has been
        // saying. The front door is the last place to leave a warning standing.
        onSubmit={(e) => {
          e.preventDefault();
          if (login) submitLogin();
          else submitSignup();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        {!login && (
          <Field label="Your name" boxId="login-name">
            <input
              id="login-name"
              className="input"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              autoFocus={autoFocusFields}
            />
          </Field>
        )}

        <Field label="Email" boxId="login-email">
          <input
            id="login-email"
            className="input"
            type="email"
            name="email"
            autoComplete={login ? "username" : "email"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            autoFocus={autoFocusFields && login}
          />
        </Field>

        <Field
          label="Password"
          boxId="login-password"
          /**
           * Why the button is dead, said where the button cannot say it.
           *
           * Signing up disables "Create account" until the password is long
           * enough — and offered no hint, no message and no explanation, so
           * the form simply refused to work with nothing on screen to say
           * why. The placeholder carried the rule and disappeared the moment
           * anyone typed, which is exactly when it was needed.
           *
           * It counts down rather than restating the rule, because "4 more
           * characters" answers the question a stuck person is actually
           * asking. Logging in has no requirement to state — the rule belongs
           * to the password being CREATED, not to one already chosen.
           */
          hint={login ? undefined : passwordHint(password, { email, name })}
          action={
            login ? (
              <button
                type="button"
                onClick={() => { setExtra("forgot"); setError(""); }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  color: "var(--color-accent-200)",
                  // A 44px target around 12px of text: the negative margin
                  // gives the space back so the label row does not grow. It
                  // was a 40x12 button.
                  minHeight: 44,
                  minWidth: 44,
                  padding: "0 6px",
                  margin: "-16px -6px",
                }}
              >
                Forgot?
              </button>
            ) : null
          }
        >
          <PasswordInput
            id="login-password"
            describedBy={login ? undefined : "login-password-hint"}
            value={password}
            onChange={setPassword}
            autoComplete={login ? "current-password" : "new-password"}
            /* The rule is in the hint beneath; saying it here too printed it twice. */
            placeholder={login ? "Your password" : "Choose a password"}
          />
        </Field>

        {/* The one product question at sign-up, and deliberately the only one.
            It decides which setup steps exist, whether money defaults to a
            settle-up, and whether the roster is shared — see org-profile.ts.
            Asked as what somebody IS, never as "organization kind": a person
            signing up knows which of these they are and does not know what a
            kind is. No default, because silently answering the most
            consequential question in the product is how a society ends up
            configured as a club. */}
        {!login && (
          <fieldset style={{ border: "none", padding: 0, margin: 0, minWidth: 0 }}>
            <legend
              style={{ fontSize: 13, padding: 0, marginBottom: 7, color: "var(--color-text)", fontWeight: 500 }}
            >
              What are you organizing golf for?
            </legend>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {SIGNUP_KINDS.map((k) => (
                <label
                  key={k.value}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 9,
                    padding: "10px 11px",
                    borderRadius: 10,
                    cursor: "pointer",
                    background:
                      kind === k.value
                        ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                        : "color-mix(in srgb, var(--color-text) 4%, transparent)",
                    boxShadow:
                      kind === k.value
                        ? "inset 0 0 0 1px var(--color-accent)"
                        : "inset 0 0 0 1px color-mix(in srgb, var(--color-text) 10%, transparent)",
                  }}
                >
                  <input
                    type="radio"
                    name="orgKind"
                    value={k.value}
                    checked={kind === k.value}
                    onChange={() => setKind(k.value)}
                    style={{ marginTop: 2, flex: "none", accentColor: "var(--color-accent)" }}
                  />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{k.label}</span>
                    <span className="text-muted" style={{ display: "block", fontSize: 13, lineHeight: 1.5 }}>
                      {k.help}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {/* A discount code the owner handed out. Folded away, because almost
            nobody has one and an empty box reads as a price to pay; a link that
            carries one (?code=…) opens it filled in. Kept on the club and offered
            at its plan checkout — it comes off the first payment only. */}
        {!login &&
          (codeOpen ? (
            <Field label="Discount code" boxId="login-discount" hint="Optional. It comes off your first payment when you choose a paid plan.">
              <input
                id="login-discount"
                className="input"
                name="discountCode"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value)}
                placeholder="e.g. 7KQ2MXRP"
                aria-describedby="login-discount-hint"
              />
            </Field>
          ) : (
            <button
              type="button"
              onClick={() => setCodeOpen(true)}
              style={{
                alignSelf: "flex-start",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 13,
                color: "var(--color-accent-200)",
                minHeight: 44,
                padding: 0,
                margin: "-10px 0",
              }}
            >
              Have a discount code?
            </button>
          ))}

        {errorBlock}

        <button
          type="submit"
          className="btn btn-primary btn-block"
          style={{ marginTop: 2 }}
          disabled={pending || (login && (!email.trim() || !password))}
        >
          {pending
            ? login
              ? "Logging in…"
              : "Creating account…"
            : login
              ? "Log in"
              : "Create account"}
        </button>

        {/* WHAT CREATING AN ACCOUNT AGREES TO (2026-10-02), said beside the
            button that does it — the one place it binds, and the one place a
            person is looking. Sign-up only: logging in agrees to nothing new.
            Links in a sentence, so they stay words rather than buttons. */}
        {!login && (
          <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.55, margin: 0, textAlign: "center" }}>
            By creating an account you agree to the{" "}
            <a href="/terms" style={{ color: "var(--color-accent-200)" }}>Terms</a> and the{" "}
            <a href="/privacy" style={{ color: "var(--color-accent-200)" }}>Privacy policy</a>.
          </p>
        )}
      </form>

      {/* Players in a code-access tournament have no account at all — this is
          their whole way in, so it can't be buried. */}
      <a
        href="/play"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          marginTop: -2,
          padding: "10px 12px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: "none",
          color: "var(--color-accent-200)",
          background: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
          boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 22%, transparent)",
        }}
      >
        <Icon name="flag" style={{ fontSize: 15 }} />
        Playing today? Enter your round code
        <Icon name="arrow-right" style={{ fontSize: 13 }} />
      </a>
    </>,
  );
}

/**
 * One field: its label, an optional action beside the label, the box, a hint.
 *
 * NOT ONE BIG `<label>` (2026-10-11). It was, and "Forgot?" sat inside it
 * ahead of the box. A label belongs to the first control inside it — so
 * "Password" was the label of the Forgot button: tapping the word opened
 * "Reset your password", the password box had no label, and the button had no
 * name a screen reader could find. The label is its own element now, FOR the
 * box by id, and whatever sits beside it is beside it.
 */
function Field({
  label,
  boxId,
  hint,
  action,
  children,
}: {
  label: string;
  /** The id of the box this field's label is for. */
  boxId: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="field" style={{ display: "block" }}>
      <span
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 13,
          fontWeight: 500,
          marginBottom: 6,
          color: "var(--color-text-muted)",
        }}
      >
        <label htmlFor={boxId} style={{ font: "inherit", color: "inherit", letterSpacing: "inherit" }}>
          {label}
        </label>
        {action}
      </span>
      {children}
      {hint && (
        <span id={`${boxId}-hint`} className="text-muted" style={{ display: "block", fontSize: 13, marginTop: 5 }}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * A password field you can read back.
 *
 * Typing a password blind on a phone at a golf club, one-handed, is the most
 * common reason a correct password gets rejected — and the reveal toggle is
 * the standard fix everywhere except here.
 */
function PasswordInput({
  id,
  describedBy,
  value,
  onChange,
  autoComplete,
  placeholder,
  autoFocus,
}: {
  id: string;
  describedBy?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span style={{ position: "relative", display: "block" }}>
      <input
        id={id}
        aria-describedby={describedBy}
        className="input"
        type={shown ? "text" : "password"}
        name="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ paddingRight: 46 }}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          right: 0,
          top: "50%",
          transform: "translateY(-50%)",
          // 44x44, the platform minimum; it was 28x28.
          width: 44,
          height: 44,
          display: "grid",
          placeItems: "center",
          background: "none",
          border: "none",
          borderRadius: 7,
          cursor: "pointer",
          color: "var(--color-text-muted)",
        }}
      >
        <Icon name={shown ? "ph ph-eye-slash" : "ph ph-eye"} style={{ fontSize: 15 }} />
      </button>
    </span>
  );
}

function BackLink({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        padding: "0 8px",
        minHeight: 44,
        cursor: "pointer",
        color: "var(--color-text-muted)",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 5,
        alignSelf: "center",
      }}
    >
      <Icon name="arrow-left" /> {label}
    </button>
  );
}
