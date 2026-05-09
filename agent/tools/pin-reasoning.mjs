// Phase: running (heartbeat tick step 4 — between dispute and set-last-decision)
// Pins state/decisions/<reportId>.json to Swarm via bee.uploadData with
// the NULL_STAMP postage batch, returns the resulting bzz:// reference,
// and updates the local file with the bzz so re-runs are idempotent.
//
// Usage:
//   node tools/pin-reasoning.mjs <reportId>
//
// Output:
//   { ok:true, reportId, ref, bmtRoot, decisionFile }

import fs   from 'node:fs';
import path from 'node:path';

import { pinImmutable } from './lib/swarm.mjs';

import { DECISIONS_DIR, emit, fail } from './_common.mjs';

const [reportId] = process.argv.slice(2);
if (!reportId) fail('usage: pin-reasoning.mjs <reportId>');

const decisionFile = path.join(DECISIONS_DIR, `${reportId}.json`);
if (!fs.existsSync(decisionFile)) {
  fail(`no decision file for ${reportId} — run dispute.mjs first`, { decisionFile });
}

const decision = JSON.parse(fs.readFileSync(decisionFile, 'utf8'));

let pinned;
try {
  pinned = await pinImmutable(decision);
} catch (e) {
  fail(`pin failed: ${e.message}`, { reportId });
}

// Idempotency: stash the bzz on the local file so subsequent runs can
// short-circuit (or human reviewers can correlate file ↔ bzz quickly).
decision.bzz     = pinned.ref;
decision.bmtRoot = pinned.bmtRoot;
decision.pinnedAt = decision.pinnedAt ?? new Date().toISOString();
fs.writeFileSync(decisionFile, JSON.stringify(decision, null, 2));

emit({
  ok:           true,
  reportId,
  ref:          pinned.ref,
  bmtRoot:      pinned.bmtRoot,
  decisionFile,
  next: `run \`node /Users/nick/Documents/Phare-protocol/agent/tools/set-last-decision.mjs ${reportId} ${pinned.ref}\``,
});
