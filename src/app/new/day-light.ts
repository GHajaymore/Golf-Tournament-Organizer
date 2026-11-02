/**
 * ONE DAY'S LIGHT (site rehaul, design E, 2026-11-02): the page is the tournament day, and its
 * ground follows the light from before the first tee time to the prize-giving.
 *
 * Each LIGHT is one stretch of the day: the ground(s) its words sit on, and the three text colours
 * drawn on it. Every text colour is held to 7:1 against EVERY ground of its light (Ajay's crisp
 * rule, the same bar as SUNLIGHT_RATIO) by `src/lib/__tests__/day-light.test.ts`; a ground that
 * only blends between two lights (the first ~140px of a section, where nothing is written) is not
 * listed, because no word is drawn on it.
 *
 * The same colours at every width: there is no phone palette.
 */
export type LightName = "night" | "dawn" | "sunrise" | "morning" | "midday" | "afternoon" | "late" | "golden" | "evening";

export interface Light {
  /** When it is, as the chapter marker says it. */
  clock: string;
  /** The chapter marker's words. */
  label: string;
  /** The ground the section is painted in (its first entry), and any other ground text sits on. */
  grounds: readonly string[];
  /** Lifted panels and tiles in this light (text sits on these too). */
  panel: string;
  ink: string;
  soft: string;
  /** The orange as WORDS in this light (on dark it is light; on light it is burnt). */
  accent: string;
  line: string;
  /** Dark lights draw cream text; light ones draw ink. */
  dark: boolean;
}

export const LIGHT: Record<LightName, Light> = {
  night: {
    clock: "The week before", label: "Entries and the draw",
    grounds: ["#0c1230", "#111a3c"], panel: "#18214a",
    ink: "#f7f1e6", soft: "#cdd1e6", accent: "#f7a86c", line: "#ffffff26", dark: true,
  },
  dawn: {
    clock: "06:12", label: "First light",
    grounds: ["#0c1230", "#1a1d4a", "#2a2254"], panel: "#22265a",
    ink: "#f7f1e6", soft: "#d6d3e8", accent: "#f9ae74", line: "#ffffff29", dark: true,
  },
  sunrise: {
    clock: "08:05", label: "Sunrise",
    grounds: ["#fbe3cc", "#f8d9bd"], panel: "#fff3e6",
    ink: "#1c1428", soft: "#463647", accent: "#6e2c08", line: "#1c142826", dark: false,
  },
  morning: {
    clock: "10:50", label: "Morning",
    grounds: ["#f6efe0", "#fbf6ec"], panel: "#fffdf8",
    ink: "#16161d", soft: "#43424b", accent: "#7c330b", line: "#16161d24", dark: false,
  },
  midday: {
    clock: "12:30", label: "Midday",
    grounds: ["#eef3f5", "#ffffff"], panel: "#ffffff",
    ink: "#111821", soft: "#3f4852", accent: "#7c330b", line: "#11182124", dark: false,
  },
  afternoon: {
    clock: "14:00", label: "Afternoon",
    grounds: ["#f6ecd9", "#fdf7ec"], panel: "#fffaf1",
    ink: "#1b160f", soft: "#463d31", accent: "#7a3209", line: "#1b160f26", dark: false,
  },
  late: {
    clock: "16:20", label: "Late afternoon",
    grounds: ["#f2dfbf", "#f8ead2"], panel: "#fff6e7",
    ink: "#1d1409", soft: "#45361f", accent: "#73300a", line: "#1d140926", dark: false,
  },
  golden: {
    clock: "17:40", label: "Golden hour",
    grounds: ["#5a2416", "#4a1d14", "#62281a"], panel: "#3b1610",
    ink: "#fff4e4", soft: "#f2d3b8", accent: "#ffc78f", line: "#ffffff2e", dark: true,
  },
  evening: {
    clock: "19:30", label: "The prize-giving",
    grounds: ["#22101b", "#170b13", "#2a1220"], panel: "#2c1624",
    ink: "#f8efe4", soft: "#dccbd0", accent: "#f9ae74", line: "#ffffff26", dark: true,
  },
};

/** The orange FILL (buttons, the marked row) and the words on it: one pair for every light. */
export const SUN_FILL = "#ee8a3c";
export const ON_SUN = "#1a0e06";
