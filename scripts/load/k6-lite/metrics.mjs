/** `k6/metrics`: Trend, Rate, Counter. See ../k6-lite.mjs. */
const rt = () => globalThis.__k6lite;

export class Trend {
  constructor(name) {
    this.name = name;
  }
  add(value) {
    rt().record(this.name, "trend", Number(value));
  }
}

export class Rate {
  constructor(name) {
    this.name = name;
  }
  add(value) {
    rt().record(this.name, "rate", Boolean(value));
  }
}

export class Counter {
  constructor(name) {
    this.name = name;
  }
  add(value) {
    rt().record(this.name, "counter", Number(value));
  }
}
