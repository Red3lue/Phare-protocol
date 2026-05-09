// Phase: needs-ens → running
// Mints <handle>.verifier.phare.eth via Lighthouse.enrollVerifier with PCC
// burnt. Wraps /skill enrollVerifier.
//
// Pre-pins data/policy.json + data/soul.md to Swarm via pinImmutable so
// the subname is minted with REAL BMT-pinned refs from the start —
// no `bzz://policy-stub` placeholder phase. Caller can override with
// POLICY_URI / SOUL_URI env vars.

import fs   from 'node:fs';
import path from 'node:path';

import { enrollVerifier } from 'skill/lighthouse';

import { pinImmutable } from './lib/swarm.mjs';

import {
  PHASES,
  DATA_DIR,
  cfg,
  publicClient,
  walletClient,
  readState,
  updateState,
  emit,
  fail,
} from './_common.mjs';

const state = readState();
if (!state.handle) fail('no handle in state.json — run gen-wallet first');
if (state.phase === PHASES.RUNNING) {
  emit({ ok: true, alreadyEnrolled: true, handle: state.handle, node: state.node });
  process.exit(0);
}

const wc  = walletClient();
const pc  = publicClient();
const cf  = cfg();

// Pin identity artefacts unless caller overrode the URIs explicitly.
let policyURI = process.env.POLICY_URI;
let soulURI   = process.env.SOUL_URI;

if (!policyURI || !soulURI) {
  const policyPath = path.join(DATA_DIR, 'policy.json');
  const soulPath   = path.join(DATA_DIR, 'soul.md');
  if (!fs.existsSync(policyPath)) fail(`missing ${policyPath}`);
  if (!fs.existsSync(soulPath))   fail(`missing ${soulPath}`);

  const policyJson = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const soulText   = fs.readFileSync(soulPath, 'utf8');

  try {
    if (!policyURI) policyURI = (await pinImmutable(policyJson)).ref;
    if (!soulURI)   soulURI   = (await pinImmutable(soulText)).ref;
  } catch (e) {
    fail(`swarm pin failed during enroll: ${e.message}`);
  }
}

let result;
try {
  result = await enrollVerifier({
    walletClient: wc,
    publicClient: pc,
    lighthouse:   cf.lighthouse,
    handle:       state.handle,
    policyURI,
    soulURI,
  });
} catch (e) {
  fail(`enrollVerifier reverted: ${e.shortMessage ?? e.message}`);
}

const next = updateState((s) => ({
  ...s,
  phase: PHASES.RUNNING,
  node:  result.node,
}));

emit({
  ok: true,
  phase:  next.phase,
  handle: next.handle,
  node:   next.node,
  ens:    `${next.handle}.verifier.phare.eth`,
  txHash: result.txHash,
  policyURI,
  soulURI,
  resolve: `https://sepolia.app.ens.domains/${next.handle}.verifier.phare.eth`,
  next: 'enter heartbeat loop — `node tools/poll-uma.mjs`',
});
