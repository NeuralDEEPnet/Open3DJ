// Measure math on the tessellation (pure functions, tested in Node). Every number here is an
// observation of the mesh, within the export chord of the true surface: the panel labels it
// "observed". Numbers of record (part volume, area, centre of mass, and the minimum distance
// or overlap between two parts) come from the kernel through the report and are labelled
// "measured" (docs/COMPUTE.md: GPU screens, CPU decides).

/** Distance between two points. */
export function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

function cross(u, v) {
  return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 0 ? [v[0] / n, v[1] / n, v[2] / n] : [0, 0, 0];
}

/**
 * Area, area-weighted normal and centre of triangles [t0, t1) of an indexed mesh, in the
 * mesh's own frame. planar is true when no triangle normal leans more than tolDeg from the
 * mean, so the normal stands for the whole face.
 */
export function facePatch(positions, index, t0, t1, tolDeg = 0.5) {
  let area = 0;
  const sum = [0, 0, 0];
  const centre = [0, 0, 0];
  const normals = [];
  for (let t = t0; t < t1; t++) {
    const a = index[t * 3] * 3;
    const b = index[t * 3 + 1] * 3;
    const c = index[t * 3 + 2] * 3;
    const u = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const v = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const n = cross(u, v);
    const s = 0.5 * Math.hypot(n[0], n[1], n[2]);
    if (s === 0) continue;
    area += s;
    for (let i = 0; i < 3; i++) {
      sum[i] += n[i] / 2;
      centre[i] += (s * (positions[a + i] + positions[b + i] + positions[c + i])) / 3;
    }
    normals.push(normalize(n));
  }
  const normal = normalize(sum);
  let lean = 0;
  for (const n of normals) lean = Math.max(lean, angleDeg(n, normal));
  return { area, normal, centre: area > 0 ? centre.map((x) => x / area) : centre, planar: normals.length > 0 && lean <= tolDeg, leanDeg: lean };
}

/** Angle between two directions in degrees (0 to 180). */
export function angleDeg(a, b) {
  const na = Math.hypot(a[0], a[1], a[2]);
  const nb = Math.hypot(b[0], b[1], b[2]);
  if (na === 0 || nb === 0) return 0;
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
  return (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
}

/**
 * The angle between two planar faces, as a CAD measure gives it: the angle between their
 * normals (0 for parallel faces that face the same way, 180 for opposed faces), and, for
 * faces within tolDeg of parallel, the distance between their planes.
 */
export function facesRelation(f1, f2, tolDeg = 0.01) {
  const angle = angleDeg(f1.normal, f2.normal);
  const parallel = angle <= tolDeg || angle >= 180 - tolDeg;
  const d = [f2.centre[0] - f1.centre[0], f2.centre[1] - f1.centre[1], f2.centre[2] - f1.centre[2]];
  const gap = parallel ? Math.abs(d[0] * f1.normal[0] + d[1] * f1.normal[1] + d[2] * f1.normal[2]) : undefined;
  return { angle, parallel, gap };
}

/** Total length of segments given as x0 y0 z0 x1 y1 z1 runs. */
export function segmentsLength(segments) {
  let length = 0;
  for (let i = 0; i + 5 < segments.length; i += 6) length += Math.hypot(segments[i + 3] - segments[i], segments[i + 4] - segments[i + 1], segments[i + 5] - segments[i + 2]);
  return length;
}

/** Transform a point by a column-major 4x4 matrix (three's Matrix4.elements). */
export function applyPoint(m, p) {
  const [x, y, z] = p;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
}

/** Turn a direction by the rotation part of a column-major 4x4 rigid matrix, and normalise it. */
export function applyDirection(m, v) {
  return normalize([m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]);
}

/**
 * The kernel's numbers for two occurrences, from the report's fit lines: the minimum distance
 * (clearance or contact) or the overlap volume (clash). Concise ranges (screw#1..4) count.
 * Returns the fit line or null.
 */
export function kernelFit(fits, a, b, pairsOf) {
  for (const f of fits ?? []) {
    for (const [x, y] of pairsOf(f)) {
      if ((x === a && y === b) || (x === b && y === a)) return f;
    }
  }
  return null;
}

/**
 * The measure panel's rows for one or two picks: [label, value, tier], tier "observed",
 * "measured" or null (a plain note). A pick is { path, element, point, face?, edge? }, with
 * face { area, normal?, centre } and edge { length } observed on the mesh. name(pick) gives the
 * label of a pick, fits the report's fit lines and pairsOf their pairs; round formats numbers.
 * The same face picked twice is two points on it: the face is listed once and no face relation
 * is given.
 */
export function measureRows(a, b, { name, fits, pairsOf, round }) {
  const rows = [];
  const describe = (p) => {
    if (p.face) rows.push([name(p), `area ${round(p.face.area)} mm²${p.face.normal ? `, normal ${p.face.normal.map((v) => round(v, 3)).join(", ")}` : ", curved"}`, "observed"]);
    else if (p.edge) rows.push([name(p), `length ${round(p.edge.length)} mm`, "observed"]);
    else rows.push([name(p), "a point on the section cut", "observed"]);
  };
  if (!a) return rows;
  describe(a);
  if (!b) return rows;
  const same = a.path === b.path && sameElement(a.element, b.element);
  if (same) rows.push([name(b), "the same element again: measuring between the two points on it", null]);
  else describe(b);
  const d = distance(a.point, b.point);
  rows.push(["Point to point", `${round(d)} mm (dx ${round(b.point[0] - a.point[0])}, dy ${round(b.point[1] - a.point[1])}, dz ${round(b.point[2] - a.point[2])})`, "observed"]);
  if (!same && a.face?.normal && b.face?.normal) {
    const rel = facesRelation({ normal: a.face.normal, centre: a.face.centre }, { normal: b.face.normal, centre: b.face.centre });
    rows.push(["Angle between faces", `${round(rel.angle, 3)}°`, "observed"]);
    if (rel.parallel) rows.push(["Distance between planes", `${round(rel.gap)} mm`, "observed"]);
  }
  if (a.path !== b.path) {
    const fit = kernelFit(fits, a.path, b.path, pairsOf);
    if (fit?.distance_mm !== undefined) rows.push([`Minimum distance ${a.path} to ${b.path}`, `${round(fit.distance_mm)} mm (${fit.kind})`, "measured"]);
    else if (fit?.volume_mm3 !== undefined) rows.push([`Overlap ${a.path} with ${b.path}`, `${round(fit.volume_mm3)} mm³ (clash)`, "measured"]);
    else rows.push([`${a.path} to ${b.path}`, "The report has no fit line for this pair (apart by more than the watch distance, or a mated seat).", null]);
  }
  return rows;
}

function sameElement(x, y) {
  if (!x || !y || x.kind !== y.kind) return false;
  if (x.kind === "face") return x.face === y.face;
  if (x.kind === "edge") return x.edge === y.edge;
  return false;
}
