// Phase: running (one-shot)
// Pins data/policy.json + data/soul.md to Swarm via pinImmutable, then
// updates the verifier's two ENS text records via /skill helpers:
//   verifier.policy → bzz://<policyRoot>
//   verifier.soul   → bzz://<soulRoot>
//
// Replaces the bzz://policy-stub / bzz://soul-stub placeholders that
// enroll.mjs writes at first-mint time (when the swarm tool was still
// deferred). Idempotent — re-running just re-pins and re-writes.
//
// Usage:
//   node tools/publish-identity.mjs

import fs   from 'node:fs';
import path from 'node:path';

import { setVerifierPolicy, setVerifierSoul } from 'skill/lighthouse';

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
if (state.phase !== PHASES.RUNNING) fail(`phase is ${state.phase}; enroll first`);
if (!state.handle) fail('no handle in state.json');

const policyPath = path.join(DATA_DIR, 'policy.json');
const soulPath   = path.join(DATA_DIR, 'soul.md');
if (!fs.existsSync(policyPath)) fail(`missing ${policyPath}`);
if (!fs.existsSync(soulPath))   fail(`missing ${soulPath}`);

const policyJson = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const soulText   = fs.readFileSync(soulPath, 'utf8');

let policyPin, soulPin;
try {
    [policyPin, soulPin] = await Promise.all([
        pinImmutable(policyJson),
        pinImmutable(soulText),
    ]);
} catch (e) {
    fail(`swarm pin failed: ${e.message}`);
}

const wc = walletClient();
const pc = publicClient();
const cf = cfg();

// Serial, not parallel: both setText calls go from the same EOA, so
// firing them concurrently makes viem reuse the same nonce → revert.
let policyTx, soulTx;
try {
    policyTx = await setVerifierPolicy({
        walletClient: wc, publicClient: pc,
        resolver: cf.publicResolver,
        handle:   state.handle,
        value:    policyPin.ref,
    });
    soulTx = await setVerifierSoul({
        walletClient: wc, publicClient: pc,
        resolver: cf.publicResolver,
        handle:   state.handle,
        value:    soulPin.ref,
    });
} catch (e) {
    fail(`setText reverted: ${e.shortMessage ?? e.message}`);
}

updateState((s) => ({
    ...s,
    identity: {
        policy: policyPin.ref,
        soul:   soulPin.ref,
        publishedAt: new Date().toISOString(),
    },
}));

emit({
    ok: true,
    handle: state.handle,
    ens:    `${state.handle}.verifier.phare.eth`,
    policy: { ref: policyPin.ref, txHash: policyTx.txHash },
    soul:   { ref: soulPin.ref,   txHash: soulTx.txHash   },
    resolve: `https://sepolia.app.ens.domains/${state.handle}.verifier.phare.eth`,
    next: `verify with: node /Users/nick/Documents/Phare-protocol/agent/tools/fetch-metadata.mjs ${policyPin.ref}`,
});
