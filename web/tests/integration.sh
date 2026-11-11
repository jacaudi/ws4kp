#!/bin/sh
# Serve the production build with the Go binary and run the Puppeteer integration test
# (web/tests/index.mjs) against it. Run from the repo root after `npm --prefix web run build`;
# `task integration` does both, and installs this package's dependencies first.
#
# index.mjs separates our failures from upstream's by exit code: 0 clean, 1 a real regression,
# 75 upstream-only (api.weather.gov / Open-Meteo was failing). Without that split an NWS outage
# failed CI, and because every later stage needed it, a third party's availability gated the
# whole pipeline. 75 becomes a warning and exit 0 here; STRICT_INTEGRATION=1 (the nightly run)
# makes index.mjs exit 1 instead, so sustained breakage still surfaces.
#
# POSIX sh, not a Task command: Task's built-in shell gives $! a job id, not a PID, so the
# server could not be checked or killed by it.
set -eu

port="${WS4KP_PORT:-8080}"
tmp="${TMPDIR:-/tmp}"
bin="${tmp%/}/ws4kp-integration"
log="${tmp%/}/ws4kp-integration.log"

# Something already answering would be tested in place of this build.
if curl -s -o /dev/null "http://localhost:${port}/"; then
	echo "::error::something already answers on :${port}; set WS4KP_PORT to a free port"
	exit 1
fi

# A built binary, not `go run`: $! is then the server itself, so the kill below reaches it.
# The binary embeds web/dist/, which is why the site is built first.
go build -o "${bin}" ./cmd/ws4kp
WS4KP_PORT="${port}" "${bin}" >"${log}" 2>&1 &
pid=$!
trap 'kill "${pid}" 2>/dev/null || true' EXIT

i=0
until curl -sf "http://localhost:${port}/" >/dev/null; do
	kill -0 "${pid}" 2>/dev/null || { echo "::error::the server exited before answering; its log:"; cat "${log}"; exit 1; }
	i=$((i + 1))
	[ "${i}" -lt 45 ] || { echo "::error::TIMEOUT: nothing answered on :${port} within 90 s; the server log:"; cat "${log}"; exit 1; }
	sleep 2
done

status=0
WS4KP_TEST_URL="http://localhost:${port}" node web/tests/index.mjs || status=$?
if [ "${status}" = "75" ]; then
	echo "::warning title=Integration test inconclusive::Upstream (api.weather.gov / Open-Meteo) was failing, so the integration test could not run to completion. This is NOT a regression in this change. The nightly run re-checks with STRICT_INTEGRATION=1."
	if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
		echo "Integration test inconclusive: upstream was failing. Not treated as a regression." >>"${GITHUB_STEP_SUMMARY}"
	fi
	exit 0
fi
exit "${status}"
