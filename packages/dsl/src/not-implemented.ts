// Hints for the DSL entries that throw DSL_NOT_IMPLEMENTED. Each one names a working alternative,
// so an agent's next call can succeed instead of guessing. One table serves the guest prelude (NI),
// notImplemented in errors.ts (host side, sketch.ts included) and the lib fallback in host.ts.
// Every alternative was run before it was written here; not-implemented.test.ts checks that each
// entry has its own hint and that every DSL name a hint mentions is real.
// No imports: the prelude embeds this table, and the MCP process must not load the kernel.

/** The hint for an entry without one of its own. The tests keep every known entry off it. */
export const GENERIC_NOT_IMPLEMENTED_HINT = "Build the same shape from the implemented entries, or ask for this entry in an issue.";

const DRAW_PROFILE = "polygon([[x, y], ...]) or path().moveTo(x, y).lineTo(x, y).arcTo(x, y, r).close()";

/** One sentence per entry, keyed by the entry name in the error message; "lib.*" covers other lib names. */
export const NOT_IMPLEMENTED_HINTS: Readonly<Record<string, string>> = Object.freeze({
  hole: "Subtract a cutter instead: lib.clearanceHole('M3', { length: 10 }).translate(x, y, faceZ), lib.screwCutter('M3', { length: 10, head: 'socket' }) for a counterbore or with head: 'countersunk' for a countersink, moved the same way, or cylinder(depth, r).translate(x, y, faceZ - depth).",
  onFace: "Move the part onto the face with .attachTo(parent, 'top', 'bottom') or .translate(x, y, z), then .add() it to the parent or return both as parts.",
  cutout: "Extrude the profile to the pocket depth, sink it into the face with .attachTo(parent, 'top', 'top') or .translate(x, y, faceZ - depth), turning it first with .rotate(axis, deg) for a side face, then .subtract() it.",
  "sketch.onFace": "Extrude the sketch, then .add() it on the face with .attachTo(parent, 'top', 'bottom'), or sink it in with .attachTo(parent, 'top', 'top') and .subtract() it; .translate(x, y, z) and .rotate(axis, deg) reach the other faces.",
  "shape.face": "Faces are not objects yet: name one with .withReferences({ deck: { face: { normal: [0, 0, 1] } } }) so the report tracks it, and place parts with a point reference or the top, bottom, left, right, front and back anchors of .attachTo(parent, parentAnchor, myAnchor).",
  group: "Return several parts instead: an array, return [a, b], or parts with names, return [{ name: 'Base', shape: a }, { name: 'Lid', shape: b }].",
  tolerance: "Grow or shrink a 2D profile with .offset(mm) before you extrude it, for example rect(10, 10).offset(0.2).extrude(5).",
  chamferBottomEdges: "Use chamfer(shape, size, { atZ: z }) with z, the lowest Z, from .bounds().min[2]: it chamfers every edge at that height.",
  minWall: "Run the script, then check walls with inspect {fields: [\"gates\"]} (CLI: --fields gates): its min_wall check measures every part against 0.8 mm, and wall.min_mm gives the thinnest wall to compare with your own limit.",
  text2d: `Text is not available yet: draw each glyph as an outline with ${DRAW_PROFILE}, then .extrude(h) it.`,
  spline2d: "Approximate the curve with polygon([[x, y], ...]) through points sampled along it, or with path() segments and .arcTo(x, y, r) arcs, then .extrude(h) it.",
  point: "Use a plain [x, y] or [x, y, z] array for a point.",
  Point2D: "Use a plain [x, y] array for a 2D point.",
  "Rectangle2D.fromDimensions": "Use rect(w, h).translate(cx, cy), a w by h rectangle centred at (cx, cy).",
  "Rectangle2D.fromCenterAndDimensions": "Use rect(w, h).translate(cx, cy): rect is centred on the origin.",
  "Rectangle2D.from2Corners": "Use rect(x2 - x1, y2 - y1).translate((x1 + x2) / 2, (y1 + y2) / 2) for the rectangle from the lower-left corner [x1, y1] to the upper-right corner [x2, y2].",
  "Shape.fromSlices": "Use loft([profiles], [heights]) through the slices, for example loft([rect(20, 20), circle2d(8), rect(10, 10)], [0, 10, 20]).",
  "lib.snapFit": "Build the hook from a box(w, d, h) arm and a polygon([[x, y], ...]) wedge: .extrude(w) the wedge, turn it with .rotate(axis, deg), move it to the arm's end and .add() it.",
  "lib.screwBoss": "Use a cylinder(h, r) boss and .subtract() lib.heatSetPocket(size, { depth }) or lib.clearanceHole(size, { length }) moved to its top.",
  "lib.mountingTab": "Extrude a roundedRect(w, d, r) to the tab thickness t and .subtract() lib.clearanceHole(size, { length: t + 1 }) moved to its top.",
  "lib.cableAnchor": "Use a box(w, d, h) block and .subtract() a tunnel for the tie parallel to its base, a rect(tieThickness + 1, tieWidth + 1) profile run through it with .extrude(length) and .rotate([0, 1, 0], 90).",
  "lib.remoteCradle": "Extrude a roundedRect(w, d, r) as wide and deep as the remote plus 2 * (clearance + t) and hollow it with .shell(t), which puts the walls inside and leaves the top open.",
  "lib.profile2020BSlot6": `Draw the 20x20 B-type slot 6 cross-section from its maker's drawing with ${DRAW_PROFILE}, then .extrude(length) it.`,
  "lib.profile2020BSlot6Profile": `Draw the 20x20 B-type slot 6 cross-section from its maker's drawing with ${DRAW_PROFILE}.`,
  "lib.tSlotProfile": `Draw the T-slot cross-section from its maker's drawing with ${DRAW_PROFILE}, then .extrude(length) it.`,
  "lib.*": "lib has fastener, clearanceHole, screwCutter, heatSetPocket, hexNutPocket, bolt, nut and washer: build other parts from box(w, d, h), cylinder(h, r) or an extruded roundedRect(w, d, r) with those cutters.",
  "offset of a profile with holes": "Offset the outer outline and each hole outline separately, the holes by the opposite amount, then .subtract() the holes: rect(20, 20).offset(1).subtract(circle2d(3).offset(-1)).",
  "extrude with twist or scaleTop of a profile with holes": "Extrude the outer outline and each hole outline with the same twist and scaleTop, then .subtract() the hole solids from the outer solid.",
  "loft of a profile with holes": "Loft the outer outlines and the hole outlines separately with the same heights, then .subtract() the hole loft from the outer loft.",
});

/** The hint for a not-implemented entry: its own, the lib hint for other lib names, else the generic one. */
export function notImplementedHint(entry: string): string {
  if (Object.hasOwn(NOT_IMPLEMENTED_HINTS, entry)) return NOT_IMPLEMENTED_HINTS[entry]!;
  if (entry.startsWith("lib.")) return NOT_IMPLEMENTED_HINTS["lib.*"]!;
  return GENERIC_NOT_IMPLEMENTED_HINT;
}
