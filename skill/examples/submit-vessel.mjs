// Submit a bonded vessel sighting through ReportRegistry. This:
//   - Auto-wraps ETH → WETH if balance is short
//   - Approves the registry to pull bond + UMA min bond
//   - Opens a UMA OOv3 assertion with `liveness` second window
//
// After this lands, wait `liveness` seconds (60s on Sepolia by default),
// then run `examples/settle-vessel.mjs` to settle. The truthful resolution
// callback fires Lighthouse.nameVessel (first sighting) or recordSighting
// (subsequent), which mints/updates `imo-<n>.vessel.phare.eth`.

import { walletClient, publicClient, cfg } from './_clients.mjs';
import { submitReport, getTotalBond, settleAfterTimestamp } from '../src/registry.js';
import { writeFile } from 'node:fs/promises';
import { keccak256, toHex } from 'viem';

const imo = BigInt(process.env.VESSEL_IMO ?? '9133701');
const aisDark = (process.env.AIS_DARK ?? 'true') === 'true';

// In production this would be the keccak/sha256 of the photo bytes pinned
// to Swarm. For an example we just hash a deterministic string.
const photoHash = keccak256(toHex(`example-photo-imo-${imo}`));
const metadataSwarm = process.env.METADATA_SWARM ?? `bzz://example-imo-${imo}`;

// Vessel descriptors propagated to ENS text records on settle. Reporter-
// supplied; voters arbitrate truthfulness of the metadata as a whole, not
// these fields individually.
const country  = process.env.VESSEL_COUNTRY  ?? 'RU';
const cargo    = process.env.VESSEL_CARGO    ?? 'Crude · ~730k bbl';
const lastSeen = process.env.VESSEL_LASTSEEN ?? '26.55,56.25';

const bond = await getTotalBond({ publicClient, registry: cfg.reportRegistry });
console.log('Bond breakdown     :', {
  protocolBond: bond.protocolBond.toString(),
  umaBond:      bond.umaBond.toString(),
  total:        bond.total.toString(),
});

const { txHash, reportId, assertionId } = await submitReport({
  walletClient, publicClient,
  registry: cfg.reportRegistry,
  imo,
  aisDark,
  photoHash,
  metadataSwarm,
  country,
  cargo,
  lastSeen,
});

console.log('submit tx          :', txHash);
console.log('reportId           :', reportId);
console.log('assertionId        :', assertionId);

const settleAfter = await settleAfterTimestamp({
  publicClient, registry: cfg.reportRegistry, reportId,
});
console.log('Settle after (unix):', settleAfter.toString());
console.log('Wait until then, then run example:settle');

await writeFile(new URL('./.vessel-state.json', import.meta.url), JSON.stringify({
  reportId,
  imo: imo.toString(),
  settleAfter: settleAfter.toString(),
}, null, 2));
console.log('saved              : examples/.vessel-state.json');
