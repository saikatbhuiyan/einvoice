#!/usr/bin/env bash
# Runs a k6 script from inside the dev stack's network, so it reaches bff by service name and
# needs no local k6 install. Usage: load-tests/run.sh [script]  (default: bff-read-path.js)
set -euo pipefail
cd "$(dirname "$0")"
SCRIPT="${1:-bff-read-path.js}"
exec docker run --rm --network einvoice-dev_edge -v "$PWD/k6:/scripts:ro" grafana/k6:2.3.0 run "/scripts/$SCRIPT"
