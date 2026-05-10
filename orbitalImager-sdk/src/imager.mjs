// orbitalImager-sdk v0.1.0 — high-level client for the orbitalimager
// plugin's tiled-image RPC surface.
//
// Public API
// ──────────
//   listImages(opts)                  → { imageIds: string[] }
//   getMetadata({ imageId, ...opts }) → Metadata    (no disk side-effects)
//   getPacket({ imageId, packetIndex, ...opts })    → { bytes, hash, width, height, mimeType }
//   downloadPackets({ imageId, indexes, sessionDir, onProgress?, verify?, ...opts })
//                                     → { downloadedIndexes: number[], state }
//   downloadImage({ imageId, outPath, sessionDir?, onProgress?, verify?, ...opts })
//                                     → { outPath, state }
//
// downloadImage is the single function most callers want: resumable end-to-end
// fetch + recompose. Crash mid-fetch and the next call picks up exactly where
// the previous one left off (atomic per-packet writes + state.json mirror).
//
// Local layout (sessionDir):
//
//   <sessionDir>/<image_id>/
//   ├── state.json                    cached metadata + _download progress block
//   ├── packets/
//   │   ├── 0000.png                  one file per packet, base64 decoded
//   │   └── …
//   └── (the recomposed PNG is written to the caller's outPath, NOT here)
//
// state.json shape (extension of the server's metadata.json):
//
//   { …all server fields verbatim…,
//     _download: {
//       started_at_unix: 1778…,
//       updated_at_unix: 1778…,
//       downloaded_packets: [0, 1, 2],
//       complete: false,
//       out_path: "/where/the/recomposed/image/went.png"   // set on completion
//     } }

import { Buffer }              from 'node:buffer';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve }    from 'node:path';
import sharp                   from 'sharp';
import { keccak_256 }          from '@noble/hashes/sha3';

import { pluginCall, GatewayError } from './gateway.mjs';

const SVC = 'orbitalimager.OrbitalImagerPlugin';

// ── tiny helpers ──────────────────────────────────────────────────────────

function b64ToBuf(s) { return s ? Buffer.from(s, 'base64') : Buffer.alloc(0); }
function bufEq(a, b) { return a.length === b.length && a.equals(b); }
function nowUnix()    { return Math.floor(Date.now() / 1000); }

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/** Atomic write: write to <path>.tmp then rename. Crash-safe. */
async function atomicWrite(path, data) {
  const tmp = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, data);
  await rename(tmp, path);
}

// ── public API ────────────────────────────────────────────────────────────

/**
 * @param {import('./gateway.mjs').GatewayOpts} [opts]
 * @returns {Promise<{ imageIds: string[] }>}
 */
export async function listImages(opts = {}) {
  const r = await pluginCall(`${SVC}.ListImages`, {}, opts);
  return { imageIds: r.imageIds ?? [] };
}

/**
 * Read the typed metadata for one image. No disk side-effects.
 *
 * @param {{ imageId: string } & import('./gateway.mjs').GatewayOpts} args
 * @returns {Promise<object>} the metadata object (proto3-JSON, camelCase)
 */
export async function getMetadata({ imageId, ...opts }) {
  if (!imageId) throw new Error('getMetadata: imageId is required');
  return pluginCall(`${SVC}.GetImageMetadata`, { imageId }, opts);
}

/**
 * Fetch a single packet. Returns the decoded bytes plus integrity
 * info — caller decides whether to save it.
 *
 * @param {{ imageId: string, packetIndex: number } & import('./gateway.mjs').GatewayOpts} args
 * @returns {Promise<{ bytes: Buffer, hash: Buffer, width: number, height: number, mimeType: string, packetIndex: number }>}
 */
export async function getPacket({ imageId, packetIndex, ...opts }) {
  if (!imageId)                    throw new Error('getPacket: imageId is required');
  if (!Number.isInteger(packetIndex) || packetIndex < 0)
    throw new Error('getPacket: packetIndex must be a non-negative integer');

  const r = await pluginCall(`${SVC}.GetImagePacket`,
    { imageId, packetIndex }, opts);

  return {
    packetIndex: r.packetIndex ?? 0,
    bytes:       b64ToBuf(r.packetB64),
    hash:        b64ToBuf(r.packetHash),
    width:       r.width ?? 0,
    height:      r.height ?? 0,
    mimeType:    r.mimeType ?? 'image/png',
  };
}

/**
 * Download a set of packets and persist them under sessionDir. Updates
 * state.json after each packet so a crash leaves consistent on-disk state.
 *
 * The caller's onProgress callback is fired once before any work
 * ({ phase: 'start', current: 0, total }) and after every completed packet
 * ({ phase: 'packet', current, total, packetIndex }).
 *
 * @param {object} args
 * @param {string}   args.imageId
 * @param {number[]} [args.indexes]      packet indexes to fetch (default: all missing)
 * @param {string}   args.sessionDir     parent dir; per-image folder is created inside
 * @param {boolean}  [args.verify=true]  keccak256-verify each packet against metadata
 * @param {(p: ProgressEvent) => void} [args.onProgress]
 * @param {object}   [args.metadata]     pre-fetched metadata (skips a roundtrip)
 * @returns {Promise<{ downloadedIndexes: number[], state: object }>}
 */
export async function downloadPackets({
  imageId,
  indexes,
  sessionDir,
  verify = true,
  onProgress,
  metadata,
  ...opts
}) {
  if (!imageId)    throw new Error('downloadPackets: imageId is required');
  if (!sessionDir) throw new Error('downloadPackets: sessionDir is required');

  const state    = await ensureState({ imageId, sessionDir, metadata, opts });
  const imageDir = resolve(sessionDir, imageId);
  const total    = state.packetCount;

  const owned   = new Set(state._download.downloaded_packets);
  const missing = (indexes ?? [...Array(total).keys()]).filter(i => !owned.has(i));
  const newly   = [];

  onProgress?.({ phase: 'start', current: owned.size, total });

  for (const i of missing) {
    const pkt = await getPacket({ imageId, packetIndex: i, ...opts });

    if (verify) {
      const expectedFromMeta = b64ToBuf(state.packets[i]?.packetHash);
      const actual           = Buffer.from(keccak_256(pkt.bytes));
      if (!bufEq(actual, pkt.hash)) {
        throw new GatewayError(
          `packet ${i}: server-reported hash ${pkt.hash.toString('hex')} ` +
          `does not match recomputed ${actual.toString('hex')}`);
      }
      if (expectedFromMeta.length === 32 && !bufEq(actual, expectedFromMeta)) {
        throw new GatewayError(
          `packet ${i}: bytes do not match metadata hash ` +
          `${expectedFromMeta.toString('hex')}`);
      }
    }

    const filename = state.packets[i]?.filename ?? `${String(i).padStart(4, '0')}.png`;
    await atomicWrite(resolve(imageDir, 'packets', filename), pkt.bytes);

    state._download.downloaded_packets.push(i);
    state._download.updated_at_unix = nowUnix();
    await atomicWrite(resolve(imageDir, 'state.json'),
                      Buffer.from(JSON.stringify(state, null, 2)));

    newly.push(i);
    onProgress?.({
      phase: 'packet',
      packetIndex: i,
      current: state._download.downloaded_packets.length,
      total,
    });
  }

  return { downloadedIndexes: newly, state };
}

/**
 * High-level: download every packet (resumably) and recompose into a single
 * PNG written to the caller's chosen outPath.
 *
 * Resumes from any prior crash automatically: if a previous run downloaded
 * 4 of 6 packets, this call fetches the remaining 2 and skips the rest.
 *
 * @param {object} args
 * @param {string}  args.imageId
 * @param {string}  args.outPath        where the recomposed PNG goes
 * @param {string}  [args.sessionDir]   default: ./state/sessions
 * @param {boolean} [args.verify=true]
 * @param {(p: ProgressEvent) => void} [args.onProgress]
 * @returns {Promise<{ outPath: string, state: object }>}
 */
export async function downloadImage({
  imageId,
  outPath,
  sessionDir = resolve('state/sessions'),
  verify = true,
  onProgress,
  ...opts
}) {
  if (!imageId) throw new Error('downloadImage: imageId is required');
  if (!outPath) throw new Error('downloadImage: outPath is required');

  await downloadPackets({ imageId, sessionDir, verify, onProgress, ...opts });

  // Re-load state from disk so we recompose against the source of truth,
  // not the in-memory copy (paranoia: handles a swapped sessionDir on resume).
  const imageDir = resolve(sessionDir, imageId);
  const state    = JSON.parse(await readFile(resolve(imageDir, 'state.json'), 'utf8'));

  if (state._download.downloaded_packets.length !== state.packetCount) {
    throw new Error(
      `downloadImage: ${state._download.downloaded_packets.length}/${state.packetCount} ` +
      `packets present; refusing to recompose with gaps`);
  }

  onProgress?.({ phase: 'recompose', current: state.packetCount, total: state.packetCount });
  await recompose({ state, imageDir, outPath });

  state._download.complete       = true;
  state._download.out_path       = resolve(outPath);
  state._download.updated_at_unix = nowUnix();
  await atomicWrite(resolve(imageDir, 'state.json'),
                    Buffer.from(JSON.stringify(state, null, 2)));

  onProgress?.({ phase: 'done', current: state.packetCount, total: state.packetCount });
  return { outPath: resolve(outPath), state };
}

// ── internal: state + recompose ───────────────────────────────────────────

/**
 * Load existing state.json or fetch fresh metadata + initialise it. Reconciles
 * the on-disk packets/ directory with the recorded `downloaded_packets` array
 * so a state.json that drifted from reality (e.g. user wiped packets/) gets
 * corrected on the next download.
 */
async function ensureState({ imageId, sessionDir, metadata, opts }) {
  const imageDir  = resolve(sessionDir, imageId);
  const statePath = resolve(imageDir, 'state.json');
  let state;

  if (await exists(statePath)) {
    state = JSON.parse(await readFile(statePath, 'utf8'));
    if (state.imageId !== imageId) {
      throw new Error(
        `sessionDir contains state for image_id=${JSON.stringify(state.imageId)}, ` +
        `not ${JSON.stringify(imageId)}; pick a different sessionDir`);
    }
  } else {
    const meta = metadata ?? await getMetadata({ imageId, ...opts });
    state = {
      ...meta,
      _download: {
        started_at_unix: nowUnix(),
        updated_at_unix: nowUnix(),
        downloaded_packets: [],
        complete: false,
        out_path: null,
      },
    };
    await mkdir(resolve(imageDir, 'packets'), { recursive: true });
    await atomicWrite(statePath, Buffer.from(JSON.stringify(state, null, 2)));
  }

  // Reconcile: trust the filesystem if a recorded packet's file is missing.
  const present = [];
  for (const i of state._download.downloaded_packets) {
    const filename = state.packets[i]?.filename ?? `${String(i).padStart(4, '0')}.png`;
    if (await exists(resolve(imageDir, 'packets', filename))) present.push(i);
  }
  if (present.length !== state._download.downloaded_packets.length) {
    state._download.downloaded_packets = present;
    state._download.updated_at_unix    = nowUnix();
    await atomicWrite(statePath, Buffer.from(JSON.stringify(state, null, 2)));
  }

  return state;
}

/**
 * Stitch every packet PNG into a single canvas using sharp's composite
 * pipeline (libvips under the hood — streaming, no canvas-in-memory blow-up).
 */
async function recompose({ state, imageDir, outPath }) {
  const tile = state.tilePixelSize;
  const composites = state.packets.map((p, i) => ({
    input: resolve(imageDir, 'packets', p.filename ?? `${String(i).padStart(4, '0')}.png`),
    top:   (p.row ?? 0) * tile,   // proto3 JSON omits zero-valued fields
    left:  (p.col ?? 0) * tile,
  }));

  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await sharp({
    create: {
      width:    state.imageWidth,
      height:   state.imageHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(resolve(outPath));
}

/**
 * @typedef {object} ProgressEvent
 * @property {'start'|'packet'|'recompose'|'done'} phase
 * @property {number} current
 * @property {number} total
 * @property {number} [packetIndex]
 */
