// One-shot maintenance tool — overwrite a vessel's `vessel.swarm.log`
// ENS text record with a real BMT-pinned metadata JSON, by submitting a
// fresh bonded report through ReportRegistry and settling it truthfully.
//
// Lighthouse.recordSighting is `onlyRegistry` (LIGHTHOUSE_SPEC §3) — the
// only way to update an already-minted vessel's swarm.log is to push
// another `Submitted → liveness → settled-true` cycle for that IMO. The
// callback inside ReportRegistry calls Lighthouse.recordSighting with
// the new metadataSwarm, which overwrites the prior text record value.
//
// Usage:
//   IMO=9133701 node tools/publish-vessel-fixture.mjs
//
// Env:
//   IMO            — vessel IMO (default 9133701, PABLO)
//   GPS_LAT/GPS_LON — coordinates (defaults to Strait of Hormuz)
//   AIS_DARK        — 'true' | 'false' (default true)

import {
    createPublicClient,
    createWalletClient,
    http,
    keccak256,
    toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia }             from 'viem/chains';

import {
    submitReport,
    settleReport,
    settleAfterTimestamp,
    getReport,
    statusLabel,
} from 'skill/registry';
import { resolveAddresses } from 'skill/addresses';
import { publicResolverAbi } from 'skill/abis';
import { vesselNode } from 'skill/lighthouse';

import { pinImmutable } from './lib/swarm.mjs';

import { rpcUrl, emit, fail } from './_common.mjs';

import dotenv from 'dotenv';
import path   from 'node:path';

// Load the repo-root /.env so DEPLOYER_PRIVATE_KEY is available — that's
// the reporter wallet for fixture maintenance. Agent's wallet stays in
// the verifier role.
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

const imo     = BigInt(process.env.IMO ?? '9133701');
const gpsLat  = Number(process.env.GPS_LAT ?? 26.55);
const gpsLon  = Number(process.env.GPS_LON ?? 56.25);
const aisDark = (process.env.AIS_DARK ?? 'true') === 'true';
const country  = process.env.COUNTRY  ?? 'RU';
const cargo    = process.env.CARGO    ?? 'Crude · ~730k bbl';
const lastSeen = process.env.LASTSEEN ?? `${gpsLat},${gpsLon}`;

const reporterPk = process.env.DEPLOYER_PRIVATE_KEY;
if (!reporterPk) fail('DEPLOYER_PRIVATE_KEY not set in repo-root /.env');

const account = privateKeyToAccount(reporterPk);
const transport = http(rpcUrl());
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ chain: sepolia, transport, account });

const cf = resolveAddresses();

// 1. Pin a deterministic photo placeholder so photoHash is meaningful.
const photoBytes = new TextEncoder().encode(
    `phare-fixture-photo:imo=${imo}:lat=${gpsLat}:lon=${gpsLon}:v1`,
);
const photoHash  = keccak256(photoBytes);
const photoPin   = await pinImmutable(photoBytes);

// 2. Build + pin metadata JSON. Same shape useReportSubmit.ts emits.
const nonce = new Uint8Array(32);
crypto.getRandomValues(nonce);
const nonceHex =
    '0x' + Array.from(nonce).map((b) => b.toString(16).padStart(2, '0')).join('');

const metadata = {
    photo:     photoPin.ref,
    photoHash,
    gps:       [gpsLat, gpsLon],
    timestamp: Date.now(),
    imo:       Number(imo),
    ais_dark:  aisDark,
    nonce:     nonceHex,
    country,
    cargo,
    lastSeen,
    fixture:   true,
    notes:     'Maintenance re-publish to overwrite a stub vessel.swarm.log on imo-<n>.vessel.phare.eth.',
};
const metaPin = await pinImmutable(metadata);

// 3. Submit. Auto-wraps ETH→WETH if balance is short and approves.
let submit;
try {
    submit = await submitReport({
        walletClient, publicClient,
        registry:      cf.reportRegistry,
        imo,
        aisDark,
        photoHash,
        metadataSwarm: metaPin.ref,
        country,
        cargo,
        lastSeen,
    });
} catch (e) {
    fail(`submit reverted: ${e.shortMessage ?? e.message}`);
}

// 4. Wait liveness + 5 s buffer.
const settleAt = await settleAfterTimestamp({
    publicClient, registry: cf.reportRegistry, reportId: submit.reportId,
});
// 15 s buffer accounts for chain-time vs local-clock drift + the settle
// tx's own mining latency (`Assertion not expired` reverts have been
// seen at +5 s on Sepolia public RPCs).
const waitMs = Math.max(0, Number(settleAt) * 1000 - Date.now()) + 15_000;

emit({
    step: 'submitted',
    reportId:    submit.reportId,
    assertionId: submit.assertionId,
    txHash:      submit.txHash,
    metadataRef: metaPin.ref,
    photoRef:    photoPin.ref,
    settleAtUnix: settleAt.toString(),
    waitMs,
});
await new Promise((r) => setTimeout(r, waitMs));

// 5. Settle. Truthful resolution → Lighthouse.recordSighting → overwrites vessel.swarm.log.
let settled;
try {
    settled = await settleReport({
        walletClient, publicClient, registry: cf.reportRegistry, reportId: submit.reportId,
    });
} catch (e) {
    fail(`settle reverted: ${e.shortMessage ?? e.message}`, { reportId: submit.reportId });
}

// 6. Read back vessel.swarm.log to confirm the on-chain text record now
//    points at our just-pinned metadata bzz, not the prior stub.
const updatedSwarmLog = await publicClient.readContract({
    address: cf.publicResolver, abi: publicResolverAbi,
    functionName: 'text', args: [vesselNode(imo), 'vessel.swarm.log'],
});

const report = await getReport({ publicClient, registry: cf.reportRegistry, reportId: submit.reportId });

emit({
    ok: true,
    imo: Number(imo),
    ens: `imo-${imo}.vessel.phare.eth`,
    submit: { txHash: submit.txHash, reportId: submit.reportId, assertionId: submit.assertionId },
    settle: { txHash: settled.txHash, status: statusLabel(report.status) },
    swarm:  { metadata: metaPin.ref, photo: photoPin.ref },
    vesselSwarmLogNow: updatedSwarmLog,
    resolve: `https://sepolia.app.ens.domains/imo-${imo}.vessel.phare.eth`,
    next: `verify with: node /Users/nick/Documents/Phare-protocol/agent/tools/fetch-metadata.mjs ${updatedSwarmLog}`,
});
