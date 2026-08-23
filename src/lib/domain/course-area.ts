/**
 * Searching for a course by WHERE IT IS, not only by what it is called.
 *
 * A society deciding where to play next month thinks in places — "somewhere
 * near Cincinnati", "anywhere in Ohio" — and the search matched a course's
 * name and city only. So "Ohio" found nothing at all, because the catalogue
 * stores a two-letter code, and "Cincinnati, OH" found nothing either,
 * because the comma made it one string that matched no city on earth.
 *
 * This turns what somebody typed into the parts a query can use. It is
 * deliberately generous: anything it cannot read as a place stays as free
 * text and is matched against the name, so adding this never takes a result
 * away.
 */

/**
 * US states by name, to the code the catalogue stores.
 *
 * People type "Ohio". The directory says "OH". Without this the whole state
 * half of the search is unreachable for anybody who does not think in postal
 * codes — which is most people, about their own state, most of the time.
 */
const STATE_CODES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "puerto rico": "PR",
};

const CODES = new Set(Object.values(STATE_CODES));

/** The parts of a search, once the place has been read out of it. */
export interface AreaQuery {
  /** What is left to match against a course name. May be empty. */
  text: string;
  /** A town, when the query named one. */
  city: string;
  /** A two-letter state code, when the query named a state. */
  state: string;
}

const tidy = (s: string): string => s.trim().replace(/\s+/g, " ");

/** "Ohio" or "OH" → "OH". Empty when it is neither. */
export function stateCodeOf(word: string): string {
  const w = tidy(word).toLowerCase();
  if (!w) return "";
  if (STATE_CODES[w]) return STATE_CODES[w];
  const upper = w.toUpperCase();
  return CODES.has(upper) ? upper : "";
}

/**
 * Read a place out of what somebody typed.
 *
 * Three shapes, and everything else is left alone:
 *
 *   "Cincinnati, OH"  → city and state, which is how an address is written
 *   "Ohio" / "OH"     → a state on its own
 *   "Green Crest"     → not a place; stays as text
 *
 * A comma is treated as the city/state separator because that is what a
 * person writing an address means by it. Without the comma, "Cincinnati OH"
 * still works: the trailing word is checked for a state and split off.
 *
 * Text is never DISCARDED in favour of a place — "Cincinnati, OH" leaves the
 * city in `city` and nothing in `text`, but "Crest Ohio" keeps "Crest" as
 * text and takes "Ohio" as the state, so the name half of the search still
 * has something to work with.
 */
export function parseAreaQuery(query: string): AreaQuery {
  const q = tidy(query);
  if (!q) return { text: "", city: "", state: "" };

  // "City, ST" — the comma says which half is which, so trust it.
  const comma = q.indexOf(",");
  if (comma > 0) {
    const left = tidy(q.slice(0, comma));
    const right = tidy(q.slice(comma + 1));
    const state = stateCodeOf(right);
    // A comma with something unreadable after it is not an address; the whole
    // string stays as text rather than half of it being thrown away.
    if (state) return { text: "", city: left, state };
    return { text: q, city: "", state: "" };
  }

  // The whole query is a state.
  const whole = stateCodeOf(q);
  if (whole) return { text: "", city: "", state: whole };

  // A trailing state, with the rest left as text: "Crest Ohio", "Cincinnati OH".
  const words = q.split(" ");
  if (words.length > 1) {
    // Two-word states ("New York", "Rhode Island") need the last two words
    // tried before the last one, or "New York" reads as "York".
    for (const take of [2, 1]) {
      if (words.length <= take) continue;
      const tail = stateCodeOf(words.slice(-take).join(" "));
      if (tail) return { text: tidy(words.slice(0, -take).join(" ")), city: "", state: tail };
    }
  }

  return { text: q, city: "", state: "" };
}
