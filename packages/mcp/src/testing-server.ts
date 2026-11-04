// The MCP server over the fake compute pool, for the protocol tests (server.test.ts) and
// the CLI parity test. Same server code as `open3dj mcp`; only the pool is fake.
// Usage: node testing-server.ts [root]
import { createHandlers, guardStdout, serveStdio } from "./index.ts";
import { FAKE_INVENTORY, fakePlace, fakePool } from "./testing.ts";

guardStdout();
const handlers = createHandlers({ pool: fakePool(), inventory: FAKE_INVENTORY, place: fakePlace, root: process.argv[2] ?? process.cwd(), interactiveMs: 5_000 });
// The real daemon's warm workers keep its event loop alive; this timer does the same here,
// so a server that never returns from serveStdio hangs in tests as it would in production.
const keepAlive = setInterval(() => {}, 1 << 30);
await serveStdio(handlers, { version: "0.0.0-test" });
clearInterval(keepAlive);
