// Camera, navigation presets, standard views and fit-to-view. Z is up, as in the report.
// Orthographic is the default (the CAD habit); P switches to perspective and back.
import { MOUSE, OrthographicCamera, PerspectiveCamera, Sphere, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * Mouse presets. OrbitControls pans when Ctrl, Cmd or Shift is held on the orbit button, which
 * gives the SolidWorks Ctrl+middle pan and the Onshape Ctrl+right pan. A null button does
 * nothing, so the left button stays free for selection.
 */
export const PRESETS = {
  open3dj: { label: "Open3DJ", mouse: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN } },
  solidworks: { label: "SolidWorks", mouse: { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: null } },
  onshape: { label: "Onshape", mouse: { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE } },
};

/** View directions: from the target towards the camera. Front looks along +Y, as in the drawing. */
export const VIEWS = {
  front: [0, -1, 0],
  top: [0, -1e-4, 1],
  right: [1, 0, 0],
  iso: [1, -1, 1],
};

const FOV = 35;
const MARGIN = 1.12;

export class ViewCamera {
  constructor(dom, onChange) {
    this.persp = new PerspectiveCamera(FOV, 1, 0.1, 1e5);
    this.ortho = new OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
    for (const c of [this.persp, this.ortho]) c.up.set(0, 0, 1);
    this.camera = this.ortho;
    this.aspect = 1;
    this.orthoHalf = 100;
    this.radius = 100;
    this.onChange = onChange;
    this.controls = new OrbitControls(this.camera, dom);
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.enableDamping = false;
    this.controls.addEventListener("change", () => {
      this.updateClip();
      this.onChange();
    });
    this.tween = null;
    this.setPreset("open3dj");
  }

  get isOrtho() {
    return this.camera === this.ortho;
  }

  setPreset(name) {
    const preset = PRESETS[name] ?? PRESETS.open3dj;
    this.preset = PRESETS[name] ? name : "open3dj";
    this.controls.mouseButtons = { ...preset.mouse };
  }

  setSize(width, height) {
    this.aspect = width / Math.max(height, 1);
    this.persp.aspect = this.aspect;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
  }

  updateOrtho() {
    const h = this.orthoHalf;
    this.ortho.left = -h * this.aspect;
    this.ortho.right = h * this.aspect;
    this.ortho.top = h;
    this.ortho.bottom = -h;
    this.ortho.updateProjectionMatrix();
  }

  /** Near and far planes that keep depth precision for the model's size. */
  updateClip() {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const r = this.radius;
    this.persp.near = Math.max(r * 1e-3, (dist - r * 3) * 0.5, dist * 0.01);
    this.persp.far = dist + r * 20;
    this.persp.updateProjectionMatrix();
    this.ortho.near = -(dist + r * 50);
    this.ortho.far = dist + r * 50;
    this.ortho.updateProjectionMatrix();
  }

  direction() {
    return this.camera.position.clone().sub(this.controls.target).normalize();
  }

  /** Where the camera goes to show box from direction dir: returns { target, position, half }. */
  goal(box, dir) {
    const sphere = box.isEmpty() ? new Sphere(new Vector3(), 50) : box.getBoundingSphere(new Sphere());
    const r = Math.max(sphere.radius, 0.01);
    const vfov = (FOV * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.aspect);
    const dist = (r * MARGIN) / Math.sin(Math.min(vfov, hfov) / 2);
    const d = new Vector3(...dir).normalize();
    return { target: sphere.center.clone(), position: sphere.center.clone().addScaledVector(d, dist), half: r * MARGIN * Math.max(1, 1 / this.aspect), radius: r };
  }

  /** Frame box from dir (default: the current direction). Animated unless instant. */
  frame(box, dir, instant = false) {
    const g = this.goal(box, dir ?? this.direction().toArray());
    const from = { target: this.controls.target.clone(), position: this.camera.position.clone(), half: this.orthoHalf / this.ortho.zoom };
    this.ortho.zoom = 1;
    this.orthoHalf = from.half;
    if (instant) {
      this.apply(g.target, g.position, g.half);
      return;
    }
    this.tween = { start: performance.now(), ms: 240, from, to: g };
  }

  setView(name, box) {
    this.frame(box, VIEWS[name] ?? VIEWS.iso);
  }

  apply(target, position, half) {
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    // Both cameras share the pose, so switching projection keeps the view.
    const other = this.isOrtho ? this.persp : this.ortho;
    other.position.copy(position);
    this.orthoHalf = half;
    this.updateOrtho();
    this.controls.update();
    this.updateClip();
  }

  /** Advance an animation; returns true while one runs. */
  step(now) {
    const t = this.tween;
    if (!t) return false;
    const k = Math.min(1, (now - t.start) / t.ms);
    const e = k * k * (3 - 2 * k);
    const target = t.from.target.clone().lerp(t.to.target, e);
    // Move on the sphere around the target, so a view change turns instead of cutting through.
    const fromDir = t.from.position.clone().sub(t.from.target);
    const toDir = t.to.position.clone().sub(t.to.target);
    const len = fromDir.length() + (toDir.length() - fromDir.length()) * e;
    const dir = fromDir.normalize().lerp(toDir.normalize(), e);
    if (dir.lengthSq() < 1e-8) dir.copy(toDir.normalize());
    const position = target.clone().addScaledVector(dir.normalize(), len);
    this.apply(target, position, t.from.half + (t.to.half - t.from.half) * e);
    if (k >= 1) this.tween = null;
    return true;
  }

  toggleProjection() {
    const target = this.controls.target;
    const dist = this.camera.position.distanceTo(target);
    const tan = Math.tan((FOV * Math.PI) / 360);
    if (this.isOrtho) {
      const half = this.orthoHalf / this.ortho.zoom;
      const d = this.direction();
      this.camera = this.persp;
      this.persp.position.copy(target).addScaledVector(d, half / tan);
    } else {
      this.orthoHalf = dist * tan;
      this.ortho.zoom = 1;
      this.ortho.position.copy(this.persp.position);
      this.camera = this.ortho;
      this.updateOrtho();
    }
    this.camera.up.set(0, 0, 1);
    this.controls.object = this.camera;
    this.controls.update();
    this.updateClip();
    this.onChange();
  }
}
