// lib.*: metric fastener data and the cutters and schematic hardware built from it.
// Cutters are built for a surface at Z = 0 and cut downward (3dj convention): translate them
// to the surface, for example cutter.translate(x, y, surfaceZ).
// Hardware is schematic: smooth shanks and bores, no modelled threads.
import type { Vec3 } from "@open3dj/schemas";
import type { KernelAdapter, ShapeHandle } from "@open3dj/kernel";
import type { GuestValue } from "@open3dj/sandbox";
import { DslError, badArgument } from "./errors.ts";
import { nonNeg, obj, pos, str } from "./state.ts";
import type { ConnectorFrame } from "./state.ts";

export interface FastenerSpec {
  /** Nominal thread diameter. */
  d: number;
  /** Clearance hole diameters, ISO 273: close = fine series, medium, coarse. */
  clearance: { close: number; medium: number; coarse: number };
  /** Hexagon nut, ISO 4032: s = width across flats, m = height (max). */
  nut: { s: number; m: number };
  /** Hexagon socket head cap screw, ISO 4762: head diameter dk (max), head height k (max), socket size s, socket depth t (min). */
  socketHead: { dk: number; k: number; s: number; t: number };
  /** Hexagon socket countersunk head screw, ISO 10642 (M3 and up): theoretical head diameter dk (max), head height k (max). 90 degree head. */
  countersunk: { dk: number; k: number };
  /** Plain washer, ISO 7089 normal series: inner d1 (min), outer d2 (max), thickness h. */
  washer: { d1: number; d2: number; h: number };
  /** Heat-set insert pocket: hole diameter and insert length. Not standardised; see the note below. */
  heatSet: { hole: number; length: number };
}

// Values from the public dimension tables of the standards named in each field above.
// Notes:
// - ISO 10642 starts at M3. The M2 and M2.5 countersunk values are the ISO 7046-1 actual head
//   diameter (max) and head height, as the closest 90 degree countersunk standard.
// - Heat-set insert sizes vary by vendor and no standard covers them. The values below are
//   typical brass insert sizes for 3D-printed parts carried over from the DSL spike; check
//   them against the insert you buy.
export const FASTENERS: Readonly<Record<string, FastenerSpec>> = Object.freeze({
  M2: { d: 2, clearance: { close: 2.2, medium: 2.4, coarse: 2.6 }, nut: { s: 4, m: 1.6 }, socketHead: { dk: 3.8, k: 2, s: 1.5, t: 1 }, countersunk: { dk: 3.8, k: 1.2 }, washer: { d1: 2.2, d2: 5, h: 0.3 }, heatSet: { hole: 3.2, length: 4 } },
  "M2.5": { d: 2.5, clearance: { close: 2.7, medium: 2.9, coarse: 3.1 }, nut: { s: 5, m: 2 }, socketHead: { dk: 4.5, k: 2.5, s: 2, t: 1.1 }, countersunk: { dk: 4.7, k: 1.5 }, washer: { d1: 2.7, d2: 6, h: 0.5 }, heatSet: { hole: 3.6, length: 4 } },
  M3: { d: 3, clearance: { close: 3.2, medium: 3.4, coarse: 3.6 }, nut: { s: 5.5, m: 2.4 }, socketHead: { dk: 5.5, k: 3, s: 2.5, t: 1.3 }, countersunk: { dk: 6.72, k: 1.86 }, washer: { d1: 3.2, d2: 7, h: 0.5 }, heatSet: { hole: 4, length: 5.7 } },
  M4: { d: 4, clearance: { close: 4.3, medium: 4.5, coarse: 4.8 }, nut: { s: 7, m: 3.2 }, socketHead: { dk: 7, k: 4, s: 3, t: 2 }, countersunk: { dk: 8.96, k: 2.48 }, washer: { d1: 4.3, d2: 9, h: 0.8 }, heatSet: { hole: 5.6, length: 8.1 } },
  M5: { d: 5, clearance: { close: 5.3, medium: 5.5, coarse: 5.8 }, nut: { s: 8, m: 4.7 }, socketHead: { dk: 8.5, k: 5, s: 4, t: 2.5 }, countersunk: { dk: 11.2, k: 3.1 }, washer: { d1: 5.3, d2: 10, h: 1 }, heatSet: { hole: 6.4, length: 9.5 } },
  M6: { d: 6, clearance: { close: 6.4, medium: 6.6, coarse: 7 }, nut: { s: 10, m: 5.2 }, socketHead: { dk: 10, k: 6, s: 5, t: 3 }, countersunk: { dk: 13.44, k: 3.72 }, washer: { d1: 6.4, d2: 12, h: 1.6 }, heatSet: { hole: 8, length: 12.7 } },
  M8: { d: 8, clearance: { close: 8.4, medium: 9, coarse: 10 }, nut: { s: 13, m: 6.8 }, socketHead: { dk: 13, k: 8, s: 6, t: 4 }, countersunk: { dk: 17.92, k: 4.96 }, washer: { d1: 8.4, d2: 16, h: 1.6 }, heatSet: { hole: 9.6, length: 12.7 } },
});

/** Radial clearance added around a socket head for its counterbore (Open3DJ's choice, not from a standard). */
export const COUNTERBORE_CLEARANCE = 0.5;

export function fastener(size: GuestValue | undefined): FastenerSpec {
  const s = str(size, "fastener size", 8);
  const spec = FASTENERS[s];
  if (!spec) throw new DslError("DSL_BAD_ARGUMENT", `unknown fastener size ${s}`, `Use one of ${Object.keys(FASTENERS).join(", ")}.`);
  return spec;
}

export interface LibShape {
  handle: ShapeHandle;
  connectors?: Record<string, ConnectorFrame>;
}

const seat = (origin: Vec3, axis: Vec3): ConnectorFrame => ({ kind: "male", type: "seat", origin, axis, up: [1, 0, 0] });

/** Builders for lib.* shapes, on the kernel adapter only. */
export class Library {
  readonly kernel: KernelAdapter;
  constructor(kernel: KernelAdapter) {
    this.kernel = kernel;
  }

  #cyl(r: number, z0: number, z1: number): ShapeHandle {
    return this.kernel.translate(this.kernel.cylinder(r, z1 - z0), [0, 0, z0]);
  }

  #cone(r0: number, r1: number, z0: number, z1: number): ShapeHandle {
    return this.kernel.translate(this.kernel.cone(r0, r1, z1 - z0), [0, 0, z0]);
  }

  /** Hexagonal prism with width s across flats (flats parallel to X), from z0 to z1. */
  #hex(s: number, z0: number, z1: number): ShapeHandle {
    const r = s / Math.sqrt(3);
    const pts = Array.from({ length: 6 }, (_, i) => [r * Math.cos((i * Math.PI) / 3), r * Math.sin((i * Math.PI) / 3), z0] as Vec3);
    return this.kernel.extrude(this.kernel.face(this.kernel.polygon(pts)), [0, 0, z1 - z0]);
  }

  clearanceHole(size: GuestValue | undefined, o: GuestValue | undefined): LibShape {
    const spec = fastener(size);
    const opts = obj(o, "clearanceHole options");
    const length = pos(opts["length"] ?? 10, "length");
    const fit = opts["fit"] ?? "medium";
    if (fit !== "close" && fit !== "medium" && fit !== "coarse") throw badArgument(`clearanceHole fit must be "close", "medium" or "coarse", got ${String(fit)}`);
    return { handle: this.#cyl(spec.clearance[fit] / 2, -length, 1) };
  }

  screwCutter(size: GuestValue | undefined, o: GuestValue | undefined): LibShape {
    const spec = fastener(size);
    const opts = obj(o, "screwCutter options");
    const length = pos(opts["length"] ?? 10, "length");
    const head = opts["head"] ?? "socket";
    const clearance = nonNeg(opts["clearance"] ?? 0, "clearance");
    const rs = spec.clearance.medium / 2 + clearance;
    const parts = [this.#cyl(rs, -length, 1)];
    if (head === "countersunk") {
      const R = spec.countersunk.dk / 2 + clearance;
      const depth = R - rs; // 90 degree head: the cone drops 1 mm per 1 mm of radius
      parts.push(this.#cone(rs, R, -depth, 0), this.#cyl(R, 0, 1));
    } else if (head === "socket" || head === "counterbore") {
      const R = spec.socketHead.dk / 2 + COUNTERBORE_CLEARANCE + clearance;
      parts.push(this.#cyl(R, -spec.socketHead.k, 1));
    } else if (head !== "none") {
      throw badArgument(`screwCutter head must be "socket", "countersunk", "counterbore" or "none", got ${String(head)}`);
    }
    return { handle: this.kernel.fuseAll(parts) };
  }

  heatSetPocket(size: GuestValue | undefined, o: GuestValue | undefined): LibShape {
    const spec = fastener(size);
    const opts = obj(o, "heatSetPocket options");
    const depth = opts["depth"] === undefined ? spec.heatSet.length : pos(opts["depth"], "depth");
    const clearance = nonNeg(opts["clearance"] ?? 0, "clearance");
    return { handle: this.#cyl(spec.heatSet.hole / 2 + clearance, -depth, 0.5) };
  }

  hexNutPocket(size: GuestValue | undefined, o: GuestValue | undefined): LibShape {
    const spec = fastener(size);
    const opts = obj(o, "hexNutPocket options");
    const depth = opts["depth"] === undefined ? spec.nut.m : pos(opts["depth"], "depth");
    const clearance = nonNeg(opts["clearance"] ?? 0.2, "clearance");
    return { handle: this.#hex(spec.nut.s + 2 * clearance, -depth, 0.5) };
  }

  /** ISO 4762 socket head cap screw: head from z = 0 up to k, shank from z = -length to 0. */
  bolt(size: GuestValue | undefined, len: GuestValue | undefined): LibShape {
    const spec = fastener(size);
    const length = pos(len, "bolt length");
    const { dk, k, s, t } = spec.socketHead;
    const head = this.kernel.cut(this.#cyl(dk / 2, 0, k), this.#hex(s, k - t, k + 1));
    const handle = this.kernel.fuseAll([head, this.#cyl(spec.d / 2, -length, 0)]);
    return { handle, connectors: { head_seat: seat([0, 0, 0], [0, 0, -1]), tip: { kind: "male", type: "tip", origin: [0, 0, -length], axis: [0, 0, -1], up: [1, 0, 0] } } };
  }

  /** ISO 4032 hexagon nut, centred on the origin, with a plain bore of the nominal diameter. */
  nut(size: GuestValue | undefined): LibShape {
    const spec = fastener(size);
    const { s, m } = spec.nut;
    const handle = this.kernel.cut(this.#hex(s, -m / 2, m / 2), this.#cyl(spec.d / 2, -m / 2 - 1, m / 2 + 1));
    return { handle, connectors: { seat: seat([0, 0, -m / 2], [0, 0, -1]) } };
  }

  /** ISO 7089 plain washer, centred on the origin. */
  washer(size: GuestValue | undefined): LibShape {
    const spec = fastener(size);
    const { d1, d2, h } = spec.washer;
    const handle = this.kernel.cut(this.#cyl(d2 / 2, -h / 2, h / 2), this.#cyl(d1 / 2, -h / 2 - 1, h / 2 + 1));
    return { handle, connectors: { seat: seat([0, 0, -h / 2], [0, 0, -1]) } };
  }
}


