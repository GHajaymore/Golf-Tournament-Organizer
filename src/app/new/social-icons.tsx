import type { SocialKey } from "@/lib/contact";

/**
 * The networks' marks, drawn inline (no icon font, no third-party script). Each is decoration
 * beside the network's written name, or carries the name itself as its accessible label where it
 * stands alone (the footer).
 */
const PATHS: Record<SocialKey, string> = {
  instagram:
    "M7.5 2.5h9a5 5 0 0 1 5 5v9a5 5 0 0 1-5 5h-9a5 5 0 0 1-5-5v-9a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3h-9ZM12 7.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm0 2a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Zm5.1-3.6a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3Z",
  youtube:
    "M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8 1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8ZM10 15.1V8.9l5.3 3.1L10 15.1Z",
  facebook:
    "M13.5 21.5v-8h2.7l.4-3.2h-3.1V8.3c0-.9.3-1.6 1.6-1.6h1.7V3.9c-.3 0-1.3-.1-2.5-.1-2.4 0-4.1 1.5-4.1 4.2v2.3H7.5v3.2h2.7v8h3.3Z",
  linkedin:
    "M4.2 2.5h15.6c.9 0 1.7.8 1.7 1.7v15.6c0 .9-.8 1.7-1.7 1.7H4.2c-.9 0-1.7-.8-1.7-1.7V4.2c0-.9.8-1.7 1.7-1.7ZM6 9.6v8.3h2.7V9.6H6Zm1.35-4.2a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1Zm3.4 4.2v8.3h2.6v-4.1c0-1.1.2-2.1 1.6-2.1 1.3 0 1.3 1.2 1.3 2.2v4h2.7v-4.6c0-2.3-.5-4-3.1-4-1.3 0-2.1.7-2.5 1.3V9.6h-2.6Z",
  x: "M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.9 3h6.4l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z",
};

export function SocialIcon({ net, label }: { net: SocialKey; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} fillRule="evenodd">
      <path d={PATHS[net]} />
    </svg>
  );
}
