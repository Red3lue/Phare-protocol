// Live end-to-end example for swarm-kv. Pins string / JSON / binary
// values and a tombstone via the bzz.limo gateway, then reads them back
// through a separate KVReader instance to prove the data round-trips.
//
// Run:
//   node examples/live-roundtrip.mjs
//
// Notes:
// - bzz.limo accepts NULL_STAMP and rewrites server-side. For your own
//   Bee node, pass `stamp` to the constructor.
// - Public gateways have ~1-2s read-after-write lag on Feed lookups. The
//   external reader pause below is there to demonstrate eventual
//   consistency, not because the lib needs it.

import { KV } from 'swarm-kv';

const GATEWAY  = process.env.SWARM_BEE_URL ?? 'https://bzz.limo';
const SIGNER   = '4646464646464646464646464646464646464646464646464646464646464646';
const NS       = `swarm-kv-example-${Date.now()}`;

const kv = new KV({ gateway: GATEWAY, signer: SIGNER, namespace: NS });
console.log('owner =', kv.owner);
console.log('namespace =', NS);

console.log('\n--- put ---');
await kv.put('greeting', 'hello world');
await kv.put('stats', { disputes: 1, won: 0, lastActive: Date.now() });
await kv.put('blob', new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
console.log('wrote 3 keys');

console.log('\n--- get ---');
console.log('greeting =', await kv.get('greeting'));
console.log('stats    =', await kv.get('stats'));
console.log('blob     =', Array.from(await kv.get('blob')).map((b) => b.toString(16).padStart(2, '0')).join(' '));
console.log('missing  =', await kv.get('missing'));

console.log('\n--- list ---');
console.log(await kv.list());

console.log('\n--- overwrite ---');
await kv.put('stats', { disputes: 2, won: 1, lastActive: Date.now() });
console.log('stats =', await kv.get('stats'));

console.log('\n--- del ---');
await kv.del('greeting');
console.log('greeting after del =', await kv.get('greeting'));
console.log('list after del     =', await kv.list());

console.log('\n--- read via independent KVReader ---');
console.log('waiting 4s for gateway propagation…');
await new Promise((r) => setTimeout(r, 4000));
const reader = KV.reader({ gateway: GATEWAY, owner: kv.owner, namespace: NS });
console.log('reader.list    =', await reader.list());
console.log('reader.entries =', await reader.entries());
