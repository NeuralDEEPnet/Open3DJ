import type {
  DeviceInventory, DocsInput, DocsOutput, ExportInput, ExportOutput, InspectInput, InspectOutput, RenderInput,
  RenderOutput, RunInput, RunOutput,
} from "@open3dj/schemas";
import type { Pool, RenderImage } from "@open3dj/compute";

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
}

export interface HandlerDeps {
  pool: Pool;
  inventory: DeviceInventory;
  /** Folder that relative project paths resolve against. Default process.cwd(). */
  root?: string;
  /** Clock for provenance timestamps; tests pin it. */
  now?: () => Date;
}

export interface ServeOptions {
  /** Server name and version in initialize and server/discover. */
  name?: string;
  version?: string;
  /** Diagnostics go here. Never process.stdout, which carries JSON-RPC. Default process.stderr. */
  log?: (line: string) => void;
}
