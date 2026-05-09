// Update text records on an already-enrolled verifier subname. Caller must
// be the wrapped owner (= the principal that originally called
// enrollVerifier).
//
// Run:   VERIFIER_HANDLE=agent-test01 pnpm --filter skill run example:update-verifier
//
// Demonstrates writing four common keys: lastDecision, policy, soul, runtime.

import { walletClient, publicClient, cfg } from './_clients.mjs';
import {
  setVerifierLastDecision,
  setVerifierPolicy,
  setVerifierSoul,
  setVerifierText,
  readVerifier,
} from '../src/lighthouse.js';

const handle = process.env.VERIFIER_HANDLE;
if (!handle) throw new Error('set VERIFIER_HANDLE (e.g. agent-test01)');

console.log('Updating verifier  :', handle);

// Latest decision after a dispute (typical post-dispute flow)
const { txHash: t1 } = await setVerifierLastDecision({
  walletClient, publicClient,
  resolver: cfg.publicResolver,
  handle,
  value: `bzz://decision-${Date.now()}`,
});
console.log('lastDecision tx    :', t1);

// Rotate policy
const { txHash: t2 } = await setVerifierPolicy({
  walletClient, publicClient,
  resolver: cfg.publicResolver,
  handle,
  value: `bzz://policy-v${Math.floor(Date.now() / 1000)}`,
});
console.log('policy tx          :', t2);

// Custom key
const { txHash: t3 } = await setVerifierText({
  walletClient, publicClient,
  resolver: cfg.publicResolver,
  handle,
  key:   'verifier.region',
  value: 'eu-west-1',
});
console.log('verifier.region tx :', t3);

console.log('');
const state = await readVerifier({
  publicClient,
  resolver: cfg.publicResolver,
  nameWrapper: cfg.nameWrapper,
  handle,
});
console.log('post-update state  :', state);
