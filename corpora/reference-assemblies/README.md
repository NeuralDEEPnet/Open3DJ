# Reference assemblies

Generated assemblies for timing and for seeded fit checks. They are the timing corpus for S2 (viewer frame time), S3, S4 and S7a ([ARCHITECTURE.md](../../docs/ARCHITECTURE.md) section 16, [ASSEMBLIES.md](../../docs/ASSEMBLIES.md) sections 6 and 15). Each one is a DSL script with parameters, original and MIT licensed, so a bigger or smaller variant is one `--param` away.

| Script | What it is | What it is for |
|---|---|---|
| `plate-145.o3j.js` | A 120 x 120 x 6 mm plate with a 12 x 12 grid of M3 clearance holes and 144 M3 x 10 socket head screws (clones of one `lib.bolt`): 145 occurrences of 2 definitions. By default the first two screws (`screw#1`, `screw#2`) sink 0.5 mm into the plate. | The S2 frame-time gate (orbit the 145-occurrence assembly). A seeded fit corpus: the fit check must report exactly 2 clashes and 142 contacts; any other answer is a false pass or a false alarm. Exact-tier timing for S3 and S7a. |
| `grid-1025.o3j.js` | A 192 x 192 mm base plate with a 32 x 32 grid of small parts (pin, block, hex post, cone) that cycle through `Kinds` definitions: 1,025 occurrences. `Lift` (default 1 mm) holds the parts clear of the plate. | Broad-phase timing at 1,000 or more occurrences (H2, the S7a GPU pre-check gate). With `Kinds=50`, the report-time hypothesis H1 (1,000 occurrences of 50 definitions). With `Lift=0`, 1,024 contacts for the exact tier. |

Parameters: `plate-145` takes `Grid` (2 to 12), `Pitch` (8 to 20 mm) and `Sunk screws` (0 to 4); `grid-1025` takes `Grid` (4 to 40), `Kinds` (1 to 50) and `Lift` (0 to 10 mm).

```sh
npx open3dj run corpora/reference-assemblies/plate-145.o3j.js
npx open3dj run corpora/reference-assemblies/grid-1025.o3j.js --param Kinds=50
node scripts/reference-assemblies.ts     # the table below, for your machine
```

## Measured cost

Measured on 2026-10-28 on a shared Linux container (4 vCPUs, 16 GB, Node 24.22.1, occt-wasm 5.8.1, brepjs 20.11.1) with `node scripts/reference-assemblies.ts`. "Job" is the run job on a fresh pool worker (the script, the assembly, the exact fit check and the detailed report). "Worker memory" is the kernel's WebAssembly memory plus the worker's JS heap after the job. "CLI run" is one fresh `open3dj run --json` process, including Node start-up and the kernel load; its output is the concise report, pretty-printed.

| Configuration | Occurrences / definitions | Status | Fits | Job (ms) | Worker memory (MB) | Detailed report (bytes) | CLI run (ms) | CLI output (bytes) |
|---|---|---|---|---|---|---|---|---|
| plate-145 | 145 / 2 | warning | 2 clash, 142 contact | 17748 | 187 | 13373 | 19182 | 1711 |
| plate-145, `Sunk screws=0` | 145 / 2 | ok | 144 contact | 18569 | 158 | 13290 | 18925 | 1468 |
| grid-1025 | 1025 / 5 | ok | none | 2575 | 190 | 1531 | 3429 | 1999 |
| grid-1025, `Kinds=50` | 1025 / 51 | ok | none | 2992 | 192 | 11904 | 3978 | 1999 |
| grid-1025, `Lift=0` | 1025 / 5 | ok | 1024 contact | 7222 | 191 | 91186 | 8007 | 1891 |

What the numbers say:

- **The exact fit tier dominates.** With every part clear of the others, 1,025 occurrences take 2.6 s, most of it building and placing the shapes. The plate's 144 screw-in-hole pairs take about 15 s more: about 100 ms a pair, against the 19 to 29 ms a pair that ASSEMBLIES.md section 6 records for simpler pairs. The 1,024 pin-on-plate contacts of the seated grid cost about 4.6 s, about 4.5 ms a pair.
- **The plate is close to the default job limit.** 18 s on this machine is 60% of the pool's 30 s wall-clock limit (`jobTimeoutMs`). A slower runner (Windows ARM64, a laptop on battery) may time out on it. This is worth a look before S3 adds more checks per pair.
- **Reports stay small.** The detailed report grows with definitions and fits, not occurrences: 1.5 kB for 1,025 clear occurrences of 5 definitions, 91 kB with 1,024 fits listed.
- **Fit features cost about 15% (S1 polish, measured again on 2026-10-28 on the same container).** Since fits list every distinct gap of a pair, each of the 142 screw contacts also reports its 0.2 mm shank-in-hole gap (an M3 shank of 3 mm in the 3.4 mm medium clearance hole): plate-145 gives 2 clash, 142 contact and 142 clearance lines in 20.4 s (job) and 21.9 s (CLI run), `Sunk screws=0` 20.8 s, and the seated grid 8.6 s. The plate is now at 68% of the 30 s job limit. The table above keeps the earlier numbers.
- **Memory is flat.** Under 200 MB per worker in every case, far from the 1.5 GiB recycle limit.
