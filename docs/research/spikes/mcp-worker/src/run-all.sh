#!/usr/bin/env bash
# Reproduce the MCP server + kernel worker spike. Usage: bash run-all.sh <spike-dir>
set -euo pipefail
S=${1:?spike dir}; D=$S/deps; O=$S/out; cd "$S/src"; mkdir -p "$O"
timeout 120 node probe-print.mjs "$D" capture  > "$O/probe-capture.stdout" 2> "$O/probe-capture.stderr"
timeout 120 node probe-print.mjs "$D" default  > "$O/probe-default.stdout" 2> "$O/probe-default.stderr"
timeout 600 node leak-test.mjs "$D" "$O" > "$O/leak-summary.json" 2> "$O/leak-test.stderr"
for cfg in "child 0 0" "thread 0 0" "inproc 0 0" "child 1 1" "thread 1 1"; do for r in 1 2 3; do timeout 180 node stress-splice.mjs "$D" "$O" $cfg 40; done; done > "$O/splice-results.jsonl"
{ timeout 500 node bench-client.mjs "$D" "$O" thread 7 1 1 1; timeout 500 node bench-client.mjs "$D" "$O" child 7 1 1 1
  timeout 400 node bench-client.mjs "$D" "$O" inproc 5 1 0 1; timeout 200 node bench-client.mjs "$D" "$O" thread 1 0 0 0; } > "$O/bench-all.jsonl" 2> "$O/bench-all.stderr"
timeout 400 node overhead.mjs "$D" "$O" 3 2> "$O/overhead.stderr"
timeout 300 node proto-test.mjs "$D" "$O" > "$O/proto-stdout.json" 2> "$O/proto.stderr"
timeout 500 node v2-test.mjs "$D" "$S/deps-v2" "$O" 2> "$O/v2-test.stderr"
timeout 400 node kill-test.mjs "$D" "$O" 2> "$O/kill.stderr"
timeout 120 node path-test.mjs "$D" "$O" > "$O/path-stdout.jsonl"
timeout 120 node render-sample.mjs "$D" "$O"
