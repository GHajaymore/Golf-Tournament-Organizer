/**
 * No unit test may hold the real GolfCourseAPI key (50 free searches a day, for the whole app).
 *
 * Set to an EMPTY string, not deleted: `dotenv/config` never overrides a variable that already
 * exists, but it WOULD put a deleted one back from `.env` the moment a test file imports it.
 * `golfcourseapi-live.ts` reads an empty key as "no key": silent, no request. A test that wants
 * the lookup sets a placeholder key itself and stubs `fetch`.
 */
process.env.GOLFCOURSE_API_KEY = "";
