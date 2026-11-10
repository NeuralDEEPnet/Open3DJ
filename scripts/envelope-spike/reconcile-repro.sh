#!/usr/bin/env bash
# Certified Envelopes spike, reconciliation: the minimal reproducer of every design defect the
# spike found in the gallery examples, through the product CLI only (no spike code), one process
# at a time. It runs on copies of the examples in a scratch folder, because the CLI writes a
# project folder next to each script. Two copies are edited on purpose to test a cause:
# knob-short-flute (flutes 1 mm shorter) and bracket-r09 (0.9 mm edge fillet instead of 1 mm).
#
#   bash scripts/envelope-spike/reconcile-repro.sh [scratch-dir] > scripts/envelope-spike/results/reconcile/repro.txt
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${1:-$(mktemp -d)}"
mkdir -p "$DIR"
for e in flange box-with-lid bracket knob tapered-cup vented-box; do cp "$ROOT/examples/$e/$e.o3j.js" "$DIR/"; done
sed 's/cylinder(H - 6, 1.6)/cylinder(H - 7, 1.6)/' "$DIR/knob.o3j.js" > "$DIR/knob-short-flute.o3j.js"
sed 's/return fillet(body, 1,/return fillet(body, 0.9,/' "$DIR/bracket.o3j.js" > "$DIR/bracket-r09.o3j.js"
CLI="$ROOT/packages/open3dj/src/cli.ts"
cd "$DIR"
run() { echo "### run $*"; node "$CLI" run "$@" --no-save-params --detailed 2>&1 | grep -E "^(ok|error|warning |  [a-z_]+ +valid|  [a-z_]+ +invalid|  clearance|  clash|  contact|  op:|  elements:)" || true; }
counts() { echo "### counts $*"; node "$CLI" run "$@" --no-save-params --detailed --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const m=(s.match(/"(solids|faces|edges)": *[0-9]+/g)||[]).map((x)=>x.replace(/[" ]/g,""));console.log("  "+m.slice(0,3).join(" "));})'; }
gates() { echo "### gates $*"; node "$CLI" inspect "$@" --fields gates --gates fdm.v1 --build 0,0,1 --no-save-params 2>&1 | grep -E "^gates|thinnest|FAIL min_wall" || true; }
node --version
gates flange.o3j.js
run flange.o3j.js --param Diameter=52
gates flange.o3j.js --param Diameter=52
gates flange.o3j.js --param Diameter=56
run box-with-lid.o3j.js --param Clearance=0.25
run box-with-lid.o3j.js --param Clearance=0
run box-with-lid.o3j.js --param Clearance=0.6
run box-with-lid.o3j.js --param Clearance=-0.3
run bracket.o3j.js --param Thickness=2
run bracket.o3j.js --param Thickness=2.125
run bracket-r09.o3j.js --param Thickness=2
counts bracket.o3j.js
counts bracket.o3j.js --param Width=100 --param Leg=20 --param Thickness=10 --param Screw=M5
counts bracket.o3j.js --param Width=100 --param Leg=21 --param Thickness=10 --param Screw=M5
gates bracket.o3j.js --param Width=24 --param Leg=80 --param Thickness=10 --param Screw=M5
gates knob.o3j.js
gates knob-short-flute.o3j.js
run knob.o3j.js --param Height=12
run knob.o3j.js --param Height=12.25
gates tapered-cup.o3j.js
gates tapered-cup.o3j.js --param Height=120 --param Wall=1.2
gates tapered-cup.o3j.js --param Height=70 --param Wall=1.35
gates tapered-cup.o3j.js --param Height=70 --param Wall=1.45
gates vented-box.o3j.js
gates vented-box.o3j.js --param Height=32
counts vented-box.o3j.js
counts vented-box.o3j.js --param Height=25
gates vented-box.o3j.js --param Width=66.4
counts vented-box.o3j.js --param Width=66.4
