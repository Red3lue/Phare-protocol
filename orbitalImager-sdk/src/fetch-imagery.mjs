#!/usr/bin/env node
// Thin CLI around the orbitalImager-sdk public API. See src/index.mjs.
//
// Usage:
//   ORBITPORT_GATEWAY_URL=http://localhost:8080 \
//   ORBITPORT_BEARER=dev \
//   node src/fetch-imagery.mjs [--out path/to/output]
//
// If --out is omitted, the file is written as state/last-imagery.<ext>
// where <ext> is derived from the response's mime_type.

import { fetchImageryToFile } from './index.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const explicitOut = outIdx >= 0 ? args[outIdx + 1] : undefined;

const gateway = process.env.ORBITPORT_GATEWAY_URL;
const bearer  = process.env.ORBITPORT_BEARER;

console.log(`POST ${gateway ?? 'http://localhost:8080'}/api/v1/rpc → orbitalimager.RequestImagery`);

try {
  const r = await fetchImageryToFile({
    gateway,
    bearer,
    outPath: explicitOut,
    request: {
      lat: 34.6,
      lon: 33.0,
      imo: 9133701,
    },
  });

  console.log('OK');
  console.log(`  bytes        ${r.bytes.length}`);
  console.log(`  mime         ${r.mimeType}`);
  console.log(`  sensor       ${r.sensor}`);
  console.log(`  captured_at  ${r.capturedAt}`);
  console.log(`  mocked       ${r.mocked}`);
  console.log(`  keccak256    0x${r.imageHash?.toString('hex') ?? '(missing)'}`);
  console.log(`  written to   ${r.outPath}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
