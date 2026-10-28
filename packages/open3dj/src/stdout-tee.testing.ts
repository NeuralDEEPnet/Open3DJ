// Test helper for mcp-e2e.test.ts: runs a command, passes stdin and stdout straight
// through, and appends every stdout byte to a file. An MCP client can then talk to the
// real server while the test checks afterwards that stdout carried only JSON-RPC.
// Usage: node stdout-tee.testing.ts <log file> <command> [args...]
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const [log, command, ...args] = process.argv.slice(2);
if (!log || !command) {
  process.stderr.write("usage: stdout-tee.testing.ts <log file> <command> [args...]\n");
  process.exit(2);
}
const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
process.stdin.pipe(child.stdin);
child.stdout.on("data", (d: Buffer) => {
  appendFileSync(log, d);
  process.stdout.write(d);
});
// A client that closes sends SIGTERM: end the server's stdin so it shuts down cleanly.
process.on("SIGTERM", () => child.stdin.end());
child.on("exit", (code) => process.exit(code ?? 1));
