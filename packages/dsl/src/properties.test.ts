// Seeded property tests for DSL measures, transforms and sketch booleans (issue #17).
// Fixed cases check analytic values; these check a rule over many generated inputs. Each
// property draws its inputs from mulberry32 with a fixed seed, runs every case in one script
// and reads each case's measures back from its console.log line. A failure message names the
// seed and the case as DSL code (for example `ngon(7, 12.5).rotate(-30)`), so it can be pasted
// into a script and replayed. Relative tolerances: 1e-9 for boxes, polygons, rigid transforms
// and bounds (the kernel's precise bounding box, curved edges included); 1e-6 for the area and
// volume of a profile with a curved edge. The worst deviation seen at SEED is about 1e-13.
import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, near, vecNear } from "./testing.ts";

const SEED = 17;
const CASES = 32;
const EXACT = 1e-9;
const CURVED = 1e-6;

/** mulberry32: a small seeded generator, uniform in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Three decimals keep every input short enough to read and type back. */
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function gen(seed: number) {
  const next = mulberry32(seed);
  const num = (lo: number, hi: number) => r3(lo + (hi - lo) * next());
  return {
    seed,
    num,
    int: (lo: number, hi: number) => lo + Math.floor((hi - lo + 1) * next()),
    /** A length from 0.5 to 200 mm, log-uniform, so small and large parts are equally likely. */
    size: () => r3(0.5 * 400 ** next()),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    /** A direction with components in [-1, 1], never shorter than 0.2. */
    dir: (n: number): number[] => {
      for (;;) {
        const v = Array.from({ length: n }, () => num(-1, 1));
        if (Math.hypot(...v) >= 0.2) return v;
      }
    },
  };
}
type Gen = ReturnType<typeof gen>;

interface Profile {
  code: string;
  /** Exact area of the profile. */
  area: number;
  /** Radius of a disk about the origin that lies inside the profile. */
  inradius: number;
  curved: boolean;
  /** Symmetric about the origin, so its bounds stay centred on it. */
  symmetric: boolean;
}

const KINDS = ["rect", "circle2d", "ngon", "roundedRect", "slot", "ellipse"] as const;
/** The mirror property adds a sketch boolean result, which the DSL mirrors as a kernel face. */
const MIRROR_KINDS = [...KINDS, "plate"] as const;

function profile(g: Gen, kind: (typeof MIRROR_KINDS)[number]): Profile {
  const PI = Math.PI;
  switch (kind) {
    case "rect": {
      const w = g.size(), h = g.size();
      return { code: `rect(${w}, ${h})`, area: w * h, inradius: Math.min(w, h) / 2, curved: false, symmetric: true };
    }
    case "circle2d": {
      const r = g.size();
      return { code: `circle2d(${r})`, area: PI * r * r, inradius: r, curved: true, symmetric: true };
    }
    case "ngon": {
      // r is the circumradius.
      const n = g.int(3, 12), r = g.size();
      return { code: `ngon(${n}, ${r})`, area: (n / 2) * r * r * Math.sin((2 * PI) / n), inradius: r * Math.cos(PI / n), curved: false, symmetric: n % 2 === 0 };
    }
    case "roundedRect": {
      const w = g.size(), h = g.size();
      const r = r3(Math.min(w, h) * g.num(0.05, 0.45));
      return { code: `roundedRect(${w}, ${h}, ${r})`, area: w * h - (4 - PI) * r * r, inradius: Math.min(w, h) / 2, curved: true, symmetric: true };
    }
    case "slot": {
      // slot(length, width): the length includes the two round ends.
      const w = g.size(), len = r3(w + g.size());
      return { code: `slot(${len}, ${w})`, area: (len - w) * w + (PI * w * w) / 4, inradius: w / 2, curved: true, symmetric: true };
    }
    case "ellipse": {
      const rx = g.size(), ry = g.size();
      return { code: `ellipse(${rx}, ${ry})`, area: PI * rx * ry, inradius: Math.min(rx, ry), curved: true, symmetric: true };
    }
    case "plate": {
      // A plate with a round hole at the origin, so no disk about the origin lies inside it:
      // never use it to place an overlapping profile.
      const w = g.size(), h = g.size();
      const r = r3(Math.min(w, h) * g.num(0.05, 0.4));
      return { code: `rect(${w}, ${h}).subtract(circle2d(${r}))`, area: w * h - PI * r * r, inradius: 0, curved: true, symmetric: true };
    }
  }
}

interface Case {
  /** The case as DSL code, shown in failure messages. */
  label: string;
  /** Script statements ending in `return { ... }` with the measures to check. */
  body: string;
}

/** Runs all cases in one script, one JSON log line each; a case that throws logs { error }. */
async function measure<T>(g: Gen, property: string, cases: readonly Case[]): Promise<Array<T & { error?: string }>> {
  const h = await harness();
  const code = [
    "const out = (f) => { try { console.log(JSON.stringify(f())); } catch (e) { console.log(JSON.stringify({ error: String(e && e.message ? e.message : e) })); } };",
    ...cases.map((c) => `out(() => { ${c.body} });`),
    "return box(1, 1, 1);",
  ].join("\n");
  const r = await h.run(code);
  assert.equal(r.ok, true, `seed ${g.seed}, ${property}: the script failed: ${r.error?.code}: ${r.error?.message}`);
  assert.equal(r.logs.length, cases.length, `seed ${g.seed}, ${property}: ${r.logs.length} log lines for ${cases.length} cases`);
  return r.logs as Array<T & { error?: string }>;
}

/** Collects every failed check of a property, so one run lists all failing cases. */
function checker(g: Gen, property: string) {
  const failures: string[] = [];
  const where = (c: Case) => `seed ${g.seed}, ${property}, ${c.label}`;
  return {
    ran(c: Case, out: { error?: string }): boolean {
      if (out.error !== undefined) failures.push(`${where(c)}: threw ${out.error}`);
      return out.error === undefined;
    },
    near(c: Case, what: string, got: number, want: number, rel: number): void {
      if (!near(got, want, rel)) failures.push(`${where(c)}: ${what} ${got}, want ${want} (rel ${rel})`);
    },
    that(c: Case, holds: boolean, what: string): void {
      if (!holds) failures.push(`${where(c)}: ${what}`);
    },
    done(): void {
      assert.equal(failures.length, 0, `${failures.length} failed checks:\n${failures.join("\n")}`);
    },
  };
}

test("property: box(w, d, h) has volume w*d*h and bounds size [w, d, h]", async () => {
  const g = gen(SEED + 1);
  const dims = Array.from({ length: CASES }, () => [g.size(), g.size(), g.size()] as const);
  const cases = dims.map(([w, d, h]) => ({ label: `box(${w}, ${d}, ${h})`, body: `const s = box(${w}, ${d}, ${h}); return { v: s.volume(), size: s.bounds().size };` }));
  const outs = await measure<{ v: number; size: number[] }>(g, "box measures", cases);
  const check = checker(g, "box measures");
  cases.forEach((c, i) => {
    const out = outs[i]!;
    if (!check.ran(c, out)) return;
    const [w, d, h] = dims[i]!;
    check.near(c, "volume", out.v, w * d * h, EXACT);
    [w, d, h].forEach((want, k) => check.near(c, `bounds size[${k}]`, out.size[k]!, want, EXACT));
  });
  check.done();
});

test("property: translate and rotate about any axis and pivot keep volume and area", async () => {
  const g = gen(SEED + 2);
  const solid = (): string => {
    const a = g.size(), b = g.size(), c = g.size();
    return g.pick([
      `box(${a}, ${b}, ${c})`,
      `cylinder(${a}, ${b})`,
      `sphere(${a})`,
      `torus(${r3(a + b)}, ${b})`,
      // A block with a through hole: a boolean result, not a primitive.
      `box(${r3(a + 2)}, ${r3(b + 2)}, ${c}).subtract(cylinder(${r3(c + 2)}, ${r3(Math.min(a, b) / 3)}).translate(0, 0, -1))`,
    ]);
  };
  const cases = Array.from({ length: CASES }, () => {
    const s = solid();
    const t = [g.num(-100, 100), g.num(-100, 100), g.num(-100, 100)];
    const move = `.translate(${t.join(", ")}).rotate([${g.dir(3).join(", ")}], ${g.num(-360, 360)}, [${[g.num(-50, 50), g.num(-50, 50), g.num(-50, 50)].join(", ")}])`;
    return { label: `${s}${move}`, body: `const s = ${s}; const m = s${move}; return { v0: s.volume(), a0: s.area(), v1: m.volume(), a1: m.area() };` };
  });
  const outs = await measure<{ v0: number; a0: number; v1: number; a1: number }>(g, "rigid transforms", cases);
  const check = checker(g, "rigid transforms");
  cases.forEach((c, i) => {
    const out = outs[i]!;
    if (!check.ran(c, out)) return;
    check.near(c, "volume after the move", out.v1, out.v0, EXACT);
    check.near(c, "area after the move", out.a1, out.a0, EXACT);
  });
  check.done();
});

test("property: rect, circle2d and ngon profiles extrude to area() * h", async () => {
  const g = gen(SEED + 3);
  const cases = Array.from({ length: CASES }, (_, i) => {
    const p = profile(g, (["rect", "circle2d", "ngon"] as const)[i % 3]!);
    const h = g.size();
    const sketch = `${p.code}.rotate(${g.num(-180, 180)}).translate(${g.num(-100, 100)}, ${g.num(-100, 100)})`;
    return { label: `${sketch}.extrude(${h})`, area: p.area, h, tol: p.curved ? CURVED : EXACT, body: `const p = ${sketch}; return { area: p.area(), v: p.extrude(${h}).volume() };` };
  });
  const outs = await measure<{ area: number; v: number }>(g, "extrude", cases);
  const check = checker(g, "extrude");
  cases.forEach((c, i) => {
    const out = outs[i]!;
    if (!check.ran(c, out)) return;
    check.near(c, "area()", out.area, c.area, c.tol);
    check.near(c, "extruded volume", out.v, out.area * c.h, c.tol);
  });
  check.done();
});

test("property: area(a.add(b)) + area(a.intersect(b)) = area(a) + area(b) for overlapping profiles", async () => {
  const g = gen(SEED + 4);
  const cases = Array.from({ length: CASES }, () => {
    const a = profile(g, g.pick(KINDS));
    const b = profile(g, g.pick(KINDS));
    // b is centred inside a disk that a contains, so the two share area: the intersection of
    // disjoint profiles is an error by design (sketch-boolean.test.ts).
    const angle = 2 * Math.PI * g.num(0, 1);
    const rho = 0.9 * a.inradius * Math.sqrt(g.num(0, 1));
    const bb = `${b.code}.rotate(${g.num(-180, 180)}).translate(${r3(rho * Math.cos(angle))}, ${r3(rho * Math.sin(angle))})`;
    return {
      label: `a = ${a.code}, b = ${bb}`,
      areaA: a.area,
      tolA: a.curved ? CURVED : EXACT,
      areaB: b.area,
      tolB: b.curved ? CURVED : EXACT,
      tol: a.curved || b.curved ? CURVED : EXACT,
      body: `const a = ${a.code}; const b = ${bb}; return { a: a.area(), b: b.area(), union: a.add(b).area(), common: a.intersect(b).area() };`,
    };
  });
  const outs = await measure<{ a: number; b: number; union: number; common: number }>(g, "inclusion-exclusion", cases);
  const check = checker(g, "inclusion-exclusion");
  cases.forEach((c, i) => {
    const out = outs[i]!;
    if (!check.ran(c, out)) return;
    check.near(c, "a.area()", out.a, c.areaA, c.tolA);
    check.near(c, "b.area()", out.b, c.areaB, c.tolB);
    check.near(c, "union + intersection area", out.union + out.common, out.a + out.b, c.tol);
    // The sum alone cannot tell add from intersect: the union is at least as large as either
    // profile, and the intersection is positive and no larger than either.
    const slack = c.tol * Math.max(1, out.a, out.b);
    check.that(c, out.union >= Math.max(out.a, out.b) - slack, `union area ${out.union} is smaller than a profile (${out.a}, ${out.b})`);
    check.that(c, out.common > 0 && out.common <= Math.min(out.a, out.b) + slack, `intersection area ${out.common} is not in (0, ${Math.min(out.a, out.b)}]`);
  });
  check.done();
});

/** Reflection of point p through the plane (or line) through the origin with normal n. */
function reflect(p: readonly number[], n: readonly number[]): number[] {
  const len = Math.hypot(...n);
  const d = p.reduce((s, x, k) => s + (x * n[k]!) / len, 0);
  return p.map((x, k) => x - (2 * d * n[k]!) / len);
}

test("property: a profile mirrored twice keeps its bounds, and mirrored once reflects its centre", async () => {
  const g = gen(SEED + 5);
  const centres: number[][] = [];
  const cases = Array.from({ length: CASES }, () => {
    const p = profile(g, g.pick(MIRROR_KINDS));
    const t = [g.num(-100, 100), g.num(-100, 100)];
    const n = g.dir(2);
    centres.push(p.symmetric ? reflect(t, n) : []);
    const sketch = `${p.code}.rotate(${g.num(-180, 180)}).translate(${t.join(", ")})`;
    return { label: `${sketch}.mirror([${n.join(", ")}])`, body: `const p = ${sketch}; const m = p.mirror([${n.join(", ")}]); return { before: p.bounds(), once: m.bounds(), twice: m.mirror([${n.join(", ")}]).bounds() };` };
  });
  type B = { min: number[]; max: number[]; center: number[] };
  const outs = await measure<{ before: B; once: B; twice: B }>(g, "sketch mirror", cases);
  const check = checker(g, "sketch mirror");
  cases.forEach((c, i) => {
    const out = outs[i]!;
    if (!check.ran(c, out)) return;
    for (const k of [0, 1]) {
      check.near(c, `bounds min[${k}] after two mirrors`, out.twice.min[k]!, out.before.min[k]!, EXACT);
      check.near(c, `bounds max[${k}] after two mirrors`, out.twice.max[k]!, out.before.max[k]!, EXACT);
      // Only a profile symmetric about its centre keeps its bounds centred on that point.
      if (centres[i]!.length > 0) check.near(c, `bounds center[${k}] after one mirror`, out.once.center[k]!, centres[i]![k]!, EXACT);
    }
  });
  check.done();
});

test("property: a solid mirrored twice keeps its bounds, and mirrored once reflects its centre", async () => {
  const g = gen(SEED + 6);
  const centres: number[][] = [];
  const cases = Array.from({ length: CASES }, () => {
    const a = g.size(), b = g.size(), c = g.size();
    // Each solid is symmetric about this centre: box and cylinder stand on z = 0.
    const [s, z] = g.pick([[`box(${a}, ${b}, ${c})`, c / 2], [`cylinder(${c}, ${a})`, c / 2], [`sphere(${a})`, 0], [`torus(${r3(a + b)}, ${b})`, 0]] as const);
    const t = [g.num(-100, 100), g.num(-100, 100), g.num(-100, 100)];
    const n = g.dir(3);
    centres.push(reflect([t[0]!, t[1]!, t[2]! + z], n));
    const shape = `${s}.translate(${t.join(", ")})`;
    return { label: `${shape}.mirror([${n.join(", ")}])`, body: `const s = ${shape}; const m = s.mirror([${n.join(", ")}]); return { before: s.bounds(), once: m.bounds(), twice: m.mirror([${n.join(", ")}]).bounds() };` };
  });
  type B = { min: number[]; max: number[]; center: number[] };
  const outs = await measure<{ before: B; once: B; twice: B }>(g, "solid mirror", cases);
  const check = checker(g, "solid mirror");
  cases.forEach((c, i) => {
    const out = outs[i]!;
    if (!check.ran(c, out)) return;
    for (const k of [0, 1, 2]) {
      check.near(c, `bounds min[${k}] after two mirrors`, out.twice.min[k]!, out.before.min[k]!, EXACT);
      check.near(c, `bounds max[${k}] after two mirrors`, out.twice.max[k]!, out.before.max[k]!, EXACT);
      check.near(c, `bounds center[${k}] after one mirror`, out.once.center[k]!, centres[i]![k]!, EXACT);
    }
  });
  check.done();
});

// The DSL spike passed the normal as the mirror line's direction, which leaves this profile
// where it was (docs/research/spikes/dsl-brepjs.md). A mirror through the line x = 0 moves it.
test("regression: rect(2, 2).translate(5, 0).mirror([1, 0]) moves the centre to x = -5", async () => {
  const h = await harness();
  const r = await h.run("console.log(JSON.stringify(rect(2, 2).translate(5, 0).mirror([1, 0]).bounds().center));\nreturn box(1, 1, 1);");
  assert.equal(r.ok, true, `${r.error?.code}: ${r.error?.message}`);
  assert.ok(vecNear(r.logs[0] as number[], [-5, 0], EXACT), `centre ${JSON.stringify(r.logs[0])}, want [-5, 0]`);
});
