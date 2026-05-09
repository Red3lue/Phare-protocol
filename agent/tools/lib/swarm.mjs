// Verified Fetch helpers — BMT recompute against the /bytes endpoint.
//
// Two primitives, both delegating to @ethersphere/bee-js:
//
//   verifyAndFetch(ref) → fetch ${BEE_URL}/bytes/<hash>, recompute the BMT
//                        root with MerkleTree.root, throw on mismatch,
//                        otherwise return { bytes, ref, verified:true }.
//   pinImmutable(bytes) → bee.uploadData(NULL_STAMP, bytes), return
//                        bzz://<reference>.
//
// Why /bytes and not /bzz: per Swarm docs and the mentor's guidance, the
// /bzz endpoint auto-resolves manifests / collections and may transform
// the response. /bytes returns the raw chunk byte stream that hashes back
// to <ref> — the only thing we can recompute.
//
// Why NULL_STAMP: bzz.limo (the ETHSwarm sponsor gateway) accepts a
// NULL_STAMP postage batch and rewrites it server-side to a valid one.
// Avoids needing to provision a real batch for hackathon scope.

import { Bee, MerkleTree, NULL_STAMP } from '@ethersphere/bee-js';

// ─── Errors ─────────────────────────────────────────────────────────────

export class BmtMismatchError extends Error {
  constructor({ expected, recomputed }) {
    super(`BMT root mismatch: expected ${expected}, recomputed ${recomputed}`);
    this.name = 'BmtMismatchError';
    this.expected = expected;
    this.recomputed = recomputed;
  }
}

export class GatewayFetchError extends Error {
  constructor({ url, status, statusText }) {
    super(`gateway returned ${status} ${statusText} for ${url}`);
    this.name = 'GatewayFetchError';
    this.url = url;
    this.status = status;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-fA-F]{64}$/;
const HEX128 = /^[0-9a-fA-F]{128}$/; // encrypted refs (root || decryption key)

/** Strip a `bzz://` or full https-gateway prefix; return the bare 64-hex. */
export function parseBzzRef(ref) {
  let hex = String(ref).trim();
  if (hex.startsWith('bzz://')) hex = hex.slice('bzz://'.length);
  // Strip a known gateway prefix if someone passed the full URL.
  hex = hex.replace(/^https?:\/\/[^/]+\/(?:access|bytes|bzz)\//i, '');
  hex = hex.replace(/^0x/i, '');
  if (HEX128.test(hex)) {
    throw new Error('encrypted Swarm references (64-byte) are out of scope for v1');
  }
  if (!HEX64.test(hex)) {
    throw new Error(`unrecognised Swarm reference: ${ref}`);
  }
  return hex.toLowerCase();
}

/** Build the canonical bzz:// URI from a 64-hex root reference. */
export function formatBzzRef(hex) {
  return `bzz://${parseBzzRef(hex)}`;
}

function bytesToHex(uint8) {
  return Array.from(uint8, (b) => b.toString(16).padStart(2, '0')).join('');
}

function beeUrl() {
  const url = process.env.SWARM_BEE_URL;
  if (!url) throw new Error('SWARM_BEE_URL not set in /agent/.env');
  return url.replace(/\/$/, '');
}

function bee() {
  return new Bee(beeUrl());
}

// ─── Read: verifyAndFetch (BMT round-trip) ──────────────────────────────

/**
 * Fetch the bytes pinned at `ref` and assert the BMT recompute matches.
 * Throws BmtMismatchError if the gateway returned tampered bytes.
 *
 * @param {string} ref - bzz://… or bare 64-hex Swarm reference
 * @returns {Promise<{ bytes:Uint8Array, ref:string, bmtRoot:string, verified:true }>}
 */
export async function verifyAndFetch(ref) {
  const hex = parseBzzRef(ref);
  const url = `${beeUrl()}/bytes/${hex}`;

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new GatewayFetchError({ url, status: resp.status, statusText: resp.statusText });
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());

  const chunk = await MerkleTree.root(bytes);
  const recomputed = bytesToHex(chunk.hash());

  if (recomputed !== hex) {
    throw new BmtMismatchError({ expected: hex, recomputed });
  }
  return { bytes, ref: `bzz://${hex}`, bmtRoot: hex, verified: true };
}

/** Convenience: verifyAndFetch + JSON.parse the bytes as utf-8. */
export async function verifyAndFetchJson(ref) {
  const out = await verifyAndFetch(ref);
  const text = new TextDecoder().decode(out.bytes);
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`payload at ${out.ref} is not valid JSON: ${e.message}`);
  }
  return { ...out, json, text };
}

// ─── Write: pinImmutable ────────────────────────────────────────────────

/**
 * Upload `payload` (string | Uint8Array | object → JSON.stringify) to
 * Swarm via bee.uploadData with the NULL_STAMP postage batch. Returns
 * the canonical bzz:// reference returned by the node.
 *
 * @param {string|Uint8Array|object} payload
 * @returns {Promise<{ ref:string, bmtRoot:string }>}
 */
export async function pinImmutable(payload) {
  let bytes;
  if (payload instanceof Uint8Array) {
    bytes = payload;
  } else if (typeof payload === 'string') {
    bytes = new TextEncoder().encode(payload);
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(payload));
  }

  const result = await bee().uploadData(NULL_STAMP, bytes);
  // bee-js v12 returns an UploadResult with a .reference.toHex() helper.
  const hex = parseBzzRef(result.reference?.toHex?.() ?? String(result.reference));
  return { ref: `bzz://${hex}`, bmtRoot: hex };
}

// ─── Re-exports ─────────────────────────────────────────────────────────

export { NULL_STAMP };
