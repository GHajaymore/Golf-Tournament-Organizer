/**
 * The address on the privacy policy, and the refusal to publish a fake one.
 *
 * The policy shipped with `privacy@tourneyhq.example` hard-coded and a comment
 * saying "set this before launch". `.example` is reserved by RFC 2606 — it can
 * never be registered and can never receive mail — so the page told every
 * player how to exercise a data-protection right, in a way that silently went
 * nowhere. A dead address on a privacy policy is worse than no address: it
 * reads as a route, and it consumes the one attempt most people will make.
 *
 * Two things follow from that, and both are here rather than in the page.
 *
 * FIRST, the address is configuration. It changes when a domain is bought, not
 * when the software changes, and it should not need a code edit and a review to
 * set. `PRIVACY_CONTACT_EMAIL` is read on the server only — the policy is a
 * server component, so the address never has to enter the client bundle, and
 * `NEXT_PUBLIC_` would put it there for a scraper to collect.
 *
 * SECOND, and the reason this is a function rather than a `??`: the placeholder
 * must be unrepresentable. Moving a bad value from a constant into an
 * environment variable does not fix it — it just moves where it can be typed,
 * and the next person to paste an example address in gets exactly the original
 * bug with no comment above it to warn them. So a reserved address is REFUSED
 * here, and the page degrades to prose that is true.
 *
 * The degradation is not a placation. The policy already establishes that the
 * club is the controller and TourneyHQ the processor, so "ask your club to
 * raise it with us" describes a route that genuinely exists and genuinely
 * works, for someone who by definition has a club. It is what the page should
 * say when there is no direct address, and it is never a lie.
 */

/**
 * Whether the policy can print an address.
 *
 * A union rather than `string | null` so the page has to handle both — the
 * copy differs between them by more than one interpolated value, and a nullable
 * string invites `{CONTACT ?? "..."}` inside a sentence written for the other
 * case.
 */
export type PrivacyContact =
  /** A real address, safe to publish and to link. */
  | { kind: "address"; email: string }
  /** Nothing usable was configured. Say what is true instead. */
  | { kind: "none" };

/**
 * Domains that exist to be examples, and can never receive mail.
 *
 * RFC 2606 reserves the `.test`, `.example`, `.invalid` and `.localhost` TLDs
 * along with the `example.com/net/org` second-level names, precisely so that
 * documentation can use them without colliding with a real registration. That
 * property is what makes them useful in a fixture and disqualifying on a live
 * policy page, and it is why matching on them is not a guess about intent: an
 * address here is unreachable as a matter of the DNS, whatever it was meant to
 * be.
 */
const RESERVED_TLDS = ["example", "test", "invalid", "localhost"];
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];

/**
 * Deliberately not the app's sign-up validator.
 *
 * That one decides whether a person may be let in and is tuned to be generous.
 * This one decides whether to publish a string as a working contact route, so
 * it wants the plain shape and nothing exotic: one `@`, something either side,
 * a dot in the domain, no whitespace.
 */
const SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Whether an address can, in principle, receive mail. */
export function isReachableAddress(email: string): boolean {
  const clean = email.trim().toLowerCase();
  if (!SHAPE.test(clean)) return false;
  const domain = clean.slice(clean.lastIndexOf("@") + 1);
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (RESERVED_TLDS.includes(tld)) return false;
  return !RESERVED_DOMAINS.includes(domain);
}

/**
 * Resolve the address the privacy policy should print.
 *
 * Takes the raw value rather than reading `process.env` itself, so the rule is
 * testable without mutating the environment — the same reason the rest of
 * `src/lib/domain` takes its inputs.
 *
 * Unset, blank, malformed and reserved all collapse to the same answer on
 * purpose. From the reader's side they are one situation — there is no address
 * that reaches anybody — and giving them separate behaviours would only create
 * a path where a typo prints as a link.
 */
export function privacyContact(raw: string | undefined | null): PrivacyContact {
  const clean = (raw ?? "").trim().toLowerCase();
  if (!clean || !isReachableAddress(clean)) return { kind: "none" };
  return { kind: "address", email: clean };
}
