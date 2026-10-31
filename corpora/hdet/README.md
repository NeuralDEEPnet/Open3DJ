# H-det corpus

The two DSL cases that `node scripts/hdet.ts` adds to three examples (bracket, tapered-cup and enclosure) to test hypothesis H-det: a kernel result is bit-identical across fresh processes and across warm reuses of one worker ([ARCHITECTURE.md](../../docs/ARCHITECTURE.md) section 8). Both are original and MIT licensed.

| Script | What it exercises |
|---|---|
| `shell.o3j.js` | The kernel's shell: a tray with 6 mm vertical corner fillets hollowed to 2 mm, and a cylinder hollowed to 1.5 mm |
| `offset.o3j.js` | The kernel's exact 2D offset (`sketch.offset`), grown and shrunk, on a star, an octagon, a rounded rectangle, a slot and an ellipse |

The latest result is in [ops/build-log.md](../../ops/build-log.md).
