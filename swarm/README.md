# swarm — Verified Fetch helper

Read-and-verify primitives for Swarm gateways. Used by `agent/` (verifier
skill) and `web/` (reporter PWA). Implements the mentor-blessed recipe:

```
GET /bytes/<hash>           → bytes as-is, no auto-resolve
MerkleTree.root(bytes)      → recompute BMT root
hex(root) === hash          → verified, otherwise reject
```

## Scope

Two primitives, both fetched from the gateway and verified client-side:

### Immutable (CAC) — content-addressed chunks

Verifies single-chunk content-addressed payloads pinned via
`bee.uploadData` (raw bytes). The BMT root returned by `uploadData` is
the address served by `/bytes/<ref>`, so a round-trip recompute matches.

Multi-chunk Mantaray manifests (produced by `bee.uploadFile` with a
filename + content-type) are out of scope for v1. Fetch the wrapped
payload reference directly and verify it as a single-chunk CAC. The
reporter PWA uploads photos via `bee.uploadData` for this reason.

### Mutable (SOC) — single-owner chunks

Verifies SOC chunks fetched from `/chunks/<socAddress>`. The full
upstream verification chain is replicated (delegated to bee-js's
`unmarshalSingleOwnerChunk` so it tracks 1:1):

```
cac_address     = BMT(span || payload)
recovered_owner = ecrecover(sig, keccak256(identifier || cac_address))
soc_address     = keccak256(identifier || recovered_owner)
assert soc_address == expected
```

The address is derivable from `(owner, identifier)`, so a verified
fetch needs only those two inputs.

## API

```js
import {
  verifyAndFetch, verifyAndFetchJson, pinImmutable,
  verifyAndFetchSoc, verifyAndFetchSocJson, pinSoc, verifySocChunk,
} from 'swarm';

const gateway = 'https://bzz.limo';

// CAC: read + BMT-verify
const { bytes, ref, bmtRoot, verified } = await verifyAndFetch('bzz://…', { gateway });

// CAC: read + verify + JSON.parse
const { json } = await verifyAndFetchJson('bzz://…', { gateway });

// CAC: write (NULL_STAMP, rewritten server-side by bzz.limo)
const { ref: r } = await pinImmutable({ hello: 'world' }, { gateway });

// SOC: read + verify by (owner, identifier)
const soc = await verifyAndFetchSocJson({
  gateway,
  owner:      '0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f',
  identifier: 'b2440826…df4e44',
});
console.log(soc.json, soc.verified);

// SOC: write (test/dev helper)
await pinSoc({ gateway, signer: '0x…32-byte-pk', identifier: '00…ff', payload: { k:'v' } });

// SOC: verify already-fetched chunk bytes
verifySocChunk(rawBytes, expectedAddrHex);
verifySocChunk(rawBytes, { owner, identifier });
```

Throws `BmtMismatchError` on tampered CAC response.
Throws `SocVerifyError` on tampered SOC chunk (bad sig, wrong owner, address mismatch).
Throws `GatewayFetchError` on non-2xx.

## Configuration

`SWARM_BEE_URL` env var (e.g. `https://bzz.limo`).

## Why `/bytes` and not `/bzz`

Per mentor guidance: `/bzz` auto-resolves manifests and may transform
the response. `/bytes` returns the raw chunk byte stream that hashes
back to the requested reference — the only thing the client can
recompute.
