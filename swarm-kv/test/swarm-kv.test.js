// Offline unit tests for swarm-kv. Cover envelope encode/decode round
// trips, type-tag handling, tombstone semantics, key derivation, and the
// KV class's input validation. Live integration is exercised by the
// example script in examples/ (see README).

import { describe, expect, it } from 'vitest';

import {
  KV, KVReader, KvError, _internals,
} from '../src/index.js';

const {
  encodeValue, decodePayload, topicFor, isTombstone,
  TAG_STRING, TAG_JSON, TAG_BYTES, TAG_TOMBSTONE, INDEX_KEY,
} = _internals;

describe('encodeValue / decodePayload', () => {
  it('roundtrips strings', () => {
    const enc = encodeValue('hello world');
    expect(enc[0]).toBe(TAG_STRING);
    expect(decodePayload(enc)).toBe('hello world');
  });

  it('roundtrips empty string', () => {
    const enc = encodeValue('');
    expect(enc[0]).toBe(TAG_STRING);
    expect(decodePayload(enc)).toBe('');
  });

  it('roundtrips json objects', () => {
    const obj = { disputes: 2, won: 1, who: 'agent', t: 12345 };
    const enc = encodeValue(obj);
    expect(enc[0]).toBe(TAG_JSON);
    expect(decodePayload(enc)).toEqual(obj);
  });

  it('roundtrips json arrays', () => {
    const enc = encodeValue([1, 'two', { three: 3 }, null]);
    expect(decodePayload(enc)).toEqual([1, 'two', { three: 3 }, null]);
  });

  it('roundtrips numbers and booleans through json tag', () => {
    expect(decodePayload(encodeValue(42))).toBe(42);
    expect(decodePayload(encodeValue(true))).toBe(true);
    expect(decodePayload(encodeValue(false))).toBe(false);
    expect(decodePayload(encodeValue(null))).toBe(null);
  });

  it('roundtrips Uint8Array bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
    const enc = encodeValue(bytes);
    expect(enc[0]).toBe(TAG_BYTES);
    const decoded = decodePayload(enc);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual([0, 1, 2, 127, 128, 255]);
  });

  it('roundtrips empty bytes', () => {
    const enc = encodeValue(new Uint8Array(0));
    expect(enc[0]).toBe(TAG_BYTES);
    expect(decodePayload(enc).length).toBe(0);
  });

  it('rejects empty payloads', () => {
    expect(() => decodePayload(new Uint8Array(0))).toThrow(/empty/);
    expect(() => decodePayload(null)).toThrow(/empty/);
  });

  it('rejects unknown tags', () => {
    const bad = new Uint8Array([0x42, 1, 2, 3]);
    expect(() => decodePayload(bad)).toThrow(/unknown kv tag/);
  });

  it('decodes tombstone tag as undefined', () => {
    const tomb = new Uint8Array([TAG_TOMBSTONE]);
    expect(decodePayload(tomb)).toBeUndefined();
  });
});

describe('isTombstone', () => {
  it('identifies tombstone payloads', () => {
    expect(isTombstone(new Uint8Array([TAG_TOMBSTONE]))).toBe(true);
    expect(isTombstone(encodeValue('alive'))).toBe(false);
    expect(isTombstone(encodeValue({}))).toBe(false);
    expect(isTombstone(new Uint8Array(0))).toBe(false);
    expect(isTombstone(null)).toBe(false);
  });
});

describe('topicFor (key derivation)', () => {
  it('produces 32-byte topic hex', () => {
    const t = topicFor('phare:test', 'stats');
    expect(t.toHex()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const a = topicFor('ns', 'k');
    const b = topicFor('ns', 'k');
    expect(a.toHex()).toBe(b.toHex());
  });

  it('separates namespaces', () => {
    expect(topicFor('a', 'k').toHex()).not.toBe(topicFor('b', 'k').toHex());
  });

  it('separates keys', () => {
    expect(topicFor('a', 'k1').toHex()).not.toBe(topicFor('a', 'k2').toHex());
  });

  // Non-injective concatenations are a classic kv-on-feed pitfall:
  // ('phare', 'verifier:agent') and ('phare:verifier', 'agent') must
  // produce different topics. Our delimiter byte (\x00) prevents this.
  it('avoids namespace/key concatenation collisions', () => {
    const a = topicFor('phare', 'verifier:agent').toHex();
    const b = topicFor('phare:verifier', 'agent').toHex();
    expect(a).not.toBe(b);
  });
});

describe('KV constructor validation', () => {
  const SIGNER = '46'.repeat(32);

  it('requires signer for writes', () => {
    expect(() => new KV({ gateway: 'http://x', namespace: 'ns' }))
      .toThrow(/signer/);
  });

  it('requires gateway', () => {
    expect(() => new KV({ signer: SIGNER, namespace: 'ns' }))
      .toThrow(/gateway/);
  });

  it('requires non-empty namespace', () => {
    expect(() => new KV({ gateway: 'http://x', signer: SIGNER, namespace: '' }))
      .toThrow(/namespace/);
    expect(() => new KV({ gateway: 'http://x', signer: SIGNER }))
      .toThrow(/namespace/);
  });

  it('derives owner address from signer', () => {
    const kv = new KV({ gateway: 'http://x', signer: SIGNER, namespace: 'ns' });
    expect(kv.owner).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('exposes a static .reader() factory', () => {
    const reader = KV.reader({ gateway: 'http://x', owner: '0x' + 'aa'.repeat(20), namespace: 'ns' });
    expect(reader).toBeInstanceOf(KVReader);
  });
});

describe('KVReader constructor validation', () => {
  it('requires owner', () => {
    expect(() => new KVReader({ gateway: 'http://x', namespace: 'ns' }))
      .toThrow(/owner/);
  });
  it('requires namespace', () => {
    expect(() => new KVReader({ gateway: 'http://x', owner: '0x' + 'a'.repeat(40) }))
      .toThrow(/namespace/);
  });
});

describe('KV.put / .del input validation', () => {
  const kv = new KV({
    gateway: 'http://offline.invalid',
    signer:  '46'.repeat(32),
    namespace: 'unit',
  });

  it('rejects empty key', async () => {
    await expect(kv.put('', 'v')).rejects.toThrow(/invalid key/);
  });

  it('rejects non-string key', async () => {
    await expect(kv.put(42, 'v')).rejects.toThrow(/invalid key/);
    await expect(kv.put(null, 'v')).rejects.toThrow(/invalid key/);
  });

  it('rejects reserved __index__ key', async () => {
    await expect(kv.put(INDEX_KEY, 'v')).rejects.toThrow(/invalid key/);
    await expect(kv.del(INDEX_KEY)).rejects.toThrow(/invalid key/);
  });

  it('rejects values exceeding the SOC payload cap', async () => {
    // 1-byte tag + 4096-byte body would just exceed the 4096 cap.
    const big = new Uint8Array(4096);
    await expect(kv.put('big', big)).rejects.toThrow(/too large/);
  });
});

describe('KvError', () => {
  it('attaches extra fields', () => {
    const err = new KvError('boom', { keyLen: 5 });
    expect(err.name).toBe('KvError');
    expect(err.keyLen).toBe(5);
  });
});

describe('INDEX_KEY constant', () => {
  it('is reserved and exposed', () => {
    expect(INDEX_KEY).toBe('__index__');
  });
});
