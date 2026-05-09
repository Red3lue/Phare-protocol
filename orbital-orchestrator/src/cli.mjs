#!/usr/bin/env node
// One-shot CLI for the pipeline, no HTTP server.
//
//   node src/cli.mjs <imo> [lat] [lon]
//   pnpm --filter orbital-orchestrator process 9133701

import { runPipeline } from './pipeline.mjs';

const imo = process.argv[2] ?? '9133701';
const lat = process.argv[3] ? Number(process.argv[3]) : 34.6;
const lon = process.argv[4] ? Number(process.argv[4]) : 33.0;

try {
  const result = await runPipeline({ imo, lat, lon });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
