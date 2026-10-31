/** Thrown for bad input to the assembly builder, unknown scopes and refused export paths. */
export class AssemblyError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  /** 1-based script line of the part the error is about, when known. */
  readonly line: number | undefined;
  constructor(code: string, message: string, hint?: string, line?: number) {
    super(message);
    this.name = "AssemblyError";
    this.code = code;
    this.hint = hint;
    this.line = line;
  }
}
