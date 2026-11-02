/** `k6`: check, sleep, fail, group. See ../k6-lite.mjs. */
const rt = () => globalThis.__k6lite;

export function check(value, sets) {
  let all = true;
  for (const [, fn] of Object.entries(sets)) {
    let pass = false;
    try {
      pass = Boolean(typeof fn === "function" ? fn(value) : fn);
    } catch {
      pass = false;
    }
    rt().record("checks", "rate", pass);
    all = all && pass;
  }
  return all;
}

export function sleep(seconds) {
  rt().sleep(seconds);
}

export function fail(message) {
  throw new Error(message);
}

export function group(_name, fn) {
  return fn();
}
