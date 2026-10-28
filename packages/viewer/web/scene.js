// The model in the scene: one InstancedMesh per definition and colour (every occurrence of a
// definition shares one geometry), edges per occurrence on one shared EdgesGeometry, and fit
// markers from the report. Selection, hover, hide and isolate only change instance colours
// and matrices, so they never rebuild geometry.
import {
  Box3, Color, EdgesGeometry, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry, Vector3,
} from "three";
import { fitAnchor, fitPairs, markerVisible } from "./fits.js";

const HIDDEN = new Matrix4().makeScale(0, 0, 0);
const EDGE_ANGLE = 25;

export class ModelScene {
  constructor() {
    this.group = new Group();
    this.group.name = "model";
    this.faces = new Group();
    this.edges = new Group();
    this.markers = new Group();
    this.group.add(this.faces, this.edges, this.markers);
    /** path -> { path, name, mesh, index, edge, color, box } */
    this.parts = new Map();
    this.meshes = [];
    this.fitMarkers = [];
    this.disposables = [];
    this.faceMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.edgeMaterial = new LineBasicMaterial({ color: 0x1d232b });
    this.edgeSelectedMaterial = new LineBasicMaterial({ color: 0x2563eb });
    this.accent = new Color(0x2563eb);
    this.edgesOn = true;
    this.markersOn = true;
    this.markerGeometry = new SphereGeometry(1, 20, 12);
  }

  /** Build from a parsed GLB (glb.js) and the fits of the report. */
  build(parsed, fits) {
    this.clear();
    const byGroup = new Map();
    for (const p of parsed.parts) {
      const key = `${p.geometryKey}|${p.color.getHexString()}`;
      let g = byGroup.get(key);
      if (!g) byGroup.set(key, (g = { geometry: p.geometry, color: p.color, parts: [] }));
      g.parts.push(p);
    }
    const edgeGeometry = new Map();
    for (const g of byGroup.values()) {
      const mesh = new InstancedMesh(g.geometry, this.faceMaterial, g.parts.length);
      mesh.name = g.parts[0].name;
      mesh.userData.paths = g.parts.map((p) => p.path);
      let eg = edgeGeometry.get(g.geometry);
      if (!eg) {
        eg = new EdgesGeometry(g.geometry, EDGE_ANGLE);
        edgeGeometry.set(g.geometry, eg);
        this.disposables.push(eg);
      }
      g.parts.forEach((p, index) => {
        mesh.setMatrixAt(index, p.matrix);
        mesh.setColorAt(index, p.color);
        const edge = new LineSegments(eg, this.edgeMaterial);
        edge.matrixAutoUpdate = false;
        edge.matrix.copy(p.matrix);
        edge.matrixWorldNeedsUpdate = true;
        edge.userData.path = p.path;
        this.edges.add(edge);
        const box = g.geometry.boundingBox.clone().applyMatrix4(p.matrix);
        this.parts.set(p.path, { path: p.path, name: p.name, mesh, index, edge, color: p.color.clone(), box, matrix: p.matrix.clone() });
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      this.faces.add(mesh);
      this.meshes.push(mesh);
      if (!this.disposables.includes(g.geometry)) this.disposables.push(g.geometry);
    }
    this.buildMarkers(fits ?? []);
  }

  buildMarkers(fits) {
    for (const m of this.fitMarkers) {
      this.markers.remove(m);
      m.material.dispose();
    }
    this.fitMarkers = [];
    const size = this.box().getSize(new Vector3()).length() || 1;
    const radius = Math.max(size * 0.008, 0.05);
    fits.forEach((fit, fitIndex) => {
      for (const [a, b] of fitPairs(fit)) {
        const pa = this.parts.get(a);
        const pb = this.parts.get(b);
        if (!pa || !pb) continue;
        const at = fitAnchor({ min: pa.box.min.toArray(), max: pa.box.max.toArray() }, { min: pb.box.min.toArray(), max: pb.box.max.toArray() });
        const material = new MeshBasicMaterial({ color: markerColor(fit.kind), depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 });
        const marker = new Mesh(this.markerGeometry, material);
        marker.position.set(at[0], at[1], at[2]);
        marker.scale.setScalar(radius);
        marker.renderOrder = 10;
        marker.userData = { fitIndex, kind: fit.kind, a, b, radius };
        marker.visible = this.markersOn;
        this.markers.add(marker);
        this.fitMarkers.push(marker);
      }
    });
  }

  /** Apply selection, hover, hidden and isolated state to every instance. */
  refresh({ selected = new Set(), hovered = null, hidden = new Set(), isolated = null, activeFit = -1 } = {}) {
    const c = new Color();
    for (const p of this.parts.values()) {
      const visible = !hidden.has(p.path) && (!isolated || isolated.has(p.path));
      p.mesh.setMatrixAt(p.index, visible ? p.matrix : HIDDEN);
      p.edge.visible = visible && this.edgesOn;
      const isSelected = selected.has(p.path);
      p.edge.material = isSelected ? this.edgeSelectedMaterial : this.edgeMaterial;
      if (isSelected) c.copy(p.color).lerp(this.accent, 0.65);
      else if (hovered === p.path) c.copy(p.color).lerp(this.accent, 0.3);
      else c.copy(p.color);
      p.mesh.setColorAt(p.index, c);
      p.visible = visible;
    }
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingBox();
      m.computeBoundingSphere();
    }
    for (const marker of this.fitMarkers) {
      marker.visible = markerVisible(this.markersOn, marker.userData.a, marker.userData.b, hidden, isolated);
      const active = marker.userData.fitIndex === activeFit;
      marker.scale.setScalar(marker.userData.radius * (active ? 1.8 : 1));
    }
  }

  /** The occurrence path under the ray, skipping hidden parts, or null. */
  pick(raycaster) {
    const hits = raycaster.intersectObjects(this.meshes, false);
    for (const h of hits) {
      const path = h.object.userData.paths?.[h.instanceId];
      const p = path && this.parts.get(path);
      if (p && p.visible !== false) return path;
    }
    return null;
  }

  /** The world box of the given paths (default: every visible part). */
  box(paths) {
    const box = new Box3();
    const list = paths ? [...paths].map((p) => this.parts.get(p)).filter(Boolean) : [...this.parts.values()].filter((p) => p.visible !== false);
    for (const p of list) box.union(p.box);
    if (box.isEmpty() && !paths) for (const p of this.parts.values()) box.union(p.box);
    return box;
  }

  setEdgeColors(edge, selected) {
    this.edgeMaterial.color.set(edge);
    this.edgeSelectedMaterial.color.set(selected);
    this.accent.set(selected);
  }

  clear() {
    for (const m of this.meshes) {
      this.faces.remove(m);
      m.dispose();
    }
    for (const e of [...this.edges.children]) this.edges.remove(e);
    for (const m of this.fitMarkers) {
      this.markers.remove(m);
      m.material.dispose();
    }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.meshes = [];
    this.fitMarkers = [];
    this.parts.clear();
  }
}

export function markerColor(kind) {
  const css = getComputedStyle(document.documentElement).getPropertyValue(`--${kind}`).trim();
  return new Color(css || (kind === "clash" ? "#d92d20" : kind === "contact" ? "#c27c0e" : "#0e8a7e"));
}
