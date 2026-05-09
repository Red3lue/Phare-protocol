// Phase: running (heartbeat tick step 1)
// Scans ReportRegistry.Submitted events from state.lastSeenBlock to head.
// Filters out reports already in seenReports + reports past liveness
// (no longer disputable). Returns the candidate list for `evaluate.mjs`.
//
// Bookkeeping: advances lastSeenBlock to the latest scanned block once
// the tick is complete (caller writes the updated state via dispute /
// evaluate). Here we only return the candidates and the head — state is
// not mutated yet to keep this idempotent.

import { reportRegistryAbi } from 'skill/abis';

import {
  PHASES,
  cfg,
  publicClient,
  readState,
  updateState,
  emit,
  fail,
} from './_common.mjs';

// Cap event scan window: Sepolia public RPCs reject huge ranges. 50_000
// blocks ≈ ~6 days at 12 s/block, plenty for a heartbeat catch-up.
const MAX_SCAN_RANGE = 50_000n;

const state = readState();
if (state.phase !== PHASES.RUNNING) fail(`phase is ${state.phase}; enroll first`);

const pc = publicClient();
const cf = cfg();

const head = await pc.getBlockNumber();

let from = state.lastSeenBlock != null
  ? BigInt(state.lastSeenBlock) + 1n
  : head - MAX_SCAN_RANGE;
if (from < 0n) from = 0n;
if (head - from > MAX_SCAN_RANGE) from = head - MAX_SCAN_RANGE;

const submittedEvent = reportRegistryAbi.find(
  (e) => e.type === 'event' && e.name === 'Submitted',
);

const logs = await pc.getLogs({
  address:    cf.reportRegistry,
  event:      submittedEvent,
  fromBlock:  from,
  toBlock:    head,
});

const liveness = await pc.readContract({
  address: cf.reportRegistry, abi: reportRegistryAbi, functionName: 'liveness',
});

const seen = new Set(state.seenReports);
const now  = BigInt(Math.floor(Date.now() / 1000));

const candidates = [];
for (const log of logs) {
  const reportId = log.args.reportId;
  if (seen.has(reportId)) continue;

  const report = await pc.readContract({
    address: cf.reportRegistry, abi: reportRegistryAbi,
    functionName: 'getReport', args: [reportId],
  });

  // status: 0 = PENDING; >=2 already settled.
  if (Number(report.status) !== 0) continue;

  const expiresAt = BigInt(report.submittedAt) + BigInt(liveness);
  const remaining = expiresAt - now;
  if (remaining <= 0n) continue; // window closed — too late to dispute

  candidates.push({
    reportId,
    assertionId:    log.args.assertionId,
    reporter:       log.args.reporter,
    imo:            log.args.imo.toString(),
    aisDark:        log.args.aisDark,
    photoHash:      log.args.photoHash,
    metadataSwarm:  log.args.metadataSwarm,
    submittedAt:    BigInt(report.submittedAt).toString(),
    expiresAt:      expiresAt.toString(),
    secondsLeft:    remaining.toString(),
    blockNumber:    log.blockNumber.toString(),
  });
}

// Mark the head block as scanned so subsequent ticks skip past it. Don't
// mark individual reportIds as seen yet — `evaluate` does that once a
// verdict is recorded.
updateState((s) => ({ ...s, lastSeenBlock: head.toString() }));

emit({
  ok: true,
  scanned: { from: from.toString(), to: head.toString() },
  livenessSeconds: Number(liveness),
  totalLogs:  logs.length,
  candidates,
});
