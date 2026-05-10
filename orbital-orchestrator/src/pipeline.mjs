// Single-shot orchestration:
//   1. orbitalImager-sdk → resumably fetch every packet of a fragmented
//      image (v0.1.0 SDK), recompose into images/<imo>/<ts>.png
//   2. inference         → mocked port-based destination
//   3. swarm.mjs         → empty (TODO); fall back to bzz://<keccak256>
//   4. ens.mjs           → snapshot vessel + verifier records, rebuild
//                          ENS_VESSELS.md and ENS_VERIFIERS.md
//   5. onchain.mjs       → if .env present: enroll once, then write
//                          verifier.lastDecision live on Sepolia

import { Buffer }   from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { resolve }  from 'node:path';
import {
  downloadImage, listImages,
} from 'orbitalImager-sdk';

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

// Image to fetch when nothing more specific is supplied. The plugin only
// fragments the configured fixture today, so picking the first available
// id is good enough — once the plugin learns to route by (lat, lon) we
// pass those through here instead.
const IMAGE_ID_OVERRIDE = process.env.ORBITAL_IMAGER_IMAGE_ID;

async function pickImageId({ gateway, bearer }) {
  if (IMAGE_ID_OVERRIDE) return IMAGE_ID_OVERRIDE;
  const { imageIds } = await listImages({ gateway, bearer });
  if (imageIds.length === 0) {
    throw new Error(
      'orbitalimager has no fragmented images on disk — point ' +
      'ORBITPORT_ORBITALIMAGER_FIXTURE_PATH at a PNG/JPEG and restart ' +
      'the plugin');
  }
  return imageIds[0];
}

export async function runPipeline({ imo, lat, lon, verifierHandle, imageId } = {}) {
  if (!imo) throw new Error('imo required');

  const ts = Date.now();
  const gateway = process.env.ORBITPORT_GATEWAY_URL;
  const bearer  = process.env.ORBITPORT_BEARER;
  const sdkOpts = { gateway, bearer };

  const chosenImageId = imageId ?? await pickImageId(sdkOpts);
  const outPath       = resolve(paths.imagesDir, String(imo), `${ts}.png`);
  const sessionDir    = resolve(paths.packageDir, 'state', 'sessions');

  console.log(`[pipeline] imo=${imo} image_id=${chosenImageId} fetching packets…`);
  const { state } = await downloadImage({
    imageId:    chosenImageId,
    outPath,
    sessionDir,
    onProgress: (e) => {
      if (e.phase === 'start' && e.current > 0 && e.current < e.total) {
        console.log(`[pipeline]   resume: ${e.current}/${e.total} already on disk`);
      } else if (e.phase === 'packet') {
        console.log(`[pipeline]   packet ${e.packetIndex}  ${e.current}/${e.total}`);
      } else if (e.phase === 'recompose') {
        console.log(`[pipeline]   recomposing…`);
      }
    },
    ...sdkOpts,
  });

  // Recomposed PNG is on disk; load it back so swarm + ledger keep using
  // the same { bytes, mimeType, hash } surface the rest of the pipeline
  // already understands.
  const imageBytes = await readFile(outPath);
  const fullHashB64 = state.fullImageHash ?? '';
  // Note: `imageHashHex` is the keccak256 of the ORIGINAL fixture bytes
  // (computed server-side at fragment time). It will NOT match
  // keccak256(imageBytes) because PNG re-encoding is not byte-stable.
  // We keep using the server hash so it stays bound to the eventual
  // attest() digest (orbital_attestor on-chain).
  const imageHashHex = Buffer.from(fullHashB64, 'base64').toString('hex');

  console.log(`[pipeline] imo=${imo} running inference…`);
  const inference = inferDestination({ imo, lat, lon });

  console.log(`[pipeline] imo=${imo} uploading to swarm (mock)…`);
  const swarm = await uploadToSwarm({ bytes: imageBytes, hint: `imo-${imo}` });

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
  const ledgerState = await loadState();

  const vessel = buildVesselRecord({
    imo, timestamp: ts,
    imageLocalPath: outPath,
    imageMime:      'image/png',
    imageHashHex, avatarRef, inference,
  });
  ledgerState.vessels[String(imo)] = vessel;

  const verifier = buildVerifierActivity({
    handle: effectiveHandle,
    imo, timestamp: ts,
    decision: inference,
  });
  ledgerState.verifiers[effectiveHandle] = verifier;

  await saveState(ledgerState);
  await renderVesselsLedger(ledgerState);
  await renderVerifiersLedger(ledgerState);

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
      bytes:      imageBytes.length,
      mime:       'image/png',
      hash:       `0x${imageHashHex}`,
      file:       outPath,
      imageId:    chosenImageId,
      shipName:   state.shipName,
      packets:    state.packetCount,
      width:      state.imageWidth,
      height:     state.imageHeight,
      sessionDir: resolve(sessionDir, chosenImageId),
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
