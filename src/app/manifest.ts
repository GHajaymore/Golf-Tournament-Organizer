import type { MetadataRoute } from "next";
import { HOME_SCREEN_START } from "@/lib/domain/home-screen-start";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // The installed-app name. Kept shorter than the page title because a home
    // screen truncates: short_name is what actually sits under the icon.
    name: "TourneyHQ — Golf tournaments & leagues",
    short_name: "TourneyHQ",
    description: "Enter scores, track the live leaderboard, and run golf tournaments.",
    // Not "/", the held front door: an iPhone home-screen app has its own empty cookie jar, and a
    // guest opening it there needs the code box (J39/J40 PR 2, G3). /start sends each person home.
    start_url: HOME_SCREEN_START,
    display: "standalone",
    background_color: "#16181a",
    theme_color: "#16181a",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
