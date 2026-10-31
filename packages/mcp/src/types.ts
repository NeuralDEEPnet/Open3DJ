import type {
  ComputeBlock, ComputeMode, DeviceInventory, DocsInput, DocsOutput, ExportInput, ExportOutput, InspectInput, InspectOutput,
  RenderInput, RenderOutput, RunInput, RunOutput,
} from "@open3dj/schemas";
import type { JobKind, Pool, RenderImage } from "@open3dj/compute";

/** A render result plus the images, which MCP sends as image content and an SVG resource. */
export interface RenderResult {
  output: RenderOutput;
  images: RenderImage[];
}

/**
 * The tool handlers. The MCP server and the CLI call the same functions (CLI parity), so
 * every behaviour is testable without a protocol in between. Handlers never throw for user
 * errors: they return status "error" with a ScriptError.
 */
export interface ToolHandlers {
  run(input: RunInput): Promise<RunOutput>;
  inspect(input: InspectInput): Promise<InspectOutput>;
  render(input: RenderInput): Promise<RenderResult>;
  export(input: ExportInput): Promise<ExportOutput>;
  docs(input: DocsInput): Promise<DocsOutput>;
  /** Cancel running jobs. The pool is the caller's to close. */
  shutdown(): void;
}

export type PlaceFn = (mode: ComputeMode, kind: JobKind, inventory: DeviceInventory) => ComputeBlock;

export interface HandlerDeps {
  pool: Pool;
  inventory: DeviceInventory;
  /** Folder that relative project paths resolve against, and that projects must be inside. Default process.cwd(). */
  root?: string;
  /** Clock for provenance timestamps; tests pin it. */
  now?: () => Date;
  /** Placement. Default: pool.place(). */
  place?: PlaceFn;
  /** How long run waits before it returns status "queued" with a job_id. Default 20000 ms. */
  interactiveMs?: number;
  /** The DSL reference the docs tool searches. Default: docs/DSL.md in the repository. */
  docsFile?: URL | string;
  /** open3dj version recorded in engine pins. Default: inventory.runtime.open3dj. */
  version?: string;
}

export interface ServeOptions {
  /** Server name and version in initialize and server/discover. */
  name?: string;
  version?: string;
  /** Diagnostics go here. Never process.stdout, which carries JSON-RPC. Default process.stderr. */
  log?: (line: string) => void;
}
