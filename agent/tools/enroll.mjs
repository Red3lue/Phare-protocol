// Phase: needs-ens → running
// Mints <handle>.verifier.phare.eth via Lighthouse.enrollVerifier with PCC
// burnt. Wraps /skill enrollVerifier.
//
// policyURI / soulURI are placeholders (`bzz://policy-stub`,
// `bzz://soul-stub`) until the swarm tool ships. The verifier owns the
// node (PCC burnt) and can rewrite these later via PublicResolver.setText
// — the skill's set-last-decision tool already proves that path.

import { enrollVerifier } from 'skill/lighthouse';

import {
  PHASES,
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

const policyURI = process.env.POLICY_URI ?? 'bzz://policy-stub';
const soulURI   = process.env.SOUL_URI   ?? 'bzz://soul-stub';

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
