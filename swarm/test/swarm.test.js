// Offline tests for @phare/swarm. Mocks fetch globally; fabricates SOC
// bytes via bee-js's offline helpers so no network or postage stamps are
// required.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Bee, MerkleTree } from '@ethersphere/bee-js';

import {
  parseBzzRef,
  formatBzzRef,
  verifyAndFetch,
  verifyAndFetchJson,
  verifySocChunk,
  makeSocAddressHex,
  verifyAndFetchSoc,
  verifyAndFetchSocJson,
  BmtMismatchError,
  GatewayFetchError,
  SocVerifyError,
} from 'swarm';

const GATEWAY = 'https://example.invalid';

// ─── Fixtures (offline) ─────────────────────────────────────────────────

const bee = new Bee('http://offline.invalid');
const SIGNER_PK = '4646464646464646464646464646464646464646464646464646464646464646';
const IDENT_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

function bytesToHex(u8) {
  return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
}

function makeCac(payload) {
  // Returns { bytes, refHex } such that MerkleTree.root(bytes).hash() === refHex.
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  return { bytes, refHex: null }; // we'll compute refHex from MerkleTree.root inline
}

async function makeCacFixture(payload) {
  const bytes = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  const root = await MerkleTree.root(bytes);
  return { bytes, refHex: bytesToHex(root.hash()) };
}

function makeSocFixture(payloadStr, identHex = IDENT_HEX, signerPk = SIGNER_PK) {
  const payload = new TextEncoder().encode(payloadStr);
  const cac = bee.makeContentAddressedChunk(payload);
  const soc = cac.toSingleOwnerChunk(identHex, signerPk);
  return {
    bytes: soc.data,                       // raw 32+65+8+payload bytes
    address: soc.address.toHex(),          // 64-hex SOC address
    owner: '0x' + soc.owner.toHex(),       // 0x + 40-hex
    identifier: identHex,
  };
}

function mockFetchResponse({ status = 200, body } = {}) {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Not Found',
    arrayBuffer: async () => body instanceof Uint8Array ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new ArrayBuffer(0),
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─── parseBzzRef / formatBzzRef ─────────────────────────────────────────

describe('parseBzzRef', () => {
  const HASH = 'aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44';

  it('accepts bare 64-hex', () => {
    expect(parseBzzRef(HASH)).toBe(HASH);
  });
  it('strips bzz:// prefix', () => {
    expect(parseBzzRef(`bzz://${HASH}`)).toBe(HASH);
  });
  it('strips full https-gateway URL', () => {
    expect(parseBzzRef(`https://bzz.limo/bytes/${HASH}`)).toBe(HASH);
    expect(parseBzzRef(`https://bzz.limo/bzz/${HASH}/`)).toBe(HASH);
    expect(parseBzzRef(`https://example.com/access/${HASH}`)).toBe(HASH);
  });
  it('strips 0x prefix', () => {
    expect(parseBzzRef(`0x${HASH}`)).toBe(HASH);
  });
  it('lower-cases mixed-case hex', () => {
    expect(parseBzzRef(HASH.toUpperCase())).toBe(HASH);
  });
  it('rejects encrypted (128-hex) refs', () => {
    expect(() => parseBzzRef('a'.repeat(128))).toThrow(/encrypted/i);
  });
  it('rejects malformed input', () => {
    expect(() => parseBzzRef('not-a-hash')).toThrow(/unrecognised/i);
    expect(() => parseBzzRef('a'.repeat(63))).toThrow(/unrecognised/i);
    expect(() => parseBzzRef('a'.repeat(65))).toThrow(/unrecognised/i);
  });
});

describe('formatBzzRef', () => {
  it('round-trips through parseBzzRef', () => {
    const HASH = 'b1'.repeat(32);
    expect(formatBzzRef(HASH)).toBe(`bzz://${HASH}`);
    expect(parseBzzRef(formatBzzRef(HASH))).toBe(HASH);
  });
});

// ─── verifyAndFetch (CAC) ───────────────────────────────────────────────

describe('verifyAndFetch', () => {
  it('returns verified bytes when BMT root matches', async () => {
    const fix = await makeCacFixture('hello world');
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ body: fix.bytes }));

    const out = await verifyAndFetch(fix.refHex, { gateway: GATEWAY });
    expect(out.verified).toBe(true);
    expect(out.bmtRoot).toBe(fix.refHex);
    expect(out.bytes).toEqual(fix.bytes);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${GATEWAY}/bytes/${fix.refHex}`,
      expect.any(Object),
    );
  });

  it('throws BmtMismatchError when gateway returns tampered bytes', async () => {
    const fix = await makeCacFixture('hello world');
    const tampered = new Uint8Array(fix.bytes);
    tampered[0] ^= 0xff;
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ body: tampered }));

    await expect(verifyAndFetch(fix.refHex, { gateway: GATEWAY }))
      .rejects.toBeInstanceOf(BmtMismatchError);
  });

  it('throws GatewayFetchError on 404', async () => {
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ status: 404 }));
    await expect(verifyAndFetch('a'.repeat(64), { gateway: GATEWAY }))
      .rejects.toBeInstanceOf(GatewayFetchError);
  });

  it('throws GatewayFetchError on 500', async () => {
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ status: 500 }));
    await expect(verifyAndFetch('b'.repeat(64), { gateway: GATEWAY }))
      .rejects.toBeInstanceOf(GatewayFetchError);
  });

  it('requires gateway option', async () => {
    await expect(verifyAndFetch('c'.repeat(64), {}))
      .rejects.toThrow(/gateway/i);
  });
});

describe('verifyAndFetchJson', () => {
  it('parses verified bytes as JSON', async () => {
    const fix = await makeCacFixture(JSON.stringify({ k: 'v', n: 1 }));
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ body: fix.bytes }));

    const out = await verifyAndFetchJson(fix.refHex, { gateway: GATEWAY });
    expect(out.json).toEqual({ k: 'v', n: 1 });
    expect(out.verified).toBe(true);
  });

  it('throws on malformed JSON even if BMT verifies', async () => {
    const fix = await makeCacFixture('{"k":');
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ body: fix.bytes }));

    await expect(verifyAndFetchJson(fix.refHex, { gateway: GATEWAY }))
      .rejects.toThrow(/not valid JSON/i);
  });
});

// ─── makeSocAddressHex ──────────────────────────────────────────────────

describe('makeSocAddressHex', () => {
  it('matches bee-js for a known SOC fixture', () => {
    const fix = makeSocFixture('hi');
    const computed = makeSocAddressHex(fix.identifier, fix.owner);
    expect(computed).toBe(fix.address);
  });
  it('rejects wrong-length identifier', () => {
    expect(() => makeSocAddressHex('aa', 'bb'.repeat(20))).toThrow(/identifier/);
  });
  it('rejects wrong-length owner', () => {
    expect(() => makeSocAddressHex('cc'.repeat(32), 'dd')).toThrow(/owner/);
  });
});

// ─── verifySocChunk ─────────────────────────────────────────────────────

describe('verifySocChunk', () => {
  it('verifies a clean SOC chunk', () => {
    const fix = makeSocFixture('hello-soc');
    const r = verifySocChunk(fix.bytes, fix.address);
    expect(r.verified).toBe(true);
    expect(r.owner.toLowerCase()).toBe(fix.owner.toLowerCase());
    expect(new TextDecoder().decode(r.payload)).toBe('hello-soc');
  });

  it('accepts {owner, identifier} as expected', () => {
    const fix = makeSocFixture('abc');
    const r = verifySocChunk(fix.bytes, { owner: fix.owner, identifier: fix.identifier });
    expect(r.verified).toBe(true);
  });

  it('rejects tampered payload byte', () => {
    const fix = makeSocFixture('payload-xyz');
    const tampered = new Uint8Array(fix.bytes);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => verifySocChunk(tampered, fix.address)).toThrow(SocVerifyError);
  });

  it('rejects tampered signature byte', () => {
    const fix = makeSocFixture('sig-test');
    const tampered = new Uint8Array(fix.bytes);
    tampered[40] ^= 0x01; // somewhere in the 65-byte signature
    expect(() => verifySocChunk(tampered, fix.address)).toThrow(SocVerifyError);
  });

  it('rejects tampered identifier byte', () => {
    const fix = makeSocFixture('id-test');
    const tampered = new Uint8Array(fix.bytes);
    tampered[5] ^= 0x80; // somewhere in the 32-byte identifier
    expect(() => verifySocChunk(tampered, fix.address)).toThrow(SocVerifyError);
  });

  it('rejects when expected address is wrong', () => {
    const fix = makeSocFixture('addr-test');
    expect(() => verifySocChunk(fix.bytes, '0'.repeat(64))).toThrow(SocVerifyError);
  });

  it('rejects too-short input', () => {
    expect(() => verifySocChunk(new Uint8Array(50), 'a'.repeat(64))).toThrow(/too small/);
  });

  it('rejects non-Uint8Array input', () => {
    expect(() => verifySocChunk([1, 2, 3], 'a'.repeat(64))).toThrow(SocVerifyError);
  });
});

// ─── verifyAndFetchSoc (mocked) ─────────────────────────────────────────

describe('verifyAndFetchSoc', () => {
  it('fetches /chunks/<address> and verifies', async () => {
    const fix = makeSocFixture('soc-fetch');
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ body: fix.bytes }));

    const out = await verifyAndFetchSoc({
      gateway: GATEWAY, owner: fix.owner, identifier: fix.identifier,
    });
    expect(out.verified).toBe(true);
    expect(out.address).toBe(fix.address);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${GATEWAY}/chunks/${fix.address}`,
      expect.any(Object),
    );
  });

  it('throws GatewayFetchError on 404', async () => {
    const fix = makeSocFixture('x');
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ status: 404 }));
    await expect(verifyAndFetchSoc({
      gateway: GATEWAY, owner: fix.owner, identifier: fix.identifier,
    })).rejects.toBeInstanceOf(GatewayFetchError);
  });

  it('throws SocVerifyError when fetched bytes are tampered', async () => {
    const fix = makeSocFixture('tamper-fetch');
    const tampered = new Uint8Array(fix.bytes);
    tampered[fix.bytes.length - 1] ^= 0xff;
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ body: tampered }));

    await expect(verifyAndFetchSoc({
      gateway: GATEWAY, owner: fix.owner, identifier: fix.identifier,
    })).rejects.toBeInstanceOf(SocVerifyError);
  });

  it('rejects malformed owner / identifier inputs', async () => {
    await expect(verifyAndFetchSoc({
      gateway: GATEWAY, owner: 'bad', identifier: 'a'.repeat(64),
    })).rejects.toThrow(/owner/);
    await expect(verifyAndFetchSoc({
      gateway: GATEWAY, owner: 'aa'.repeat(20), identifier: 'short',
    })).rejects.toThrow(/identifier/);
  });
});

describe('verifyAndFetchSocJson', () => {
  it('parses verified payload as JSON', async () => {
    const fix = makeSocFixture(JSON.stringify({ k: 'v' }));
    globalThis.fetch.mockResolvedValueOnce(mockFetchResponse({ body: fix.bytes }));

    const out = await verifyAndFetchSocJson({
      gateway: GATEWAY, owner: fix.owner, identifier: fix.identifier,
    });
    expect(out.json).toEqual({ k: 'v' });
    expect(out.verified).toBe(true);
  });
});
