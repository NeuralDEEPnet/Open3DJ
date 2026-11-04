// The Open3DJ viewer page. It fetches the model JSON and the revision's GLB from open3dj view,
// listens for new revisions on a server-sent-events stream, and shows the assembly. It never
// changes the design. Its one write shares the person's selection with agents (POST
// api/selection, when "Share with agents" is on), and it shows what an agent points at
// (render view=highlight, a "highlight" event). Every URL is relative, because the page lives
// under its session nonce.
//
// Rendering is on demand: a frame is drawn only when the camera, the scene, the selection or
// an overlay changes (and while a view animation or damping runs), never in an idle loop.
import * as THREE from "three";
import { ViewCamera, PRESETS } from "./camera.js";
import { elementName } from "./faces.js";
import { facePatch } from "./measure.js";
import { FIT_ORDER, fitCounts, fitPairs, fitValue, round } from "./fits.js";
import { parseGlb } from "./glb.js";
import { shortcutAction, takesText } from "./keys.js";
import { ModelScene, markerColor } from "./scene.js";
import { Tools } from "./tools.js";

const $ = (id) => document.getElementById(id);
const PREFS_KEY = "open3dj.viewer";
const query = new URLSearchParams(location.search);
/** Software rasterisers: there image-based lighting costs more than it gives, so it starts off. */
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Software|Microsoft Basic Render/i;

const state = {
  model: null,
  rev: null,
  /** The last run state from the server (status, rev, warnings). */
  run: null,
  parsed: null,
  selected: new Set(),
  primary: null,
  /** Picked faces and edges (click selects one, Shift or Ctrl adds). */
  elements: [],
  hidden: new Set(),
  isolated: null,
  activeFit: -1,
  rendererKind: "none",
  loading: null,
  framed: false,
  /** What an agent points at (render view=highlight), until the person dismisses it. */
  agent: null,
  /** The selection as the server stored it for agents. */
  shared: null,
};

const prefs = loadPrefs();
applyTheme(prefs.theme);

let renderer = null;
let view = null;
let scene = null;
let model = null;
let tools = null;
let headlight = null;
let hemi = null;
let frameRequested = false;
let lastFrame = 0;
/** True when the frame being drawn shows motion (the camera moved, or an animation runs). */
let motion = false;
let lastMotion = false;
const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0;
const lineMaterials = new Set();
/** Frame-time probe: intervals between consecutive frames, render CPU time and pick time (ms). */
const probe = { intervals: [], renderMs: [], pickMs: [], frames: 0 };

// ---- start -------------------------------------------------------------------------------

start().catch((e) => showMessage(`The viewer could not start: ${e.message}`, true));

async function start() {
  const viewport = $("viewport");
  const made = await createRenderer();
  if (made) {
    renderer = made.renderer;
    state.rendererKind = made.kind;
    state.software = made.software;
    if ("localClippingEnabled" in renderer) renderer.localClippingEnabled = true;
    applyPixelRatio();
    viewport.prepend(renderer.domElement);
    scene = new THREE.Scene();
    view = new ViewCamera(renderer.domElement, () => requestRender(true));
    view.setPreset(prefs.preset);
    if (prefs.projection === "perspective") view.toggleProjection();
    hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);
    // A headlight that follows the camera, a little above and left of it, so the side you look at is lit.
    headlight = new THREE.DirectionalLight(0xffffff, 2.2);
    scene.add(headlight, headlight.target);
    model = new ModelScene({ fatEdges: (positions, colors, planes, width) => makeFatEdges(positions, colors, planes, width) });
    model.edgesOn = prefs.edges;
    model.markersOn = prefs.markers;
    model.batch = ["on", "off", "auto"].includes(query.get("batch")) ? query.get("batch") : prefs.batch;
    model.edgeStyle = prefs.edgeStyle === "fat" ? "fat" : "thin";
    // Fat lines draw the model edges in the fat style and the outline of a picked face in both.
    if (model.edgeStyle === "fat") await loadFatLines();
    else loadFatLines();
    scene.add(model.group);
    themeScene();
    // Environment light: the saved choice, else on for a hardware GPU and off for a software rasteriser.
    const env = query.get("env");
    const envOn = env === "1" || (env !== "0" && (prefs.environment === "auto" ? !state.software : !!prefs.environment));
    state.environment = envOn;
    if (envOn) await setEnvironment(true, false);
    new ResizeObserver(() => resize()).observe(viewport);
    resize();
    bindPointer(renderer.domElement);
  } else {
    state.rendererKind = "none";
    document.documentElement.dataset.viewer = "no-gpu";
    showDrawing(true, "This browser has no WebGPU or WebGL2 context, so the 3D view is off. This is the hidden-line drawing of the same revision, rendered on the CPU.");
  }
  tools = new Tools({ state, prefs, savePrefs, getModel: () => model, getView: () => view, requestRender, flash, renderMeasure, setEnvironment, setPixelRatio, setEdgeStyle, reloadModel, screenshot, perf, fitIfOutside });
  setPressed("edges", prefs.edges);
  setPressed("markers", prefs.markers);
  $("nav-preset").value = view?.preset ?? prefs.preset;
  $("projection-button").textContent = view && !view.isOrtho ? "Persp" : "Ortho";
  bindUi();
  bindShare();
  tools.bind();
  connect();
  await load();
}

/** WebGPURenderer when the browser has an adapter, else WebGLRenderer on WebGL2, else null. */
async function createRenderer() {
  const ask = query.get("renderer");
  if (ask === "none") return null;
  if (ask !== "webgl" && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const { WebGPURenderer } = await import("three/webgpu");
        const r = new WebGPURenderer({ antialias: true });
        await r.init();
        if (r.backend?.isWebGPUBackend) {
          watchWebGpu(r);
          const info = adapter.info ?? {};
          return { renderer: r, kind: "WebGPU", software: !!info.isFallbackAdapter || SOFTWARE.test(`${info.vendor} ${info.architecture} ${info.description}`) };
        }
        r.dispose();
      }
    } catch {
      // Fall through to WebGL2.
    }
  }
  try {
    const probeCanvas = document.createElement("canvas");
    if (!probeCanvas.getContext("webgl2")) return null;
    const r = new THREE.WebGLRenderer({ antialias: true });
    const gl = r.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return { renderer: r, kind: "WebGL2", software: SOFTWARE.test(String(name)) };
  } catch {
    return null;
  }
}

/**
 * A WebGPU device can still fail after init (a lost device, or a software adapter that cannot
 * map buffers). Then the page reloads itself on WebGL2 once, rather than show an empty view.
 */
function watchWebGpu(r) {
  const fallback = (why) => {
    if (state.fellBack) return;
    state.fellBack = true;
    console.warn(`WebGPU failed (${why}); switching to WebGL2`);
    const u = new URL(location.href);
    u.searchParams.set("renderer", "webgl");
    location.replace(u);
  };
  r.backend.device?.lost?.then((info) => info?.reason !== "destroyed" && fallback(info?.message || "device lost"));
  const gpuError = (message) => /GPU|WebGPU|Instance dropped|createBuffer/.test(String(message ?? ""));
  window.addEventListener("error", (e) => gpuError(e.message) && fallback(e.message));
  window.addEventListener("unhandledrejection", (e) => gpuError(e.reason?.message ?? e.reason) && fallback(e.reason?.message ?? e.reason));
}

/** Ask for one frame. Frames run only on demand: nothing draws while the view is idle. */
function requestRender(moving = false) {
  if (moving) motion = true;
  if (frameRequested || !renderer) return;
  frameRequested = true;
  requestAnimationFrame(frame);
}

function frame(now) {
  frameRequested = false;
  const moving = view.step(now);
  const damping = view.controls.enableDamping ? view.controls.update() : false;
  const cam = view.camera;
  cam.updateMatrixWorld();
  const dist = cam.position.distanceTo(view.controls.target);
  headlight.position.copy(cam.localToWorld(new THREE.Vector3(-0.25 * dist, 0.4 * dist, 0)));
  headlight.target.position.copy(view.controls.target);
  // Markers and measure marks keep a constant size on screen.
  const size = pixelSize(dist);
  if (model.setPixelSize(size)) tools?.rescale(size);
  const t0 = performance.now();
  try {
    renderer.render(scene, cam);
  } catch (e) {
    if (state.rendererKind !== "WebGPU") throw e;
    window.dispatchEvent(new ErrorEvent("error", { message: `WebGPU render failed: ${e.message}` }));
    return;
  }
  record(probe.renderMs, performance.now() - t0);
  // Two motion frames in a row are one motion: the interval between them is the frame time.
  const inMotion = motion || moving || damping;
  if (inMotion && lastMotion && now - lastFrame < 1000) {
    record(probe.intervals, now - lastFrame);
    adapt(now - lastFrame);
  }
  if (inMotion) settle();
  lastMotion = inMotion;
  motion = false;
  lastFrame = now;
  probe.frames++;
  const info = renderer.info?.render ?? {};
  probe.calls = info.calls ?? info.drawCalls ?? 0;
  probe.triangles = info.triangles ?? 0;
  if (state.rev && document.documentElement.dataset.viewer !== "ready" && model.parts.size > 0) {
    document.documentElement.dataset.viewer = "ready";
  }
  if (moving || damping) requestRender(true);
  tools?.updatePerf(forcePerf);
  forcePerf = false;
}

/** World units per screen pixel at the view target. */
function pixelSize(dist) {
  const cam = view.camera;
  const h = Math.max(renderer.domElement.clientHeight, 1);
  if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / h;
  return (2 * Math.tan(((cam.fov ?? 45) * Math.PI) / 360) * dist) / h;
}

// Adaptive resolution: while the view moves and frames take longer than 40 ms (a weak or
// software GPU, a large assembly), draw at half the pixel ratio; 250 ms after the motion stops,
// draw one frame at full resolution again.
let lowRes = false;
let slowEma = 0;
let settleTimer = 0;
/** The status readout is redrawn after the full-resolution frame that follows a motion. */
let forcePerf = false;
function adapt(interval) {
  slowEma = slowEma ? slowEma * 0.7 + interval * 0.3 : interval;
  if (!lowRes && prefs.adaptive && slowEma > 40) {
    lowRes = true;
    probe.lowResFrames = (probe.lowResFrames ?? 0) + 1;
    applyPixelRatio();
  }
}

function settle() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    slowEma = 0;
    if (!lowRes) return;
    lowRes = false;
    applyPixelRatio();
    forcePerf = true;
    requestRender();
  }, 250);
}

function record(list, value) {
  list.push(value);
  if (list.length > 600) list.shift();
}

function resize() {
  if (!renderer) return;
  const el = $("viewport");
  const w = Math.max(el.clientWidth, 1);
  const h = Math.max(el.clientHeight, 1);
  renderer.setSize(w, h, false);
  view.setSize(w, h);
  for (const m of lineMaterials) m.resolution?.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
  requestRender();
}

/** The device pixel ratio, capped (default 2; ?dpr= or the Quality setting changes it). */
function applyPixelRatio() {
  const asked = Number(query.get("dpr"));
  const cap = asked > 0 ? asked : Number(prefs.dpr) || 2;
  const ratio = Math.min(window.devicePixelRatio || 1, cap) * (lowRes ? 0.5 : 1);
  if (renderer.getPixelRatio() === ratio) return;
  renderer.setPixelRatio(ratio);
  const el = $("viewport");
  for (const m of lineMaterials) m.resolution?.set(el.clientWidth * ratio, el.clientHeight * ratio);
}

function setPixelRatio(cap) {
  savePrefs({ dpr: cap });
  if (!renderer) return;
  applyPixelRatio();
  resize();
}

// ---- lighting and edges ------------------------------------------------------------------

let environment = null;
/** Image-based lighting from three's RoomEnvironment through a PMREM, or the plain lights. */
async function setEnvironment(on, save = true) {
  if (save) savePrefs({ environment: on });
  state.environment = on;
  if (!scene) return;
  if (on && !environment) {
    const t0 = performance.now();
    try {
      const { RoomEnvironment } = await import("three/addons/environments/RoomEnvironment.js");
      const Generator = state.rendererKind === "WebGPU" ? (await import("three/webgpu")).PMREMGenerator : THREE.PMREMGenerator;
      const pmrem = new Generator(renderer);
      const room = new RoomEnvironment();
      environment = pmrem.fromScene(room, 0.04).texture;
      room.dispose?.();
      pmrem.dispose();
      probe.envMs = performance.now() - t0;
    } catch (e) {
      console.warn(`environment lighting is not available here: ${e.message}`);
      environment = null;
    }
  }
  scene.environment = on ? environment : null;
  scene.environmentIntensity = 0.7;
  hemi.intensity = on && environment ? 0.7 : 1.6;
  headlight.intensity = on && environment ? 1.4 : 2.2;
  requestRender();
}

let fatLines = null;
async function loadFatLines() {
  if (fatLines) return fatLines;
  try {
    const { LineSegmentsGeometry } = await import("three/addons/lines/LineSegmentsGeometry.js");
    if (state.rendererKind === "WebGPU") {
      const { LineSegments2 } = await import("three/addons/lines/webgpu/LineSegments2.js");
      const { Line2NodeMaterial } = await import("three/webgpu");
      fatLines = { LineSegments2, LineSegmentsGeometry, material: () => new Line2NodeMaterial({ color: 0xffffff, linewidth: 1.6, vertexColors: true, worldUnits: false }) };
    } else {
      const { LineSegments2 } = await import("three/addons/lines/LineSegments2.js");
      const { LineMaterial } = await import("three/addons/lines/LineMaterial.js");
      fatLines = { LineSegments2, LineSegmentsGeometry, material: () => new LineMaterial({ color: 0xffffff, linewidth: 1.6, vertexColors: true, worldUnits: false }) };
    }
  } catch (e) {
    console.warn(`fat lines are not available here: ${e.message}`);
    fatLines = null;
  }
  return fatLines;
}

/** Edges as screen-space quads of width px (LineSegments2, default 1.6), when the line modules loaded. */
function makeFatEdges(positions, colors, planes, width = 1.6) {
  if (!fatLines || positions.length === 0) return null;
  const g = new fatLines.LineSegmentsGeometry();
  g.setPositions(positions);
  g.setColors(colors);
  const material = fatLines.material();
  material.linewidth = width;
  material.clippingPlanes = planes;
  const el = $("viewport");
  material.resolution?.set(el.clientWidth * renderer.getPixelRatio(), el.clientHeight * renderer.getPixelRatio());
  lineMaterials.add(material);
  const object = new fatLines.LineSegments2(g, material);
  return {
    object,
    setColors: (c) => g.setColors(c),
    setClipping: (p) => {
      material.clippingPlanes = p;
      material.needsUpdate = true;
    },
    dispose: () => {
      lineMaterials.delete(material);
      g.dispose();
      material.dispose();
    },
  };
}

async function setEdgeStyle(style) {
  savePrefs({ edgeStyle: style });
  if (!model) return;
  if (style === "fat" && !(await loadFatLines())) {
    flash("fat lines are not available with this renderer");
    style = "thin";
  }
  model.setEdges(model.edgesOn, style);
  requestRender();
}

// ---- data --------------------------------------------------------------------------------

async function load() {
  if (state.loading) {
    state.reload = true;
    return state.loading;
  }
  state.loading = (async () => {
    do {
      state.reload = false;
      await loadOnce();
    } while (state.reload);
  })().finally(() => (state.loading = null));
  return state.loading;
}

/** Rebuild the scene from the loaded GLB (after the batching setting changes). */
function reloadModel(batch) {
  if (!model || !state.parsed) return;
  model.batch = batch;
  buildScene();
  requestRender();
}

function buildScene() {
  const data = state.model;
  const defOf = new Map((data.tree ?? []).map((n) => [n.path, n.def]));
  model.build(state.parsed, data.fits, (path) => defOf.get(path), (def) => partReport(def)?.counts?.faces);
  view.radius = Math.max(model.box().getBoundingSphere(new THREE.Sphere()).radius, 0.01);
  tools.afterBuild();
}

async function loadOnce() {
  const res = await fetch("api/model", { cache: "no-store" });
  if (!res.ok) throw new Error(`api/model answered ${res.status}`);
  const data = await res.json();
  showRun(data.run);
  if (!data.rev) {
    showMessage(data.run?.state === "error" ? "The script has an error and there is no revision to show yet." : "Waiting for the first run of the script...");
    return;
  }
  if (data.rev === state.rev && state.model) return;
  state.model = data;
  if (renderer) {
    showMessage(`Loading ${data.rev}...`);
    const glb = await fetch(data.glb, { cache: "no-store" });
    if (!glb.ok) {
      const text = await glb.text();
      showMessage(`The GLB of ${data.rev} could not be made: ${text.slice(0, 300)}`, true);
      return;
    }
    const t0 = performance.now();
    state.parsed = parseGlb(await glb.arrayBuffer());
    probe.parseMs = performance.now() - t0;
    // Keep paths that still exist, so an edit does not lose the selection.
    const paths = new Set(state.parsed.parts.map((p) => p.path));
    for (const set of [state.selected, state.hidden]) for (const p of [...set]) if (!paths.has(p)) set.delete(p);
    if (state.isolated) state.isolated = new Set([...state.isolated].filter((p) => paths.has(p)));
    if (state.primary && !paths.has(state.primary)) state.primary = null;
    // Face numbers can change with the geometry: picked elements do not carry over.
    state.elements = [];
    const t1 = performance.now();
    buildScene();
    probe.buildMs = performance.now() - t1;
    if (!state.framed) {
      const g = view.goal(model.box(), [1, -1, 1]);
      view.apply(g.target, g.position, g.half);
      state.framed = true;
    }
  }
  state.rev = data.rev;
  if (state.agent) {
    applyAgent();
    renderAgent();
  }
  if (data.run?.state === "error") showRun(data.run);
  else showMessage(data.note ?? "");
  state.activeFit = -1;
  renderTree();
  renderFits();
  renderMeasure();
  renderStatus();
  refresh();
  if (!$("drawing").hidden) showDrawing(true);
}

function connect() {
  const link = $("status-link");
  const es = new EventSource("api/events");
  es.addEventListener("open", () => {
    link.textContent = "live";
    link.className = "ok";
  });
  es.addEventListener("error", () => {
    link.textContent = "reconnecting";
    link.className = "warn";
  });
  es.addEventListener("revision", (e) => {
    const { rev } = JSON.parse(e.data);
    if (rev !== state.rev) load().catch((err) => showMessage(err.message, true));
  });
  es.addEventListener("hello", (e) => {
    const hello = JSON.parse(e.data);
    if (hello.highlight) showAgent(hello.highlight);
  });
  es.addEventListener("highlight", (e) => showAgent(JSON.parse(e.data)));
  es.addEventListener("selection", (e) => showShare(JSON.parse(e.data)));
  es.addEventListener("run", (e) => {
    const run = JSON.parse(e.data);
    showRun(run);
    if (run.state !== "running" && !state.rev) load().catch((err) => showMessage(err.message, true));
  });
}

// ---- tree --------------------------------------------------------------------------------

function defName(id) {
  return state.model?.definitions?.[id]?.name ?? id;
}

function partReport(def) {
  return state.model?.parts?.find((p) => p.def === def) ?? state.model?.report?.parts?.find((p) => p.def === def);
}

function leavesUnder(path) {
  const tree = state.model?.tree ?? [];
  return tree.filter((n) => n.kind !== "assembly" && (n.path === path || n.path.startsWith(`${path}/`))).map((n) => n.path);
}

function renderTree() {
  const ul = $("tree");
  ul.replaceChildren();
  const tree = state.model?.tree ?? [];
  const leaves = tree.filter((n) => n.kind !== "assembly");
  $("tree-count").textContent = `(${leaves.length} occurrence${leaves.length === 1 ? "" : "s"})`;
  for (const n of tree) {
    const leaf = n.kind !== "assembly";
    const li = document.createElement("li");
    li.setAttribute("role", "treeitem");
    li.dataset.path = n.path;
    li.dataset.leaf = String(leaf);
    li.tabIndex = -1;
    li.style.paddingLeft = `${4 + 14 * (n.path.split("/").length - 1)}px`;
    li.title = `${n.path} (definition ${n.def})`;
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    const part = model?.parts.get(n.path);
    const defColor = state.model?.definitions?.[n.def]?.color;
    if (part) swatch.style.background = `#${part.color.getHexString(THREE.SRGBColorSpace)}`;
    else if (leaf && defColor) swatch.style.background = `rgb(${defColor.map((c) => Math.round(c * 255)).join(" ")})`;
    else if (!leaf) swatch.style.visibility = "hidden";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = n.path.split("/").pop();
    const def = document.createElement("span");
    def.className = "def";
    if (leaf) {
      const r = partReport(n.def);
      const dot = document.createElement("span");
      dot.className = `validity ${r?.valid === false ? "bad" : "ok"}`;
      dot.title = r?.valid === false ? "invalid solid" : "valid solid";
      def.append(dot, defName(n.def));
    } else {
      def.textContent = `${n.children ?? 0} items`;
    }
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "eye";
    eye.title = "Hide or show";
    eye.setAttribute("aria-label", `Hide or show ${n.path}`);
    eye.textContent = "◉";
    eye.addEventListener("click", (e) => {
      e.stopPropagation();
      const paths = leavesUnder(n.path);
      const allHidden = paths.every((p) => state.hidden.has(p));
      for (const p of paths) allHidden ? state.hidden.delete(p) : state.hidden.add(p);
      refresh();
    });
    li.append(swatch, name, def, eye);
    li.addEventListener("click", (e) => {
      state.elements = [];
      select(leavesUnder(n.path), e.ctrlKey || e.metaKey || e.shiftKey, n.path);
    });
    li.addEventListener("dblclick", () => fitPaths(leavesUnder(n.path)));
    ul.append(li);
  }
}

function syncTree() {
  const agentPaths = new Set(state.agent ? state.agent.targets.flatMap((t) => t.paths) : []);
  for (const li of $("tree").children) {
    const path = li.dataset.path;
    const paths = li.dataset.leaf === "true" ? [path] : leavesUnder(path);
    const selected = paths.length > 0 && paths.every((p) => state.selected.has(p));
    li.setAttribute("aria-selected", String(selected));
    const visible = (p) => !state.hidden.has(p) && (!state.isolated || state.isolated.has(p));
    li.classList.toggle("hidden", paths.length > 0 && !paths.some(visible));
    li.classList.toggle("agent-target", paths.length > 0 && paths.some((p) => agentPaths.has(p)));
  }
  const first = $("tree").querySelector(`[aria-selected="true"]`);
  first?.scrollIntoView({ block: "nearest" });
}

// ---- selection ---------------------------------------------------------------------------

function select(paths, add = false, primary = paths[0] ?? null) {
  if (!add) state.selected.clear();
  const allIn = paths.length > 0 && paths.every((p) => state.selected.has(p));
  for (const p of paths) add && allIn ? state.selected.delete(p) : state.selected.add(p);
  state.primary = state.selected.size ? (paths.length === 1 ? paths[0] : primary) : null;
  state.activeFit = -1;
  state.elements = state.elements.filter((el) => state.selected.has(el.path));
  model?.setPicked([...state.elements, ...(tools?.measurePicks() ?? [])]);
  refresh();
  renderMeasure();
  renderFits();
}

/** Select the element under a click: a face or an edge of an occurrence. add keeps the others. */
function selectElement(element, add) {
  if (!add) state.elements = [];
  const at = state.elements.findIndex((el) => sameElement(el, element));
  if (at >= 0) state.elements.splice(at, 1);
  else state.elements.push(element);
  const keep = state.elements.slice();
  if (add) {
    state.selected.add(element.path);
    state.primary = element.path;
    state.activeFit = -1;
    state.elements = keep;
    model?.setPicked([...state.elements, ...(tools?.measurePicks() ?? [])]);
    refresh();
    renderMeasure();
    renderFits();
  } else {
    select([element.path]);
    state.elements = keep;
    model?.setPicked([...state.elements, ...(tools?.measurePicks() ?? [])]);
    renderMeasure();
  }
  requestRender();
}

function sameElement(a, b) {
  return a.path === b.path && a.kind === b.kind && (a.kind === "face" ? a.face === b.face : a.edge === b.edge);
}

function refresh() {
  syncTree();
  if (model) {
    model.refresh({ selected: state.selected, hidden: state.hidden, isolated: state.isolated, activeFit: state.activeFit });
    tools?.afterRefresh();
    requestRender();
  }
}

function fitPaths(paths) {
  if (!view || !model) return;
  const box = paths?.length ? model.box(paths) : model.box();
  view.frame(box);
  requestRender();
}

/** Observed numbers of a picked element, from the mesh. */
function elementFacts(el) {
  const part = model?.parts.get(el.path);
  if (!part) return null;
  return el.kind === "face" ? tools.faceFacts(part, el.face) : tools.edgeFacts(part, el.edge);
}

function renderMeasure() {
  scheduleShare();
  const box = $("measure");
  box.replaceChildren();
  const paths = [...state.selected];
  if (paths.length === 0) {
    box.innerHTML = `<p class="muted">Click a part in the view or the tree. A click in the view also picks the face or edge under the cursor.</p>`;
    return;
  }
  const node = state.model?.tree?.find((n) => n.path === state.primary) ?? state.model?.tree?.find((n) => n.path === paths[0]);
  const dl = document.createElement("dl");
  dl.className = "kv";
  const row = (k, v, tier) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    if (tier) {
      const t = document.createElement("span");
      t.className = `tier ${tier}`;
      t.textContent = tier;
      t.title = tier === "measured" ? "From the CPU kernel (the report): a number of record" : "Observed on the display mesh in the browser, within the export chord of the true surface";
      dd.append(" ", t);
    }
    dl.append(dt, dd);
  };
  for (const el of state.elements) {
    if (el.kind !== "face" && el.kind !== "edge") continue;
    const name = elementName(el.path, el);
    row(el.kind === "face" ? "Face" : "Edge", name.address ?? name.text);
    const facts = elementFacts(el);
    if (facts?.area !== undefined) row("Face area", `${round(facts.area)} mm²`, "observed");
    if (facts?.normal) row("Normal", facts.normal.map((v) => round(v, 3)).join(", "), "observed");
    if (facts?.length !== undefined) row("Edge length", `${round(facts.length)} mm`, "observed");
  }
  if (paths.length > 1) {
    row("Selected", `${paths.length} parts`);
    let volume = 0;
    for (const p of paths) {
      const n = state.model.tree.find((t) => t.path === p);
      volume += partReport(n?.def)?.volume_mm3 ?? 0;
    }
    row("Volume (sum)", `${round(volume)} mm³`, "measured");
  }
  if (node) {
    const r = partReport(node.def);
    row("Occurrence", node.path);
    row("Definition", `${defName(node.def)}${defName(node.def) !== node.def ? ` (${node.def})` : ""}`);
    if (r) {
      row("Valid", r.valid ? "yes" : "no");
      row("Volume", `${round(r.volume_mm3)} mm³`, "measured");
      if (r.area_mm2 !== undefined) row("Area", `${round(r.area_mm2)} mm²`, "measured");
      if (r.mass_g !== undefined) row("Mass", `${round(r.mass_g)} g`);
      const s = r.bbox.max.map((v, i) => v - r.bbox.min[i]);
      row("Size", `${s.map((v) => round(v)).join(" x ")} mm`);
      row("Local min", r.bbox.min.map((v) => round(v)).join(", "));
      row("Local max", r.bbox.max.map((v) => round(v)).join(", "));
      if (r.center_of_mass) row("Centre of mass", r.center_of_mass.map((v) => round(v)).join(", "));
      if (r.counts) row("Counts", `${r.counts.solids} solid${r.counts.solids === 1 ? "" : "s"}${r.counts.faces !== undefined ? `, ${r.counts.faces} faces, ${r.counts.edges} edges` : ""}`);
      if (r.occurrences !== undefined) row("Instances", String(r.occurrences));
    }
    const part = model?.parts.get(node.path);
    if (part) {
      const w = part.base;
      row("World min", w.min.toArray().map((v) => round(v)).join(", "));
      row("World max", w.max.toArray().map((v) => round(v)).join(", "));
      if (!part.info.addressing.addressed) row("Face addresses", `off: ${part.info.addressing.reason}`);
    }
  }
  box.append(dl);
  const actions = document.createElement("div");
  actions.className = "measure-actions";
  for (const [label, fn] of [["Fit", () => fitPaths(paths)], ["Isolate", () => isolate()], ["Hide", () => hideSelected()], [state.elements.length ? "Copy address" : "Copy path", () => copyPath()]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", fn);
    actions.append(b);
  }
  box.append(actions);
}

function isolate() {
  if (state.isolated || state.selected.size === 0) state.isolated = null;
  else state.isolated = new Set(state.selected);
  refresh();
}

function hideSelected() {
  for (const p of state.selected) state.hidden.add(p);
  state.selected.clear();
  state.elements = [];
  model?.setPicked(tools?.measurePicks() ?? []);
  state.primary = null;
  refresh();
  renderMeasure();
}

/** Copy what an agent needs: the picked element addresses, else the occurrence path. */
function copyPath() {
  let text;
  if (state.elements.length) text = state.elements.map((el) => elementName(el.path, el)).map((n) => n.address ?? n.text).join("\n");
  else text = state.primary ?? [...state.selected][0];
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => flash(`copied ${text.split("\n").join(", ")}`), () => flash(text));
}

// ---- fits --------------------------------------------------------------------------------

function renderFits() {
  const ul = $("fits");
  ul.replaceChildren();
  const fits = state.model?.fits ?? [];
  const counts = fitCounts(fits);
  const further = counts.extra ? `, ${counts.extra} further gap${counts.extra === 1 ? "" : "s"}` : "";
  $("fits-count").textContent = fits.length ? `(${counts.clash} clash, ${counts.contact} contact, ${counts.clearance} clearance${further})` : "(none)";
  const order = fits.map((f, i) => [f, i]).sort((x, y) => (FIT_ORDER[x[0].kind] ?? 9) - (FIT_ORDER[y[0].kind] ?? 9));
  for (const [f, i] of order) {
    const li = document.createElement("li");
    li.dataset.fit = String(i);
    li.classList.toggle("active", i === state.activeFit);
    const kind = document.createElement("span");
    kind.className = `kind ${f.kind}`;
    kind.textContent = f.kind;
    const pair = document.createElement("span");
    pair.className = "pair";
    pair.textContent = `${f.a} ↔ ${f.b}${f.n ? ` (x${f.n})` : ""}`;
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = `${fitValue(f, fits)}, ${f.confidence}`;
    li.append(kind, pair, value);
    li.addEventListener("click", () => {
      const paths = [...new Set(fitPairs(f).flat())];
      state.elements = [];
      select(paths.filter((p) => !model || model.parts.has(p)));
      state.activeFit = i;
      refresh();
      renderFits();
      fitPaths(paths);
    });
    ul.append(li);
  }
  // The stored report's warnings, plus the last run's when it made the shown revision.
  const run = state.run?.rev && state.run.rev === state.model?.rev ? state.run.warnings ?? [] : [];
  const warnings = [...new Set([...run, ...(state.model?.report?.warnings ?? [])])];
  $("warnings-section").hidden = warnings.length === 0;
  $("warnings").replaceChildren(...warnings.map((w) => Object.assign(document.createElement("li"), { textContent: w })));
}

// ---- status ------------------------------------------------------------------------------

function renderStatus() {
  const m = state.model;
  const rev = $("status-rev");
  rev.textContent = m?.rev ? `${m.rev}${m.rev === m.head ? " (head)" : ""}` : "no revision";
  const valid = $("status-valid");
  const parts = m?.report?.parts ?? [];
  const bad = parts.filter((p) => !p.valid).length;
  // The worse of the stored status and the status of the run that made this revision.
  const rank = { ok: 0, warning: 1, error: 2 };
  const runStatus = state.run?.rev && state.run.rev === m?.rev ? state.run.status : undefined;
  const status = (rank[runStatus] ?? -1) > (rank[m?.report?.status] ?? -1) ? runStatus : m?.report?.status;
  valid.textContent = m?.rev ? `${status ?? "?"}: ${parts.length - bad} of ${parts.length} definitions valid` : "";
  valid.className = bad || status === "error" ? "bad" : status === "warning" ? "warn" : "ok";
  const c = m?.report?.compute ?? m?.compute;
  $("status-compute").textContent = c ? `compute ${c.backend} on ${c.device}` : "";
  $("status-compute").title = c?.placement_reason ?? "";
  const forced = query.get("renderer") === "webgl" && state.rendererKind === "WebGL2";
  $("status-renderer").textContent = state.rendererKind === "none" ? "no GPU context: drawing view" : `${state.rendererKind}${state.software ? " (software)" : ""}${forced ? " (WebGPU off)" : ""}${model?.batched ? ", batched" : ""}`;
  $("project-name").textContent = m?.project ?? $("project-name").textContent;
}

function showRun(run) {
  const el = $("status-run");
  if (!run) return;
  state.run = run;
  if (state.model && run.rev === state.model.rev) {
    renderStatus();
    renderFits();
  }
  if (run.state === "running") {
    el.textContent = "running the script...";
    el.className = "warn";
  } else if (run.state === "error" && run.error) {
    const e = run.error;
    el.textContent = `${e.code}${e.line ? ` at line ${e.line}` : ""}: ${e.message}`.slice(0, 200);
    el.title = e.hint ?? "";
    el.className = "bad";
    showMessage(`The last run failed (${e.code}${e.line ? `, line ${e.line}` : ""}): ${e.message}${e.hint ? ` ${e.hint}` : ""}${state.rev ? ` Showing ${state.rev}.` : ""}`, true);
  } else if (run.at) {
    el.textContent = `ran ${new Date(run.at).toLocaleTimeString()}`;
    el.title = "";
    el.className = "";
    if ($("message").classList.contains("error") && state.rev) showMessage("");
  }
}

function showMessage(text, error = false) {
  const m = $("message");
  m.textContent = text;
  m.classList.toggle("error", error);
}

let flashTimer = 0;
function flash(text) {
  showMessage(text);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => showMessage(""), 1800);
}

// ---- drawing -----------------------------------------------------------------------------

function showDrawing(on, note) {
  const d = $("drawing");
  d.hidden = !on;
  setPressed("drawing", on);
  if (note !== undefined) $("drawing-note").textContent = note;
  if (!on) return;
  const rev = state.model?.rev;
  const img = $("drawing-img");
  if (!rev) return;
  const src = state.model.drawing;
  if (img.getAttribute("src") !== src) {
    if (state.rendererKind !== "none") $("drawing-note").textContent = `Rendering the hidden-line drawing of ${rev} on the CPU...`;
    img.onload = () => {
      if (state.rendererKind !== "none") $("drawing-note").textContent = "";
    };
    img.onerror = () => ($("drawing-note").textContent = `The drawing of ${rev} could not be rendered.`);
    img.src = src;
  }
}

// ---- input -------------------------------------------------------------------------------

function bindPointer(canvas) {
  let down = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, button: e.button };
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || e.button !== 0 || down.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    const add = e.ctrlKey || e.metaKey || e.shiftKey;
    const hit = hitAt(e.clientX, e.clientY);
    if (tools.measuring) {
      tools.measurePick(hit);
      return;
    }
    if (hit?.element.kind === "cap") {
      // A section cap: the part that was cut. Caps have no face address.
      if (!add) state.elements = [];
      select([hit.path], add);
      requestRender();
    } else if (hit) selectElement(hit.element, add);
    else if (!add) {
      state.elements = [];
      select([]);
    }
  });
  let pending = false;
  let last = null;
  canvas.addEventListener("pointermove", (e) => {
    last = e;
    if (e.buttons || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const hit = hitAt(last.clientX, last.clientY);
      const el = hit?.element ?? null;
      const before = model.hovered;
      if (!el !== !before || (el && before && !sameElement(el, before))) {
        model.setHover(el);
        canvas.style.cursor = el ? (el.kind === "edge" ? "crosshair" : "pointer") : "";
        requestRender();
      }
    });
  });
  canvas.addEventListener("pointerleave", () => {
    if (model?.hovered) {
      model.setHover(null);
      requestRender();
    }
  });
}

/** The element under a screen point: { path, element, point, normal, ... } or null. */
function hitAt(clientX, clientY) {
  if (!model || !view) return null;
  const t0 = performance.now();
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, view.camera);
  const hit = model.pick(raycaster);
  if (hit) {
    const project = (v) => {
      const p = v.clone().project(view.camera);
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    };
    const edge = model.nearestEdge(hit, clientX, clientY, project);
    hit.element = model.element(hit, edge);
  }
  record(probe.pickMs, performance.now() - t0);
  return hit;
}

function bindUi() {
  for (const b of document.querySelectorAll("[data-action]")) b.addEventListener("click", () => act(b.dataset.action));
  $("nav-preset").addEventListener("change", (e) => setPreset(e.target.value));
  document.addEventListener("keydown", (e) => {
    // Typed text belongs to the control; a slider or a checkbox with focus keeps the shortcuts.
    if (takesText(e.target)) return;
    if (e.altKey) return;
    const k = e.key;
    if (k === "Escape") {
      if (!$("help").hidden) return act("help");
      if (!$("drawing").hidden && state.rendererKind !== "none") return showDrawing(false);
      if (tools.measuring) return tools.setMeasuring(false);
      if (state.isolated) {
        state.isolated = null;
        return refresh();
      }
      state.elements = [];
      return select([]);
    }
    if (!$("help").hidden && k !== "?") return;
    if (e.ctrlKey || e.metaKey) return;
    // The action follows Shift, not the letter case, so Caps Lock changes nothing.
    const action = shortcutAction(k, e.shiftKey);
    if (!action) return;
    e.preventDefault();
    act(action);
  });
}

function act(action) {
  switch (action) {
    case "fit":
      return fitPaths();
    case "fit-selection":
      return fitPaths(state.selected.size ? [...state.selected] : undefined);
    case "view-front":
    case "view-top":
    case "view-right":
    case "view-iso":
      if (view && model) {
        view.setView(action.slice(5), model.box());
        requestRender();
      }
      return;
    case "projection":
      if (!view) return;
      view.toggleProjection();
      $("projection-button").textContent = view.isOrtho ? "Ortho" : "Persp";
      savePrefs({ projection: view.isOrtho ? "orthographic" : "perspective" });
      return;
    case "hide":
      return hideSelected();
    case "show-all":
      state.hidden.clear();
      state.isolated = null;
      return refresh();
    case "isolate":
      return isolate();
    case "edges":
      if (!model) return;
      model.setEdges(!model.edgesOn);
      setPressed("edges", model.edgesOn);
      savePrefs({ edges: model.edgesOn });
      return refresh();
    case "markers":
      if (!model) return;
      model.markersOn = !model.markersOn;
      setPressed("markers", model.markersOn);
      savePrefs({ markers: model.markersOn });
      return refresh();
    case "drawing":
      if (state.rendererKind === "none") return;
      return showDrawing($("drawing").hidden);
    case "theme": {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      applyTheme(next);
      savePrefs({ theme: next });
      themeScene();
      return;
    }
    case "next-preset": {
      const names = Object.keys(PRESETS);
      const next = names[(names.indexOf(view?.preset ?? prefs.preset) + 1) % names.length];
      $("nav-preset").value = next;
      setPreset(next);
      flash(`mouse: ${PRESETS[next].label}`);
      return;
    }
    case "copy":
      return copyPath();
    case "agent-frame":
      return state.agent ? frameAgent() : flash("no agent is pointing at anything");
    case "agent-dismiss":
      return dismissAgent();
    case "help": {
      const h = $("help");
      h.hidden = !h.hidden;
      if (!h.hidden) {
        // The heading takes the focus, so the card opens at the top (focusing Close scrolled it down).
        $("help-title").focus({ preventScroll: true });
        h.querySelector(".card").scrollTop = 0;
      }
      return;
    }
    case "section":
    case "xray":
    case "measure":
    case "overlay":
    case "screenshot":
      return tools?.act(action);
  }
}

function setPreset(name) {
  view?.setPreset(name);
  savePrefs({ preset: name });
}

function setPressed(action, on) {
  for (const b of document.querySelectorAll(`[data-action="${action}"]`)) b.setAttribute("aria-pressed", String(on));
}

// ---- sharing with agents ------------------------------------------------------------------
//
// The selection goes to the server 250 ms after it last changed, only when it differs from
// what the server last accepted. The server checks it against the revision and keeps it in
// the project (.o3j-view/selection.json), where inspect fields=[selection] reads it.

const DISMISSED_KEY = "open3dj.viewer.dismissed";
let shareTimer = 0;
let lastShared = null;
const num = (x, d = 4) => Number(x.toFixed(d)) + 0;

function bindShare() {
  const on = $("share-on");
  on.checked = prefs.share !== false;
  on.addEventListener("change", () => {
    savePrefs({ share: on.checked });
    // Turning sharing off clears what agents see; turning it on shares the selection now.
    if (on.checked) scheduleShare(true);
    else sendShare({ items: [] }, true);
  });
  $("share-clear").addEventListener("click", () => {
    state.elements = [];
    select([]);
    clearTimeout(shareTimer);
    sendShare({ items: [] }, true);
  });
  $("agent-frame").addEventListener("click", () => frameAgent());
  $("agent-dismiss").addEventListener("click", () => dismissAgent());
  fetch("api/selection", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((sel) => sel && showShare(sel), () => {});
}

/** The selection as the server wants it: occurrence paths and kernel face numbers (1-based). */
function selectionPayload() {
  const items = [];
  const withElements = new Set();
  for (const el of state.elements) {
    const part = model?.parts.get(el.path);
    if (!part || !el.addressed) continue;
    withElements.add(el.path);
    if (el.kind === "face") {
      const { starts } = part.info.ranges;
      // Observed on the display mesh, in the definition's frame (where face queries are written).
      const f = facePatch(part.info.positions, part.info.index, starts[el.face], starts[el.face + 1]);
      const observed = { area_mm2: num(f.area), centroid: f.centre.map((v) => num(v)) };
      if (f.planar) observed.normal = f.normal.map((v) => num(v, 6));
      items.push({ path: el.path, face: el.face + 1, observed });
    } else {
      const e = part.info.edges[el.edge];
      const faces = e.faces.filter((x) => x >= 0).map((x) => x + 1);
      const c = [0, 0, 0];
      const n = e.segments.length / 3;
      for (let i = 0; i < e.segments.length; i++) c[i % 3] += e.segments[i] / n;
      items.push({ path: el.path, edge_faces: faces, observed: { length_mm: num(e.length), centroid: c.map((v) => num(v)) } });
    }
  }
  for (const p of state.selected) if (!withElements.has(p)) items.push({ path: p });
  return state.rev ? { rev: state.rev, items: items.slice(0, 64) } : { items: [] };
}

function scheduleShare(force = false) {
  if (prefs.share === false || !state.rev) return;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(() => sendShare(selectionPayload(), force), 250);
}

async function sendShare(payload, force = false) {
  const body = JSON.stringify(payload);
  if (!force && body === lastShared) return;
  try {
    const res = await fetch("api/selection", { method: "POST", headers: { "Content-Type": "application/json" }, body, cache: "no-store" });
    if (res.status === 429) {
      clearTimeout(shareTimer);
      shareTimer = setTimeout(() => sendShare(prefs.share === false ? { items: [] } : selectionPayload(), force), 1000);
      return;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) return showShare(null, `not shared: ${data?.error?.message ?? `the server answered ${res.status}`}`);
    lastShared = body;
    showShare(data);
  } catch (e) {
    showShare(null, `not shared: ${e.message}`);
  }
}

function showShare(sel, problem) {
  const el = $("share-state");
  el.classList.toggle("bad", !!problem);
  if (problem) {
    el.textContent = problem;
    el.title = "";
    return;
  }
  state.shared = sel;
  const names = (sel?.items ?? []).map((i) => i.address ?? `${i.path}: the edge between ${i.faces?.join(" and ")}`);
  el.textContent = prefs.share === false ? "off" : names.length ? `agents see ${names.length === 1 ? names[0] : `${names.length} items`}` : "agents see nothing selected";
  el.title = names.join("\n");
}

// ---- what an agent points at ----------------------------------------------------------------

function dismissedIds() {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function showAgent(h) {
  if (!h || !Array.isArray(h.targets) || dismissedIds().includes(h.id)) return;
  if (state.agent?.id === h.id) return;
  state.agent = h;
  applyAgent();
  renderAgent();
  syncTree();
}

/**
 * Show the highlight: parts named whole are tinted, faces (on the revision it named) are filled
 * and their parts left untinted, and every target's edges show through the parts in front of
 * it. The camera never moves here: the person frames it (Frame, A, or a target in the banner).
 */
function applyAgent() {
  if (!model || model.parts.size === 0) return;
  const h = state.agent;
  if (!h) {
    model.setAgent();
    requestRender();
    return;
  }
  const all = new Set(h.targets.flatMap((t) => t.paths));
  const tint = new Set();
  const faces = [];
  for (const t of h.targets) {
    const n = t.element ? Number(t.element.slice(5)) - 1 : -1;
    for (const p of t.paths) {
      const addressed = model.parts.get(p)?.info.addressing.addressed;
      if (n >= 0 && h.rev === state.rev && addressed) faces.push({ path: p, face: n });
      else tint.add(p);
    }
  }
  model.setAgent(tint, faces, all);
  requestRender();
}

/** Frame what is pointed at (all targets, or the paths given), with some of the assembly around it. */
function frameAgent(only) {
  const h = state.agent;
  if (!h || !model) return;
  const paths = [...new Set(only ?? h.targets.flatMap((t) => t.paths))].filter((p) => model.parts.has(p));
  if (paths.length === 0) return;
  // Hidden or isolated-away targets are shown again: the agent wants them seen.
  let changed = false;
  for (const p of paths) changed = state.hidden.delete(p) || changed;
  if (state.isolated && paths.some((p) => !state.isolated.has(p))) {
    for (const p of paths) state.isolated.add(p);
    changed = true;
  }
  if (changed) refresh();
  // A small target alone fills the view with no context: the box grows to at least a quarter
  // of the assembly's size on each axis, around the targets.
  const box = model.box(paths);
  const whole = model.box().getSize(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const half = new THREE.Vector3(Math.max(size.x, 0.25 * whole.x), Math.max(size.y, 0.25 * whole.y), Math.max(size.z, 0.25 * whole.z)).multiplyScalar(0.5);
  view.frame(new THREE.Box3(centre.clone().sub(half), centre.clone().add(half)));
  requestRender();
}

function dismissAgent() {
  const h = state.agent;
  if (!h) return;
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedIds(), h.id].slice(-50)));
  } catch {
    // Without storage a reload shows it again; that is all.
  }
  state.agent = null;
  applyAgent();
  renderAgent();
  syncTree();
}

function renderAgent() {
  const box = $("agent");
  const h = state.agent;
  box.hidden = !h;
  if (!h) return;
  const older = state.rev && h.rev !== state.rev;
  $("agent-rev").textContent = older ? `${h.rev} (faces not shown on ${state.rev})` : h.rev;
  // Each target is a button: it selects the parts it names and frames them.
  $("agent-targets").replaceChildren(...h.targets.map((t) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t.target;
    b.dataset.target = t.target;
    b.title = t.paths.length > 1 ? `${t.paths.length} parts: ${t.paths.slice(0, 20).join(", ")}${t.paths.length > 20 ? ", ..." : ""}` : t.paths[0];
    b.addEventListener("click", () => {
      const paths = t.paths.filter((p) => model?.parts.has(p));
      state.elements = [];
      select(paths);
      frameAgent(paths);
    });
    li.append(b);
    return li;
  }));
  const note = $("agent-note");
  note.hidden = !h.note;
  note.textContent = h.note ?? "";
}

/** Frame the parts again when the exploded view moved some out of sight (after the explode slider). */
function fitIfOutside() {
  if (!view || !model) return;
  const box = model.box();
  if (box.isEmpty()) return;
  view.camera.updateMatrixWorld();
  const p = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(view.camera);
    if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) {
      view.frame(box);
      requestRender();
      return;
    }
  }
}

// ---- screenshot and probe ------------------------------------------------------------------

/** Download the current view as a PNG: draw one frame and read the canvas in the same task. */
function screenshot() {
  if (!renderer) return;
  renderer.render(scene, view.camera);
  renderer.domElement.toBlob((blob) => {
    if (!blob) return flash("the view could not be read back");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.model?.project ?? "open3dj"}-${state.rev ?? "view"}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    flash(`saved ${a.download}`);
  }, "image/png");
}

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(2);
};

/** The frame-time probe: what the last frames cost, and what is drawn. */
function perf() {
  return {
    renderer: state.rendererKind,
    software: !!state.software,
    environment: !!state.environment,
    pixelRatio: renderer?.getPixelRatio() ?? 0,
    adaptive: !!prefs.adaptive,
    lowResFrames: probe.lowResFrames ?? 0,
    frames: probe.frames,
    frameMs: { p50: pct(probe.intervals, 50), p95: pct(probe.intervals, 95), samples: probe.intervals.length },
    renderCpuMs: { p50: pct(probe.renderMs, 50), p95: pct(probe.renderMs, 95) },
    pickMs: { p50: pct(probe.pickMs, 50), p95: pct(probe.pickMs, 95), samples: probe.pickMs.length },
    loadMs: { parse: probe.parseMs ?? null, build: probe.buildMs ?? null, environment: probe.envMs ?? null },
    drawCalls: probe.calls ?? 0,
    triangles: probe.triangles ?? 0,
    scene: model?.stats() ?? null,
  };
}

/**
 * Orbit the camera for ms milliseconds, one step per frame, and report the frame times of that
 * run (the S2 frame-time probe; it needs no mouse, so input latency is not counted).
 */
function orbitProbe(ms = 3000) {
  if (!view) return Promise.resolve(null);
  probe.intervals.length = 0;
  probe.renderMs.length = 0;
  const target = view.controls.target.clone();
  const start = performance.now();
  return new Promise((resolve) => {
    const step = () => {
      const t = performance.now() - start;
      const offset = view.camera.position.clone().sub(target);
      offset.applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.02);
      view.camera.position.copy(target).add(offset);
      view.controls.update();
      view.updateClip();
      requestRender(true);
      if (t < ms) requestAnimationFrame(step);
      else {
        resolve(perf());
      }
    };
    requestAnimationFrame(step);
  });
}

// ---- theme and preferences ---------------------------------------------------------------

function applyTheme(theme) {
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function themeScene() {
  if (!scene) return;
  const css = getComputedStyle(document.documentElement);
  scene.background = new THREE.Color(css.getPropertyValue("--scene").trim() || "#e9ecf0");
  model.setEdgeColors(css.getPropertyValue("--scene-edge").trim() || "#1d232b", css.getPropertyValue("--accent").trim() || "#2563eb", css.getPropertyValue("--pick").trim() || "#0b3fa8");
  model.setMarkerColors();
  model.setAgentColor(css.getPropertyValue("--agent").trim() || "#c026d3");
  tools?.themeChanged();
  refresh();
}

function loadPrefs() {
  const d = { theme: "", preset: "open3dj", projection: "orthographic", edges: true, markers: true, dpr: 2, environment: "auto", edgeStyle: "thin", batch: "auto", adaptive: true, share: true };
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
  } catch {
    // No storage: the defaults.
  }
  const out = { ...d, ...saved };
  if (query.has("adaptive")) out.adaptive = query.get("adaptive") !== "0";
  return out;
}

function savePrefs(patch) {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are a convenience; the page works without storage.
  }
}

// ---- test and agent hooks ----------------------------------------------------------------

/** A small read-only handle for browser tests and probes. */
window.open3dj = {
  state: () => ({
    rev: state.rev, renderer: state.rendererKind, selected: [...state.selected], parts: model?.parts.size ?? 0, hidden: [...state.hidden],
    elements: state.elements.map((el) => elementName(el.path, el)),
    measure: tools?.measureState() ?? null,
    agent: state.agent ? { id: state.agent.id, rev: state.agent.rev, targets: state.agent.targets.map((t) => t.target), note: state.agent.note ?? null, shown: !$("agent").hidden, tinted: [...(model?.agentPaths ?? [])], faces: model?.agentFaces.length ?? 0 } : null,
    shared: state.shared ? state.shared.items.map((i) => i.address ?? `${i.path} ${i.faces?.join("+")}`) : null,
  }),
  projectPath(path) {
    const part = model?.parts.get(path);
    if (!part || !view) return null;
    const b = part.box;
    // The middle of the top face of the part's world box: the side the iso view looks at.
    return toScreen(new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z));
  },
  /** Observed facts of every face of an occurrence: [{ face, address, area, normal, planar, centre }]. */
  faces(path) {
    const part = model?.parts.get(path);
    if (!part) return [];
    const n = part.info.ranges.starts.length - 1;
    return Array.from({ length: n }, (_, face) => ({ face, address: elementName(path, { kind: "face", face, addressed: part.info.addressing.addressed }).address, ...tools.faceFacts(part, face) }));
  },
  /** A screen point on the given face that picking resolves to that face (a visible triangle centre), or null. */
  pointOnFace(path, face) {
    const part = model?.parts.get(path);
    if (!part || !view) return null;
    const { starts } = part.info.ranges;
    const pos = part.info.positions;
    const idx = part.info.index;
    for (let t = starts[face]; t < starts[face + 1]; t++) {
      const c = new THREE.Vector3();
      for (let k = 0; k < 3; k++) c.add(new THREE.Vector3(pos[idx[t * 3 + k] * 3], pos[idx[t * 3 + k] * 3 + 1], pos[idx[t * 3 + k] * 3 + 2]));
      const p = toScreen(c.divideScalar(3).applyMatrix4(part.world));
      const hit = hitAt(p.x, p.y);
      if (hit && hit.path === path && hit.element.kind === "face" && hit.element.face === face) return p;
    }
    return null;
  },
  select: (path) => {
    state.elements = [];
    select(path ? [path] : []);
  },
  /** The camera position and target, rounded (for tests: did something move the view?). */
  camera: () => (view ? { position: view.camera.position.toArray().map((v) => +v.toFixed(4)), target: view.controls.target.toArray().map((v) => +v.toFixed(4)) } : null),
  perf,
  probe: (ms) => orbitProbe(ms),
  tools: (options) => tools?.apply(options),
};

function toScreen(v) {
  const p = v.clone().project(view.camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
}
