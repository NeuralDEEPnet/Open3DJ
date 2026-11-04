"""Compare determinism fingerprints. usage: python3 -I compare_det.py <det dir>"""
import json, sys, glob, os
from collections import defaultdict

d = sys.argv[1]
groups = {}
xp = sorted(glob.glob(os.path.join(d, "xproc-*.json")))
xruns = [json.load(open(f)) for f in xp]
groups["xproc_fresh(5)"] = [r["runs"][0] for r in xruns]
groups["xproc_2nd(5)"] = [r["runs"][1] for r in xruns if len(r["runs"]) > 1]
for mode in ["none", "keep", "junk"]:
    f = os.path.join(d, f"inproc-{mode}.json")
    if os.path.exists(f):
        groups[f"inproc_{mode}(20)"] = json.load(open(f))["runs"]
allruns = [r for g in groups.values() for r in g]
groups[f"ALL({len(allruns)})"] = allruns

FIELDS = ["error", "valid", "volume_bits", "area_bits", "bbox_bits", "counts", "faceHashes_ordered", "faceHashes_sorted",
          "edgeHashes_ordered", "faceGeom_sorted", "faceGeom_ordered", "step_raw", "step_norm", "mesh_pos", "mesh_nrm", "mesh_idx", "stl"]
cases = list(allruns[0]["cases"].keys())
summary = {}
for case in cases:
    summary[case] = {}
    for gname, runs in groups.items():
        row = {}
        for fld in FIELDS:
            vals = [json.dumps(r["cases"][case].get(fld)) for r in runs]
            row[fld] = len(set(vals))
        vols = [r["cases"][case].get("volume") for r in runs if r["cases"][case].get("volume") is not None]
        row["vol_spread"] = (max(vols) - min(vols)) if vols else None
        row["vol_rel_spread"] = ((max(vols) - min(vols)) / abs(vols[0])) if vols else None
        summary[case][gname] = row

def show(case):
    print(f"\n### {case}")
    gnames = list(groups.keys())
    print("| field | " + " | ".join(gnames) + " |")
    print("|---|" + "---|" * len(gnames))
    for fld in FIELDS + ["vol_rel_spread"]:
        vals = []
        for g in gnames:
            v = summary[case][g][fld]
            vals.append(f"{v:.1e}" if isinstance(v, float) else str(v))
        print(f"| {fld} | " + " | ".join(vals) + " |")

for c in cases:
    show(c)
# order sensitivity (from the first fresh run)
r0 = groups["xproc_fresh(5)"][0]["cases"]
print("\n### order sensitivity (fresh run 1)")
for c in cases:
    cc = r0[c]
    print(c, cc.get("error") or "", cc.get("valid"), repr(cc.get("volume")), cc.get("counts"), cc.get("faceGeom_sorted"), cc.get("ms"))
json.dump(summary, open(os.path.join(d, "summary.json"), "w"), indent=1)
