// Phase: running (heartbeat tick step 6 — terminal)
// Publishes the verifier's live stats + identity refs into a Swarm-KV
// namespace owned by the agent's own EOA. Replaces the NameStone-driven
// path for verifier.stats.* (DESIGN_DOCUMENT §6.2) with an owner-signed,
// gateway-verifiable Swarm Feed-backed KV.
//
// Usage:
//   node tools/publish-stats.mjs
//
// Output (JSON one-line on stdout):
//   { ok:true, namespace, owner, keys:['stats','lastDecision','policy','soul','handle'] }
//
// Idempotent: every key is written every call (latest wins). Cheap; the
// underlying SOC writes are sub-second on bzz.limo.

import fs   from 'node:fs';
import path from 'node:path';

import { KV } from 'swarm-kv';

import {
  AGENT_ROOT,
  DECISIONS_DIR,
  WALLET_PATH,
  readState,
  emit,
  fail,
} from './_common.mjs';

function gateway() {
  const url = process.env.SWARM_BEE_URL;
  if (!url) fail('SWARM_BEE_URL not set in /agent/.env');
  return url.replace(/\/$/, '');
}

function namespaceFor(handle) {
  if (!handle) fail('state.handle missing — has the verifier been enrolled?');
  return `phare:verifier:${handle}`;
}

/** Most-recent dispute reasoning bzz ref, if any. */
function findLastDecisionRef(state) {
  const last = state.seenReports?.[state.seenReports.length - 1];
  if (!last) return null;
  const f = path.join(DECISIONS_DIR, `${last}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return j.bzz ?? null;
  } catch {
    return null;
  }
}

const wallet = (() => {
  if (!fs.existsSync(WALLET_PATH)) {
    fail('no wallet — run gen-wallet.mjs first');
  }
  return JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
})();

const state = readState();
if (state.phase !== 'running') {
  fail(`publish-stats requires phase=running, got ${state.phase}`);
}

const namespace = namespaceFor(state.handle);
const kv = new KV({
  gateway:   gateway(),
  signer:    wallet.privateKey.replace(/^0x/, ''),
  namespace,
});

const written = [];

try {
  await kv.put('stats', {
    disputes:    state.stats?.disputes    ?? 0,
    won:         state.stats?.won         ?? 0,
    lost:        state.stats?.lost        ?? 0,
    skipped:     state.stats?.skipped     ?? 0,
    lastActive:  Date.now(),
    publishedBy: state.handle,
  });
  written.push('stats');

  if (state.handle) {
    await kv.put('handle', state.handle);
    written.push('handle');
  }

  if (state.identity?.policy) {
    await kv.put('policy', state.identity.policy);
    written.push('policy');
  }
  if (state.identity?.soul) {
    await kv.put('soul', state.identity.soul);
    written.push('soul');
  }

  const lastDecRef = findLastDecisionRef(state);
  if (lastDecRef) {
    await kv.put('lastDecision', lastDecRef);
    written.push('lastDecision');
  }
} catch (e) {
  fail(`publish failed: ${e.message}`, { keysWrittenSoFar: written });
}

emit({
  ok:        true,
  namespace,
  owner:     kv.owner,
  keys:      written,
  list:      await kv.list(),
});
