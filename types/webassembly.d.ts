// The WebAssembly global as Node 24 provides it. @types/node does not declare it and the
// DOM lib would add browser globals we do not want, so this file declares the subset the
// kernel and sandbox packages use. Extend it here (not per package) when more is needed.
declare namespace WebAssembly {
  type BufferSource = ArrayBufferView | ArrayBuffer;
  type ImportValue = Function | Global | Memory | Table | number | bigint;
  type ModuleImports = Record<string, ImportValue>;
  type Imports = Record<string, ModuleImports>;
  type Exports = Record<string, Function | Global | Memory | Table>;

  interface MemoryDescriptor {
    initial: number;
    maximum?: number;
    shared?: boolean;
  }
  class Memory {
    constructor(descriptor: MemoryDescriptor);
    readonly buffer: ArrayBuffer;
    grow(delta: number): number;
  }

  interface TableDescriptor {
    element: "anyfunc" | "externref";
    initial: number;
    maximum?: number;
  }
  class Table {
    constructor(descriptor: TableDescriptor, value?: unknown);
    readonly length: number;
    get(index: number): unknown;
    grow(delta: number, value?: unknown): number;
    set(index: number, value?: unknown): void;
  }

  interface GlobalDescriptor {
    value: "i32" | "i64" | "f32" | "f64" | "v128" | "externref" | "anyfunc";
    mutable?: boolean;
  }
  class Global {
    constructor(descriptor: GlobalDescriptor, v?: unknown);
    value: unknown;
    valueOf(): unknown;
  }

  class Module {
    constructor(bytes: BufferSource);
    static exports(module: Module): Array<{ name: string; kind: string }>;
    static imports(module: Module): Array<{ module: string; name: string; kind: string }>;
  }
  class Instance {
    constructor(module: Module, imports?: Imports);
    readonly exports: Exports;
  }
  interface WebAssemblyInstantiatedSource {
    module: Module;
    instance: Instance;
  }

  class CompileError extends Error {}
  class LinkError extends Error {}
  class RuntimeError extends Error {}

  function compile(bytes: BufferSource): Promise<Module>;
  function instantiate(bytes: BufferSource, imports?: Imports): Promise<WebAssemblyInstantiatedSource>;
  function instantiate(module: Module, imports?: Imports): Promise<Instance>;
  function validate(bytes: BufferSource): boolean;
}
