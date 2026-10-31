#!/bin/bash
# Reproduce the endurance / memory / determinism spike. usage: run_all.sh <spike dir>
# Expects <spike dir>/deps to hold occt-wasm 5.8.1 installed with --ignore-scripts.
set -u
S=$1; D=$S/deps; O=$S/out; cd "$S/src"; mkdir -p "$O/det"
# (1) endurance: 5000 rebuilds x 3 strategies (run in parallel), then long runs
for st in none release checkpoint; do timeout 3000 node endurance.mjs $D $st 5000 $O/endurance-$st.json 250 2> $O/endurance-$st.log & done; wait
timeout 5400 node endurance.mjs $D checkpoint 20000 $O/long-checkpoint.json 1000 2> $O/long-checkpoint.log
timeout 1500 node ceiling_probe.mjs $D 3900 60000 noeval > $O/ceiling_probe.json 2> $O/ceiling_probe.log
timeout 1500 node ceiling_probe.mjs $D 3950 60000 eval > $O/ceiling_probe_eval.json 2> $O/ceiling_probe_eval.log
timeout 900 node --expose-gc recycle.mjs $D 1500 > $O/recycle.json 2> $O/recycle.log
# (2) determinism
./run_det.sh $S
python3 -I compare_det.py $O/det > $O/det/compare.md
timeout 600 node fresh_instance.mjs $D > $O/fresh_instance.txt
timeout 300 node stepdiff.mjs $D $O; timeout 300 node stepdiff2.mjs $D
# (3) init, warm-up, instance churn, 200-part fuseAll peak (one process per case)
timeout 1200 node initbench.mjs $D $O/initbench.json 7
for fl in "" "--no-wasm-tier-up" "--no-liftoff" "--no-wasm-lazy-compilation"; do for r in 1 2 3; do timeout 300 node $fl warmup_curve.mjs $D; done; done > $O/warmup_curve.jsonl
timeout 600 node --expose-gc instance_churn.mjs $D 40 > $O/instance_churn_gc.json
for c in boxes cyls parts; do timeout 900 node fuseall_peak.mjs $D $c 200; done > $O/fuseall_peak.jsonl
