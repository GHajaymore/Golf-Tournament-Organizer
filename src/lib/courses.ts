// Course presets for the scorecard generator. In production these would live in
// a Courses table; for the pilot they are a static catalog of realistic layouts.

export interface CoursePreset {
  name: string;
  city: string;
  address: string;
  /** Par per hole, 18 entries (front nine 0-8, back nine 9-17). */
  pars: number[];
  /** Yardage per hole, 18 entries. */
  yards: number[];
  /** Stroke index per hole, 18 entries — 1 = hardest hole, 18 = easiest. Drives the "toughest N holes" tiebreakers. */
  strokeIndex: number[];
}

export const COURSES: CoursePreset[] = [
  {
    name: "Ridgeline National",
    city: "Aspen Falls",
    address: "1 Ridgeline Drive, Aspen Falls",
    pars: [4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4],
    yards: [412, 538, 401, 178, 445, 420, 561, 165, 398, 430, 189, 552, 408, 436, 205, 415, 545, 389],
    strokeIndex: [5, 15, 3, 17, 1, 7, 9, 13, 11, 6, 18, 2, 8, 4, 16, 10, 12, 14],
  },
  {
    name: "Cedar Hollow Links",
    city: "Millbrook",
    address: "88 Cedar Hollow Road, Millbrook",
    pars: [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 4, 5, 4, 3, 4, 5],
    yards: [398, 421, 168, 512, 434, 405, 182, 528, 411, 388, 419, 155, 442, 505, 428, 191, 401, 534],
    strokeIndex: [3, 9, 17, 1, 11, 5, 15, 7, 13, 4, 14, 2, 18, 6, 10, 16, 8, 12],
  },
  {
    name: "Blackpine Dunes",
    city: "Harbor Point",
    address: "500 Dunes Parkway, Harbor Point",
    pars: [4, 3, 5, 4, 4, 4, 3, 4, 5, 4, 5, 4, 3, 4, 4, 5, 3, 4],
    yards: [421, 175, 545, 402, 438, 410, 162, 425, 520, 399, 551, 431, 198, 415, 407, 538, 171, 412],
    strokeIndex: [7, 1, 13, 5, 15, 3, 17, 9, 11, 2, 16, 8, 18, 4, 12, 6, 14, 10],
  },
  {
    name: "Willow Creek CC",
    city: "Fairhaven",
    address: "22 Willow Creek Lane, Fairhaven",
    pars: [4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5],
    yards: [405, 418, 396, 185, 522, 428, 412, 168, 508, 401, 178, 435, 531, 409, 421, 192, 398, 519],
    strokeIndex: [9, 5, 15, 3, 1, 11, 7, 17, 13, 8, 12, 4, 2, 14, 18, 10, 16, 6],
  },
];

export function findCourse(name: string): CoursePreset {
  return COURSES.find((c) => c.name === name) ?? COURSES[0];
}
