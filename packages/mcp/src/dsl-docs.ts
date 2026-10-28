// Generates docs/DSL.md from DSL_ENTRIES (@open3dj/dsl), the examples below and the error
// playbook. The docs tool searches that file, and dsl-docs.test.ts checks that the file is
// up to date and that every example runs.
//
//   node packages/mcp/src/dsl-docs.ts --write    regenerate docs/DSL.md
//   node packages/mcp/src/dsl-docs.ts --check    exit 1 when docs/DSL.md is stale
//
// This module imports @open3dj/dsl for its entry table only; the daemon never imports it.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DSL_ENTRIES } from "@open3dj/dsl";
import type { DslEntry } from "@open3dj/dsl";
import { DEFAULT_DOCS_FILE } from "./docs.ts";

/** One runnable script per S1 entry. Each returns a shape or parts. */
export const ENTRY_EXAMPLES: Readonly<Record<string, string>> = {
  "Param.number": `const width = Param.number("Width", 40, { min: 20, max: 120, unit: "mm" });
return box(width, 20, 5);`,
  "Param.bool": `const holes = Param.bool("Holes", true);
const plate = box(40, 20, 5);
return holes ? plate.subtract(cylinder(7, 3).translate(0, 0, -1)) : plate;`,
  "Param.choice": `const size = Param.choice("Size", "M4", ["M3", "M4", "M5"]);
return box(30, 30, 6).subtract(lib.clearanceHole(size, { length: 7 }).translateZ(6));`,
  "Param.string": `const label = Param.string("Label", "A", { maxLength: 8 });
return box(10, 10, label.length + 2);`,
  box: "return box(40, 20, 10); // x from -20 to 20, y from -10 to 10, z from 0 to 10",
  cylinder: "return cylinder(30, 8).add(cylinder(10, 12, 8).translateZ(30)); // a post with a cone on top",
  sphere: "return sphere(10).cutPlane(\"XY\", 0, \"positive\"); // a dome",
  torus: "return torus(20, 3);",
  rect: "return rect(30, 20).extrude(4);",
  roundedRect: "return roundedRect(60, 40, 6).extrude(3);",
  circle2d: "return circle2d(10).extrude(2);",
  ellipse: "return ellipse(12, 6).extrude(3);",
  ngon: "return ngon(6, 10).extrude(5).subtract(cylinder(7, 3).translate(0, 0, -1)); // a hex nut blank",
  star: "return star(5, 20, 8).extrude(3);",
  slot: "return box(50, 20, 4).subtract(slot(30, 6).extrude(6).translateZ(-1));",
  polygon: "return polygon([[0, 0], [40, 0], [40, 5], [5, 30], [0, 30]]).extrude(8);",
  path: `const profile = path().moveTo(0, 0).lineH(30).lineV(10).arcTo(20, 20, 10).lineTo(0, 20).close();
return profile.extrude(5);`,
  "sketch.extrude": "return ngon(6, 15).extrude(40, { twist: 60, scaleTop: 0.6 });",
  "sketch.revolve": "return rect(4, 10).translate(12, 5).revolve(); // a ring, inner radius 10, outer 14",
  "sketch.loftTo": "return rect(30, 30).loftTo(circle2d(8), 25);",
  loft: "return loft([rect(30, 30), circle2d(12), rect(10, 10)], [0, 15, 30]);",
  "sketch.offset": "return roundedRect(40, 20, 4).offset(2).extrude(3);",
  "sketch.filletCorners": "return rect(40, 20).filletCorners(5).extrude(3);",
  "sketch.chamferCorners": "return rect(40, 20).chamferCorners(3).extrude(3);",
  "sketch.transform": "return rect(10, 4).translate(10, 0).rotate(45).extrude(2);",
  "sketch.boolean": "return rect(40, 20).subtract(circle2d(5).translate(10, 0)).extrude(3);",
  "sketch.measure": `const s = roundedRect(40, 20, 4);
console.log(s.area(), JSON.stringify(s.bounds()));
return s.extrude(1);`,
  add: "return box(40, 10, 5).add(box(10, 40, 5), cylinder(10, 4)); // one fused solid",
  subtract: "const holes = [-12, 0, 12].map((x) => cylinder(7, 2).translate(x, 0, -1));\nreturn box(40, 10, 5).subtract(holes);",
  intersect: "return box(20, 20, 20).intersect(sphere(13));",
  cutPlane: "return sphere(10).cutPlane(\"XY\", 2, \"negative\"); // keep z below 2",
  translate: "return box(10, 10, 10).translate(20, 0, 0).translateZ(5);",
  rotate: "return box(30, 4, 4).rotate([0, 0, 1], 45).rotateX(10);",
  scale: "return sphere(5).scale(2);",
  mirror: "return box(10, 10, 10).translate(15, 0, 0).mirror([1, 0, 0]); // now at x = -15",
  pointAlong: "return cylinder(30, 2).pointAlong([1, 0, 0]); // the axis now runs along X",
  moveTo: "return box(10, 10, 10).moveTo(0, 0, 0); // min corner at the origin",
  clone: `const leg = cylinder(30, 3);
return [
  { name: "Leg 1", shape: leg.clone().translate(-20, -20, 0) },
  { name: "Leg 2", shape: leg.clone().translate(20, -20, 0) },
  { name: "Leg 3", shape: leg.clone().translate(0, 20, 0) },
];`,
  fillet: "return fillet(box(40, 30, 10), 2, { atZ: 10 }); // round the four top edges",
  chamfer: "return chamfer(box(40, 30, 10), 1, { parallel: [0, 0, 1] }); // break the vertical edges",
  shell: "return roundedRect(60, 40, 5).extrude(25).shell(2); // open-top tray, 2 mm walls inside the skin",
  edges: `console.log(JSON.stringify(box(20, 20, 10).edges({ atZ: 10 }).map((e) => e.length)));
return box(20, 20, 10);`,
  linearPattern: "return box(44, 8, 2).add(linearPattern(cylinder(8, 2).translate(-16, 0, 0), 5, 8, 0)); // five pins, 8 mm apart, on a strip",
  circularPattern: "return box(40, 40, 3).subtract(circularPattern(cylinder(5, 2).translate(14, 0, -1), 6));",
  mirrorCopy: "return box(20, 10, 5).add(mirrorCopy(box(10, 10, 5).translate(15, 0, 0), [1, 0, 0])); // a 40 mm bar built from one half",
  measure: `const part = box(20, 10, 5);
console.log(part.volume(), part.area(), JSON.stringify(part.bounds().size), JSON.stringify(part.geometryInfo()));
return part;`,
  color: "return box(20, 20, 5).color(\"#00d4ff\");",
  name: "return box(20, 20, 5).name(\"Base plate\");",
  withReferences: `const plate = box(40, 20, 5).withReferences({ hole: [10, 0, 5] }).translate(0, 0, 10);
const [x, y, z] = plate.referencePoint("hole");
const drilled = plate.subtract(cylinder(10, 2).translate(x, y, z - 7));
// Name a face and an edge on the final shape: refs[] in the report says whether later runs still find them.
return drilled.withReferences({ top: { face: { normal: [0, 0, 1], atZ: 15 } }, bore: { face: { surface: "cylinder" } }, front_top: { edge: { parallel: [1, 0, 0], atY: -10, atZ: 15 } } });`,
  attachTo: `const base = box(40, 40, 10);
const knob = cylinder(8, 6).attachTo(base, "top", "bottom");
return [{ name: "Base", shape: base }, { name: "Knob", shape: knob }];`,
  connector: `const seat = connector.female("seat", { origin: [0, 0, 5], axis: [0, 0, 1], up: [1, 0, 0] });
return box(20, 20, 5).withConnectors({ seat });`,
  withConnectors: `const plate = box(30, 30, 4).withConnectors({
  top: connector.female("seat", { origin: [0, 0, 4], axis: [0, 0, 1], up: [1, 0, 0] }),
});
return plate;`,
  matchTo: `const base = box(30, 30, 4).withConnectors({ top: connector.female("seat", { origin: [0, 0, 4], axis: [0, 0, 1], up: [1, 0, 0] }) });
const post = cylinder(20, 3).withConnectors({ foot: connector.male("seat", { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] }) });
return [{ name: "Base", shape: base }, { name: "Post", shape: post.matchTo(base, "foot", "top") }];`,
  "lib.fastener": `const f = lib.fastener("M4");
console.log(JSON.stringify(f));
return box(20, 20, 5);`,
  "lib.clearanceHole": "return box(30, 30, 6).subtract(lib.clearanceHole(\"M4\", { length: 7 }).translateZ(6));",
  "lib.screwCutter": "return box(30, 30, 8).subtract(lib.screwCutter(\"M3\", { head: \"countersunk\", length: 10 }).translateZ(8));",
  "lib.heatSetPocket": "return cylinder(12, 5).subtract(lib.heatSetPocket(\"M3\").translateZ(12));",
  "lib.hexNutPocket": "return box(20, 20, 8).subtract(lib.hexNutPocket(\"M4\", { depth: 4 }).translateZ(8));",
  "lib.bolt": "return lib.bolt(\"M5\", 20); // head above z = 0, shank below",
  "lib.nut": "return lib.nut(\"M5\");",
  "lib.washer": "return lib.washer(\"M5\");",
};

export interface DocExample {
  title: string;
  intro: string;
  script: string;
}

/** Complete scripts for the Examples section. Written for Open3DJ; each one runs. */
export const EXAMPLES: readonly DocExample[] = [
  {
    title: "Bracket with holes and rounded edges",
    intro: "One part with parameters, a batched cut and a fillet chosen by an edge query.",
    script: `const width = Param.number("Width", 60, { min: 30, max: 120, unit: "mm" });
const thick = Param.number("Thickness", 5, { min: 3, max: 12, unit: "mm" });
const size = Param.choice("Screw", "M4", ["M3", "M4", "M5"]);

const foot = box(width, 30, thick);
const wall = box(width, thick, 40).translate(0, 15 - thick / 2, 0);
const holes = [-1, 1].map((s) => lib.clearanceHole(size, { length: thick + 1 }).translate(s * (width / 2 - 10), -3, thick));
const bracket = foot.add(wall).subtract(holes);
return fillet(bracket, 1, { parallel: [1, 0, 0], minLength: width - 1 }).name("Bracket").color("#5b6b7a");`,
  },
  {
    title: "Enclosure with a lid and four screws",
    intro: "Several parts in one assembly. The screws are clones, so they share one definition, and the lid is seated on the rim with connectors and matchTo.",
    script: `const W = 80, D = 60, H = 30, wall = 2.4, lidT = 4;
const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy]) => [sx * (W / 2 - 7), sy * (D / 2 - 7)]);

const cavity = roundedRect(W - 2 * wall, D - 2 * wall, 2).extrude(H).translateZ(wall);
const bosses = corners.map(([x, y]) => cylinder(H - wall, 4.5).translate(x, y, wall));
const pockets = corners.map(([x, y]) => lib.heatSetPocket("M3").translate(x, y, H));
const body = roundedRect(W, D, 4).extrude(H).subtract(cavity).add(bosses).subtract(pockets)
  .withConnectors({ rim: connector.female("seat", { origin: [0, 0, H], axis: [0, 0, 1], up: [1, 0, 0] }) });

const holes = corners.map(([x, y]) => lib.clearanceHole("M3", { length: lidT + 1 }).translate(x, y, lidT));
const lid = roundedRect(W, D, 4).extrude(lidT).subtract(holes)
  .withConnectors({ under: connector.male("seat", { origin: [0, 0, 0], axis: [0, 0, -1], up: [1, 0, 0] }) })
  .matchTo(body, "under", "rim");

const screw = lib.bolt("M3", 8);
const screws = corners.map(([x, y]) => ({ name: "Screw", shape: screw.clone().translate(x, y, H + lidT) }));
return [{ name: "Body", shape: body, color: "#5b6b7a" }, { name: "Lid", shape: lid, color: "#00d4ff" }, ...screws];`,
  },
  {
    title: "Turned knob from a revolved profile",
    intro: "A path profile revolved about Z, with a knurl made by a circular pattern of cuts.",
    script: `const profile = path().moveTo(0, 0).lineH(15).lineV(4).lineTo(13, 18).lineH(-13).close();
const knob = profile.revolve();
const grooves = circularPattern(cylinder(20, 1.2).translate(14.5, 0, 2), 18);
return knob.subtract(grooves).subtract(cylinder(12, 2.5).translate(0, 0, -1)).name("Knob");`,
  },
];

interface PlaybookEntry {
  code: string;
  meaning: string;
  fix: string;
}

/** What each error code means and what to do. Codes come from the sandbox, DSL, kernel, assembly, render, pool and daemon. */
export const PLAYBOOK: readonly PlaybookEntry[] = [
  { code: "SCRIPT_SYNTAX", meaning: "The script is not valid JavaScript. line and column point at the problem.", fix: "Fix the syntax at that line. Scripts are plain JavaScript (ES2023) without import or require." },
  { code: "SCRIPT_RUNTIME", meaning: "The script threw an error, for example a TypeError from a misspelt method.", fix: "Read the message at the reported line. docs {query: \"<entry>\"} shows the right signature." },
  { code: "SCRIPT_TIMEOUT", meaning: "The script used more than its CPU budget (2 s by default, kernel time excluded) or ran into the wall-clock limit. Catching the interrupt (for example inside an async function) does not help: the run still ends with this code.", fix: "Remove loops that build many shapes one by one; pass arrays to add and subtract so the kernel runs one batched boolean." },
  { code: "SCRIPT_MEMORY", meaning: "The script used more than its memory cap (128 MiB).", fix: "Build fewer temporary arrays and strings; geometry itself lives in the kernel and does not count." },
  { code: "SCRIPT_STACK", meaning: "Recursion went too deep.", fix: "Replace deep recursion with a loop." },
  { code: "SCRIPT_LIMIT", meaning: "A budget ran out: host calls (5000), live shapes (20000), items in one list argument (1000) or string length.", fix: "Too many calls: batch work (one subtract with an array instead of a loop of subtracts) and do not create shapes you do not use. Too many items in one list (\"over the batch limit\"): split the list into calls of at most 1000 items and combine the results." },
  { code: "SCRIPT_RESULT_TOO_LARGE", meaning: "The returned value is larger than 64 KiB of plain data.", fix: "Return shapes and short names, not large arrays of numbers." },
  { code: "SCRIPT_NO_RESULT", meaning: "The script did not return anything.", fix: "End with return shape, return [{ name, shape }] or return { Name: shape }." },
  { code: "SCRIPT_CANCELLED", meaning: "The run was cancelled before it finished.", fix: "Run again if the cancel was not intended." },
  { code: "HOST_ERROR", meaning: "A host function failed in an unexpected way.", fix: "Simplify the failing call. If it repeats with valid input, report it with the script." },
  { code: "DSL_BAD_ARGUMENT", meaning: "An entry got an argument of the wrong type or range, for example a negative box size.", fix: "Check the entry's signature with docs {query: \"<entry>\"}; sizes are positive millimetres, angles are degrees." },
  { code: "DSL_BAD_HANDLE", meaning: "A shape or sketch handle is not valid any more, for example from an earlier run.", fix: "Build every shape inside the script that returns it." },
  { code: "DSL_BAD_PARAM", meaning: "A Param definition or a caller value is wrong, for example a choice that is not in the list.", fix: "Use a value from the options, or fix the Param call at the reported line." },
  { code: "DSL_BAD_RETURN", meaning: "The returned value is not a shape, a list of { name, shape } or an object of shapes.", fix: "Return shapes, [{ name, shape, color? }] or { Name: shape }." },
  { code: "DSL_NO_EDGES", meaning: "An edge query for fillet or chamfer matched no edge.", fix: "List the edges with shape.edges() and console.log, then narrow or widen the query (atZ, parallel, minLength)." },
  { code: "DSL_NOT_IMPLEMENTED", meaning: "The entry exists in the 3dj DSL but arrives in a later Open3DJ step.", fix: "Build the same shape from implemented entries. docs lists what is available." },
  { code: "DSL_UNKNOWN_ANCHOR", meaning: "attachTo got an anchor name that is neither a reference nor top, bottom, left, right, front, back or center.", fix: "Use a built-in anchor or add the point with withReferences." },
  { code: "DSL_MISSING_CONNECTOR", meaning: "matchTo named a connector the shape does not have.", fix: "Attach it first with withConnectors({ name: connector.male(...) })." },
  { code: "DSL_EMPTY_RESULT", meaning: "A part has no solid left, usually because a cut removed everything. line points at the call that made the part.", fix: "Check the cutter size and position (cutters bigger than the part remove it all), or render the parts before the cut." },
  { code: "BAD_PART", meaning: "A returned part is not a usable shape: it could not be measured, for example a surface or a broken result. line points at the call that made it.", fix: "Return solids. Render the parts before the last operation to see what it did." },
  { code: "DSL_UNSUPPORTED", meaning: "The combination of options is not supported, for example offset on a profile with holes, or a 2D boolean or corner fillet whose result fails its area check.", fix: "Follow the hint; usually build the profile in two steps, or extrude the profiles and combine the solids." },
  { code: "DSL_OVERLAPPING_SOLIDS", meaning: "One returned part holds several solids that share volume, so its volume and mass would be counted twice.", fix: "Union the pieces into one solid (a.union(b)), or return them as separate parts." },
  { code: "KERNEL_BOOLEAN_FAILED", meaning: "OCCT could not compute a union, cut or intersection.", fix: "Make tools overlap the body clearly and avoid coincident faces: extend cutters 0.01 mm or more past the faces they cut." },
  { code: "KERNEL_FILLET_FAILED", meaning: "OCCT could not round the chosen edges. elements names them (edge:N).", fix: "Use a smaller radius, or fillet fewer edges at once; fillet before boolean cuts that meet the edge." },
  { code: "KERNEL_CHAMFER_FAILED", meaning: "OCCT could not chamfer the chosen edges.", fix: "Use a smaller size or fewer edges." },
  { code: "KERNEL_SHELL_FAILED", meaning: "OCCT could not hollow the solid.", fix: "Use a thinner wall, or shell before adding fillets (keep corner radii larger than the wall)." },
  { code: "KERNEL_INVALID_RESULT", meaning: "An operation returned a shape that is not a valid solid, or a shell that is wrong although valid. elements names faulty faces.", fix: "Follow the hint. For shell: thinner walls, or shell first and fillet after." },
  { code: "KERNEL_NOT_A_SOLID", meaning: "A feature needs one solid but got several bodies or a surface.", fix: "Union the bodies first, or apply the feature to each body." },
  { code: "KERNEL_CONSTRUCTION_FAILED", meaning: "A primitive or profile could not be built, for example a zero-size box or a self-crossing polygon.", fix: "Check sizes and point order." },
  { code: "KERNEL_BAD_ARGUMENT", meaning: "The kernel refused an argument, for example a size that is not a finite number.", fix: "Check the numbers passed at the reported line; docs {query: \"<entry>\"} gives the ranges." },
  { code: "KERNEL_INVALID_HANDLE", meaning: "A shape handle was used after the kernel released it. This is a bug in Open3DJ, not in the script.", fix: "Run again; if it repeats, report it with the script." },
  { code: "KERNEL_TESSELLATION_FAILED", meaning: "The kernel could not mesh a part for a render or a mesh export (STL, glTF, 3MF).", fix: "Look for tiny or sliver faces near the last operation (very small fillets, nearly tangent cuts) and simplify them; STEP export does not need a mesh." },
  { code: "KERNEL_IO_FAILED", meaning: "The kernel could not write or read a STEP, STL or BREP form of the shape.", fix: "Check that the part is valid in the report; if it is and this repeats, report it with the script." },
  { code: "KERNEL_HEALING_FAILED", meaning: "The kernel could not repair a shape.", fix: "Simplify the operation named in op; report it if it repeats." },
  { code: "KERNEL_UNKNOWN", meaning: "The kernel failed without a known cause.", fix: "Simplify the operation named in op and run again; report it with the script if it repeats." },
  { code: "KERNEL_KERNEL_ABORT", meaning: "The kernel aborted. The worker is replaced, so the next call starts clean.", fix: "Simplify the operation named in op; report it if it repeats." },
  { code: "BAD_TRANSFORM", meaning: "A part's placement is not a rigid move (its rotation is not a unit quaternion).", fix: "Place parts with translate, rotate and matchTo; do not scale a clone." },
  { code: "UNKNOWN_DEFINITION", meaning: "An occurrence uses a definition with no geometry. This is a bug in Open3DJ, not in the script.", fix: "Run the script again; if it repeats, report it with the script." },
  { code: "ASSEMBLY_TOO_DEEP", meaning: "Sub-assemblies nest deeper than 32 levels.", fix: "Flatten the grouping: fewer levels of nested groups." },
  { code: "ASSEMBLY_TOO_LARGE", meaning: "The previous revision's assembly graph expands to more than 100000 occurrences, which Open3DJ never writes; the project files were changed outside Open3DJ.", fix: "Restore the revision from git, or run the script in a fresh project." },
  { code: "XCAF_LOCATION_MISMATCH", meaning: "The STEP writer stored a different placement for an occurrence than the assembly holds. This is a bug in Open3DJ.", fix: "Export STL, glTF or 3MF meanwhile, and report it with the script." },
  { code: "BAD_FORMAT", meaning: "An export or render format is not one of the supported ones.", fix: "Export step, stl, gltf or 3mf; render png, svg or both." },
  { code: "BAD_OPTION", meaning: "An export option is out of range, for example a mesh deflection of 0.", fix: "Leave the option out to use the default." },
  { code: "BAD_SIZE", meaning: "A render width or height is not a whole number of pixels in the allowed range.", fix: "Leave the size out, or use a value from the message's range." },
  { code: "UNSUPPORTED_VIEW", meaning: "The render view is not available yet.", fix: "Use view \"multiview\"." },
  { code: "UNKNOWN_TARGET", meaning: "A target or scope names no occurrence, sub-assembly or definition.", fix: "Use inspect {fields: [\"tree\"]} to list paths such as lid, screw#2 or pcb_assy/standoff#1." },
  { code: "EMPTY_ASSEMBLY", meaning: "The script returned no parts.", fix: "Return at least one shape." },
  { code: "REV_CONFLICT", meaning: "base_rev is an older revision, not the project's head: another change landed first. Nothing was changed. (A base_rev that never existed is UNKNOWN_REV.)", fix: "inspect the head revision, then run again with base_rev set to it (or omit base_rev to build on the head)." },
  { code: "UNKNOWN_REV", meaning: "The rev or base_rev does not exist in this project, for example a typo or a rev ahead of the head.", fix: "Use a rev from an earlier result; the message names the head and the hint lists known revisions." },
  { code: "NO_REVISION", meaning: "The project has no revision or no script yet.", fix: "Call run with a script first." },
  { code: "PROJECT_NOT_FOUND", meaning: "The project folder has no project.o3j.json.", fix: "Call run with a script; it creates the project." },
  { code: "PROJECT_PATH", meaning: "The project path is not a folder whose name ends in .o3j, its parent folder does not exist, or a part of the path is a file (the message gives the file system code, such as ENOTDIR).", fix: "Use a project directly in the folder the server runs in, such as bracket.o3j, or inside a folder that already exists there." },
  { code: "PATH_REFUSED", meaning: "A path would leave the project or server folder, is absolute, goes through a symlink, or names the store's own files (revisions, .o3j-cache, .o3j-lock, project.o3j.json and the other project files).", fix: "Use a relative path inside the project, such as exports or out/r_0002." },
  { code: "PROJECT_CORRUPT", meaning: "A project file is not valid JSON or does not match its schema, a revision's assembly graph is too large to be one Open3DJ wrote (more than 100000 occurrences or 32 levels), or something other than a lock file sits at .o3j-lock.", fix: "Fix or delete the named file or folder by hand, or restore it from git." },
  { code: "PROJECT_REQUIRED", meaning: "inspect fields tree, refs, fits and measure need a project.", fix: "Pass project; devices and job work without one." },
  { code: "OP_NOT_IMPLEMENTED", meaning: "The run op arrives in a later step: add_occurrence, remove, set_transform and replace_definition come in S2. S1 supports set_param and cancel_job.", fix: "Change the script so it returns the parts with their placements, and run it again." },
  { code: "PROJECT_BUSY", meaning: "Another process (a second daemon or the CLI) held the project's lock file for more than 15 s.", fix: "Run again. If no other open3dj process runs, delete the project's .o3j-lock file." },
  { code: "STEP_HEADER", meaning: "The STEP writer produced a file without the HEADER section or FILE_SCHEMA that Open3DJ rewrites with the file name, author and version.", fix: "Report it with the script: the kernel's STEP writer changed. STL, glTF and 3MF still work." },
  { code: "STEP_ROUNDTRIP_FAILED", meaning: "The STEP file did not re-import as the same solids (count, validity or volume), so other CAD tools would open a broken part. The message names the occurrence and faces.", fix: "Usually a revolved profile whose end meets the axis at an angle: end it square to the axis (an arc centred on the axis, or a short flat). A curve the STEP writer cannot express (an offset of a spline) is the other known cause: simplify that profile. STL, glTF and 3MF still work." },
  { code: "BAD_INPUT", meaning: "The tool input does not match the tool's input schema.", fix: "Check the schema in tools/list; the message names the field." },
  { code: "NO_BACKEND", meaning: "compute asked for gpu or cloud, which arrive in later steps.", fix: "Use compute \"auto\" or \"cpu\"." },
  { code: "JOB_TIMEOUT", meaning: "The job ran past the pool's wall-clock limit and its worker was stopped.", fix: "Simplify the script or split it into parts." },
  { code: "JOB_MEMORY", meaning: "The job needed more kernel memory than a worker may use (2 GiB by default), so the worker was stopped and replaced.", fix: "Make the part smaller or simpler (fewer patterned features), or split it into parts. Sizes are in mm." },
  { code: "JOB_CANCELLED", meaning: "The job was cancelled with run ops=[{op: \"cancel_job\"}]. No revision was created.", fix: "Run again if needed." },
  { code: "JOB_NOT_FOUND", meaning: "No job with that id in this daemon. Jobs are kept in memory only.", fix: "Run again; a restarted daemon forgets its jobs." },
  { code: "WORKER_CRASHED", meaning: "The worker running the job died and was replaced.", fix: "Run again; if it repeats, simplify the operation that crashes." },
  { code: "POOL_CLOSED", meaning: "The daemon is shutting down.", fix: "Start it again." },
  { code: "INTERNAL_ERROR", meaning: "Open3DJ failed in a way it did not expect, or a file system call failed with a code other than a path problem (the message names the code, such as ENOSPC). This is not a script error.", fix: "Run the same call again. If it repeats, check the disk (free space, permissions), then report it with the script." },
];

const BASICS = `## Basics

### Units, axes and return values

Units are millimetres and Z is up. Angles are degrees. A script is plain JavaScript that ends with a return:

- \`return shape\`: one part.
- \`return [{ name: "Base", shape: base, color: "#5b6b7a" }, { name: "Lid", shape: lid }]\`: several parts.
- \`return { Base: base, Lid: lid }\`: several parts named by the keys.

Every design is an assembly: a single part is an assembly with one occurrence. Parts with the same name get #n suffixes (screw#1, screw#2), and moved clones share one definition.

### Getting started: the tool loop

1. \`docs {query: "fillet"}\` to look up an entry; \`docs {query: "entries"}\` lists them all.
2. \`run {project: "bracket.o3j", script}\` returns a GeometryReport: validity, volume, bbox and counts per definition, clashes and contacts between parts, and next steps. Keep the \`rev\` it returns.
3. \`render {project, view: "multiview"}\` returns a four-view drawing (PNG, or SVG with format svg).
4. \`export {project, format: "step"}\` writes STEP, STL, glTF (.glb) or 3MF under out/<rev>/ with an evidence sidecar.
5. Change the script and \`run\` again with \`base_rev\` set to the last rev. A stale base_rev returns REV_CONFLICT.

The CLI does the same: \`open3dj run part.o3j.js\`, \`open3dj render part.o3j\`, \`open3dj export part.o3j --format step\`.

### Sandbox limits

Scripts run in a QuickJS sandbox with no file system, network, timers or Date. Math.random is seeded. Limits: 2 s of script CPU time (kernel time excluded), 128 MiB of memory, 5000 kernel calls and 20000 live shapes per run, and at most 1000 items in one list argument (split longer lists into several calls). console.log output is kept with the run, never printed to the MCP stream.
`;

/** One compact section that names every S1 entry, so an agent can see what exists. */
function allEntries(entries: readonly DslEntry[]): string {
  const names = (list: readonly DslEntry[]) => list.map((e) => `\`${e.name}\``).join(", ");
  const now = entries.filter((e) => e.step === "S1");
  return [
    "### All entries",
    "",
    "An overview of every entry in this version. `docs {query: \"<name>\"}` gives the signature and an example.",
    "",
    `Shapes, profiles and operations: ${names(now.filter((e) => !e.name.startsWith("lib.")))}.`,
    "",
    `Standard parts: ${names(now.filter((e) => e.name.startsWith("lib.")))}.`,
  ].join("\n");
}

/** One example of the gallery in examples/, with the comment at the top of its script as the intro. */
export interface GalleryExample {
  name: string;
  intro: string;
  script: string;
}

export const EXAMPLES_DIR: URL = new URL("../../../examples/", import.meta.url);

export function galleryExamples(dir: URL = EXAMPLES_DIR): GalleryExample[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const file = new URL(`${name}/${name}.o3j.js`, dir);
    if (!existsSync(file)) return [];
    const script = readFileSync(file, "utf8").trimEnd();
    const comment = script.split("\n").filter((l) => l.startsWith("//")).map((l) => l.replace(/^\/\/\s?/, "")).join(" ");
    const intro = /^.*?\.(?=\s|$)/.exec(comment)?.[0] ?? comment;
    return [{ name, intro, script }];
  });
}

function entrySection(e: DslEntry): string {
  const example = ENTRY_EXAMPLES[e.name];
  const lines = [`### ${e.name}`, "", "```js", e.signature, "```", "", e.summary];
  if (example) lines.push("", "Example:", "", "```js", example, "```");
  return lines.join("\n");
}

export function renderDslDoc(entries: readonly DslEntry[] = DSL_ENTRIES, gallery: readonly GalleryExample[] = galleryExamples()): string {
  const now = entries.filter((e) => e.step === "S1");
  const later = entries.filter((e) => e.step !== "S1");
  const core = now.filter((e) => !e.name.startsWith("lib."));
  const lib = now.filter((e) => e.name.startsWith("lib."));
  const parts = [
    "# Open3DJ DSL reference",
    "",
    "<!-- Generated by packages/mcp/src/dsl-docs.ts from DSL_ENTRIES in @open3dj/dsl. Do not edit by hand: run node packages/mcp/src/dsl-docs.ts --write. -->",
    "",
    "DSL v1 is a 3dj-compatible modelling surface for scripts. This page is what the `docs` tool searches. Sections: Basics, DSL reference (starting with All entries), Standard parts (lib), Later entries, Error playbook, Examples and Gallery examples.",
    "",
    BASICS,
    "## DSL reference",
    "",
    allEntries(entries),
    "",
    core.map(entrySection).join("\n\n"),
    "",
    "## Standard parts (lib)",
    "",
    "Dimensions come from public tables of ISO 273, ISO 4762, ISO 10642, ISO 4032 and ISO 7089; heat-set pockets use typical values, not a standard. Hardware is schematic, without threads.",
    "",
    lib.map(entrySection).join("\n\n"),
    "",
    "## Later entries",
    "",
    "### Planned for later steps",
    "",
    "These 3dj entries throw DSL_NOT_IMPLEMENTED in S1. Build the same shape from the entries above.",
    "",
    later.map((e) => `- \`${e.signature}\`: ${e.summary}`).join("\n"),
    "",
    "## Error playbook",
    "",
    "Errors come back as tool results with status error and an error object: code, message, line and column in the script, op, faulty elements (edge:3, face:2) and a hint. The CLI exits with 2 for these.",
    "",
    PLAYBOOK.map((p) => `### ${p.code}\n\n${p.meaning}\n\nFix: ${p.fix}`).join("\n\n"),
    "",
    "## Examples",
    "",
    EXAMPLES.map((x) => `### ${x.title}\n\n${x.intro}\n\n\`\`\`js\n${x.script}\n\`\`\``).join("\n\n"),
    "",
    "## Gallery examples",
    "",
    "The examples/ folder of the repository: tested parts and assemblies, with their measures in expected.json.",
    "",
    gallery.map((x) => `### ${x.name}\n\n${x.intro} Script: examples/${x.name}/${x.name}.o3j.js.\n\n\`\`\`js\n${x.script}\n\`\`\``).join("\n\n"),
    "",
  ];
  return parts.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = fileURLToPath(DEFAULT_DOCS_FILE);
  const text = renderDslDoc();
  if (process.argv.includes("--write")) {
    writeFileSync(file, text);
    process.stderr.write(`wrote ${file}\n`);
  } else {
    let current = "";
    try {
      current = readFileSync(file, "utf8");
    } catch {
      // missing counts as stale
    }
    if (current !== text) {
      process.stderr.write("docs/DSL.md is stale: run node packages/mcp/src/dsl-docs.ts --write\n");
      process.exit(1);
    }
    process.stderr.write("docs/DSL.md is up to date\n");
  }
}
