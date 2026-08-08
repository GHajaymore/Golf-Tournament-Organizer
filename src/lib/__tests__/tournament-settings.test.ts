import { describe, it, expect } from "vitest";
import {
  DEFAULT_SETTINGS,
  cleanSettings,
  canSeeLeaderboard,
  isLeaderboardPublic,
  canEnterScores,
  canPlayerSavePartial,
  usesAccessCodes,
  usesEmailSignIn,
  allowsAutoConfirm,
  canApproveScores,
  LEADERBOARD_VISIBILITY,
  SCORE_ENTRY_BY,
  SCORE_APPROVAL,
  type TournamentSettings,
  ATTEST_BY,
  ATTEST_BY_LABEL,
  ATTEST_BY_HELP,
} from "../tournament-settings";
import { ROLES } from "../roles";

const withSettings = (patch: Partial<TournamentSettings>): TournamentSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

describe("defaults", () => {
  it("reproduces the behaviour the app had before settings existed", () => {
    // Players could previously see the leaderboard and enter scores, voice
    // dictation was on, and sign-in was by email. Changing any of these
    // silently changes how every existing tournament behaves.
    expect(DEFAULT_SETTINGS).toEqual({
      leaderboardVisibility: "participants",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      voiceEntry: true,
      playerAccess: "email",
      // One playing partner is what a club medal has always required, so a
      // tournament switching to player approval behaves as its members expect.
      attestBy: "marker",
      // "everyone" = the league question switched off, which is what every
      // pre-league tournament was implicitly doing.
      attendanceMode: "everyone",
      // The deliberate exception: prior behaviour auto-confirmed unreviewed
      // scores after 24h. Defaulting to staff approval is a considered change,
      // not an oversight — this assertion is here so it can't drift back
      // silently.
      scoreApproval: "staff",
    });
  });
});

describe("score approval", () => {
  it("never auto-confirms when staff must approve", () => {
    expect(allowsAutoConfirm(withSettings({ scoreApproval: "staff" }))).toBe(false);
    expect(allowsAutoConfirm(withSettings({ scoreApproval: "players" }))).toBe(true);
  });

  it("always lets staff approve a card", () => {
    for (const mode of SCORE_APPROVAL) {
      const s = withSettings({ scoreApproval: mode });
      expect(canApproveScores(s, "admin")).toBe(true);
      expect(canApproveScores(s, "assistant")).toBe(true);
    }
  });

  it("keeps players out of approval when the organizer signs off cards", () => {
    expect(canApproveScores(withSettings({ scoreApproval: "staff" }), "player")).toBe(false);
    expect(canApproveScores(withSettings({ scoreApproval: "players" }), "player")).toBe(true);
  });
});

describe("cleanSettings", () => {
  it("falls back per field rather than discarding the whole bundle", () => {
    const cleaned = cleanSettings({
      leaderboardVisibility: "public",
      scoreEntryBy: "nonsense",
      voiceEntry: "yes",
    });
    expect(cleaned.leaderboardVisibility).toBe("public");
    expect(cleaned.scoreEntryBy).toBe(DEFAULT_SETTINGS.scoreEntryBy);
    expect(cleaned.voiceEntry).toBe(DEFAULT_SETTINGS.voiceEntry);
  });

  it("accepts every declared option", () => {
    for (const v of LEADERBOARD_VISIBILITY) {
      expect(cleanSettings({ leaderboardVisibility: v }).leaderboardVisibility).toBe(v);
    }
    for (const v of SCORE_ENTRY_BY) {
      expect(cleanSettings({ scoreEntryBy: v }).scoreEntryBy).toBe(v);
    }
  });

  it("returns usable settings from an empty object", () => {
    expect(cleanSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps voiceEntry false when explicitly disabled", () => {
    // A falsy-but-valid value must survive; `false || default` would not.
    expect(cleanSettings({ voiceEntry: false }).voiceEntry).toBe(false);
  });
});

describe("leaderboard visibility", () => {
  it("never hides the leaderboard from staff", () => {
    for (const v of LEADERBOARD_VISIBILITY) {
      const s = withSettings({ leaderboardVisibility: v });
      expect(canSeeLeaderboard(s, "admin")).toBe(true);
      expect(canSeeLeaderboard(s, "assistant")).toBe(true);
    }
  });

  it("hides standings from players only in a blind event", () => {
    expect(canSeeLeaderboard(withSettings({ leaderboardVisibility: "staff" }), "player")).toBe(false);
    expect(canSeeLeaderboard(withSettings({ leaderboardVisibility: "participants" }), "player")).toBe(true);
    expect(canSeeLeaderboard(withSettings({ leaderboardVisibility: "public" }), "player")).toBe(true);
  });

  it("treats the public link as off unless visibility is exactly public", () => {
    expect(isLeaderboardPublic(withSettings({ leaderboardVisibility: "staff" }))).toBe(false);
    expect(isLeaderboardPublic(withSettings({ leaderboardVisibility: "participants" }))).toBe(false);
    expect(isLeaderboardPublic(withSettings({ leaderboardVisibility: "public" }))).toBe(true);
  });
});

describe("score entry", () => {
  it("always lets staff enter and correct scores", () => {
    // An organizer who cannot fix a wrong number cannot run the event, so no
    // setting may lock staff out of entry.
    for (const by of SCORE_ENTRY_BY) {
      const s = withSettings({ scoreEntryBy: by });
      expect(canEnterScores(s, "admin")).toBe(true);
      expect(canEnterScores(s, "assistant")).toBe(true);
    }
  });

  it("lets players enter only when the tournament allows it", () => {
    expect(canEnterScores(withSettings({ scoreEntryBy: "staff" }), "player")).toBe(false);
    expect(canEnterScores(withSettings({ scoreEntryBy: "players" }), "player")).toBe(true);
  });

  it("blocks partial cards from players only when set to submit after the round", () => {
    expect(canPlayerSavePartial(withSettings({ scoreEntryWindow: "during" }))).toBe(true);
    expect(canPlayerSavePartial(withSettings({ scoreEntryWindow: "after" }))).toBe(false);
  });
});

describe("player sign-in", () => {
  it("generates codes only where code access is enabled", () => {
    expect(usesAccessCodes(withSettings({ playerAccess: "email" }))).toBe(false);
    expect(usesAccessCodes(withSettings({ playerAccess: "code" }))).toBe(true);
    expect(usesAccessCodes(withSettings({ playerAccess: "both" }))).toBe(true);
  });

  it("keeps email sign-in available except in code-only tournaments", () => {
    expect(usesEmailSignIn(withSettings({ playerAccess: "email" }))).toBe(true);
    expect(usesEmailSignIn(withSettings({ playerAccess: "code" }))).toBe(false);
    expect(usesEmailSignIn(withSettings({ playerAccess: "both" }))).toBe(true);
  });

  it("always leaves a player some way in", () => {
    for (const access of ["email", "code", "both"] as const) {
      const s = withSettings({ playerAccess: access });
      expect(usesEmailSignIn(s) || usesAccessCodes(s), `${access} locks players out entirely`).toBe(true);
    }
  });
});

describe("rules cover every role", () => {
  it("answers for each role without throwing", () => {
    for (const role of ROLES) {
      expect(typeof canSeeLeaderboard(DEFAULT_SETTINGS, role)).toBe("boolean");
      expect(typeof canEnterScores(DEFAULT_SETTINGS, role)).toBe("boolean");
    }
  });
});

describe("how much agreement a card needs", () => {
  it("falls back to one partner rather than rejecting an unknown value", () => {
    // A bad value in one column must not invalidate the rest of the
    // tournament — the same rule every other setting follows.
    expect(cleanSettings({ attestBy: "everyone" }).attestBy).toBe("marker");
    expect(cleanSettings({}).attestBy).toBe("marker");
  });

  it("keeps each valid choice", () => {
    for (const v of ["marker", "opponent", "all"] as const) {
      expect(cleanSettings({ attestBy: v }).attestBy, v).toBe(v);
    }
  });

  it("describes every option it offers", () => {
    for (const key of ATTEST_BY) {
      expect(ATTEST_BY_LABEL[key], key).toBeTruthy();
      expect(ATTEST_BY_HELP[key].length, key).toBeGreaterThan(30);
    }
  });
});
