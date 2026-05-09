// Enroll a new verifier: mints <handle>.verifier.phare.eth to walletClient.account
// with PCC burnt, populates verifier.policy / soul / runtime text records.
//
// Run:    pnpm --filter skill run example:enroll
// Override:  VERIFIER_HANDLE=agent-foo POLICY_URI=bzz://... SOUL_URI=bzz://... pnpm ...

import { walletClient, publicClient, cfg } from './_clients.mjs';
import { enrollVerifier, readVerifier } from '../src/lighthouse.js';

const handle    = process.env.VERIFIER_HANDLE ?? `agent-${Date.now().toString(36)}`;
const policyURI = process.env.POLICY_URI      ?? 'bzz://policy-example';
const soulURI   = process.env.SOUL_URI        ?? 'bzz://soul-example';

console.log('Enrolling verifier :', handle);

const { txHash, node, enrolled } = await enrollVerifier({
  walletClient, publicClient,
  lighthouse: cfg.lighthouse,
  handle, policyURI, soulURI,
});

console.log('tx hash            :', txHash);
console.log('node               :', node);
console.log('event              :', enrolled);
console.log('');

const state = await readVerifier({
  publicClient,
  resolver: cfg.publicResolver,
  nameWrapper: cfg.nameWrapper,
  handle,
});
console.log('post-mint state    :', state);
console.log('');
console.log(`Resolve: https://sepolia.app.ens.domains/${state.ens}`);
