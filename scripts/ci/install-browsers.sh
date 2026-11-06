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
# outer limit (two attempts of 240 s, each given 15 s more to die, and one 15 s pause: 2x(240+15)+15 = 525 s, 8 min 45 s).
#
# `timeout -k 15` sends KILL 15 s after TERM if npx ignores it, but it cannot reach apt, which
# Playwright runs as root under sudo: a first attempt's apt may outlive its timeout and still
# hold the dpkg lock when the second begins. That is what `DPkg::Lock::Timeout 120`, set in the
# conf file below (which every apt run reads; this script runs no apt of its own to pass `-o`
# to), waits out.
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

attempts=2
for attempt in $(seq 1 "$attempts"); do
  if timeout -k 15 240 npx playwright install --with-deps "$@"; then
    exit 0
  fi
  # No pause after the last attempt: nothing follows it but the failure.
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::Installing the browser did not finish (attempt $attempt of $attempts); trying again."
    sleep 15
  fi
done

echo "::error::The browser could not be installed in $attempts attempts of four minutes (the package mirror is slow or down: a machine fault, re-run the job; do not edit the app)."
exit 1
