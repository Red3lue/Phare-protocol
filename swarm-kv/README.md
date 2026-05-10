# swarm-kv

Developer-friendly key-value store on Swarm Feeds. `put` / `get` /
`list` / `del`, with strings, JSON, and binary values, tied to an
Ethereum keypair. Anyone can read; only the owner can write.

```js
import { KV } from 'swarm-kv';

const kv = new KV({
  gateway:   'https://bzz.limo',
  signer:    '0x4646464646…',           // owner's 32-byte private key
  namespace: 'phare:verifier:agent-17ff56',
});

await kv.put('stats',    { disputes: 1, won: 0 });
await kv.put('greeting', 'hello world');
await kv.put('blob',     new Uint8Array([1, 2, 3]));

await kv.get('stats');                  // { disputes: 1, won: 0 }
await kv.list();                        // ['blob', 'greeting', 'stats']
await kv.entries();                     // [['blob', Uint8Array(3)], …]

await kv.del('greeting');
await kv.has('greeting');               // false
```

Read-only access (no private key needed):

```js
const reader = KV.reader({
  gateway:   'https://bzz.limo',
  owner:     '0x529c…78e30',
  namespace: 'phare:verifier:agent-17ff56',
});
await reader.get('stats');
```

## Why this exists

Swarm has the primitives for mutable state — Feeds, single-owner chunks,
manifests — but using them directly means understanding all three. Most
applications just want a database. This wraps the primitives into the
`get`/`put`/`list`/`del` surface every developer already knows.

## How it works

Each key maps to its own Swarm Feed:

```
topic(key) = keccak256(namespace || 0x00 || key)
```

`put(key, value)` appends one feed update at the next sequential index.
`get(key)` fetches the latest payload of that feed and decodes it.
Listing is backed by a separate `__index__` feed whose latest payload is
a JSON array of currently-live keys; `put` and `del` keep it up to date.

Values are encoded with a 1-byte type tag followed by the body:

| tag    | meaning                  |
|--------|--------------------------|
| `0x00` | UTF-8 string             |
| `0x01` | JSON (UTF-8 stringified) |
| `0x02` | raw bytes (Uint8Array)   |
| `0xff` | tombstone — `get` returns `undefined` |

`del(key)` writes a tombstone update and removes the key from the
index. The underlying feed history is preserved on Swarm.

## API

```ts
class KV {
  constructor(opts: { gateway: string, signer: string|Uint8Array, namespace: string, stamp?: string });
  static reader(opts: { gateway: string, owner: string|Uint8Array, namespace: string }): KVReader;

  put(key: string, value: string|number|boolean|null|object|Uint8Array, opts?): Promise<…>;
  get(key: string): Promise<unknown | undefined>;
  has(key: string): Promise<boolean>;
  del(key: string): Promise<{ key: string, tombstoned: true }>;
  list(): Promise<string[]>;
  entries(): Promise<Array<[string, unknown]>>;
}

class KVReader { /* same shape as KV minus put/del */ }
```

## Limits and caveats

- **4096-byte SOC cap** — values up to ~4 KB after the type-tag byte.
  Larger values can be pinned as immutable CAC and stored as their bzz
  reference (`kv.put('big', 'bzz://…')`).
- **No multi-writer concurrency control** — last write wins on the
  index feed. A single owner writing from a single process is safe.
  Concurrent writers from different processes can race and lose entries
  from the index (the per-key data feeds are unaffected).
- **Eventual consistency on public gateways** — `bzz.limo` and similar
  resolve feed updates within ~1-2s of write. The owning instance keeps
  an in-memory cache so its own subsequent reads are immediate; external
  readers see writes after the gateway converges.
- **Postage stamps** — `NULL_STAMP` is rewritten server-side by sponsor
  gateways. For self-hosted Bee nodes, pass `stamp: '<batchId>'` to the
  constructor.
- **Encrypted refs** — out of scope for v1.

## Example

`examples/live-roundtrip.mjs` writes a string, a JSON object, and a
Uint8Array, lists them, overwrites one, deletes one, then reads
everything back through an independent `KVReader`. Run it directly:

```bash
node examples/live-roundtrip.mjs
```

## Why feeds and not a single SOC per key

We tried. Public gateways cache SOC chunks aggressively by address; a
single-slot SOC overwritten on the same address often returns stale
bytes. Indexed feeds get a fresh SOC address per update, so reads
always reflect the latest write.

## Verification

Each feed update is a single-owner chunk signed by the keypair behind
`signer`. `bee-js` validates the signature and the SOC address on every
read; tampered chunks are rejected before being returned to the caller.
The same primitives are exposed standalone in the sibling `swarm`
package (Verified Fetch — Bounty 1).
