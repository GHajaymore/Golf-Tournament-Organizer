/** `k6/execution`: which iteration and which virtual user this is. See ../k6-lite.mjs. */
export default {
  get scenario() {
    return globalThis.__k6lite.exec.scenario;
  },
  get vu() {
    return globalThis.__k6lite.exec.vu;
  },
};
