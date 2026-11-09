// The egress log of the agent panel (RFC 0001): an append-only JSON Lines file, readable by
// its owner only, with one record per approval decision and one per request that left the
// machine. A record names the card by its id and payload hash, the engine, the host and the
// model, and for a request its size, attempts, usage and outcome. It never holds the prompt
// text, the conversation or any key: every record is checked against the egress-record
// schema, which allows no free text, before it is written.
import { appendFileSync, chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { validate } from "@open3dj/schemas";
import type { ValidationIssue } from "@open3dj/schemas";
import type { EngineId, TokenUsage } from "./types.ts";

interface RecordBase {
  ts: string;
  approval_id: string;
  payload_hash: string;
  engine: EngineId;
  host: string;
  model: string | null;
}

export type EgressRecord =
  | (RecordBase & { kind: "approval"; decision: "approved" | "denied" | "expired"; scope?: "prompt" | "session"; by: string; grant?: string })
  | (RecordBase & { kind: "request"; request_bytes: number; attempts: number; usage: TokenUsage | null; outcome: "ok" | "error" | "stopped" | "timeout" });

export class EgressLog {
  readonly path: string;

  /**
   * Opens (or creates) the log. A new folder is made with mode 0700 and a new file with mode
   * 0600; an existing file is set to 0600, so only its owner can read it.
   */
  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error("the egress log needs an absolute path");
    this.path = path;
    const dir = dirname(path);
    const made = mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (made !== undefined) chmodSync(dir, 0o700);
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
  }

  /** Append one record. A record that does not match the schema throws and nothing is written. */
  append(record: EgressRecord): void {
    // Check exactly what is written (JSON drops undefined fields).
    const line = JSON.stringify(record);
    const r = validate("egress-record", JSON.parse(line));
    if (!r.valid) throw new Error(`an egress record does not match its schema: ${issues(r.errors)}`);
    if (/sk-ant-/.test(line)) throw new Error("an egress record holds something shaped like an API key; it was not written");
    appendFileSync(this.path, `${line}\n`, { mode: 0o600, flag: "a" });
  }
}

function issues(list: ValidationIssue[]): string {
  return list.slice(0, 3).map((e) => `${e.path || "/"} ${e.message}`).join("; ");
}
