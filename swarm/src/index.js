// @phare/swarm — Verified Fetch primitives for Swarm gateways.
//
// Read recipe (mentor-blessed):
//   GET <gateway>/bytes/<hash>     → bytes as-is, no auto-resolve
//   MerkleTree.root(bytes)         → recompute BMT root
//   hex(root) === hash             → verified, otherwise reject
//
// Scope: single-chunk content-addressed payloads (uploadData) and
// single-owner chunks (SOC / mutable). See README for the documented
// limit (multi-chunk Mantaray manifests still out of scope).
//
// Library rule: no env reads, no Node-only APIs. The caller passes the
// gateway URL. Works in browsers and Node alike.

import { Bee, MerkleTree, NULL_STAMP, Identifier, EthAddress } from '@ethersphere/bee-js';

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

export class SocVerifyError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'SocVerifyError';
    Object.assign(this, extra);
  }
}

// ─── Reference parsing ──────────────────────────────────────────────────

const HEX64 = /^[0-9a-fA-F]{64}$/;
const HEX128 = /^[0-9a-fA-F]{128}$/; // encrypted refs (root || decryption key)

/** Strip a `bzz://` or full https-gateway prefix; return the bare 64-hex. */
export function parseBzzRef(ref) {
  let hex = String(ref).trim();
  if (hex.startsWith('bzz://')) hex = hex.slice('bzz://'.length);
  hex = hex.replace(/^https?:\/\/[^/]+\/(?:access|bytes|bzz)\//i, '');
  hex = hex.replace(/\/$/, '');
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

function normaliseGateway(gateway) {
  if (!gateway) throw new Error('gateway URL is required');
  return String(gateway).replace(/\/$/, '');
}

// ─── Read: verifyAndFetch (BMT round-trip) ──────────────────────────────

/**
 * Fetch the bytes pinned at `ref` from `gateway` and assert the BMT
 * recompute matches. Throws BmtMismatchError on tampered response.
 *
 * @param {string} ref - bzz://… or bare 64-hex Swarm reference
 * @param {{ gateway: string, signal?: AbortSignal }} opts
 * @returns {Promise<{ bytes:Uint8Array, ref:string, bmtRoot:string, verified:true }>}
 */
export async function verifyAndFetch(ref, { gateway, signal } = {}) {
  const hex = parseBzzRef(ref);
  const base = normaliseGateway(gateway);
  const url = `${base}/bytes/${hex}`;

  const resp = await fetch(url, { signal });
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
export async function verifyAndFetchJson(ref, opts) {
  const out = await verifyAndFetch(ref, opts);
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
 * Upload `payload` (string | Uint8Array | object → JSON.stringify) via
 * bee.uploadData with the NULL_STAMP postage batch. Returns the canonical
 * bzz:// reference and the BMT root.
 *
 * NULL_STAMP is rewritten server-side by sponsor gateways such as
 * bzz.limo. For self-hosted Bee nodes pass a real stamp via `opts.stamp`.
 *
 * @param {string|Uint8Array|object} payload
 * @param {{ gateway: string, stamp?: string }} opts
 * @returns {Promise<{ ref:string, bmtRoot:string }>}
 */
export async function pinImmutable(payload, { gateway, stamp = NULL_STAMP } = {}) {
  const base = normaliseGateway(gateway);

  let bytes;
  if (payload instanceof Uint8Array) {
    bytes = payload;
  } else if (typeof payload === 'string') {
    bytes = new TextEncoder().encode(payload);
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(payload));
  }

  const bee = new Bee(base);
  const result = await bee.uploadData(stamp, bytes);
  const hex = parseBzzRef(result.reference?.toHex?.() ?? String(result.reference));
  return { ref: `bzz://${hex}`, bmtRoot: hex };
}

// ─── SOC: verify single-owner chunks (mutable / feed primitive) ─────────
//
// Per mentor:
//   "To verify single-owner chunks: see src/chunk/soc.ts in bee-js…
//    reverse engineer that flow to validate."
//
// Layout (bee-js soc.ts):
//   identifier (32B) || signature (65B) || span (8B) || payload (≤4096B)
//
// Verification chain (replicated by bee-js's unmarshalSingleOwnerChunk,
// which we delegate to so the implementation tracks upstream exactly):
//
//   cac_address    = BMT root of (span || payload)
//   recovered_owner = ecrecover(signature, keccak256(identifier || cac_address))
//   soc_address     = keccak256(identifier || recovered_owner)
//   assert(soc_address === expected_address)
//
// We expose two surfaces:
//   verifySocChunk(bytes, expected)          — pure: bytes already in hand
//   verifyAndFetchSoc({ gateway, owner, identifier }) — fetch + verify

function normaliseHex(input, byteLen, label) {
  if (input instanceof Uint8Array) {
    if (input.length !== byteLen) {
      throw new SocVerifyError(`${label} must be ${byteLen} bytes, got ${input.length}`);
    }
    return bytesToHex(input);
  }
  let hex = String(input).trim().replace(/^0x/i, '').toLowerCase();
  if (hex.length !== byteLen * 2 || !/^[0-9a-f]+$/.test(hex)) {
    throw new SocVerifyError(`${label} must be ${byteLen}-byte hex, got "${input}"`);
  }
  return hex;
}

/**
 * Verify raw SOC bytes against an expected address. Returns the unmarshalled
 * chunk (with verified `owner`, `identifier`, `payload`) or throws
 * `SocVerifyError`.
 *
 * @param {Uint8Array} chunkBytes
 * @param {string|Uint8Array|{owner:string|Uint8Array, identifier:string|Uint8Array}} expected
 * @returns {{ identifier:string, owner:string, address:string, payload:Uint8Array, span:Uint8Array, verified:true }}
 */
export function verifySocChunk(chunkBytes, expected) {
  if (!(chunkBytes instanceof Uint8Array)) {
    throw new SocVerifyError('chunkBytes must be Uint8Array');
  }
  if (chunkBytes.length < 32 + 65 + 8) {
    throw new SocVerifyError(
      `SOC chunk too small: ${chunkBytes.length} bytes (need ≥ 105)`,
    );
  }

  // Resolve expected address (either passed directly, or derived from owner+identifier).
  let expectedAddrHex;
  if (typeof expected === 'string' || expected instanceof Uint8Array) {
    expectedAddrHex = normaliseHex(expected, 32, 'expected address');
  } else if (expected && expected.owner && expected.identifier) {
    // Compute via bee-js helper (avoids re-implementing keccak path).
    expectedAddrHex = makeSocAddressHex(expected.identifier, expected.owner);
  } else {
    throw new SocVerifyError('expected must be address hex/bytes or { owner, identifier }');
  }

  // Delegate the cryptographic flow to bee-js to stay 1:1 with upstream.
  const bee = new Bee('http://unused.invalid'); // helper methods don't touch network
  let unmarshalled;
  try {
    unmarshalled = bee.unmarshalSingleOwnerChunk(chunkBytes, expectedAddrHex);
  } catch (e) {
    throw new SocVerifyError(`SOC verification failed: ${e.message}`, { cause: e });
  }

  return {
    identifier: unmarshalled.identifier.toHex(),
    owner: '0x' + unmarshalled.owner.toHex(),
    address: unmarshalled.address.toHex(),
    payload: unmarshalled.payload.toUint8Array(),
    span: unmarshalled.span.toUint8Array(),
    verified: true,
  };
}

/** Compute the SOC address `keccak256(identifier || ownerAddress)` as hex. */
export function makeSocAddressHex(identifier, owner) {
  const idHex = normaliseHex(identifier, 32, 'identifier');
  const ownerHex = normaliseHex(owner, 20, 'owner');
  const bee = new Bee('http://unused.invalid');
  const ref = bee.calculateSingleOwnerChunkAddress(
    new Identifier(idHex),
    new EthAddress(ownerHex),
  );
  return ref.toHex();
}

/**
 * Fetch a SOC by `(owner, identifier)` from `gateway` and verify it.
 *
 * The Bee chunk endpoint (`/chunks/<address>`) is used — same path the
 * mentor's recipe relies on for raw chunk bytes.
 *
 * @param {{ gateway:string, owner:string|Uint8Array, identifier:string|Uint8Array, signal?:AbortSignal }} opts
 * @returns {Promise<{ identifier:string, owner:string, address:string, payload:Uint8Array, span:Uint8Array, verified:true }>}
 */
export async function verifyAndFetchSoc({ gateway, owner, identifier, signal } = {}) {
  const base = normaliseGateway(gateway);
  const ownerHex = normaliseHex(owner, 20, 'owner');
  const idHex = normaliseHex(identifier, 32, 'identifier');
  const addrHex = makeSocAddressHex(idHex, ownerHex);

  const url = `${base}/chunks/${addrHex}`;
  const resp = await fetch(url, { signal });
  if (!resp.ok) {
    throw new GatewayFetchError({ url, status: resp.status, statusText: resp.statusText });
  }
  const chunkBytes = new Uint8Array(await resp.arrayBuffer());

  const verified = verifySocChunk(chunkBytes, addrHex);
  // Sanity: recovered owner must match the one we asked for.
  if (verified.owner.toLowerCase() !== '0x' + ownerHex) {
    throw new SocVerifyError(
      `recovered owner does not match requested owner`,
      { expected: '0x' + ownerHex, recovered: verified.owner },
    );
  }
  return verified;
}

/**
 * Convenience: verifyAndFetchSoc + JSON.parse the payload as utf-8.
 */
export async function verifyAndFetchSocJson(opts) {
  const out = await verifyAndFetchSoc(opts);
  const text = new TextDecoder().decode(out.payload);
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`SOC payload at ${out.address} is not valid JSON: ${e.message}`);
  }
  return { ...out, json, text };
}

/**
 * Write a SOC. Test-loop helper — Bounty 1 is read-side, but a writer
 * is needed to close the SOC E2E test. Keeps the lib self-sufficient.
 *
 * @param {{ gateway:string, signer:string|Uint8Array, identifier:string|Uint8Array, payload:Uint8Array|string|object, stamp?:string }} opts
 * @returns {Promise<{ owner:string, identifier:string, address:string, payloadLength:number }>}
 */
export async function pinSoc({ gateway, signer, identifier, payload, stamp = NULL_STAMP } = {}) {
  const base = normaliseGateway(gateway);
  const idHex = normaliseHex(identifier, 32, 'identifier');
  const signerHex = normaliseHex(signer, 32, 'signer private key');

  let bytes;
  if (payload instanceof Uint8Array) {
    bytes = payload;
  } else if (typeof payload === 'string') {
    bytes = new TextEncoder().encode(payload);
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(payload));
  }

  const bee = new Bee(base);
  const writer = bee.makeSOCWriter(signerHex);
  await writer.upload(stamp, new Identifier(idHex), bytes);

  const ownerAddr = '0x' + writer.owner.toHex();
  const addrHex = makeSocAddressHex(idHex, ownerAddr.slice(2));
  return {
    owner: ownerAddr,
    identifier: idHex,
    address: addrHex,
    payloadLength: bytes.length,
  };
}

// ─── Re-exports ─────────────────────────────────────────────────────────

export { NULL_STAMP };
