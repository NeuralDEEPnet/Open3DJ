// View tools: section plane, exploded view, x-ray, measure, analysis overlays, quality settings
// and the PNG screenshot. All of them change the view only; nothing is written to the model.
//
// Numbers: what the kernel computed (the report) is labelled "measured"; what the browser
// reads off the display mesh is labelled "observed"; the analysis overlays are a "preview"
// (docs/COMPUTE.md: GPU screens, CPU decides).
import { BufferGeometry, Color, Float32BufferAttribute, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from "three";
import { LEGENDS } from "./analysis.js";
import { elementName } from "./faces.js";
import { fitPairs, round } from "./fits.js";
import { applyDirection, applyPoint, facePatch, measureRows } from "./measure.js";

const $ = (id) => document.getElementById(id);
/** Measure marks are this many pixels in radius. */
const MARK_PX = 4;
const PULLS = { "+z": [0, 0, 1], "-z": [0, 0, -1], "+x": [1, 0, 0], "-x": [-1, 0, 0], "+y": [0, 1, 0], "-y": [0, -1, 0] };

export class Tools {
  /** ctx: { state, prefs, savePrefs, getModel, getView, requestRender, flash, renderMeasure, setEnvironment, setPixelRatio, setEdgeStyle, reloadModel, screenshot, perf, fitIfOutside } */
  constructor(ctx) {
    this.ctx = ctx;
    this.section = { axis: null, at: 0, flip: false, lastAxis: "z", t: 0.5 };
    this.explode = 0;
    this.xray = false;
    this.overlay = { kind: null, limitDeg: 45, pull: "+z", minDeg: 1 };
    this.measuring = false;
    this.picks = [];
    this.perfOn = new URLSearchParams(location.search).has("perf");
    this.perfAt = 0;
    this.markGeometry = new SphereGeometry(1, 16, 10);
    this.markMaterial = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    this.lineMaterial = new LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
  }

  get model() {
    return this.ctx.getModel();
  }

  bind() {
    for (const b of document.querySelectorAll("[data-section]")) b.addEventListener("click", () => this.setSection(b.dataset.section === "off" ? null : b.dataset.section, undefined, true));
    $("section-at").addEventListener("input", (e) => this.setSectionAt(Number(e.target.value)));
    $("section-flip").addEventListener("change", (e) => {
      this.section.flip = e.target.checked;
      this.applySection();
    });
    $("explode").addEventListener("input", (e) => this.setExplode(Number(e.target.value)));
    // When the slider is let go and the exploded parts left the view, frame them again.
    $("explode").addEventListener("change", () => this.ctx.fitIfOutside?.());
    $("overlay-kind").addEventListener("change", (e) => this.setOverlay(e.target.value === "off" ? null : e.target.value));
    $("overhang-limit").addEventListener("input", (e) => {
      this.overlay.limitDeg = Number(e.target.value);
      this.applyOverlay();
    });
    $("draft-pull").addEventListener("change", (e) => {
      this.overlay.pull = e.target.value;
      this.applyOverlay();
    });
    $("draft-min").addEventListener("input", (e) => {
      this.overlay.minDeg = Number(e.target.value);
      this.applyOverlay();
    });
    $("quality-dpr").value = String(this.ctx.prefs.dpr);
    $("quality-dpr").addEventListener("change", (e) => this.ctx.setPixelRatio(Number(e.target.value)));
    $("quality-edges").value = this.ctx.prefs.edgeStyle === "fat" ? "fat" : "thin";
    $("quality-edges").addEventListener("change", (e) => this.ctx.setEdgeStyle(e.target.value));
    $("quality-env").checked = !!this.ctx.state.environment;
    $("quality-env").addEventListener("change", (e) => this.ctx.setEnvironment(e.target.checked));
    $("quality-batch").value = this.model?.batch ?? this.ctx.prefs.batch;
    $("quality-batch").addEventListener("change", (e) => {
      this.ctx.savePrefs({ batch: e.target.value });
      this.ctx.reloadModel(e.target.value);
    });
    $("quality-perf").checked = this.perfOn;
    $("quality-perf").addEventListener("change", (e) => {
      this.perfOn = e.target.checked;
      this.updatePerf(true);
    });
    $("quality-adaptive").checked = !!this.ctx.prefs.adaptive;
    $("quality-adaptive").addEventListener("change", (e) => this.ctx.savePrefs({ adaptive: e.target.checked }));
    $("measure-clear").addEventListener("click", () => this.clearMeasure());
    this.syncControls();
  }

  act(action) {
    switch (action) {
      case "section":
        return this.setSection(this.section.axis ? null : this.section.lastAxis, undefined, true);
      case "xray":
        return this.setXray(!this.xray);
      case "measure":
        return this.setMeasuring(!this.measuring);
      case "overlay": {
        const order = [null, "overhang", "draft"];
        return this.setOverlay(order[(order.indexOf(this.overlay.kind) + 1) % order.length]);
      }
      case "screenshot":
        return this.ctx.screenshot();
    }
  }

  /** For tests and agents: { section: { axis, t | at, flip }, explode, overlay: { kind, ... }, xray, measure }. */
  apply(options = {}) {
    // Explode first: it moves the parts, and a section given in the same call is meant for where they end up.
    if (options.explode !== undefined) this.setExplode(options.explode);
    if (options.section !== undefined) {
      const s = options.section;
      if (!s || !s.axis) this.setSection(null);
      else {
        if (s.flip !== undefined) this.section.flip = !!s.flip;
        this.setSection(s.axis, s.t, s.flip === undefined);
        if (s.at !== undefined) this.setSectionAt(s.at);
      }
    }
    if (options.overlay !== undefined) {
      if (options.overlay) Object.assign(this.overlay, { ...options.overlay, kind: undefined });
      this.setOverlay(options.overlay?.kind ?? null);
    }
    if (options.xray !== undefined) this.setXray(!!options.xray);
    if (options.measure !== undefined) this.setMeasuring(!!options.measure);
    return { section: this.section.axis ? { axis: this.section.axis, at: this.section.at, flip: this.section.flip } : null, explode: this.explode, overlay: this.overlay.kind ? this.model?.overlayStats ?? null : null, xray: this.xray };
  }

  /** After a new revision is built: put the tools back on the new scene. */
  afterBuild() {
    const m = this.model;
    if (!m) return;
    m.setXray(this.xray);
    if (this.explode) m.setExplode(this.explode);
    if (this.section.axis) this.setSection(this.section.axis, this.section.t);
    if (this.overlay.kind) this.applyOverlay();
    this.picks = [];
    this.drawMeasure();
    this.themeChanged();
    this.syncControls();
  }

  afterRefresh() {
    if (this.overlay.kind) this.renderLegend();
  }

  // ---- section -----------------------------------------------------------------------------

  /** Section along axis at fraction t of the assembly box (default: where it was, or the middle). */
  setSection(axis, t, autoSide = false) {
    if (axis && autoSide) this.section.flip = this.cameraSide(axis) < 0;
    this.section.axis = axis;
    if (axis) this.section.lastAxis = axis;
    if (t !== undefined) this.section.t = t;
    if (axis) {
      const [lo, hi] = this.range(axis);
      this.section.at = lo + (hi - lo) * this.section.t;
    }
    this.applySection();
  }

  setSectionAt(at) {
    if (!this.section.axis) return;
    const [lo, hi] = this.range(this.section.axis);
    this.section.at = at;
    this.section.t = hi > lo ? (at - lo) / (hi - lo) : 0.5;
    this.applySection();
  }

  /** Which side of the model the camera looks from along axis: 1 for the positive side, -1 for the negative. */
  cameraSide(axis) {
    const v = this.ctx.getView();
    if (!v) return 1;
    const d = v.camera.position.clone().sub(v.controls.target);
    return d[axis] >= 0 ? 1 : -1;
  }

  range(axis) {
    const box = this.model?.box();
    if (!box || box.isEmpty()) return [0, 1];
    const pad = Math.max(box.getSize(new Vector3()).length() * 1e-3, 1e-3);
    return [box.min[axis] - pad, box.max[axis] + pad];
  }

  applySection() {
    this.model?.setSection(this.section.axis ? { axis: this.section.axis, at: this.section.at, flip: this.section.flip } : null);
    this.syncControls();
    this.ctx.requestRender();
  }

  // ---- explode and x-ray -----------------------------------------------------------------------

  setExplode(factor) {
    this.explode = Math.max(0, factor);
    this.model?.setExplode(this.explode);
    if (this.section.axis) this.setSection(this.section.axis, this.section.t);
    this.drawMeasure();
    this.syncControls();
    this.ctx.requestRender();
  }

  setXray(on) {
    this.xray = on;
    this.model?.setXray(on);
    this.syncControls();
    this.ctx.requestRender();
  }

  // ---- overlays ------------------------------------------------------------------------------

  setOverlay(kind) {
    this.overlay.kind = kind;
    this.applyOverlay();
  }

  applyOverlay() {
    const m = this.model;
    if (!m) return;
    if (!this.overlay.kind) m.setOverlay(null);
    else {
      const css = getComputedStyle(document.documentElement);
      const colors = {};
      for (const [cls, , token] of LEGENDS[this.overlay.kind]) colors[cls] = new Color(css.getPropertyValue(token).trim() || "#888888");
      m.setOverlay({ kind: this.overlay.kind, limitDeg: this.overlay.limitDeg, pull: PULLS[this.overlay.pull], minDeg: this.overlay.minDeg, colors });
    }
    this.renderLegend();
    this.syncControls();
    this.ctx.requestRender();
  }

  renderLegend() {
    const ul = $("overlay-legend");
    ul.replaceChildren();
    const kind = this.overlay.kind;
    $("overlay-note").hidden = !kind;
    if (!kind) return;
    const stats = this.model?.overlayStats ?? {};
    const total = Object.values(stats).reduce((a, b) => a + b, 0) || 1;
    for (const [cls, label, token] of LEGENDS[kind]) {
      const li = document.createElement("li");
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = `var(${token})`;
      const text = document.createElement("span");
      text.textContent = label;
      const value = document.createElement("span");
      value.className = "value";
      value.textContent = `${round(stats[cls] ?? 0, 1)} mm² (${round((100 * (stats[cls] ?? 0)) / total, 1)}%)`;
      li.append(sw, text, value);
      ul.append(li);
    }
  }

  // ---- measure -------------------------------------------------------------------------------

  setMeasuring(on) {
    this.measuring = on;
    if (!on) this.clearMeasure();
    this.syncControls();
    if (on) this.ctx.flash("measure: click a face, an edge or a point; a second click measures between them");
  }

  clearMeasure() {
    this.picks = [];
    this.drawMeasure();
    this.renderMeasurePanel();
    this.ctx.getModel()?.setPicked(this.ctx.state.elements);
    this.ctx.requestRender();
  }

  /** A click in measure mode. hit is the pick under the cursor (or null). */
  measurePick(hit) {
    if (!hit) return;
    if (this.picks.length >= 2) this.picks = [];
    const part = hit.part;
    const local = hit.local.toArray();
    const pick = { element: hit.element, path: hit.path, point: applyPoint(part.matrix.elements, local) };
    if (hit.element.kind === "face") pick.face = this.faceFacts(part, hit.element.face);
    else if (hit.element.kind === "edge") pick.edge = this.edgeFacts(part, hit.element.edge);
    this.picks.push(pick);
    this.ctx.getModel()?.setPicked([...this.ctx.state.elements, ...this.measurePicks()]);
    this.drawMeasure();
    this.renderMeasurePanel();
    // The result sits below the View tools: bring it into sight.
    $("measure-tools").scrollIntoView?.({ block: "nearest" });
    this.ctx.requestRender();
  }

  measurePicks() {
    return this.picks.map((p) => p.element).filter((el) => el.kind === "face" || el.kind === "edge");
  }

  /** Observed facts of face f of a part, in assembly coordinates (not exploded). */
  faceFacts(part, face) {
    const { starts } = part.info.ranges;
    const f = facePatch(part.info.positions, part.info.index, starts[face], starts[face + 1]);
    const out = { area: f.area, planar: f.planar, centre: applyPoint(part.matrix.elements, f.centre) };
    const n = applyDirection(part.matrix.elements, f.normal);
    if (f.planar) out.normal = n;
    out.meanNormal = n;
    return out;
  }

  edgeFacts(part, edge) {
    const e = part.info.edges[edge];
    return { length: e.length, faces: e.faces };
  }

  measureState() {
    return { on: this.measuring, picks: this.picks.map((p) => ({ name: elementName(p.path, p.element), point: p.point, face: p.face ?? null, edge: p.edge ?? null })), result: this.result ?? null };
  }

  /** The measure between the picks: observed numbers from the mesh, measured ones from the report. */
  computeResult() {
    const [a, b] = this.picks;
    this.result = null;
    if (!a) return null;
    const name = (p) => {
      const n = elementName(p.path, p.element.kind === "cap" ? null : p.element);
      return p.element.kind === "cap" ? `${p.path} (section cut)` : n.address ?? n.text;
    };
    const rows = measureRows(a, b, { name, fits: this.ctx.state.model?.fits, pairsOf: fitPairs, round });
    const r = { rows };
    if (b) r.distance = Math.hypot(b.point[0] - a.point[0], b.point[1] - a.point[1], b.point[2] - a.point[2]);
    const angle = rows.find((x) => x[0] === "Angle between faces");
    if (angle) r.angle = Number.parseFloat(angle[1]);
    this.result = r;
    return r;
  }

  renderMeasurePanel() {
    const box = $("measure-result");
    box.replaceChildren();
    const r = this.computeResult();
    if (!r) {
      box.innerHTML = this.measuring ? `<p class="muted">Click a face, an edge or a point in the view.</p>` : `<p class="muted">Press R or Measure, then click.</p>`;
      return;
    }
    // One row per line pair: the label (often a long element address) on its own line, the
    // value and its label badge below it.
    const dl = document.createElement("dl");
    dl.className = "stack";
    for (const [k, v, tier] of r.rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      dt.title = k;
      const dd = document.createElement("dd");
      dd.textContent = v;
      if (tier) {
        const t = document.createElement("span");
        t.className = `tier ${tier}`;
        t.textContent = tier;
        dd.append(" ", t);
      } else dd.classList.add("muted");
      dl.append(dt, dd);
    }
    box.append(dl);
  }

  /** Marks at the picked points and a line between them, where the parts are shown (exploded too). */
  drawMeasure() {
    const m = this.model;
    if (!m) return;
    for (const c of [...m.measureGroup.children]) {
      m.measureGroup.remove(c);
      if (c.isLine) c.geometry.dispose();
    }
    // A constant size on screen once the first frame gave the pixel size (rescale keeps it).
    const radius = m.pixelSize > 0 ? MARK_PX * m.pixelSize : Math.max(m.baseBox().getSize(new Vector3()).length() * 0.004, 0.03);
    const shown = this.picks.map((p) => {
      const part = m.parts.get(p.path);
      return new Vector3(...p.point).add(part?.offset ?? new Vector3());
    });
    for (const at of shown) {
      const s = new Mesh(this.markGeometry, this.markMaterial);
      s.position.copy(at);
      s.scale.setScalar(radius);
      s.renderOrder = 30;
      m.measureGroup.add(s);
    }
    if (shown.length === 2) {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute([...shown[0].toArray(), ...shown[1].toArray()], 3));
      const line = new Line(g, this.lineMaterial);
      line.renderOrder = 30;
      m.measureGroup.add(line);
    }
  }

  /** Keep the measure marks at a constant size on screen (from main.js when the pixel size changes). */
  rescale(pixelSize) {
    const m = this.model;
    if (!m) return;
    for (const c of m.measureGroup.children) if (c.isMesh) c.scale.setScalar(MARK_PX * pixelSize);
  }

  // ---- display -------------------------------------------------------------------------------

  themeChanged() {
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--measure").trim() || "#e8590c";
    this.markMaterial.color.set(accent);
    this.lineMaterial.color.set(accent);
    if (this.overlay.kind) this.applyOverlay();
  }

  syncControls() {
    const pressed = (sel, on) => {
      for (const b of document.querySelectorAll(sel)) b.setAttribute("aria-pressed", String(on));
    };
    for (const b of document.querySelectorAll("[data-section]")) b.setAttribute("aria-pressed", String((b.dataset.section === "off" && !this.section.axis) || b.dataset.section === this.section.axis));
    pressed('[data-action="section"]', !!this.section.axis);
    pressed('[data-action="xray"]', this.xray);
    pressed('[data-action="measure"]', this.measuring);
    pressed('[data-action="overlay"]', !!this.overlay.kind);
    const at = $("section-at");
    at.disabled = !this.section.axis;
    $("section-flip").checked = this.section.flip;
    if (this.section.axis) {
      const [lo, hi] = this.range(this.section.axis);
      at.min = String(lo);
      at.max = String(hi);
      const step = (hi - lo) / 500 || 0.01;
      at.step = String(step);
      at.value = String(this.section.at);
      // As many decimals as the slider step resolves, and never "-0".
      const digits = Math.max(0, Math.min(3, Math.ceil(-Math.log10(step))));
      $("section-value").textContent = `${this.section.axis.toUpperCase()} = ${round(this.section.at, digits)} mm`;
      $("section-side").textContent = `keeps ${this.section.flip ? "above" : "below"}`;
    } else {
      $("section-value").textContent = "off";
      $("section-side").textContent = "";
    }
    $("explode").value = String(this.explode);
    $("explode-value").textContent = this.explode ? `${round(this.explode * 100, 0)}%` : "off";
    $("overlay-kind").value = this.overlay.kind ?? "off";
    $("overhang-controls").hidden = this.overlay.kind !== "overhang";
    $("draft-controls").hidden = this.overlay.kind !== "draft";
    $("overhang-limit").value = String(this.overlay.limitDeg);
    $("overhang-value").textContent = `${this.overlay.limitDeg}°`;
    $("draft-pull").value = this.overlay.pull;
    $("draft-min").value = String(this.overlay.minDeg);
    $("draft-value").textContent = `${this.overlay.minDeg}°`;
    $("measure-tools").classList.toggle("active", this.measuring);
    if (!this.picks.length) this.renderMeasurePanel();
  }

  /** The frame-time readout in the status bar, at most twice a second. */
  updatePerf(force = false) {
    const el = $("status-perf");
    if (!this.perfOn) {
      el.textContent = "";
      return;
    }
    const now = performance.now();
    if (!force && now - this.perfAt < 500) return;
    this.perfAt = now;
    const p = this.ctx.perf();
    const ms = p.frameMs.p95 !== null ? `frame p50 ${p.frameMs.p50} / p95 ${p.frameMs.p95} ms` : "frame: orbit to measure";
    // The ratio of the last frame drawn; adaptive resolution halves it only while the view moves.
    el.textContent = `${ms}, ${p.drawCalls} draws, ${Math.round(p.triangles / 1000)}k tris, dpr ${p.pixelRatio}${p.adaptive && p.lowResFrames ? " (half while moving)" : ""}`;
  }
}
