/**
 * THE PIPELINE'S SECTIONS, EACH BEHIND ONE SWITCH (design F of the site rehaul, 2026-11-03).
 *
 * Ajay, 3 Nov: "we will have to add some additional functionality which we have introduced and some
 * are in pipeline". A section of the front door may never claim what is not true on the day it shows,
 * so a feature still in an open pull request is written here and drawn nowhere until its switch is
 * turned on — by the pull request that ships it, or straight after it merges.
 *
 * TURNING ONE ON is three steps, in one commit:
 *   1. the feature is on main AND is what an organizer gets by default (the condition below);
 *   2. its screens are in `src/lib/landing/screens.ts` with a `capture`, shot and placed (the
 *      "Landing captures" workflow, `.github/workflows/landing-captures.yml`);
 *   3. `on: true` here.
 * `src/lib/__tests__/site-rehaul-pipeline.test.ts` refuses a switch that is on while any of its
 * screens is missing from the manifest or was never placed — so a section cannot go up empty, or on
 * a picture that does not exist.
 */
export interface PipelineFeature {
  on: boolean;
  /** The pull request that ships it. */
  pr: number;
  /** When it may be switched on: true on main AND what organizers get by default. */
  when: string;
  /** The landing screens its section draws (ids in `src/lib/landing/screens.ts`). */
  screens: readonly string[];
}

/** #995 — "Set up with a few questions": seven questions with answers already chosen, then a draft to review. */
export const SETUP_QUESTIONS: PipelineFeature = {
  on: false,
  pr: 995,
  when: "#995 merged, and \"Set up with a few questions\" is the first button on the create card. NOTE: #995 also writes src/app/new/page.tsx, this preview's own address; one of the two must move first.",
  screens: ["f-setup-questions"],
};

/** #994 — Rounds & formats as a "Course day" timeline. */
export const COURSE_DAY: PipelineFeature = {
  on: false,
  pr: 994,
  when: "#994 merged AND the timeline is the Rounds & formats screen by default (it ships behind ?view=timeline, off).",
  screens: ["f-course-day"],
};

/** #996 — reading a course's card from a photo, which the organizer then checks. */
export const CARD_PHOTO: PipelineFeature = {
  on: false,
  pr: 996,
  when: "#996 merged and the AI account set in production, so the card reader answers for an organizer on a plan that has it.",
  screens: ["f-card-photo"],
};

export const PIPELINE = { setupQuestions: SETUP_QUESTIONS, courseDay: COURSE_DAY, cardPhoto: CARD_PHOTO } as const;
