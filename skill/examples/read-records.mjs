// Read both a vessel and a verifier subname's full state. No txs.
//
// Run:   VERIFIER_HANDLE=agent-test01 VESSEL_IMO=9133701 pnpm --filter skill run example:read

import { publicClient, cfg } from './_clients.mjs';
import { readVerifier, readVessel } from '../src/lighthouse.js';

const handle = process.env.VERIFIER_HANDLE ?? 'agent-test01';
const imo    = BigInt(process.env.VESSEL_IMO ?? '9133701');

const [verifier, vessel] = await Promise.all([
  readVerifier({
    publicClient,
    resolver: cfg.publicResolver,
    nameWrapper: cfg.nameWrapper,
    handle,
  }),
  readVessel({
    publicClient,
    resolver: cfg.publicResolver,
    nameWrapper: cfg.nameWrapper,
    imo,
  }),
]);

console.log('Verifier           :', verifier);
console.log('');
console.log('Vessel             :', vessel);
