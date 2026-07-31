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
}

export const COURSES: CoursePreset[] = [
  {
    name: "Ridgeline National",
    city: "Aspen Falls",
    address: "1 Ridgeline Drive, Aspen Falls",
    pars: [4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4],
    yards: [412, 538, 401, 178, 445, 420, 561, 165, 398, 430, 189, 552, 408, 436, 205, 415, 545, 389],
  },
  {
    name: "Cedar Hollow Links",
    city: "Millbrook",
    address: "88 Cedar Hollow Road, Millbrook",
    pars: [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 4, 5, 4, 3, 4, 5],
    yards: [398, 421, 168, 512, 434, 405, 182, 528, 411, 388, 419, 155, 442, 505, 428, 191, 401, 534],
  },
  {
    name: "Blackpine Dunes",
    city: "Harbor Point",
    address: "500 Dunes Parkway, Harbor Point",
    pars: [4, 3, 5, 4, 4, 4, 3, 4, 5, 4, 5, 4, 3, 4, 4, 5, 3, 4],
    yards: [421, 175, 545, 402, 438, 410, 162, 425, 520, 399, 551, 431, 198, 415, 407, 538, 171, 412],
  },
  {
    name: "Willow Creek CC",
    city: "Fairhaven",
    address: "22 Willow Creek Lane, Fairhaven",
    pars: [4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5],
    yards: [405, 418, 396, 185, 522, 428, 412, 168, 508, 401, 178, 435, 531, 409, 421, 192, 398, 519],
  },
];

export function findCourse(name: string): CoursePreset {
  return COURSES.find((c) => c.name === name) ?? COURSES[0];
}
