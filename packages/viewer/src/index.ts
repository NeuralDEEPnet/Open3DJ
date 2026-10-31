// @open3dj/viewer: the read-only browser viewer (PLAN.md S2, ARCHITECTURE.md sections 12 and
// 13). The page is plain ES modules in ../web, with three.js loaded through an import map,
// so there is no bundler and no build step. This module tells a server which files exist:
// a fixed table of published paths, so a request can never name a file outside it.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageStatus } from "@open3dj/schemas";

export const PACKAGE_STATUS: PackageStatus = "ready";

/** The folder that holds the page and its modules. */
export const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));

/** The three.js package folder (resolved from this package, never from the project). */
const THREE_DIR = dirname(dirname(createRequire(import.meta.url).resolve("three")));

export const THREE_VERSION = (JSON.parse(readFileSync(join(THREE_DIR, "package.json"), "utf8")) as { version: string }).version;

export interface Asset {
  /** Absolute path of the file on disk. */
  file: string;
  /** Content-Type to serve it with. */
  type: string;
}

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
};

/** Published name of a page module: lower case, digits and dashes, one known extension. */
const SAFE = /^[a-z0-9][a-z0-9-]*\.(js|css|svg)$/;

/**
 * The three.js files the page imports, by published name. Nothing else of three is served. The
 * add-ons keep their folder layout under addons/, so their relative imports (the WebGPU
 * LineSegments2 imports ../LineSegmentsGeometry.js) resolve to files in this table.
 */
const VENDOR: Record<string, string> = {
  "three.core.js": "build/three.core.js",
  "three.module.js": "build/three.module.js",
  "three.webgpu.js": "build/three.webgpu.js",
  "OrbitControls.js": "examples/jsm/controls/OrbitControls.js",
  "addons/environments/RoomEnvironment.js": "examples/jsm/environments/RoomEnvironment.js",
  "addons/lines/LineSegments2.js": "examples/jsm/lines/LineSegments2.js",
  "addons/lines/LineSegmentsGeometry.js": "examples/jsm/lines/LineSegmentsGeometry.js",
  "addons/lines/LineMaterial.js": "examples/jsm/lines/LineMaterial.js",
  "addons/lines/webgpu/LineSegments2.js": "examples/jsm/lines/webgpu/LineSegments2.js",
};

/** The import map the page uses. Paths are relative to the page, which lives at /<nonce>/. */
export const IMPORT_MAP = Object.freeze({
  imports: {
    three: "./vendor/three.module.js",
    "three/webgpu": "./vendor/three.webgpu.js",
    "three/addons/controls/OrbitControls.js": "./vendor/OrbitControls.js",
    "three/addons/environments/RoomEnvironment.js": "./vendor/addons/environments/RoomEnvironment.js",
    "three/addons/lines/LineSegments2.js": "./vendor/addons/lines/LineSegments2.js",
    "three/addons/lines/LineSegmentsGeometry.js": "./vendor/addons/lines/LineSegmentsGeometry.js",
    "three/addons/lines/LineMaterial.js": "./vendor/addons/lines/LineMaterial.js",
    "three/addons/lines/webgpu/LineSegments2.js": "./vendor/addons/lines/webgpu/LineSegments2.js",
  },
});

/**
 * Every static file the viewer serves, keyed by its published path relative to the page
 * (for example "app/main.js" or "vendor/three.module.js"). The table is built from a fixed
 * list and a flat listing of ../web, so a lookup is the only way to reach a file.
 */
export function viewerAssets(): ReadonlyMap<string, Asset> {
  const out = new Map<string, Asset>();
  for (const entry of readdirSync(WEB_DIR, { withFileTypes: true })) {
    if (!entry.isFile() || !SAFE.test(entry.name)) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf("."));
    out.set(`app/${entry.name}`, { file: join(WEB_DIR, entry.name), type: TYPES[ext]! });
  }
  for (const [name, rel] of Object.entries(VENDOR)) out.set(`vendor/${name}`, { file: join(THREE_DIR, ...rel.split("/")), type: TYPES[".js"]! });
  return out;
}

export interface ViewerPage {
  html: string;
  /** Content-Security-Policy for the page: only its own files, plus the hash of the inline import map. */
  csp: string;
}

/**
 * The page HTML with the import map filled in, and a CSP that allows exactly that inline
 * script by its hash. title names the project.
 */
export function viewerPage(title: string): ViewerPage {
  const template = readFileSync(join(WEB_DIR, "index.html"), "utf8");
  const map = JSON.stringify(IMPORT_MAP);
  const hash = createHash("sha256").update(map).digest("base64");
  const html = template.replace("{{IMPORT_MAP}}", () => map).replaceAll("{{TITLE}}", () => escapeHtml(title)).replaceAll("{{THREE_VERSION}}", () => THREE_VERSION);
  const csp = [
    "default-src 'none'",
    `script-src 'self' 'sha256-${hash}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return { html, csp };
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
