import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flights — Golf Tournament Console",
    short_name: "Flights",
    description: "Enter scores, track the live leaderboard, and run golf tournaments.",
    start_url: "/",
    display: "standalone",
    background_color: "#161826",
    theme_color: "#161826",
    orientation: "portrait",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
