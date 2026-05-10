#!/usr/bin/env node
// CLI wrapper around imager.downloadImage — resumable end-to-end fetch +
// recompose. The first run downloads everything; killing it mid-run and
// re-invoking with the same --session-dir picks up where it stopped.
//
// Usage:
//   node src/download-image.mjs                    # first listed image → ./<id>.png
//   node src/download-image.mjs --image-id tanker-0 --out /tmp/out.png
//   node src/download-image.mjs --no-verify --session-dir /tmp/sess
//
// Env: ORBITPORT_GATEWAY_URL, ORBITPORT_BEARER (defaults: localhost:8080, 'dev').

import { resolve } from 'node:path';
import { downloadImage, listImages } from './imager.mjs';

function parseArgs(argv) {
  const out = { verify: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--image-id':    out.imageId    = next(); break;
      case '--out':         out.outPath    = next(); break;
      case '--session-dir': out.sessionDir = next(); break;
      case '--gateway':     out.gateway    = next(); break;
      case '--bearer':      out.bearer     = next(); break;
      case '--no-verify':   out.verify     = false;  break;
      case '-h': case '--help': out.help   = true;  break;
      default: throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

function bar(current, total, width = 30) {
  const pct = total ? current / total : 0;
  const fill = Math.round(pct * width);
  return '[' + '#'.repeat(fill) + '.'.repeat(width - fill) +
         `] ${current}/${total} (${(pct * 100).toFixed(0)}%)`;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`usage: download-image [--image-id ID] [--out PATH] [--session-dir DIR]
                      [--gateway URL] [--bearer TOKEN] [--no-verify]

If --image-id is omitted, the first image returned by ListImages is used.
If --out is omitted, the recomposed file goes to ./<image_id>.png.
If --session-dir is omitted, packets are staged under ./state/sessions/.`);
  process.exit(0);
}

const opts = {
  gateway: args.gateway ?? process.env.ORBITPORT_GATEWAY_URL,
  bearer:  args.bearer  ?? process.env.ORBITPORT_BEARER,
};

let imageId = args.imageId;
if (!imageId) {
  const { imageIds } = await listImages(opts);
  if (imageIds.length === 0) {
    console.error('no images on the gateway — fragment one first');
    process.exit(1);
  }
  imageId = imageIds[0];
  console.log(`(no --image-id given; using first available: ${imageId})`);
}

const outPath = args.outPath ?? `./${imageId}.png`;
const sessionDir = args.sessionDir ?? resolve('state/sessions');

console.log(`gateway     ${opts.gateway ?? 'http://localhost:8080'}`);
console.log(`image_id    ${imageId}`);
console.log(`session_dir ${sessionDir}`);
console.log(`out         ${resolve(outPath)}`);
console.log(`verify      ${args.verify}`);
console.log('');

const onProgress = (e) => {
  if (e.phase === 'start') {
    if (e.current === e.total && e.total > 0) {
      console.log(`already complete on disk (${e.total}/${e.total} packets) — recomposing only`);
    } else if (e.current > 0) {
      console.log(`resuming: ${e.current}/${e.total} already on disk`);
    }
  } else if (e.phase === 'packet') {
    process.stdout.write(`\r  ${bar(e.current, e.total)}  packet ${e.packetIndex}   `);
  } else if (e.phase === 'recompose') {
    process.stdout.write('\n  recomposing…');
  } else if (e.phase === 'done') {
    process.stdout.write(' done\n');
  }
};

try {
  const r = await downloadImage({ imageId, outPath, sessionDir, verify: args.verify, onProgress, ...opts });
  console.log(`\nDONE — ${r.outPath}`);
  console.log(`state.json @ ${resolve(sessionDir, imageId, 'state.json')}`);
} catch (err) {
  console.error(`\nFAILED: ${err.message}`);
  process.exit(1);
}
