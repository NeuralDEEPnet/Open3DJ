import sys, time, json, statistics

T0 = time.perf_counter()


def hwm_rss():
    out = {}
    with open("/proc/self/status") as f:
        for line in f:
            if line.startswith(("VmHWM", "VmRSS")):
                k, v = line.split(":")
                out[k] = int(v.split()[0]) / 1024.0  # MB
    return out


from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
from OCP.BRepFilletAPI import BRepFilletAPI_MakeFillet
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS
from OCP.OCP.collections import List_TopoDS_Shape as TopTools_ListOfShape
from OCP.gp import gp_Trsf, gp_Vec
from OCP.GProp import GProp_GProps
from OCP.BRepGProp import BRepGProp
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCP.Interface import Interface_Static

T_IMPORT = time.perf_counter() - T0
MEM_IMPORT = hwm_rss()


def box(x, y, z):
    return BRepPrimAPI_MakeBox(x, y, z).Shape()


def cyl(r, h):
    return BRepPrimAPI_MakeCylinder(r, h).Shape()


def tr(s, dx, dy, dz):
    t = gp_Trsf()
    t.SetTranslation(gp_Vec(dx, dy, dz))
    return BRepBuilderAPI_Transform(s, t, True).Shape()


def vol(s):
    p = GProp_GProps()
    BRepGProp.VolumeProperties_s(s, p)
    return p.Mass()


def fuse(a, b):
    op = BRepAlgoAPI_Fuse(a, b)
    return op.Shape()


def cut_all(s, tools):
    args = TopTools_ListOfShape()
    args.Append(s)
    tl = TopTools_ListOfShape()
    for t in tools:
        tl.Append(t)
    op = BRepAlgoAPI_Cut()
    op.SetArguments(args)
    op.SetTools(tl)
    op.Build()
    return op.Shape()


def fuse_all(shapes):
    args = TopTools_ListOfShape()
    args.Append(shapes[0])
    tl = TopTools_ListOfShape()
    for t in shapes[1:]:
        tl.Append(t)
    op = BRepAlgoAPI_Fuse()
    op.SetArguments(args)
    op.SetTools(tl)
    op.Build()
    return op.Shape()


def fillet_all(s, r):
    mk = BRepFilletAPI_MakeFillet(s)
    ex = TopExp_Explorer(s, TopAbs_EDGE)
    while ex.More():
        mk.Add(r, TopoDS.Edge(ex.Current()))
        ex.Next()
    mk.Build()
    if not mk.IsDone():
        raise RuntimeError("fillet failed (IsDone false)")
    return mk.Shape()


def w_fuse_small():
    return fuse(box(10, 10, 10), tr(cyl(3, 20), 5, 5, -5))


def w_cut_grid():
    plate = box(200, 200, 10)
    holes = [tr(cyl(3, 20), 10 + 20 * i, 10 + 20 * j, -5) for i in range(10) for j in range(10)]
    return cut_all(plate, holes)


def w_fillet_box():
    return fillet_all(box(20, 20, 20), 2.0)


def bracket():
    plate = box(100, 60, 8)
    up = tr(box(100, 8, 50), 0, 0, 8)
    b = fuse(plate, up)
    holes = [tr(cyl(3, 30), x, y, -5) for x in (15, 85) for y in (25, 45)]
    return cut_all(b, holes)


def w_bracket_fillet():
    return fillet_all(bracket(), 1.0)


def w_fuse_many():
    boxes = [tr(box(10, 10, 10), 7 * i, 3 * (i % 4), 0) for i in range(40)]
    return fuse_all(boxes)


def w_mesh_step():
    s = w_cut_grid()
    BRepMesh_IncrementalMesh(s, 0.1, False, 0.5, False)
    w = STEPControl_Writer()
    Interface_Static.SetCVal_s("write.step.schema", "AP242DIS")
    w.Transfer(s, STEPControl_AsIs)
    w.Write("/dev/null")
    return s


WORK = [
    ("fuse_box_cyl", w_fuse_small),
    ("cut_grid_100_holes", w_cut_grid),
    ("fillet_box_12_edges", w_fillet_box),
    ("bracket_fillet_all_edges", w_bracket_fillet),
    ("fuse_40_boxes", w_fuse_many),
    ("cut_grid_mesh_step", w_mesh_step),
]

res = {"runtime": "native OCP 8.0.1.1.0 (CPython %s)" % sys.version.split()[0],
       "import_s": round(T_IMPORT, 3), "mem_after_import_MB": MEM_IMPORT, "work": {}}
for name, fn in WORK:
    try:
        s = fn(); s = fn()  # warmup
    except RuntimeError as e:
        res["work"][name] = {"error": str(e)}
        continue
    ts = []
    for _ in range(7):
        t = time.perf_counter(); s = fn(); ts.append((time.perf_counter() - t) * 1000)
    res["work"][name] = {"median_ms": round(statistics.median(ts), 2), "volume": round(vol(s), 3)}
res["mem_after_suite_MB"] = hwm_rss()

# growth check: 1000 small fuses
before = hwm_rss()["VmRSS"]
t = time.perf_counter()
for i in range(1000):
    s = w_fuse_small()
res["fuse_x1000_s"] = round(time.perf_counter() - t, 2)
res["rss_growth_1000_fuses_MB"] = round(hwm_rss()["VmRSS"] - before, 1)
res["mem_final_MB"] = hwm_rss()
print(json.dumps(res, indent=1))
