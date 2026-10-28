// Child process for the stdout test: loads the kernel, exports STEP (which makes OCCT print)
// and reports what the sink captured on stderr. Its stdout must stay empty.
import { initKernel } from "../index.ts";

const captured: string[] = [];
const k = await initKernel({ sink: (stream, line) => captured.push(`${stream}:${line}`) });
const box = k.box(10, 20, 30);
const step = k.exportStep(box);
const doc = k.createDocument();
doc.addShape(box, { name: "probe" });
const step2 = doc.exportStep();
doc.close();
process.stderr.write(`${JSON.stringify({ stepBytes: step.length, step2Bytes: step2.length, captured: captured.length, sample: captured.slice(0, 3) })}\n`);
