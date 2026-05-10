// orbitalImager-sdk — JS client for the orbitalimager Orbitport plugin.
//
// v0.0.1 (this file): single-shot RequestImagery — fetches the entire
//   fixture image as one base64 blob. Kept for backward compatibility.
//
// v0.1.0 (./imager.mjs): tiled, resumable downloads with on-disk state.
//   Re-exported below so callers can import everything from the package
//   root: `import { downloadImage, getMetadata } from 'orbitalImager-sdk'`.

export {
  listImages,
  getMetadata,
  getPacket,
  downloadPackets,
  downloadImage,
} from './imager.mjs';
export { pluginCall, GatewayError } from './gateway.mjs';

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_GATEWAY = 'http://localhost:8080';
const DEFAULT_BEARER  = 'dev';
const PLUGIN_NAME     = 'orbitalimager';
const PLUGIN_METHOD   = 'orbitalimager.OrbitalImagerPlugin.RequestImagery';

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

/**
 * @typedef {object} ImageryRequest
 * @property {number} [lat]
 * @property {number} [lon]
 * @property {number} [timestampUnix]
 * @property {number|bigint} [imo]
 */

/**
 * @typedef {object} ImageryResult
 * @property {Buffer}  bytes       decoded image bytes
 * @property {string}  mimeType    e.g. "image/webp"
 * @property {Buffer?} imageHash   keccak256 of the decoded bytes (32 B)
 * @property {string}  capturedAt  Unix seconds, server-clock (string per proto3 int64)
 * @property {string}  sensor      free-form sensor identifier
 * @property {boolean} mocked      always true while satellite tasking is fixture-keyed
 * @property {string}  extension   filename extension matching mimeType
 */

/**
 * Call the orbitalimager plugin and return the decoded image + metadata.
 *
 * @param {object}         [opts]
 * @param {string}         [opts.gateway]  base URL of the Orbitport gateway
 * @param {string}         [opts.bearer]   Bearer token (any value in dev)
 * @param {ImageryRequest} [opts.request]  proto fields (camelCase per proto3 JSON)
 * @returns {Promise<ImageryResult>}
 */
export async function fetchImagery({
  gateway = DEFAULT_GATEWAY,
  bearer  = DEFAULT_BEARER,
  request = {},
} = {}) {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'plugin.Call',
    params: {
      plugin: PLUGIN_NAME,
      method: PLUGIN_METHOD,
      request: {
        lat: 0,
        lon: 0,
        timestampUnix: Math.floor(Date.now() / 1000),
        imo: 0,
        ...request,
      },
    },
  };

  const res = await fetch(`${gateway}/api/v1/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`gateway HTTP ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.error) throw new Error(`JSON-RPC error: ${JSON.stringify(json.error)}`);

  // proto3 JSON mapping: snake_case → lowerCamelCase; int64 → string.
  const r = json.result;
  if (!r?.imageB64) throw new Error(`unexpected response shape: ${JSON.stringify(json)}`);

  return {
    bytes:      Buffer.from(r.imageB64, 'base64'),
    mimeType:   r.mimeType,
    imageHash:  r.imageHash ? Buffer.from(r.imageHash, 'base64') : null,
    capturedAt: r.capturedAt,
    sensor:     r.sensor,
    mocked:     r.mocked,
    extension:  MIME_EXT[r.mimeType] ?? 'bin',
  };
}

/**
 * Convenience wrapper: fetchImagery + atomic write to disk.
 *
 * @param {object} [opts] — accepts every fetchImagery option, plus:
 * @param {string} [opts.outPath]  explicit output path
 * @param {string} [opts.outDir]   directory; filename derived from extension (default: 'state')
 * @returns {Promise<ImageryResult & {outPath:string}>}
 */
export async function fetchImageryToFile({ outPath, outDir = 'state', ...opts } = {}) {
  const result = await fetchImagery(opts);
  const finalPath = resolve(outPath ?? `${outDir}/last-imagery.${result.extension}`);
  await mkdir(dirname(finalPath), { recursive: true });
  await writeFile(finalPath, result.bytes);
  return { ...result, outPath: finalPath };
}
