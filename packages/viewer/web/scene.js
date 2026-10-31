// The model in the scene.
//
// Geometry: every occurrence of a definition shares one BufferGeometry, drawn as one
// InstancedMesh per definition and colour. When an assembly has many distinct definitions
// (more groups than BATCH_GROUPS), every part goes into one BatchedMesh instead, which draws
// them all in one multi-draw call and culls each instance against the view.
//
// Faces and edges: each definition's triangles are split into its B-rep faces (faces.js), so a
// pick resolves to an occurrence path plus a face, and the edges drawn are the seams between
// faces, merged for the whole assembly into one line object (one draw call).
//
// State changes (selection, hide, isolate, explode, section, agent highlights) only rewrite
// instance matrices, colours and the merged edge buffer; geometry is never rebuilt.
import {
  BackSide, BatchedMesh, Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Plane, Quaternion, SphereGeometry, Vector3,
} from "three";
import { fitAnchor, fitPairs, markerVisible } from "./fits.js";
import { edgeSnapPx, faceAddressing, faceEdges, faceOfTriangle, faceRanges } from "./faces.js";
import { LEGENDS, classifyMesh, explodeOffsets, rotationKey } from "./analysis.js";

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
/** More (definition, colour) groups than this go into one BatchedMesh (when batching is "auto"). */
export const BATCH_GROUPS = 24;
const FIT_KINDS = ["clash", "contact", "clearance"];
/** Fit markers are this many pixels in radius at any zoom. */
const MARKER_PX = 5;
/** How far a selected part is tinted toward the accent: the whole part, or a part with a picked face or edge. */
const PART_TINT = 0.55;
const ELEMENT_PART_TINT = 0.12;

export class ModelScene {
  /**
   * options.fatEdges(positions, colors, material) -> { object, setColors(colors), dispose() } or null,
   * from main.js, which knows the renderer and loads the line modules.
   */
  constructor(options = {}) {
    this.group = new Group();
    this.group.name = "model";
    this.faces = new Group();
    this.caps = new Group();
    this.overlay = new Group();
    this.edges = new Group();
    this.highlight = new Group();
    this.markers = new Group();
    this.measureGroup = new Group();
    this.group.add(this.faces, this.caps, this.overlay, this.edges, this.highlight, this.markers, this.measureGroup);
    /** path -> part */
    this.parts = new Map();
    /** BufferGeometry -> definition info (faces, edges, addresses) */
    this.infos = new Map();
    this.drawables = [];
    this.fitMarkers = [];
    this.fits = [];
    this.disposables = [];
    this.planes = [];
    this.clip = [new Plane(new Vector3(-1, 0, 0), 0)];
    this.faceMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    // Caps are the back faces seen through the cut, drawn flat in a darker shade of the part colour.
    this.capMaterial = new MeshBasicMaterial({ color: new Color().setScalar(0.45), side: BackSide });
    this.edgeMaterial = new LineBasicMaterial({ color: 0xffffff, vertexColors: true });
    this.overlayMaterial = new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    // Hover: a faint fill and the face outline (outline only while an analysis overlay shows its
    // own colours). Picked: a strong fill in a second tone, outlined in the accent at a heavier
    // weight, so the face stands out from its lightly tinted part.
    this.hoverMaterial = new MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.16, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    this.pickedMaterial = new MeshBasicMaterial({ color: 0x0b3fa8, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    this.hoverEdgeMaterial = new LineBasicMaterial({ color: 0x2563eb, depthTest: false, transparent: true });
    this.outlineMaterial = new LineBasicMaterial({ color: 0x2563eb, transparent: true });
    this.outlineColor = new Color(0x2563eb);
    // What an agent points at (render view=highlight): its parts are tinted and its faces filled.
    this.agentMaterial = new MeshBasicMaterial({ color: 0xc026d3, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
    this.agentColor = new Color(0xc026d3);
    // Agent targets hidden behind other parts still show: their edges, drawn through everything.
    this.agentThroughMaterial = new LineBasicMaterial({ color: 0xc026d3, depthTest: false, depthWrite: false, transparent: true, opacity: 0.75 });
    this.agentPaths = new Set();
    this.agentOutline = new Set();
    this.agentThrough = null;
    this.agentFaces = [];
    /** Paths with a picked face or edge: tinted lightly, so the element stands out. */
    this.elementPaths = new Set();
    this.pixelSize = 0;
    this.edgeColor = new Color(0x1d232b);
    this.accent = new Color(0x2563eb);
    this.edgesOn = true;
    this.markersOn = true;
    this.xray = false;
    this.explode = 0;
    this.section = null;
    this.overlayOptions = null;
    this.overlayStats = null;
    this.batch = "auto";
    this.batched = false;
    this.fatEdges = options.fatEdges ?? null;
    this.edgeStyle = "thin";
    this.edgeObject = null;
    this.markerGeometry = new SphereGeometry(1, 12, 8);
    this.state = { selected: new Set(), hidden: new Set(), isolated: null, activeFit: -1 };
    for (const m of this.clippedMaterials()) m.clippingPlanes = this.planes;
    this.hoverFace = this.elementMesh(this.hoverMaterial);
    this.hoverEdge = new LineSegments(new BufferGeometry(), this.outlineMaterial);
    this.hoverEdge.matrixAutoUpdate = false;
    this.hoverEdge.renderOrder = 20;
    this.hoverEdge.visible = false;
    this.highlight.add(this.hoverFace, this.hoverEdge);
    this.picked = [];
  }

  clippedMaterials() {
    return [this.faceMaterial, this.capMaterial, this.edgeMaterial, this.overlayMaterial, this.hoverMaterial, this.pickedMaterial, this.hoverEdgeMaterial, this.outlineMaterial, this.agentMaterial, this.agentThroughMaterial];
  }

  elementMesh(material) {
    const m = new Mesh(new BufferGeometry(), material);
    m.matrixAutoUpdate = false;
    m.visible = false;
    m.renderOrder = 15;
    m.frustumCulled = false;
    return m;
  }

  // ---- build -----------------------------------------------------------------------------

  /**
   * Build from a parsed GLB (glb.js). defOf(path) names the definition of an occurrence and
   * kernelFaces(def) its face count from the report (the kernel's number), which decides
   * whether face indices are element addresses.
   */
  build(parsed, fits, defOf = () => undefined, kernelFaces = () => undefined) {
    this.clear();
    this.fits = fits ?? [];
    const byGroup = new Map();
    for (const p of parsed.parts) {
      const key = `${p.geometryKey}|${p.color.getHexString()}`;
      let g = byGroup.get(key);
      if (!g) byGroup.set(key, (g = { geometry: p.geometry, color: p.color, parts: [] }));
      g.parts.push(p);
      const def = defOf(p.path);
      if (!this.infos.has(p.geometry)) this.infos.set(p.geometry, this.describe(p.geometry, def, kernelFaces(def)));
    }
    this.batched = this.batch === "on" || (this.batch === "auto" && byGroup.size > BATCH_GROUPS);
    if (this.batched) this.buildBatched([...byGroup.values()]);
    else this.buildInstanced([...byGroup.values()]);
    for (const geometry of this.infos.keys()) this.disposables.push(geometry);
    const box = new Box3();
    for (const p of this.parts.values()) box.union(p.base);
    this.centre = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
    this.offsets = new Map();
    this.buildMarkers();
    this.applyMatrices();
    this.applyColors();
  }

  /** Faces, edges and addresses of one definition's geometry. */
  describe(geometry, def, kernelCount) {
    const positions = geometry.attributes.position.array;
    const index = geometry.index ? geometry.index.array : Uint32Array.from({ length: positions.length / 3 }, (_, i) => i);
    const ranges = faceRanges(index, positions.length / 3);
    const addressing = faceAddressing(ranges, kernelCount);
    const { edges, faceEdges: byFace } = faceEdges(positions, index, ranges.starts);
    let n = 0;
    for (const e of edges) n += e.segments.length;
    const segments = new Float32Array(n);
    let at = 0;
    for (const e of edges) {
      segments.set(e.segments, at);
      at += e.segments.length;
    }
    return { geometry, def, ranges, addressing, edges, faceEdges: byFace, segments, index, positions, boundaries: new Map() };
  }

  addPart(p, drawable, slot) {
    const base = p.geometry.boundingBox.clone().applyMatrix4(p.matrix);
    const part = {
      path: p.path, name: p.name, geometry: p.geometry, info: this.infos.get(p.geometry), drawable, slot,
      color: p.color.clone(), matrix: p.matrix.clone(), world: p.matrix.clone(), base, box: base.clone(),
      centre: base.getCenter(new Vector3()), offset: new Vector3(), visible: true,
    };
    this.parts.set(p.path, part);
    return part;
  }

  buildInstanced(groups) {
    for (const g of groups) {
      const mesh = new InstancedMesh(g.geometry, this.faceMaterial, g.parts.length);
      mesh.name = g.parts[0].name;
      mesh.userData.paths = g.parts.map((p) => p.path);
      const drawable = { kind: "instanced", mesh, cap: null, geometry: g.geometry };
      g.parts.forEach((p, index) => {
        this.addPart(p, drawable, index);
        mesh.setColorAt(index, p.color);
      });
      this.faces.add(mesh);
      this.drawables.push(drawable);
    }
  }

  buildBatched(groups) {
    const parts = groups.flatMap((g) => g.parts);
    const geometries = [...new Set(parts.map((p) => p.geometry))];
    let vertices = 0;
    let indices = 0;
    for (const g of geometries) {
      vertices += g.attributes.position.count;
      indices += g.index ? g.index.count : g.attributes.position.count;
    }
    const make = (material) => {
      const mesh = new BatchedMesh(parts.length, vertices, indices, material);
      const ids = new Map(geometries.map((g) => [g, mesh.addGeometry(g)]));
      mesh.userData.paths = [];
      mesh.userData.starts = new Map();
      for (const [g, id] of ids) mesh.userData.starts.set(id, mesh.getGeometryRangeAt(id).start / 3);
      for (const p of parts) {
        const instance = mesh.addInstance(ids.get(p.geometry));
        mesh.userData.paths[instance] = p.path;
        mesh.setColorAt(instance, p.color);
      }
      return mesh;
    };
    const mesh = make(this.faceMaterial);
    mesh.name = "batched";
    const drawable = { kind: "batched", mesh, cap: null, make };
    parts.forEach((p, i) => this.addPart(p, drawable, i));
    this.faces.add(mesh);
    this.drawables.push(drawable);
  }

  buildMarkers() {
    for (const m of this.fitMarkers) {
      this.markers.remove(m);
      m.material.dispose();
      m.dispose();
    }
    this.fitMarkers = [];
    this.markerList = [];
    const size = this.baseBox().getSize(new Vector3()).length() || 1;
    // Until the first frame tells the pixel size: a small fraction of the assembly.
    this.markerRadius = this.pixelSize > 0 ? MARKER_PX * this.pixelSize : Math.max(size * 0.008, 0.05);
    this.fits.forEach((fit, fitIndex) => {
      for (const [a, b] of fitPairs(fit)) {
        const pa = this.parts.get(a);
        const pb = this.parts.get(b);
        if (!pa || !pb) continue;
        const at = fitAnchor({ min: pa.base.min.toArray(), max: pa.base.max.toArray() }, { min: pb.base.min.toArray(), max: pb.base.max.toArray() });
        this.markerList.push({ fitIndex, kind: fit.kind, a, b, at: new Vector3(...at) });
      }
    });
    for (const kind of FIT_KINDS) {
      const list = this.markerList.filter((m) => m.kind === kind);
      if (!list.length) continue;
      const material = new MeshBasicMaterial({ color: markerColor(kind), depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 });
      material.clippingPlanes = this.planes;
      const mesh = new InstancedMesh(this.markerGeometry, material, list.length);
      mesh.renderOrder = 10;
      mesh.userData = { kind, list };
      mesh.frustumCulled = false;
      this.markers.add(mesh);
      this.fitMarkers.push(mesh);
    }
  }

  // ---- state -----------------------------------------------------------------------------

  /** Apply selection, hidden, isolated and active-fit state. Matrices change only when visibility does. */
  refresh({ selected = new Set(), hidden = new Set(), isolated = null, activeFit = -1 } = {}) {
    const visibilityChanged = this.state.hidden !== hidden || this.state.isolated !== isolated || this.visibilityKey !== visibilityKey(hidden, isolated);
    this.state = { selected, hidden, isolated, activeFit };
    if (visibilityChanged) this.applyMatrices();
    else this.applyMarkers();
    this.applyColors();
  }

  isVisible(path) {
    const { hidden, isolated } = this.state;
    return !hidden.has(path) && (!isolated || isolated.has(path));
  }

  /** Instance matrices with explode offsets and visibility, edges, overlay and markers. */
  applyMatrices() {
    this.visibilityKey = visibilityKey(this.state.hidden, this.state.isolated);
    const t = new Matrix4();
    for (const p of this.parts.values()) {
      p.visible = this.isVisible(p.path);
      const o = this.offsets.get(p.path);
      if (o) p.offset.set(o[0], o[1], o[2]);
      else p.offset.set(0, 0, 0);
      p.world.copy(t.makeTranslation(p.offset.x, p.offset.y, p.offset.z).multiply(p.matrix));
      p.box.copy(p.base).translate(p.offset);
      for (const target of targets(p.drawable)) {
        if (p.drawable.kind === "instanced") target.setMatrixAt(p.slot, p.visible ? p.world : HIDDEN);
        else {
          target.setMatrixAt(p.slot, p.world);
          target.setVisibleAt(p.slot, p.visible);
        }
      }
    }
    for (const d of this.drawables) {
      if (d.kind !== "instanced") continue;
      d.mesh.instanceMatrix.needsUpdate = true;
      d.mesh.computeBoundingBox();
      d.mesh.computeBoundingSphere();
      if (d.cap) {
        d.cap.boundingBox = d.mesh.boundingBox;
        d.cap.boundingSphere = d.mesh.boundingSphere;
      }
    }
    this.rebuildEdges();
    if (this.overlayOptions) this.buildOverlay(this.overlayOptions);
    this.applyMarkers();
    this.syncHighlights();
    if (this.agentOutline.size) this.rebuildAgentThrough();
  }

  applyColors() {
    const c = new Color();
    const { selected } = this.state;
    for (const p of this.parts.values()) {
      if (selected.has(p.path)) c.copy(p.color).lerp(this.accent, this.elementPaths.has(p.path) ? ELEMENT_PART_TINT : PART_TINT);
      else if (this.agentPaths.has(p.path)) c.copy(p.color).lerp(this.agentColor, 0.5);
      else c.copy(p.color);
      for (const target of targets(p.drawable)) target.setColorAt(p.slot, c);
    }
    for (const d of this.drawables) if (d.kind === "instanced" && d.mesh.instanceColor) d.mesh.instanceColor.needsUpdate = true;
    this.colorEdges();
  }

  applyMarkers() {
    const m = new Matrix4();
    const s = new Vector3();
    const { hidden, isolated, activeFit } = this.state;
    for (const mesh of this.fitMarkers) {
      mesh.userData.list.forEach((mk, i) => {
        // Exploded parts no longer touch, so the markers between them would float in empty space.
        const visible = this.explode === 0 && markerVisible(this.markersOn, mk.a, mk.b, hidden, isolated);
        const pa = this.parts.get(mk.a);
        const pb = this.parts.get(mk.b);
        const at = mk.at.clone().addScaledVector(pa.offset, 0.5).addScaledVector(pb.offset, 0.5);
        const r = visible ? this.markerRadius * (mk.fitIndex === activeFit ? 1.8 : 1) : 0;
        m.compose(at, IDENTITY_Q, s.setScalar(r));
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * World units per screen pixel at the view target (from main.js before each frame). Fit
   * markers keep a constant size on screen; returns true when they were resized.
   */
  setPixelSize(size) {
    if (!(size > 0) || Math.abs(size - this.pixelSize) <= this.pixelSize * 0.03) return false;
    this.pixelSize = size;
    this.markerRadius = MARKER_PX * size;
    if (this.fitMarkers.length) this.applyMarkers();
    return true;
  }

  setMarkerColors() {
    for (const mesh of this.fitMarkers) mesh.material.color.copy(markerColor(mesh.userData.kind));
  }

  // ---- edges -----------------------------------------------------------------------------

  /** The merged edge buffer: every visible occurrence's face seams in world space. */
  rebuildEdges() {
    this.disposeEdges();
    if (!this.edgesOn) return;
    let floats = 0;
    for (const p of this.parts.values()) if (p.visible) floats += p.info.segments.length;
    const positions = new Float32Array(floats);
    this.edgeRanges = new Map();
    let at = 0;
    for (const p of this.parts.values()) {
      if (!p.visible) continue;
      const src = p.info.segments;
      const e = p.world.elements;
      this.edgeRanges.set(p.path, [at, src.length]);
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i];
        const y = src[i + 1];
        const z = src[i + 2];
        positions[at++] = e[0] * x + e[4] * y + e[8] * z + e[12];
        positions[at++] = e[1] * x + e[5] * y + e[9] * z + e[13];
        positions[at++] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
    }
    this.edgeColors = new Float32Array(floats);
    this.edgePositions = positions;
    this.fillEdgeColors();
    if (this.edgeStyle === "fat" && this.fatEdges) {
      const fat = this.fatEdges(positions, this.edgeColors, this.planes);
      if (fat) {
        this.edgeFat = fat;
        this.edgeObject = fat.object;
      }
    }
    if (!this.edgeObject) {
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(positions, 3));
      g.setAttribute("color", new BufferAttribute(this.edgeColors, 3));
      g.computeBoundingSphere();
      this.edgeObject = new LineSegments(g, this.edgeMaterial);
    }
    this.edgeObject.renderOrder = 1;
    this.edges.add(this.edgeObject);
  }

  fillEdgeColors() {
    const colors = this.edgeColors;
    if (!colors) return;
    const { selected } = this.state;
    for (const [path, [start, length]] of this.edgeRanges) {
      const c = selected.has(path) ? this.accent : this.edgeColor;
      for (let i = start; i < start + length; i += 3) {
        colors[i] = c.r;
        colors[i + 1] = c.g;
        colors[i + 2] = c.b;
      }
    }
  }

  colorEdges() {
    if (!this.edgeObject) return;
    this.fillEdgeColors();
    if (this.edgeFat) this.edgeFat.setColors(this.edgeColors);
    else this.edgeObject.geometry.attributes.color.needsUpdate = true;
  }

  disposeEdges() {
    if (this.edgeObject) {
      this.edges.remove(this.edgeObject);
      if (this.edgeFat) this.edgeFat.dispose();
      else this.edgeObject.geometry.dispose();
    }
    this.edgeObject = null;
    this.edgeFat = null;
    this.edgeColors = null;
  }

  setEdges(on, style = this.edgeStyle) {
    this.edgesOn = on;
    this.edgeStyle = style;
    this.rebuildEdges();
  }

  // ---- views: explode, section, x-ray ------------------------------------------------------

  /** Exploded view: factor 0 is assembled; 1 moves each part out by its distance from the centre. */
  setExplode(factor) {
    this.explode = factor;
    const centres = new Map([...this.parts.values()].map((p) => [p.path, p.centre.toArray()]));
    this.offsets = factor > 0 ? explodeOffsets(centres, this.centre.toArray(), factor) : new Map();
    this.applyMatrices();
  }

  /**
   * Section plane: axis "x", "y" or "z" (null for none), at a coordinate in mm, keeping the side
   * below it (flip keeps the side above). Cut faces are filled: the back faces seen through
   * the cut are drawn flat in the part's colour, which reads as a solid cap on closed solids.
   */
  setSection(section) {
    this.section = section?.axis ? { ...section } : null;
    this.planes.length = 0;
    if (this.section) {
      const n = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[this.section.axis];
      const sign = this.section.flip ? 1 : -1;
      this.clip[0].normal.set(n[0] * sign, n[1] * sign, n[2] * sign);
      this.clip[0].constant = -sign * this.section.at;
      this.planes.push(this.clip[0]);
    }
    for (const m of this.clippedMaterials()) m.needsUpdate = true;
    for (const mesh of this.fitMarkers) mesh.material.needsUpdate = true;
    this.edgeFat?.setClipping?.(this.planes);
    for (const o of this.picked) o.userData.setClipping?.(this.planes);
    this.syncCaps();
  }

  syncCaps() {
    const on = !!this.section;
    let createdBatched = false;
    for (const d of this.drawables) {
      if (on && !d.cap) {
        if (d.kind === "instanced") {
          const cap = new InstancedMesh(d.geometry, this.capMaterial, d.mesh.count);
          cap.instanceMatrix = d.mesh.instanceMatrix;
          cap.instanceColor = d.mesh.instanceColor;
          cap.boundingBox = d.mesh.boundingBox;
          cap.boundingSphere = d.mesh.boundingSphere;
          d.cap = cap;
        } else {
          d.cap = d.make(this.capMaterial);
          createdBatched = true;
        }
        this.caps.add(d.cap);
      } else if (!on && d.cap) {
        this.caps.remove(d.cap);
        if (d.kind === "batched") d.cap.dispose();
        d.cap = null;
      }
    }
    // A new batched cap needs the current matrices, visibility and colours; an existing one
    // already follows them (applyMatrices and applyColors write to both).
    if (createdBatched) {
      this.applyMatrices();
      this.applyColors();
    }
  }

  setXray(on) {
    this.xray = on;
    for (const m of [this.faceMaterial, this.overlayMaterial]) {
      m.transparent = on;
      m.opacity = on ? 0.22 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
    // Opaque caps would hide the inside again: with x-ray the cut shows as the clipped shells.
    this.caps.visible = !on;
  }

  // ---- analysis overlays ---------------------------------------------------------------------

  /**
   * Overlay: { kind: "overhang" | "draft", limitDeg, pull, minDeg, colors: { class: Color } }.
   * Parts with the same definition and the same turn share one coloured mesh, drawn instanced.
   * Returns the observed area per class (mm²), summed over the visible occurrences.
   */
  setOverlay(options) {
    this.overlayOptions = options;
    this.buildOverlay(options);
    return this.overlayStats;
  }

  buildOverlay(options) {
    // The coloured geometries share the definitions' buffers and stay cached: only the
    // instanced meshes are made again.
    for (const m of [...this.overlay.children]) {
      this.overlay.remove(m);
      m.dispose();
    }
    for (const d of this.drawables) d.mesh.visible = !options;
    this.overlayStats = null;
    if (!options) return;
    const kinds = LEGENDS[options.kind].map((e) => e[0]);
    const totals = kinds.map(() => 0);
    const groups = new Map();
    for (const p of this.parts.values()) {
      if (!p.visible) continue;
      const key = `${p.geometry.uuid}|${rotationKey(p.matrix.elements)}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { part: p, parts: [] }));
      g.parts.push(p);
    }
    // Classes depend on the definition, its turn and the options, not on where the part sits:
    // they are kept while only visibility or the explode offsets change.
    const signature = `${options.kind}|${options.limitDeg}|${options.pull}|${options.minDeg}|${kinds.map((k) => options.colors[k].getHexString()).join(",")}`;
    if (this.overlayCacheKey !== signature) {
      this.dropOverlayCache();
      this.overlayCacheKey = signature;
    }
    for (const [key, g] of groups) {
      const geo = g.part.geometry;
      let cached = this.overlayCache.get(key);
      if (!cached) {
        const { vertexClass, area } = classifyMesh(geo.attributes.position.array, geo.attributes.normal.array, g.part.info.index, g.part.matrix.elements, options);
        const colors = new Float32Array(vertexClass.length * 3);
        const palette = kinds.map((k) => options.colors[k]);
        for (let i = 0; i < vertexClass.length; i++) {
          const c = palette[vertexClass[i]];
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        const og = new BufferGeometry();
        og.setAttribute("position", geo.attributes.position);
        og.setAttribute("normal", geo.attributes.normal);
        og.setAttribute("color", new Float32BufferAttribute(colors, 3));
        og.setIndex(geo.index);
        og.boundingBox = geo.boundingBox;
        og.boundingSphere = geo.boundingSphere;
        cached = { geometry: og, area };
        this.overlayCache.set(key, cached);
      }
      cached.area.forEach((a, i) => (totals[i] += a * g.parts.length));
      const mesh = new InstancedMesh(cached.geometry, this.overlayMaterial, g.parts.length);
      g.parts.forEach((p, i) => mesh.setMatrixAt(i, p.world));
      mesh.computeBoundingSphere();
      this.overlay.add(mesh);
    }
    this.overlayStats = Object.fromEntries(kinds.map((k, i) => [k, totals[i]]));
  }

  /** Forget the coloured overlay geometries; their own colour buffer is freed, the shared ones stay. */
  dropOverlayCache() {
    for (const { geometry } of this.overlayCache?.values() ?? []) {
      geometry.deleteAttribute("position");
      geometry.deleteAttribute("normal");
      geometry.setIndex(null);
      geometry.dispose();
    }
    this.overlayCache = new Map();
  }

  // ---- picking -----------------------------------------------------------------------------

  /**
   * What the ray hits first, skipping hidden parts and the cut-away side of a section:
   * { path, part, point (world), local (definition frame), normal (world), tri, face } or null.
   * With a section on, a part whose front was cut away shows its cap, which is drawn from back
   * faces: when the first thing the ray meets on the kept side is a back face, the ray is inside
   * that part, so the hit is its cap (where the ray crosses the plane), with cap: true and no face.
   */
  pick(raycaster) {
    const sectioned = this.planes.length > 0;
    const side = this.faceMaterial.side;
    if (sectioned) this.faceMaterial.side = DoubleSide;
    let hits;
    try {
      hits = raycaster.intersectObjects(this.drawables.map((d) => d.mesh), false);
    } finally {
      this.faceMaterial.side = side;
    }
    const dir = raycaster.ray.direction;
    for (const h of hits) {
      if (this.planes.some((pl) => pl.distanceToPoint(h.point) < 0)) continue;
      const mesh = h.object;
      let path;
      let tri;
      if (mesh.isBatchedMesh) {
        path = mesh.userData.paths[h.batchId];
        tri = h.faceIndex - mesh.userData.starts.get(mesh.getGeometryIdAt(h.batchId));
      } else {
        path = mesh.userData.paths?.[h.instanceId];
        tri = h.faceIndex;
      }
      const part = path && this.parts.get(path);
      if (!part || !part.visible) continue;
      const inv = new Matrix4().copy(part.world).invert();
      const normal = h.face ? h.face.normal.clone().transformDirection(part.world) : new Vector3(0, 0, 1);
      if (sectioned && normal.dot(dir) > 0) {
        const plane = this.planes[0];
        const at = raycaster.ray.intersectPlane(plane, new Vector3());
        if (!at || at.distanceTo(raycaster.ray.origin) > h.distance + 1e-6) continue;
        const n = plane.normal.clone();
        if (n.dot(dir) > 0) n.negate();
        return { path, part, point: at, local: at.clone().applyMatrix4(inv), normal: n, tri: -1, face: -1, cap: true };
      }
      const face = faceOfTriangle(part.info.ranges.starts, tri);
      return { path, part, point: h.point.clone(), local: h.point.clone().applyMatrix4(inv), normal, tri, face };
    }
    return null;
  }

  /**
   * The edge of the hit face nearest to the pointer on screen: { edge, faces, length } or null.
   * project(Vector3) gives pixel coordinates. The snap distance shrinks with the face's size on
   * screen (edgeSnapPx), so on a zoomed-out assembly a click keeps the face and its address.
   */
  nearestEdge(hit, px, py, project, maxPx = 4) {
    if (!hit || hit.face < 0) return null;
    const info = hit.part.info;
    let best = null;
    const a = new Vector3();
    const b = new Vector3();
    const projected = [];
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of info.faceEdges[hit.face] ?? []) {
      const s = info.edges[id].segments;
      for (let i = 0; i + 5 < s.length; i += 6) {
        const pa = project(a.set(s[i], s[i + 1], s[i + 2]).applyMatrix4(hit.part.world));
        const pb = project(b.set(s[i + 3], s[i + 4], s[i + 5]).applyMatrix4(hit.part.world));
        projected.push([id, pa, pb]);
        for (const p of [pa, pb]) {
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
      }
    }
    const snap = edgeSnapPx(Math.max(x1 - x0, y1 - y0), maxPx);
    for (const [id, pa, pb] of projected) {
      const d = pointSegment(px, py, pa, pb);
      if (d <= snap && (!best || d < best.d)) best = { d, edge: id };
    }
    if (!best) return null;
    const e = info.edges[best.edge];
    return { edge: best.edge, faces: e.faces, length: e.length };
  }

  /** The element under a hit: a face, an edge when one is near the pointer, or a section cap. */
  element(hit, edge) {
    if (hit.cap) return { kind: "cap", path: hit.path };
    const { addressed, reason } = hit.part.info.addressing;
    if (edge) return { kind: "edge", path: hit.path, edge: edge.edge, faces: edge.faces, addressed, reason };
    return { kind: "face", path: hit.path, face: hit.face, addressed, reason };
  }

  // ---- highlights ----------------------------------------------------------------------------

  setHover(element) {
    this.hovered = element;
    this.syncHighlights();
  }

  /** Elements shown as picked (selected faces and edges, measure picks). */
  setPicked(elements) {
    // Face highlights share the definitions' buffers, so their meshes are pooled, never disposed
    // (disposing a geometry frees the GPU buffers of every attribute it holds).
    this.facePool ??= [];
    for (const m of this.picked) {
      this.highlight.remove(m);
      if (m.isMesh && !m.userData.outline) this.facePool.push(m);
      else if (m.userData.dispose) m.userData.dispose();
      else m.geometry.dispose();
    }
    this.picked = [];
    this.elementPaths = new Set();
    for (const el of elements) {
      const part = this.parts.get(el.path);
      if (!part || (el.kind !== "face" && el.kind !== "edge")) continue;
      this.elementPaths.add(el.path);
      const add = (obj) => {
        obj.matrixAutoUpdate = false;
        obj.renderOrder = 16;
        obj.userData.element = el;
        this.highlight.add(obj);
        this.picked.push(obj);
      };
      if (el.kind === "face") {
        add(this.facePool.pop() ?? this.elementMesh(this.pickedMaterial));
        // The face's boundary in the accent, heavier than the model edges.
        const outline = this.outlineObject(this.boundary(part.info, el.face), this.accent, 3);
        if (outline) add(outline);
      } else {
        const line = this.outlineObject(part.info.edges[el.edge]?.segments ?? new Float32Array(0), this.accent, 3);
        if (line) add(line);
      }
    }
    this.applyColors();
    this.syncHighlights();
  }

  /** The boundary of face f of a definition, as line segments in its frame (cached). */
  boundary(info, f) {
    let b = info.boundaries.get(f);
    if (!b) {
      const ids = info.faceEdges[f] ?? [];
      let n = 0;
      for (const id of ids) n += info.edges[id].segments.length;
      b = new Float32Array(n);
      let at = 0;
      for (const id of ids) {
        b.set(info.edges[id].segments, at);
        at += info.edges[id].segments.length;
      }
      info.boundaries.set(f, b);
    }
    return b;
  }

  /**
   * Lines in one colour, as fat lines of width px when main.js could load them, else thin lines.
   * The object is positioned by its matrix; userData.dispose frees it.
   */
  outlineObject(segments, color, px) {
    if (segments.length === 0) return null;
    const colors = new Float32Array(segments.length);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = color.r;
      colors[i + 1] = color.g;
      colors[i + 2] = color.b;
    }
    const fat = this.fatEdges?.(segments, colors, this.planes, px);
    if (fat) {
      fat.object.userData.outline = true;
      fat.object.userData.dispose = () => fat.dispose();
      fat.object.userData.setClipping = fat.setClipping;
      return fat.object;
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(segments, 3));
    g.computeBoundingSphere();
    const m = new LineSegments(g, this.outlineMaterial);
    m.userData.outline = true;
    return m;
  }

  /**
   * Show what an agent points at: tint (Set) are the parts it names whole, tinted in the agent
   * colour; faces ([{ path, face }], 0-based face indices) are filled in that colour and their
   * parts are not tinted; through (Set) are every part it names, whose edges are drawn through
   * the parts in front of them. Empty arguments clear it.
   */
  setAgent(paths = new Set(), faces = [], through = paths) {
    this.agentPool ??= [];
    for (const m of this.agentFaces) {
      this.highlight.remove(m);
      this.agentPool.push(m);
    }
    this.agentFaces = [];
    this.agentPaths = new Set([...paths].filter((p) => this.parts.has(p)));
    this.agentOutline = new Set([...through].filter((p) => this.parts.has(p)));
    this.rebuildAgentThrough();
    for (const el of faces) {
      const part = this.parts.get(el.path);
      if (!part || !(el.face >= 0) || el.face >= part.info.ranges.starts.length - 1) continue;
      const m = this.agentPool.pop() ?? this.elementMesh(this.agentMaterial);
      m.renderOrder = 17;
      m.userData.element = { kind: "face", path: el.path, face: el.face };
      this.highlight.add(m);
      this.agentFaces.push(m);
    }
    this.applyColors();
    this.syncHighlights();
  }

  setAgentColor(color) {
    this.agentColor.set(color);
    this.agentMaterial.color.set(color);
    this.agentThroughMaterial.color.set(color);
    this.applyColors();
  }

  /** The agent targets' edges in world space, drawn without the depth test. */
  rebuildAgentThrough() {
    if (this.agentThrough) {
      this.highlight.remove(this.agentThrough);
      this.agentThrough.geometry.dispose();
      this.agentThrough = null;
    }
    const list = [...this.agentOutline].map((p) => this.parts.get(p)).filter((p) => p?.visible);
    if (list.length === 0) return;
    let n = 0;
    for (const p of list) n += p.info.segments.length;
    const out = new Float32Array(n);
    let at = 0;
    for (const p of list) {
      const src = p.info.segments;
      const e = p.world.elements;
      for (let i = 0; i < src.length; i += 3) {
        const x = src[i];
        const y = src[i + 1];
        const z = src[i + 2];
        out[at++] = e[0] * x + e[4] * y + e[8] * z + e[12];
        out[at++] = e[1] * x + e[5] * y + e[9] * z + e[13];
        out[at++] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(out, 3));
    g.computeBoundingSphere();
    this.agentThrough = new LineSegments(g, this.agentThroughMaterial);
    this.agentThrough.renderOrder = 25;
    this.highlight.add(this.agentThrough);
  }

  syncHighlights() {
    for (const m of this.agentFaces) this.showElement(m, null, m.userData.element);
    // While an overlay shows its own colours, hover is the outline only.
    this.hoverFace.material.visible = !this.overlayOptions;
    this.showElement(this.hoverFace, this.hoverEdge, this.hovered);
    for (const obj of this.picked) {
      const el = obj.userData.element;
      if (el.kind === "face" && !obj.userData.outline) this.showElement(obj, null, el);
      else this.placeLines(obj, el);
    }
  }

  /** Put a picked outline (face boundary or edge) on its part, as shown now. */
  placeLines(obj, el) {
    const part = this.parts.get(el.path);
    obj.visible = !!part && part.visible;
    if (!obj.visible) return;
    obj.matrix.copy(part.world);
    obj.matrixWorldNeedsUpdate = true;
  }

  showElement(faceMesh, edgeLines, el) {
    const part = el && this.parts.get(el.path);
    const show = !!part && part.visible;
    if (faceMesh) faceMesh.visible = false;
    if (edgeLines) edgeLines.visible = false;
    if (!show) return;
    const info = part.info;
    if (el.kind === "face" && faceMesh && el.face >= 0) {
      const g = faceMesh.geometry;
      if (g.attributes.position !== info.geometry.attributes.position) {
        g.setAttribute("position", info.geometry.attributes.position);
        g.setIndex(info.geometry.index);
      }
      const s = info.ranges.starts;
      g.setDrawRange(s[el.face] * 3, (s[el.face + 1] - s[el.face]) * 3);
      g.boundingSphere = info.geometry.boundingSphere;
      faceMesh.matrix.copy(part.world);
      faceMesh.matrixWorldNeedsUpdate = true;
      faceMesh.visible = true;
    }
    if (edgeLines && (el.kind === "edge" || el.kind === "face")) {
      const seg = el.kind === "edge" ? info.edges[el.edge]?.segments : el.face >= 0 ? this.boundary(info, el.face) : null;
      if (!seg) return;
      const g = edgeLines.geometry;
      if (g.userData.segments !== seg) {
        g.setAttribute("position", new BufferAttribute(seg, 3));
        g.userData.segments = seg;
        g.computeBoundingSphere();
      }
      edgeLines.matrix.copy(part.world);
      edgeLines.matrixWorldNeedsUpdate = true;
      edgeLines.visible = true;
    }
  }

  // ---- queries -------------------------------------------------------------------------------

  /** The world box of the given paths (default: every visible part), exploded as shown. */
  box(paths) {
    const box = new Box3();
    const list = paths ? [...paths].map((p) => this.parts.get(p)).filter(Boolean) : [...this.parts.values()].filter((p) => p.visible !== false);
    for (const p of list) box.union(p.box);
    if (box.isEmpty() && !paths) for (const p of this.parts.values()) box.union(p.box);
    return box;
  }

  /** The assembled world box of every part (no explode). */
  baseBox() {
    const box = new Box3();
    for (const p of this.parts.values()) box.union(p.base);
    return box;
  }

  /** Counts for the frame-time probe. */
  stats() {
    let triangles = 0;
    let faces = 0;
    let addressed = 0;
    for (const info of this.infos.values()) {
      faces += info.ranges.starts.length - 1;
      if (info.addressing.addressed) addressed++;
    }
    for (const p of this.parts.values()) if (p.visible) triangles += p.info.ranges.starts[p.info.ranges.starts.length - 1];
    return { occurrences: this.parts.size, definitions: this.infos.size, drawables: this.drawables.length, batched: this.batched, triangles, faces, addressedDefinitions: addressed, edgeVertices: this.edgePositions ? this.edgePositions.length / 3 : 0 };
  }

  setEdgeColors(edge, selected, picked = selected) {
    this.edgeColor.set(edge);
    this.accent.set(selected);
    this.hoverMaterial.color.set(selected);
    this.pickedMaterial.color.set(picked);
    this.hoverEdgeMaterial.color.set(selected);
    this.outlineMaterial.color.set(selected);
    this.colorEdges();
  }

  setCapColor(color) {
    this.capMaterial.color.set(color);
  }

  clear() {
    for (const d of this.drawables) {
      this.faces.remove(d.mesh);
      d.mesh.dispose();
      if (d.cap) {
        this.caps.remove(d.cap);
        if (d.kind === "batched") d.cap.dispose();
      }
    }
    this.disposeEdges();
    for (const m of [...this.overlay.children]) {
      this.overlay.remove(m);
      m.dispose();
    }
    this.dropOverlayCache();
    for (const m of this.fitMarkers) {
      this.markers.remove(m);
      m.material.dispose();
      m.dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.hovered = null;
    this.setPicked([]);
    this.agentPaths = new Set();
    this.agentOutline = new Set();
    this.rebuildAgentThrough();
    for (const m of this.agentFaces) this.highlight.remove(m);
    this.agentPool = [...(this.agentPool ?? []), ...this.agentFaces];
    this.agentFaces = [];
    this.disposables = [];
    this.drawables = [];
    this.fitMarkers = [];
    this.parts.clear();
    this.infos.clear();
    this.overlayCacheKey = "";
  }
}

const IDENTITY_Q = new Quaternion();

function targets(drawable) {
  if (drawable.kind === "instanced") return [drawable.mesh];
  return drawable.cap ? [drawable.mesh, drawable.cap] : [drawable.mesh];
}

function visibilityKey(hidden, isolated) {
  return `${[...hidden].sort().join("\n")}\u0000${isolated ? [...isolated].sort().join("\n") : "*"}`;
}

/** Distance in pixels from (px, py) to the segment a-b. */
function pointSegment(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

export function markerColor(kind) {
  const css = getComputedStyle(document.documentElement).getPropertyValue(`--${kind}`).trim();
  return new Color(css || (kind === "clash" ? "#d92d20" : kind === "contact" ? "#c27c0e" : "#0e8a7e"));
}
