// Single-shot orchestration:
//   1. orbitalImager-sdk → fetch fixture image, save under images/<imo>/
//   2. inference         → mocked port-based destination
//   3. swarm.mjs         → empty (TODO); fall back to bzz://<keccak256>
//   4. ens.mjs           → snapshot vessel + verifier records, rebuild
//                          ENS_VESSELS.md and ENS_VERIFIERS.md
//   5. onchain.mjs       → if .env present: enroll once, then write
//                          verifier.lastDecision live on Sepolia

import { resolve } from 'node:path';
import { fetchImageryToFile } from 'orbitalImager-sdk';

import { paths } from './paths.mjs';
import { inferDestination } from './inference.mjs';
import { uploadToSwarm } from './swarm.mjs';
import { loadState, saveState } from './state.mjs';
import {
  buildVesselRecord, buildVerifierActivity,
  renderVesselsLedger, renderVerifiersLedger,
} from './ens.mjs';
import {
  isOnChainAvailable, ensureEnrolled, writeVerifierLastDecision,
  orchestratorHandle,
} from './onchain.mjs';

const FALLBACK_HANDLE = 'agent-orchestrator';

export async function runPipeline({ imo, lat, lon, verifierHandle } = {}) {
  if (!imo) throw new Error('imo required');

  const ts = Date.now();
  const outPath = resolve(paths.imagesDir, String(imo), `${ts}.webp`);

  console.log(`[pipeline] imo=${imo} fetching imagery…`);
  const imagery = await fetchImageryToFile({
    outPath,
    request: { imo: Number(imo), lat: lat ?? 0, lon: lon ?? 0 },
  });

  console.log(`[pipeline] imo=${imo} running inference…`);
  const inference = inferDestination({ imo, lat, lon });

  console.log(`[pipeline] imo=${imo} uploading to swarm (mock)…`);
  const swarm = await uploadToSwarm({ bytes: imagery.bytes, hint: `imo-${imo}` });

  const imageHashHex = imagery.imageHash?.toString('hex') ?? '';
  const avatarRef = swarm.swarmRef ?? `bzz://${imageHashHex}`;

  // ── On-chain (best effort) ────────────────────────────────────────────
  let onchain = {
    enabled: false, reason: null, handle: null,
    enrollmentTx: null, lastDecisionTx: null, error: null,
  };
  let effectiveHandle = verifierHandle ?? FALLBACK_HANDLE;

  if (isOnChainAvailable()) {
    try {
      const enrollment = await ensureEnrolled();
      effectiveHandle = enrollment.handle;
      onchain.enabled = true;
      onchain.handle  = enrollment.handle;
      if (!enrollment.alreadyEnrolled) {
        onchain.enrollmentTx = enrollment.txHash;
        console.log(`[pipeline] on-chain enrolled ${enrollment.handle} → tx ${enrollment.txHash}`);
      } else {
        console.log(`[pipeline] on-chain already enrolled as ${enrollment.handle}`);
      }
    } catch (err) {
      onchain.reason = `enroll failed: ${err.message}`;
      onchain.error  = err.message;
      console.warn(`[pipeline] on-chain enrollment failed — continuing with mock only: ${err.message}`);
    }
  } else {
    onchain.reason = 'DEPLOYER_PRIVATE_KEY or SEPOLIA_RPC_URL missing';
  }

  // ── ENS ledger snapshot (.md mirror) ──────────────────────────────────
  console.log(`[pipeline] imo=${imo} updating ENS ledgers…`);
  const state = await loadState();

  const vessel = buildVesselRecord({
    imo, timestamp: ts,
    imageLocalPath: imagery.outPath,
    imageMime:      imagery.mimeType,
    imageHashHex, avatarRef, inference,
  });
  state.vessels[String(imo)] = vessel;

  const verifier = buildVerifierActivity({
    handle: effectiveHandle,
    imo, timestamp: ts,
    decision: inference,
  });
  state.verifiers[effectiveHandle] = verifier;

  await saveState(state);
  await renderVesselsLedger(state);
  await renderVerifiersLedger(state);

  // ── Verifier on-chain write (best effort) ─────────────────────────────
  if (onchain.enabled) {
    try {
      const value = `${inference.destination} (conf ${inference.confidence}, imo ${imo}, ts ${ts}, mocked)`;
      const r = await writeVerifierLastDecision(value);
      onchain.lastDecisionTx = r.txHash;
      console.log(`[pipeline] verifier.lastDecision tx ${r.txHash}`);
    } catch (err) {
      onchain.error = onchain.error
        ? `${onchain.error}; lastDecision: ${err.message}`
        : `lastDecision failed: ${err.message}`;
      console.warn(`[pipeline] on-chain lastDecision write failed: ${err.message}`);
    }

    // Avatar is intentionally NOT written on the verifier — the vessel is
    // the surface that should show the orbital image. Wiring the vessel
    // avatar requires a Lighthouse change (see ORBITALIMAGER_SPEC roadmap).
  }

  return {
    imo: String(imo),
    timestamp: ts,
    imagery: {
      bytes: imagery.bytes.length,
      mime:  imagery.mimeType,
      hash:  `0x${imageHashHex}`,
      file:  imagery.outPath,
    },
    inference,
    swarm,
    ens: {
      vessel:   vessel.subname,
      verifier: verifier.subname,
      avatar:   avatarRef,
    },
    onchain,
  };
}
