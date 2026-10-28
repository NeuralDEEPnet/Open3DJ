/** Thrown for bad input to the assembly builder, unknown scopes and refused export paths. */
export class AssemblyError extends Error {
  readonly code: string;
  readonly hint: string | undefined;
  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "AssemblyError";
    this.code = code;
    this.hint = hint;
  }
}
