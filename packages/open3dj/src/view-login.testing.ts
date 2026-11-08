// Test helper for the open3dj view tests: raw HTTP requests, and the login a browser does on
// its first visit. A one-time link (/<nonce>/) answers a page that sets the session cookie,
// o3j_<port>; every other route lives at the root path and needs that cookie.
import assert from "node:assert/strict";
import { request } from "node:http";
import type { ViewServer } from "./view.ts";

export interface Answer { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

/** The headers a browser sends when a URL is pasted into its address bar. */
export const NAVIGATE: Readonly<Record<string, string>> = { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

/**
 * A raw request to s: the path goes out exactly as given (no URL normalisation), with the
 * loopback Host unless headers name another. A reset connection answers status 0.
 */
export function send(s: ViewServer, path: string, method = "GET", headers: Record<string, string> = {}, body?: string | Buffer, chunked = false): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const h: Record<string, string> = { host: `127.0.0.1:${s.port}`, ...headers };
    if (body !== undefined && !chunked && h["content-length"] === undefined) h["content-length"] = String(Buffer.byteLength(body));
    const req = request({ host: "127.0.0.1", port: s.port, path, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", (e: NodeJS.ErrnoException) => (e.code === "ECONNRESET" || e.code === "EPIPE" ? resolve({ status: 0, headers: {}, body: Buffer.alloc(0) }) : reject(e)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** The session cookie a one-time link's answer sets, as a Cookie header (o3j_<port>=<value>), or undefined. */
export function sessionCookie(s: ViewServer, a: Answer): string | undefined {
  const set = a.headers["set-cookie"];
  const first = Array.isArray(set) ? set[0] : set;
  const m = new RegExp(`^(${s.cookieName}=[A-Za-z0-9_-]+);`).exec(first ?? "");
  return m?.[1];
}

/**
 * Log in as a browser does: open a one-time link (default: the printed one) as a navigation
 * and keep the cookie its answer sets. Returns the Cookie header for later requests.
 */
export async function login(s: ViewServer, link = s.url): Promise<string> {
  const r = await send(s, new URL(link).pathname, "GET", NAVIGATE);
  assert.equal(r.status, 200, `login with ${link}: ${r.status} ${r.body.toString().trim()}`);
  const cookie = sessionCookie(s, r);
  assert.ok(cookie, `login with ${link} set no ${s.cookieName} cookie: ${String(r.headers["set-cookie"])}`);
  return cookie;
}

/** Open the viewer in a browser page: a new one-time link, then the move to the root path. */
export async function openPage(page: { goto(url: string): Promise<unknown>; waitForURL(url: string, options?: { timeout: number }): Promise<void> }, s: ViewServer, query = ""): Promise<void> {
  await page.goto(`${s.newLink()}${query ? `?${query}` : ""}`);
  await page.waitForURL(`${s.origin}/${query ? `?${query}` : ""}`, { timeout: 20_000 });
}
