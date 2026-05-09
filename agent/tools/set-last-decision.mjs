// Phase: running (heartbeat tick step 4)
// Writes verifier.lastDecision text record on the agent's ENS subname,
// pointing at the reasoning JSON for a given reportId. Wraps /skill
// setVerifierLastDecision.
//
// Until the swarm tool ships, the value is a stub `bzz://stub-<id>`
// derived from the reportId. Swap to the real BMT hash once swarm is
// wired — the same call flow handles it.
//
// Usage:
//   node tools/set-last-decision.mjs <reportId> [bzzRef]

import { setVerifierLastDecision } from 'skill/lighthouse';

import {
  PHASES,
  cfg,
  publicClient,
  walletClient,
  readState,
  emit,
  fail,
} from './_common.mjs';

const [reportId, bzzArg] = process.argv.slice(2);
if (!reportId) fail('usage: set-last-decision.mjs <reportId> [bzzRef]');

const state = readState();
if (state.phase !== PHASES.RUNNING) fail(`phase is ${state.phase}; enroll first`);
if (!state.handle) fail('no handle — re-run gen-wallet then enroll');

const value = bzzArg ?? `bzz://stub-${reportId.slice(2, 14)}`;

const wc = walletClient();
const pc = publicClient();
const cf = cfg();

let res;
try {
  res = await setVerifierLastDecision({
    walletClient: wc, publicClient: pc,
    resolver: cf.publicResolver,
    handle:   state.handle,
    value,
  });
} catch (e) {
  fail(`setText reverted: ${e.shortMessage ?? e.message}`, { reportId });
}

emit({
  ok: true,
  reportId,
  handle: state.handle,
  ens:    `${state.handle}.verifier.phare.eth`,
  key:    'verifier.lastDecision',
  value,
  txHash: res.txHash,
  resolve: `https://sepolia.app.ens.domains/${state.handle}.verifier.phare.eth`,
});
