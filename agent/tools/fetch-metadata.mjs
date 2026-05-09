// Phase: running (heartbeat tick step 1.5 — between poll-uma and evaluate)
// Verified Fetch read: pulls the metadata JSON pinned to Swarm at <ref>,
// recomputes the BMT root locally, and rejects gateway tampering.
//
// Usage:
//   node tools/fetch-metadata.mjs <bzz://hash>
//
// Output (success):
//   { ok:true, verified:true, bmtRoot, ref, json, rawLength }
// Output (mismatch):
//   { ok:false, error:'BMT mismatch', expected, recomputed } exit 1

import {
  verifyAndFetchJson,
  BmtMismatchError,
  GatewayFetchError,
} from './lib/swarm.mjs';

import { emit, fail } from './_common.mjs';

const [ref] = process.argv.slice(2);
if (!ref) fail('usage: fetch-metadata.mjs <bzz://hash | https-url>');

try {
  const out = await verifyAndFetchJson(ref);
  emit({
    ok:        true,
    verified:  out.verified,
    bmtRoot:   out.bmtRoot,
    ref:       out.ref,
    json:      out.json,
    rawLength: out.bytes.length,
  });
} catch (e) {
  if (e instanceof BmtMismatchError) {
    fail('BMT mismatch — gateway response does not hash to the requested reference', {
      expected:   e.expected,
      recomputed: e.recomputed,
    });
  }
  if (e instanceof GatewayFetchError) {
    fail(`gateway fetch failed: ${e.message}`, { url: e.url, status: e.status });
  }
  fail(`fetch failed: ${e.message}`);
}
