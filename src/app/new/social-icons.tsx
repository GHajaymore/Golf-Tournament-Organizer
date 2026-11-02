import type { SocialId } from "@/lib/social-links";

/**
 * The networks' marks, drawn inline (no icon font, no third-party script), for the networks
 * `src/lib/social-links.ts` names — the one place their addresses are written. A network added
 * there needs its mark here, and the compiler says so (the record is keyed by `SocialId`).
 */
const PATHS: Record<SocialId, string> = {
  instagram:
    "M7.5 2.5h9a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5h-9a5 5 0 0 1-5-5v-9a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3h-9ZM12 7.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm0 2a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Zm5.1-3.6a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z",
  facebook:
    "M13.5 21.5v-8h2.7l.4-3.2h-3.1V8.3c0-.9.3-1.6 1.6-1.6h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.4 0-4.1 1.5-4.1 4.2v2.3H7.5v3.2h2.7v8h3.3Z",
};

export function SocialIcon({ net, label }: { net: SocialId; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} fillRule="evenodd">
      <path d={PATHS[net]} />
    </svg>
  );
}
