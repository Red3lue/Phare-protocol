// Settle the assertion previously opened by submit-vessel.mjs. Triggers
// the registry's truthful-resolution callback, which fires
// Lighthouse.nameVessel under the hood and mints
// `imo-<n>.vessel.phare.eth`.
//
// Run:   pnpm --filter skill run example:settle
//
// If liveness hasn't expired yet, the script will tell you how long to wait.

import { walletClient, publicClient, cfg } from './_clients.mjs';
import { settleReport, getReport, statusLabel, settleAfterTimestamp } from '../src/registry.js';
import { readVessel } from '../src/lighthouse.js';
import { readFile } from 'node:fs/promises';

const state = JSON.parse(
  await readFile(new URL('./.vessel-state.json', import.meta.url), 'utf8'),
);
const reportId = state.reportId;

const settleAfter = await settleAfterTimestamp({
  publicClient, registry: cfg.reportRegistry, reportId,
});
const now = BigInt(Math.floor(Date.now() / 1000));
console.log('settleAfter (unix) :', settleAfter.toString());
console.log('now         (unix) :', now.toString());
if (now < settleAfter) {
  const waitS = settleAfter - now;
  console.log(`Liveness still open. Wait ~${waitS}s and retry.`);
  process.exit(1);
}

const before = await getReport({ publicClient, registry: cfg.reportRegistry, reportId });
console.log('status before      :', statusLabel(before.status));

const { txHash, assertionId } = await settleReport({
  walletClient, publicClient,
  registry: cfg.reportRegistry,
  reportId,
});
console.log('settle tx          :', txHash);
console.log('assertionId        :', assertionId);

const after = await getReport({ publicClient, registry: cfg.reportRegistry, reportId });
console.log('status after       :', statusLabel(after.status));

const vessel = await readVessel({
  publicClient,
  resolver: cfg.publicResolver,
  nameWrapper: cfg.nameWrapper,
  imo: after.imo,
});
console.log('');
console.log('vessel ENS state   :', vessel);
console.log('');
console.log(`Resolve: https://sepolia.app.ens.domains/${vessel.ens}`);
