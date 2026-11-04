#!/usr/bin/env node
// The open3dj command. Kept tiny so the stdout guard in main() runs before anything loads.
import { main } from "./index.ts";

process.exitCode = await main(process.argv.slice(2));
