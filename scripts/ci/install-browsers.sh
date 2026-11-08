#!/usr/bin/env bash
# Install the Playwright browsers a CI job drives, and the system libraries they need.
#
#   bash scripts/ci/install-browsers.sh chromium
#
# WHY THIS IS NOT ONE LINE. `playwright install --with-deps` runs apt, and apt takes the
# fonts and libraries from Ubuntu's Azure mirror, OUTSIDE the browser cache (so it runs even
# on a cache hit). On 2026-11-05 that mirror served each package at a crawl: in run
# 42131594077 (End-to-end desktop 3/3) every `Get:` of the 21.9 MB took about two minutes
# (fonts-ipafont-gothic 23:46:13 -> `Ign:` 23:48:25, fonts-wqy-zenhei 23:51:51 -> 23:54:48)
# until the step's ten-minute limit killed it, the shard handed in nothing and `verify`
# went red. Three times in two days. Nothing was wrong with the app.
#
# So: apt gives up on a stalled connection after 30 seconds and retries it (a stalled
# connection was the whole fault; waiting two minutes on each of nine packages was how ten
# minutes went), and the install is TWO attempts of four minutes each. A real hang still
# fails, in the same words, before any test runs: the step's own `timeout-minutes` stays the
# outer limit. Worst case: 2x(240+15) for the attempts + 20 s waiting for leftovers to die
# + 30 s for dpkg --configure + 5 s pause = 565 s, 9 min 25 s, under the ten-minute step.
#
# `timeout -k 15` sends KILL 15 s after TERM if npx ignores it, but it cannot reach apt, which
# Playwright runs as root under sudo: it outlives the timeout and holds the dpkg lock, which
# `DPkg::Lock::Timeout 120` (the conf file below; this script runs no apt of its own to pass
# `-o` to) could only wait on, for as long as the stalled download goes on. So the retry
# first kills it (clear_leftovers, below).
#
# round.yml carries its own three-attempt loop beside the packages job it uses; this is the
# same shape for every job that has no such job.
set -u

if [ "$#" -eq 0 ]; then
  echo "::error::install-browsers.sh needs the engines to install, e.g. chromium."
  exit 2
fi

# `|| true`: a runner without sudo or tee must still reach the install, not stop here.
printf 'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nDPkg::Lock::Timeout "120";\n' \
  | sudo tee /etc/apt/apt.conf.d/80-ci-browser-install >/dev/null || true

# What a timed-out attempt leaves behind: `timeout` ends npx, but the apt/dpkg Playwright
# started under sudo is root's and keeps running, holding the dpkg lock. On 2026-11-06 (runs
# 42307709158, 42308035657) the second attempt then died with "Unable to acquire the dpkg
# frontend lock" and exit 100. So before a retry: kill them, wait (at most 20 s) until none
# is left, and let dpkg finish any half-done configure (at most 30 s). The first letters are
# bracketed so the pattern does not match the sudo/pkill/pgrep command lines that carry it.
leftovers='\b([a]pt-get|[a]pt|[d]pkg)\b|[p]laywright.* [i]nstall'
clear_leftovers() {
  sudo pkill -KILL -f "$leftovers" || true
  for _ in $(seq 1 20); do
    pgrep -f "$leftovers" >/dev/null || break
    sleep 1
  done
  sudo timeout -k 5 30 dpkg --configure -a || true
}

attempts=2
for attempt in $(seq 1 "$attempts"); do
  if timeout -k 15 240 npx playwright install --with-deps "$@"; then
    exit 0
  fi
  # No pause after the last attempt: nothing follows it but the failure.
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::Installing the browser did not finish (attempt $attempt of $attempts); clearing what it left and trying again."
    clear_leftovers
    sleep 5
  fi
done

echo "::error::The browser could not be installed in $attempts attempts of four minutes (the package mirror is slow or down: a machine fault, re-run the job; do not edit the app)."
exit 1
