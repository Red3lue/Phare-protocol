// Phase: running (heartbeat tick step 3, only if verdict=fake)
// Posts a counter-bond on UMA OOv3 to dispute the assertion behind a
// pending report. Wraps /skill disputeReport.
//
// Side-effects:
//   - Writes a reasoning JSON to state/decisions/<reportId>.json (the
//     payload that swarm.fetch-metadata will later pin and replace with
//     a real `bzz://` ref via set-last-decision).
//   - Marks the reportId as seen and increments stats.disputes.
//
// Usage:
//   node tools/dispute.mjs <reportId> "<reasoningText>"

import fs   from 'node:fs';
import path from 'node:path';

import { disputeReport } from 'skill/registry';

import {
  PHASES,
  cfg,
  publicClient,
  walletClient,
  readState,
  updateState,
  DECISIONS_DIR,
  emit,
  fail,
} from './_common.mjs';

const [reportId, reasoningText] = process.argv.slice(2);
if (!reportId) fail('usage: dispute.mjs <reportId> "<reasoningText>"');

const state = readState();
if (state.phase !== PHASES.RUNNING) fail(`phase is ${state.phase}; cannot dispute`);

const wc = walletClient();
const pc = publicClient();
const cf = cfg();

let res;
try {
  res = await disputeReport({
    walletClient: wc, publicClient: pc, registry: cf.reportRegistry, reportId,
  });
} catch (e) {
  fail(`disputeAssertion reverted: ${e.shortMessage ?? e.message}`, { reportId });
}

// Persist reasoning JSON locally — the swarm tool (deferred) will pin
// this to Swarm and rewrite the ENS pointer with the real bzz hash.
fs.mkdirSync(DECISIONS_DIR, { recursive: true });
const decisionPath = path.join(DECISIONS_DIR, `${reportId}.json`);
const decision = {
  reportId,
  assertionId: res.assertionId,
  verifier:    state.handle,
  txHash:      res.txHash,
  reasoning:   reasoningText ?? '',
  decidedAt:   new Date().toISOString(),
};
fs.writeFileSync(decisionPath, JSON.stringify(decision, null, 2));

const next = updateState((s) => ({
  ...s,
  seenReports: [...new Set([...s.seenReports, reportId])],
  stats: { ...s.stats, disputes: s.stats.disputes + 1 },
}));

emit({
  ok: true,
  reportId,
  assertionId: res.assertionId,
  txHash:      res.txHash,
  decisionFile: decisionPath,
  // Until the swarm tool is wired, we hand back a stub bzz ref. The
  // set-last-decision tool will write this onto verifier.lastDecision.
  bzzStub:     `bzz://stub-${reportId.slice(2, 14)}`,
  stats:       next.stats,
  next: 'run `node tools/set-last-decision.mjs <reportId>` to update verifier.lastDecision',
});
