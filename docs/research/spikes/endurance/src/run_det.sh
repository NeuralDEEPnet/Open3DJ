#!/bin/bash
# usage: run_det.sh <spike dir>
S=$1; cd $S/src
for p in 1 2 3 4 5; do timeout 900 node determinism.mjs $S/deps $S/out/det/xproc-$p.json 2 none 2>>$S/out/det/run.log; done
for mode in none keep junk; do timeout 3000 node determinism.mjs $S/deps $S/out/det/inproc-$mode.json 20 $mode 2>>$S/out/det/run.log & done
wait
echo ALLDONE >> $S/out/det/run.log
