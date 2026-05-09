// Mock orbital orchestrator — one-shot.
//
// Signs an EIP-191 orbital attestation as `orbitalAttestor` (the deployer
// key) and calls ReportRegistry.attest(...). The truthful path inside
// ReportRegistry then calls Lighthouse.recordOrbital(...) which writes
// the three `vessel.orbital.*` text records on imo-<n>.vessel.phare.eth.
//
// Destination is picked deterministically from /ports.json keyed by
// `imo % ports.length` so the same report always gets the same port.
// Reads ports.json from the repo root (../../ports.json relative to
// this file).
//
// Usage:
//   REPORT_ID=0x… node tools/publish-mock-orbital.mjs
//
// Env:
//   REPORT_ID — 32-byte report id from a prior submit→settle (required)
//   FORCE     — '1' to allow re-attestation if the contract permits
//               (currently it does not — `already attested` revert)

import fs   from 'node:fs';
import path from 'node:path';

import {
    createPublicClient,
    createWalletClient,
    http,
    keccak256,
    toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia }             from 'viem/chains';

import { attestOrbital, orbitalAttestDigest, getReport } from 'skill/registry';
import { resolveAddresses }                              from 'skill/addresses';

import { pinImmutable } from './lib/swarm.mjs';

import { rpcUrl, emit, fail } from './_common.mjs';

import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env') });

const reportId = process.env.REPORT_ID;
if (!reportId || !reportId.startsWith('0x') || reportId.length !== 66) {
    fail('REPORT_ID env required (32-byte hex, 0x-prefixed)');
}

const attestorPk = process.env.DEPLOYER_PRIVATE_KEY;
if (!attestorPk) fail('DEPLOYER_PRIVATE_KEY missing — orbitalAttestor signs with this key');

const account = privateKeyToAccount(attestorPk);
const transport = http(rpcUrl());
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ chain: sepolia, transport, account });

const cf = resolveAddresses();

// 1. Look up the report for context (we need the IMO).
const report = await getReport({ publicClient, registry: cf.reportRegistry, reportId });
if (!report.reporter || report.reporter === '0x0000000000000000000000000000000000000000') {
    fail(`unknown report ${reportId}`);
}
if (Number(report.status) !== 2) {
    fail(`report ${reportId} not settled-true (status=${report.status})`);
}
if (report.orbitalAttested) {
    fail('already attested — contract rejects re-attestation');
}

const imo = Number(report.imo);

// 2. Load /ports.json from repo root and pick a deterministic port.
const portsPath = path.resolve(import.meta.dirname, '../../ports.json');
const portsDoc  = JSON.parse(fs.readFileSync(portsPath, 'utf8'));
const ports     = portsDoc.ports;
const port      = ports[imo % ports.length];

// 3. Build mock satellite imagery bytes + pin.
const imageBytes = new TextEncoder().encode(
    `phare-orbital-imagery:imo=${imo}:report=${reportId}:t=${Date.now()}`,
);
const imageHash = keccak256(imageBytes);     // independent on-chain anchor
const imagePin  = await pinImmutable(imageBytes);

// 4. Build TEE prediction JSON + pin. mocked:true per DESIGN_DOCUMENT §7.2.
const prediction = {
    destination: {
        name:               port.name,
        country:            port.country,
        lat:                port.lat,
        lon:                port.lon,
        shadow_fleet_known: port.shadow_fleet_known,
    },
    confidence: 0.62 + (imo % 33) / 100,        // deterministic 0.62…0.94
    routeCandidates: [port.name],
    inputs: { imo, reportId },
    mocked: true,
    note:   'Rule-based stub per DESIGN_DOCUMENT §7.2 — real spaceTEE not yet shipped by SpaceComputer.',
    timestamp: new Date().toISOString(),
};
const predPin = await pinImmutable(prediction);

// 5. Compute digest + sign EIP-191. orbitalAttestDigest from /skill returns
//    the inner keccak256; viem's signMessage adds the EIP-191 prefix.
const digest = orbitalAttestDigest({
    reportId,
    imageHash,
    teePrediction: predPin.ref,
});
const signature = await walletClient.signMessage({
    message: { raw: digest },
});

// 6. Call attest. ReportRegistry verifies signer==orbitalAttestor, then
//    calls Lighthouse.recordOrbital → writes vessel.orbital.* text records.
let res;
try {
    res = await attestOrbital({
        walletClient, publicClient,
        registry:      cf.reportRegistry,
        reportId,
        imageSwarm:    imagePin.ref,
        imageHash,
        teePrediction: predPin.ref,
        signature,
    });
} catch (e) {
    fail(`attest reverted: ${e.shortMessage ?? e.message}`, { reportId });
}

emit({
    ok: true,
    imo,
    reportId,
    txHash:    res.txHash,
    port:      { name: port.name, country: port.country, lat: port.lat, lon: port.lon },
    image:     { ref: imagePin.ref, hash: imageHash },
    teePred:   { ref: predPin.ref, json: prediction },
    resolve:   `https://sepolia.app.ens.domains/imo-${imo}.vessel.phare.eth`,
    next:      `verify with: node /Users/nick/Documents/Phare-protocol/agent/tools/fetch-metadata.mjs ${predPin.ref}`,
});
