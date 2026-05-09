// Phase: running (heartbeat tick step 2)
// Consults the local ASI fixture + shadow-vessel registry, returns a
// verdict for a given report. Pure local lookup — no chain reads, no
// network. Caller decides whether to dispute based on the verdict.
//
// Usage:
//   node tools/evaluate.mjs <reportId> <imo>
//
// Per NICK_SPEC §7.5 the ASI verdict is keyed on IMO with a default
// fallback. The shadow-vessels registry is informational only.

import fs   from 'node:fs';
import path from 'node:path';

import { DATA_DIR, emit, fail } from './_common.mjs';

const [reportId, imo] = process.argv.slice(2);
if (!reportId || !imo) {
  fail('usage: evaluate.mjs <reportId> <imo>', { argv: process.argv.slice(2) });
}

const asi    = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'asi-fixtures.json'),    'utf8'));
const shadow = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'shadow-vessels.json'), 'utf8'));

const verdict = asi.verdicts[imo] ?? asi.default;
const known   = shadow.vessels.find((v) => String(v.imo) === String(imo)) ?? null;

emit({
  ok: true,
  reportId,
  imo,
  verdict: {
    decision:    verdict.verdict,           // "fake" | "ok"
    confidence:  verdict.confidence,
    reasoning:   verdict.reasoning,
    source:      asi.verdicts[imo] ? 'fixture' : 'default',
  },
  shadowVessel: known,
  shouldDispute: verdict.verdict === 'fake',
  next: verdict.verdict === 'fake'
    ? 'run `node tools/dispute.mjs <reportId>`'
    : 'skip — record locally as `ok` and move on',
});
