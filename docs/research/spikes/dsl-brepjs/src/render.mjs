import { readFileSync, writeFileSync } from "node:fs";
import { createRuntime } from "./dsl.mjs";
const [DEPS, OUT, DIR, ids] = process.argv.slice(2);
const rt = await createRuntime(DEPS, { withLib: true });
for (const id of ids.split(",")) {
  const { parts } = rt.run(readFileSync(`${DIR}/${id}.js`, "utf8"));
  const shape = parts.length === 1 ? parts[0].shape.v : rt.B.compound(parts.map(p => p.shape.v));
  const png = await rt.kernel.toMultiviewPNG(shape.wrapped.id);
  writeFileSync(`${OUT}/${id}.png`, png);
  process.stderr.write(`${id}.png ${png.length} bytes\n`);
}
