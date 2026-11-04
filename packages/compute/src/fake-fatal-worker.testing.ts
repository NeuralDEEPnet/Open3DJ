// A fake pool worker that cannot start, for the pool's start-failure test.
import { parentPort } from "node:worker_threads";
import type { FromWorker } from "./protocol.ts";

const message: FromWorker = { type: "fatal", message: "fake kernel failed to load" };
parentPort!.postMessage(message);
