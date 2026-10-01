import type { Metadata } from "next";
import { alt as ogAlt, size as ogSize } from "@/app/opengraph-image";

/**
 * A public page's own link preview (2026-09-30).
 *
 * The root layout's `openGraph` and `twitter` describe the LANDING page —
 * `url: "/"` and the landing's headline — and Next merges metadata one key
 * deep, so a page that set only `title` and `description` inherited both
 * whole. /privacy and /faq were shared as "TourneyHQ — Golf tournament
 * management, from the draw to the payout" pointing at "/", which a chat app
 * reads as a link to the front page.
 *
 * Replacing `openGraph` replaces the whole object, so `type` and `siteName`
 * are restated here — and so is the IMAGE. Measured on the dev server: a page
 * that sets its own `openGraph` loses the image `app/opengraph-image.tsx`
 * gives every other route (the landing carried six og:image tags, /faq none),
 * which would have shared these pages as a bare line of text.
 */
const IMAGE = {
  url: "/opengraph-image",
  width: ogSize.width,
  height: ogSize.height,
  alt: ogAlt,
};

export function pageShareMeta(p: { path: string; title: string; description: string }): Pick<Metadata, "openGraph" | "twitter"> {
  const title = `${p.title} · TourneyHQ`;
  return {
    openGraph: { type: "website", siteName: "TourneyHQ", url: p.path, title, description: p.description, images: [IMAGE] },
    twitter: { card: "summary_large_image", title, description: p.description, images: [IMAGE.url] },
  };
}
