// swarm-kv — Developer-friendly key-value store on Swarm Feeds.
//
// Each "key" maps to a Swarm Feed (sequence of single-owner chunks at
// indexed addresses derived from the topic + owner). Each `put` appends
// a new feed update with the encoded value. `get` reads the latest
// feed payload.
//
// Why feeds and not single SOCs: gateways cache SOC chunks aggressively
// by address. A single-slot SOC overwritten on the same address often
// returns stale bytes. Indexed feeds get a fresh SOC address per update,
// so reads always reflect the latest write.
//
// Listing is backed by a separate "__index__" Feed whose latest payload
// is a JSON array of currently-live keys. Updated on every put/del.
//
// Values are stored with a 1-byte type tag prefix:
//   0x00  string (utf-8)
//   0x01  json   (utf-8 JSON)
//   0x02  bytes  (raw)
//   0xff  tombstone (no payload)
//
// Tied to an Ethereum keypair: writes need the private key; reads only
// need the owner's 20-byte address. Anyone can read; only the owner can
// write.
//
// Limits:
// - 4096-byte SOC payload cap → binary values up to ~4 KB.
// - No multi-writer concurrency control (last write wins on the index).

import { Bee, NULL_STAMP, PrivateKey, Topic } from '@ethersphere/bee-js';

// ─── Type tags ──────────────────────────────────────────────────────────

const TAG_STRING    = 0x00;
const TAG_JSON      = 0x01;
const TAG_BYTES     = 0x02;
const TAG_TOMBSTONE = 0xff;

const INDEX_KEY = '__index__';
const ENC = new TextEncoder();
const DEC = new TextDecoder();

// ─── Helpers ────────────────────────────────────────────────────────────

function isUint8Array(x) {
  return x instanceof Uint8Array;
}
function isPlainKey(k) {
  return typeof k === 'string' && k.length > 0 && k !== INDEX_KEY;
}

/** Topic for (namespace, key) — keccak256 over the joined string. */
function topicFor(namespace, key) {
  return Topic.fromString(`${namespace}\x00${key}`);
}

/** Encode a value into a tagged Uint8Array payload. */
function encodeValue(value) {
  if (isUint8Array(value)) {
    const out = new Uint8Array(value.length + 1);
    out[0] = TAG_BYTES;
    out.set(value, 1);
    return out;
  }
  if (typeof value === 'string') {
    const utf8 = ENC.encode(value);
    const out = new Uint8Array(utf8.length + 1);
    out[0] = TAG_STRING;
    out.set(utf8, 1);
    return out;
  }
  // Default to JSON for everything else (number, boolean, object, array).
  const utf8 = ENC.encode(JSON.stringify(value));
  const out = new Uint8Array(utf8.length + 1);
  out[0] = TAG_JSON;
  out.set(utf8, 1);
  return out;
}

/** Decode a tagged payload Uint8Array back into its original value. */
function decodePayload(payload) {
  if (!payload || payload.length === 0) {
    throw new Error('empty kv payload');
  }
  const tag = payload[0];
  const body = payload.subarray(1);
  switch (tag) {
    case TAG_STRING:    return DEC.decode(body);
    case TAG_JSON:      return JSON.parse(DEC.decode(body));
    case TAG_BYTES:     return new Uint8Array(body);
    case TAG_TOMBSTONE: return undefined;
    default:            throw new Error(`unknown kv tag: 0x${tag.toString(16)}`);
  }
}

function isTombstone(payload) {
  return payload?.length > 0 && payload[0] === TAG_TOMBSTONE;
}

const TOMBSTONE_BYTES = new Uint8Array([TAG_TOMBSTONE]);

// ─── Errors ─────────────────────────────────────────────────────────────

export class KvError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'KvError';
    Object.assign(this, extra);
  }
}

// ─── Bee gateway plumbing ───────────────────────────────────────────────

function newBee(gateway) {
  if (!gateway) throw new KvError('gateway is required');
  return new Bee(String(gateway).replace(/\/$/, ''));
}

/**
 * Read the latest payload of a feed. Returns Uint8Array or null if the
 * feed has no updates yet (gateway 404).
 */
async function readFeedPayload(bee, topic, owner) {
  const reader = bee.makeFeedReader(topic, owner);
  try {
    const result = await reader.downloadPayload();
    return result.payload.toUint8Array();
  } catch (e) {
    // bee-js wraps gateway 404s as BeeError. Heuristic: any read failure
    // is treated as "no value yet" so callers see undefined.
    if (/404|not found|cannot find/i.test(e.message ?? '')) return null;
    throw e;
  }
}

async function writeFeedPayload(bee, topic, signer, payload, stamp) {
  const writer = bee.makeFeedWriter(topic, signer);
  await writer.uploadPayload(stamp ?? NULL_STAMP, payload);
}

// ─── Public reader (no signer required) ─────────────────────────────────

class KVReader {
  /**
   * @param {{ gateway:string, owner:string|Uint8Array, namespace:string }} opts
   */
  constructor({ gateway, owner, namespace }) {
    if (!owner) throw new KvError('owner is required');
    if (typeof namespace !== 'string' || namespace.length === 0) {
      throw new KvError('namespace must be a non-empty string');
    }
    this.gateway   = gateway;
    this.owner     = owner;
    this.namespace = namespace;
    this._bee      = newBee(gateway);
  }

  async get(key) {
    if (!isPlainKey(key)) throw new KvError(`invalid key: ${JSON.stringify(key)}`);
    const topic = topicFor(this.namespace, key);
    const payload = await readFeedPayload(this._bee, topic, this.owner);
    if (!payload) return undefined;
    if (isTombstone(payload)) return undefined;
    return decodePayload(payload);
  }

  async has(key) {
    return (await this.get(key)) !== undefined;
  }

  async list() {
    const topic = topicFor(this.namespace, INDEX_KEY);
    const payload = await readFeedPayload(this._bee, topic, this.owner);
    if (!payload) return [];
    try {
      const arr = JSON.parse(DEC.decode(payload));
      return Array.isArray(arr) ? arr.filter(isPlainKey) : [];
    } catch {
      return [];
    }
  }

  async entries() {
    const keys = await this.list();
    const out = [];
    for (const k of keys) {
      const v = await this.get(k);
      if (v !== undefined) out.push([k, v]);
    }
    return out;
  }
}

// ─── Public writer (extends reader; needs a private key) ────────────────

class KV extends KVReader {
  /**
   * @param {{ gateway:string, signer:string|Uint8Array, namespace:string, stamp?:string }} opts
   */
  constructor({ gateway, signer, namespace, stamp }) {
    if (!signer) throw new KvError('signer (private key) is required for writes');
    const pk = new PrivateKey(signer);
    const owner = '0x' + pk.publicKey().address().toHex();
    super({ gateway, owner, namespace });
    this.signer = signer;
    this.stamp  = stamp ?? NULL_STAMP;
    // In-process index cache. Public Bee gateways have eventual-consistency
    // on Feed lookups (read-after-write lag of 1-2s). The cache makes the
    // writer's own list/put/del calls authoritative; external KVReader
    // instances still resolve eventually through the gateway.
    this._indexCache = null;
  }

  /** Public read-only handle for the same namespace + owner. */
  static reader(opts) {
    return new KVReader(opts);
  }

  /**
   * Set (overwrite) the value at `key`. `value` may be a string, plain
   * JSON-able object/number/boolean/array, or a Uint8Array.
   */
  async put(key, value, opts = {}) {
    if (!isPlainKey(key)) throw new KvError(`invalid key: ${JSON.stringify(key)}`);
    const payload = encodeValue(value);
    if (payload.length > 4096) {
      throw new KvError(
        `value too large: ${payload.length} bytes (SOC limit is 4096)`,
        { keyLen: key.length, payloadLen: payload.length },
      );
    }
    const topic = topicFor(this.namespace, key);
    await writeFeedPayload(this._bee, topic, this.signer, payload, opts.stamp ?? this.stamp);
    await this._addToIndex(key, opts);
    return { key, owner: this.owner, payloadLength: payload.length };
  }

  /**
   * Tombstone the key. Subsequent gets return undefined; key is removed
   * from list output. The underlying feed gets a tombstone update (not
   * deleted from Swarm).
   */
  async del(key, opts = {}) {
    if (!isPlainKey(key)) throw new KvError(`invalid key: ${JSON.stringify(key)}`);
    const topic = topicFor(this.namespace, key);
    await writeFeedPayload(this._bee, topic, this.signer, TOMBSTONE_BYTES, opts.stamp ?? this.stamp);
    await this._removeFromIndex(key, opts);
    return { key, tombstoned: true };
  }

  // ─── Listing (writer-side: read from cache when warm) ─────────────────

  async list() {
    if (this._indexCache !== null) return [...this._indexCache];
    const keys = await super.list();
    this._indexCache = keys.slice().sort();
    return [...this._indexCache];
  }

  // ─── Index maintenance ────────────────────────────────────────────────

  async _writeIndex(keys, opts = {}) {
    const topic = topicFor(this.namespace, INDEX_KEY);
    const payload = ENC.encode(JSON.stringify(keys));
    if (payload.length > 4096) {
      throw new KvError(`index payload too large: ${payload.length} bytes`);
    }
    await writeFeedPayload(this._bee, topic, this.signer, payload, opts.stamp ?? this.stamp);
    this._indexCache = keys.slice();
  }

  async _addToIndex(key, opts) {
    const keys = await this.list();
    if (keys.includes(key)) return;
    keys.push(key);
    keys.sort();
    await this._writeIndex(keys, opts);
  }

  async _removeFromIndex(key, opts) {
    const keys = await this.list();
    const next = keys.filter((k) => k !== key);
    if (next.length === keys.length) return;
    await this._writeIndex(next, opts);
  }
}

// ─── Re-exports ─────────────────────────────────────────────────────────

export { KV, KVReader };

// Internal helpers exposed for tests + advanced users.
export const _internals = Object.freeze({
  encodeValue, decodePayload, topicFor, isTombstone,
  TAG_STRING, TAG_JSON, TAG_BYTES, TAG_TOMBSTONE, INDEX_KEY,
});
