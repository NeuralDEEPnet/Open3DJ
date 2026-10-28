// The Open3DJ viewer page. Read-only: it fetches the model JSON and the revision's GLB from
// open3dj view, listens for new revisions on a server-sent-events stream, and shows the
// assembly. Every URL is relative, because the page lives under its session nonce.
import * as THREE from "three";
import { ViewCamera, PRESETS } from "./camera.js";
import { FIT_ORDER, fitCounts, fitPairs, fitValue, round } from "./fits.js";
import { parseGlb } from "./glb.js";
import { ModelScene, markerColor } from "./scene.js";

const $ = (id) => document.getElementById(id);
const PREFS_KEY = "open3dj.viewer";

const state = {
  model: null,
  rev: null,
  /** The last run state from the server (status, rev, warnings). */
  run: null,
  parsed: null,
  selected: new Set(),
  primary: null,
  hovered: null,
  hidden: new Set(),
  isolated: null,
  activeFit: -1,
  rendererKind: "none",
  loading: null,
  framed: false,
};

const prefs = loadPrefs();
applyTheme(prefs.theme);

let renderer = null;
let view = null;
let scene = null;
let model = null;
let headlight = null;
let dirty = true;
const raycaster = new THREE.Raycaster();

// ---- start -------------------------------------------------------------------------------

start().catch((e) => showMessage(`The viewer could not start: ${e.message}`, true));

async function start() {
  const viewport = $("viewport");
  const made = await createRenderer();
  if (made) {
    renderer = made.renderer;
    state.rendererKind = made.kind;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    viewport.prepend(renderer.domElement);
    scene = new THREE.Scene();
    view = new ViewCamera(renderer.domElement, () => (dirty = true));
    view.setPreset(prefs.preset);
    if (prefs.projection === "perspective") view.toggleProjection();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6);
    hemi.position.set(0, 0, 1);
    scene.add(hemi);
    // A headlight that follows the camera, a little above and left of it, so the side you look at is lit.
    headlight = new THREE.DirectionalLight(0xffffff, 2.2);
    scene.add(headlight, headlight.target);
    model = new ModelScene();
    model.edgesOn = prefs.edges;
    model.markersOn = prefs.markers;
    scene.add(model.group);
    themeScene();
    new ResizeObserver(() => resize()).observe(viewport);
    resize();
    bindPointer(renderer.domElement);
    renderer.setAnimationLoop(frame);
  } else {
    state.rendererKind = "none";
    document.documentElement.dataset.viewer = "no-gpu";
    showDrawing(true, "This browser has no WebGPU or WebGL2 context, so the 3D view is off. This is the hidden-line drawing of the same revision, rendered on the CPU.");
  }
  setPressed("edges", prefs.edges);
  setPressed("markers", prefs.markers);
  $("nav-preset").value = view?.preset ?? prefs.preset;
  $("projection-button").textContent = view && !view.isOrtho ? "Persp" : "Ortho";
  bindUi();
  connect();
  await load();
}

/** WebGPURenderer when the browser has an adapter, else WebGLRenderer on WebGL2, else null. */
async function createRenderer() {
  const ask = new URLSearchParams(location.search).get("renderer");
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
          return { renderer: r, kind: "WebGPU" };
        }
        r.dispose();
      }
    } catch {
      // Fall through to WebGL2.
    }
  }
  try {
    const probe = document.createElement("canvas");
    if (!probe.getContext("webgl2")) return null;
    return { renderer: new THREE.WebGLRenderer({ antialias: true }), kind: "WebGL2" };
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

function frame(now) {
  const moving = view.step(now);
  if (!dirty && !moving) return;
  dirty = false;
  const cam = view.camera;
  cam.updateMatrixWorld();
  const dist = cam.position.distanceTo(view.controls.target);
  headlight.position.copy(cam.localToWorld(new THREE.Vector3(-0.25 * dist, 0.4 * dist, 0)));
  headlight.target.position.copy(view.controls.target);
  try {
    renderer.render(scene, cam);
  } catch (e) {
    if (state.rendererKind !== "WebGPU") throw e;
    window.dispatchEvent(new ErrorEvent("error", { message: `WebGPU render failed: ${e.message}` }));
    return;
  }
  if (state.rev && document.documentElement.dataset.viewer !== "ready" && model.parts.size > 0) {
    document.documentElement.dataset.viewer = "ready";
  }
}

function resize() {
  if (!renderer) return;
  const el = $("viewport");
  const w = Math.max(el.clientWidth, 1);
  const h = Math.max(el.clientHeight, 1);
  renderer.setSize(w, h, false);
  view.setSize(w, h);
  dirty = true;
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
    state.parsed = parseGlb(await glb.arrayBuffer());
    model.build(state.parsed, data.fits);
    view.radius = Math.max(model.box().getBoundingSphere(new THREE.Sphere()).radius, 0.01);
    // Keep paths that still exist, so an edit does not lose the selection.
    for (const set of [state.selected, state.hidden]) for (const p of [...set]) if (!model.parts.has(p)) set.delete(p);
    if (state.isolated) state.isolated = new Set([...state.isolated].filter((p) => model.parts.has(p)));
    if (state.primary && !model.parts.has(state.primary)) state.primary = null;
    if (!state.framed) {
      const g = view.goal(model.box(), [1, -1, 1]);
      view.apply(g.target, g.position, g.half);
      state.framed = true;
    }
  }
  state.rev = data.rev;
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
    li.addEventListener("click", (e) => select(leavesUnder(n.path), e.ctrlKey || e.metaKey, n.path));
    li.addEventListener("dblclick", () => fitPaths(leavesUnder(n.path)));
    ul.append(li);
  }
}

function syncTree() {
  for (const li of $("tree").children) {
    const path = li.dataset.path;
    const paths = li.dataset.leaf === "true" ? [path] : leavesUnder(path);
    const selected = paths.length > 0 && paths.every((p) => state.selected.has(p));
    li.setAttribute("aria-selected", String(selected));
    const visible = (p) => !state.hidden.has(p) && (!state.isolated || state.isolated.has(p));
    li.classList.toggle("hidden", paths.length > 0 && !paths.some(visible));
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
  refresh();
  renderMeasure();
  renderFits();
}

function refresh() {
  syncTree();
  if (model) {
    model.refresh({ selected: state.selected, hovered: state.hovered, hidden: state.hidden, isolated: state.isolated, activeFit: state.activeFit });
    dirty = true;
  }
}

function fitPaths(paths) {
  if (!view || !model) return;
  const box = paths?.length ? model.box(paths) : model.box();
  view.frame(box);
  dirty = true;
}

function renderMeasure() {
  const box = $("measure");
  box.replaceChildren();
  const paths = [...state.selected];
  if (paths.length === 0) {
    box.innerHTML = `<p class="muted">Click a part in the view or the tree.</p>`;
    return;
  }
  const node = state.model?.tree?.find((n) => n.path === state.primary) ?? state.model?.tree?.find((n) => n.path === paths[0]);
  const dl = document.createElement("dl");
  dl.className = "kv";
  const row = (k, v) => {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  };
  if (paths.length > 1) {
    row("Selected", `${paths.length} parts`);
    let volume = 0;
    for (const p of paths) {
      const n = state.model.tree.find((t) => t.path === p);
      volume += partReport(n?.def)?.volume_mm3 ?? 0;
    }
    row("Volume (sum)", `${round(volume)} mm³`);
  }
  if (node) {
    const r = partReport(node.def);
    row("Occurrence", node.path);
    row("Definition", `${defName(node.def)}${defName(node.def) !== node.def ? ` (${node.def})` : ""}`);
    if (r) {
      row("Valid", r.valid ? "yes" : "no");
      row("Volume", `${round(r.volume_mm3)} mm³`);
      if (r.area_mm2 !== undefined) row("Area", `${round(r.area_mm2)} mm²`);
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
      const w = part.box;
      row("World min", w.min.toArray().map((v) => round(v)).join(", "));
      row("World max", w.max.toArray().map((v) => round(v)).join(", "));
    }
  }
  box.append(dl);
  const actions = document.createElement("div");
  actions.className = "measure-actions";
  for (const [label, fn] of [["Fit", () => fitPaths(paths)], ["Isolate", () => isolate()], ["Hide", () => hideSelected()], ["Copy path", () => copyPath()]]) {
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
  state.primary = null;
  refresh();
  renderMeasure();
}

function copyPath() {
  const path = state.primary ?? [...state.selected][0];
  if (!path) return;
  navigator.clipboard?.writeText(path).then(() => flash(`copied ${path}`), () => flash(path));
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
  const forced = new URLSearchParams(location.search).get("renderer") === "webgl" && state.rendererKind === "WebGL2";
  $("status-renderer").textContent = state.rendererKind === "none" ? "no GPU context: drawing view" : `${state.rendererKind}${forced ? " (WebGPU off)" : ""}`;
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
    const path = pickAt(e.clientX, e.clientY);
    if (path) select([path], e.ctrlKey || e.metaKey);
    else if (!(e.ctrlKey || e.metaKey)) select([]);
  });
  let pending = false;
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const path = pickAt(e.clientX, e.clientY);
      if (path !== state.hovered) {
        state.hovered = path;
        canvas.style.cursor = path ? "pointer" : "";
        refresh();
      }
    });
  });
  canvas.addEventListener("pointerleave", () => {
    if (state.hovered) {
      state.hovered = null;
      refresh();
    }
  });
}

function pickAt(clientX, clientY) {
  if (!model || !view) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, view.camera);
  return model.pick(raycaster);
}

function bindUi() {
  for (const b of document.querySelectorAll("[data-action]")) b.addEventListener("click", () => act(b.dataset.action));
  $("nav-preset").addEventListener("change", (e) => setPreset(e.target.value));
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
    if (e.altKey) return;
    const k = e.key;
    if (k === "Escape") {
      if (!$("help").hidden) return act("help");
      if (!$("drawing").hidden && state.rendererKind !== "none") return showDrawing(false);
      if (state.isolated) {
        state.isolated = null;
        return refresh();
      }
      return select([]);
    }
    if (!$("help").hidden && k !== "?") return;
    if (e.ctrlKey || e.metaKey) return;
    const map = { f: "fit", F: "fit-selection", 1: "view-front", 2: "view-top", 3: "view-right", 4: "view-iso", p: "projection", h: "hide", H: "show-all", i: "isolate", e: "edges", m: "markers", d: "drawing", t: "theme", n: "next-preset", c: "copy", "?": "help" };
    const action = map[k] ?? map[k.toLowerCase?.()];
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
        dirty = true;
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
      model.edgesOn = !model.edgesOn;
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
    case "help": {
      const h = $("help");
      h.hidden = !h.hidden;
      if (!h.hidden) h.querySelector("button")?.focus();
      return;
    }
  }
}

function setPreset(name) {
  view?.setPreset(name);
  savePrefs({ preset: name });
}

function setPressed(action, on) {
  document.querySelector(`[data-action="${action}"]`)?.setAttribute("aria-pressed", String(on));
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
  model.setEdgeColors(css.getPropertyValue("--scene-edge").trim() || "#1d232b", css.getPropertyValue("--accent").trim() || "#2563eb");
  for (const m of model.fitMarkers) m.material.color.copy(markerColor(m.userData.kind));
  refresh();
}

function loadPrefs() {
  const d = { theme: "", preset: "open3dj", projection: "orthographic", edges: true, markers: true };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") };
  } catch {
    return d;
  }
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

/** A small read-only handle for browser tests: state, and the screen point of a part. */
window.open3dj = {
  state: () => ({ rev: state.rev, renderer: state.rendererKind, selected: [...state.selected], parts: model?.parts.size ?? 0, hidden: [...state.hidden] }),
  projectPath(path) {
    const part = model?.parts.get(path);
    if (!part || !view) return null;
    const b = part.box;
    // The middle of the top face of the part's world box: the side the iso view looks at.
    const p = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, b.max.z).project(view.camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  },
  select: (path) => select(path ? [path] : []),
};
