// Validation script — proves the KV works as intended end-to-end.
//
// Asserts the trust + isolation properties Bounty 2 cares about:
//
//   1. Owner writes; anyone can read with just (owner address, namespace).
//   2. A reader pointed at a different owner sees nothing (SOC address
//      derives from owner, so different owner == different storage).
//   3. Two different signers writing to the same namespace string get
//      independent stores (namespace is not a global mutex; it's
//      scoped under the owner).
//   4. Tombstones propagate to external readers.
//   5. Missing keys, reserved keys, and oversize values are all handled.
//
// Run:
//   node examples/validate.mjs
//
// Exits non-zero if any assertion fails.

import { KV } from 'swarm-kv';

const GATEWAY = process.env.SWARM_BEE_URL ?? 'https://bzz.limo';
const STAMP_LAG_MS = 4000;

const PK_A = '4646464646464646464646464646464646464646464646464646464646464646';
const PK_B = '7777777777777777777777777777777777777777777777777777777777777777';
const NS   = `validate-${Date.now()}`;

let passed = 0;
let failed = 0;

function ok(label) { console.log(`  ✓ ${label}`); passed++; }
function fail(label, err) {
  console.log(`  ✗ ${label}`);
  if (err) console.log(`      ${err.message ?? err}`);
  failed++;
}

async function expect(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (e) {
    fail(label, e);
  }
}

function assert(cond, msg = 'assert failed') {
  if (!cond) throw new Error(msg);
}
function eq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg ?? 'eq'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────

console.log(`gateway   = ${GATEWAY}`);
console.log(`namespace = ${NS}`);

const kvA = new KV({ gateway: GATEWAY, signer: PK_A, namespace: NS });
const kvB = new KV({ gateway: GATEWAY, signer: PK_B, namespace: NS });
console.log(`owner A   = ${kvA.owner}`);
console.log(`owner B   = ${kvB.owner}`);

// ─── 1. Owner writes; external reader sees same data ───────────────────

console.log('\n[1] Owner writes; independent KVReader sees same data');

await expect('A writes string, json, bytes', async () => {
  await kvA.put('greeting', 'hello world');
  await kvA.put('stats',    { disputes: 1, won: 0 });
  await kvA.put('blob',     new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
});

await expect('A reads back string', async () => {
  eq(await kvA.get('greeting'), 'hello world');
});
await expect('A reads back json', async () => {
  eq(await kvA.get('stats'), { disputes: 1, won: 0 });
});
await expect('A reads back bytes', async () => {
  const b = await kvA.get('blob');
  assert(b instanceof Uint8Array, 'expected Uint8Array');
  eq(Array.from(b), [0xde, 0xad, 0xbe, 0xef]);
});

await expect(`A.list() returns [blob, greeting, stats]`, async () => {
  eq(await kvA.list(), ['blob', 'greeting', 'stats']);
});

console.log(`  ⏳ waiting ${STAMP_LAG_MS}ms for gateway propagation…`);
await new Promise((r) => setTimeout(r, STAMP_LAG_MS));

const readerA = KV.reader({ gateway: GATEWAY, owner: kvA.owner, namespace: NS });

await expect('external reader.get string matches', async () => {
  eq(await readerA.get('greeting'), 'hello world');
});
await expect('external reader.get json matches', async () => {
  eq(await readerA.get('stats'), { disputes: 1, won: 0 });
});
await expect('external reader.list matches', async () => {
  eq(await readerA.list(), ['blob', 'greeting', 'stats']);
});

// ─── 2. Wrong owner → empty store ───────────────────────────────────────

console.log('\n[2] Reader with WRONG owner sees nothing');

const readerWrong = KV.reader({
  gateway:   GATEWAY,
  owner:     '0x' + '01'.repeat(20),         // address with no SOCs in this NS
  namespace: NS,
});
await expect('wrong-owner list = []', async () => {
  eq(await readerWrong.list(), []);
});
await expect('wrong-owner get = undefined', async () => {
  assert((await readerWrong.get('greeting')) === undefined);
  assert((await readerWrong.get('stats'))    === undefined);
});

// ─── 3. Different signer, same NS → isolated stores ────────────────────

console.log('\n[3] Different signer + same namespace = isolated stores');

await expect('B sees its OWN namespace empty before writing', async () => {
  eq(await kvB.list(), []);
});

await expect("B's writes are invisible to A's reader", async () => {
  await kvB.put('foreign', 'B value');
  // A's reader is keyed on A's owner address — should not see B's data.
  eq(await readerA.list(), ['blob', 'greeting', 'stats']);
});

await expect("A's writes still visible to A's reader after B activity", async () => {
  eq(await readerA.get('greeting'), 'hello world');
});

// ─── 4. Tombstones propagate ────────────────────────────────────────────

console.log('\n[4] Tombstone propagates to external reader');

await expect('A.del removes from A.list', async () => {
  await kvA.del('greeting');
  eq(await kvA.list(), ['blob', 'stats']);
  assert((await kvA.get('greeting')) === undefined, 'A.get after del');
});

console.log(`  ⏳ waiting ${STAMP_LAG_MS}ms for gateway propagation…`);
await new Promise((r) => setTimeout(r, STAMP_LAG_MS));

await expect('external reader sees deletion', async () => {
  // External readers may briefly be stale; the post-delay read should converge.
  eq(await readerA.list(), ['blob', 'stats']);
  assert((await readerA.get('greeting')) === undefined, 'reader.get after del');
});

// ─── 5. Edge cases ──────────────────────────────────────────────────────

console.log('\n[5] Edge cases');

await expect('missing key → undefined', async () => {
  assert((await kvA.get('does-not-exist')) === undefined);
});

await expect('reserved __index__ key rejected on put', async () => {
  let threw = false;
  try { await kvA.put('__index__', 'no'); } catch { threw = true; }
  assert(threw, 'expected throw');
});

await expect('reserved __index__ key rejected on del', async () => {
  let threw = false;
  try { await kvA.del('__index__'); } catch { threw = true; }
  assert(threw, 'expected throw');
});

await expect('oversize value (>4096 bytes) rejected', async () => {
  let threw = false;
  try { await kvA.put('big', new Uint8Array(4096)); } catch { threw = true; }
  assert(threw, 'expected throw on >4096-byte payload');
});

await expect('overwrite returns latest value', async () => {
  await kvA.put('stats', { disputes: 99, won: 50 });
  eq(await kvA.get('stats'), { disputes: 99, won: 50 });
});

// ─── Summary ────────────────────────────────────────────────────────────

console.log(`\n──────── ${passed} passed · ${failed} failed ────────`);
if (failed > 0) process.exit(1);
