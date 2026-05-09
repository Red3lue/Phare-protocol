// Lighthouse + ENS-side helpers for the Phare verifier agent.
//
// Auth model recap:
//   - enrollVerifier      — permissionless. Anyone can call. Mints
//                           <handle>.verifier.phare.eth, owned by msg.sender,
//                           PCC burnt.
//   - updateVerifierRecord — direct PublicResolver.setText, signed by the
//                            wrapped owner of the verifier node (the
//                            principal). Lighthouse not in the path.
//   - nameVessel / recordSighting / recordOrbital — onlyRegistry. Only the
//     ReportRegistry contract can call these. The agent CANNOT call them
//     directly. Vessels are created/updated via the UMA settlement flow
//     (see registry.js: submitReport + settleAssertion).
//
// All functions accept a viem WalletClient (for txs) or PublicClient (for
// reads). Pass them in explicitly so this module stays transport-agnostic.

import {
  namehash,
  keccak256,
  encodePacked,
  toBytes,
  parseEventLogs,
} from 'viem';

import {
  lighthouseAbi,
  publicResolverAbi,
  nameWrapperAbi,
} from './abis.js';

import { PHARE_NAMES } from './addresses.js';

// ─── Node helpers ────────────────────────────────────────────────────────

/** Return the namehash of `<label>.<parentName>` without round-tripping
 *  through the resolver. parentName like "verifier.phare.eth". */
export function subnodeOf(label, parentName) {
  const parentNode = namehash(parentName);
  const labelHash = keccak256(toBytes(label));
  return keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, labelHash]));
}

/** ENS node for a verifier handle. */
export function verifierNode(handle) {
  return subnodeOf(handle, PHARE_NAMES.verifierParent);
}

/** ENS node for a vessel IMO. */
export function vesselNode(imo) {
  return subnodeOf(`imo-${imo}`, PHARE_NAMES.vesselParent);
}

// ─── Verifier: create (permissionless) ──────────────────────────────────

/**
 * Mint <handle>.verifier.phare.eth to wallet.account, with PCC burnt and
 * three text records (verifier.policy, verifier.soul, verifier.runtime)
 * pre-populated.
 *
 * Returns the txHash, the bytes32 node, and the parsed VerifierEnrolled
 * event payload from the receipt.
 */
export async function enrollVerifier({
  walletClient,
  publicClient,
  lighthouse,
  handle,
  policyURI,
  soulURI,
}) {
  const hash = await walletClient.writeContract({
    address: lighthouse,
    abi: lighthouseAbi,
    functionName: 'enrollVerifier',
    args: [handle, policyURI, soulURI],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const events = parseEventLogs({
    abi: lighthouseAbi,
    eventName: 'VerifierEnrolled',
    logs: receipt.logs,
  });

  return {
    txHash: hash,
    node: verifierNode(handle),
    receipt,
    enrolled: events[0]?.args ?? null,
  };
}

// ─── Verifier: update (direct, principal-signed) ────────────────────────

/**
 * Write a single text record on the verifier subname. Caller must be the
 * wrapped owner (the principal). PCC is burnt on the child but that does
 * NOT block owner-driven setText; it only prevents the parent owner from
 * interfering.
 *
 * Returns the txHash.
 */
export async function setVerifierText({
  walletClient,
  publicClient,
  resolver,
  handle,
  key,
  value,
}) {
  const node = verifierNode(handle);
  const hash = await walletClient.writeContract({
    address: resolver,
    abi: publicResolverAbi,
    functionName: 'setText',
    args: [node, key, value],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, node };
}

/** Convenience: write `verifier.lastDecision` (the post-dispute reasoning ref). */
export const setVerifierLastDecision = (opts) =>
  setVerifierText({ ...opts, key: 'verifier.lastDecision' });

/** Convenience: rotate `verifier.policy` (the agent's policy markdown ref). */
export const setVerifierPolicy = (opts) =>
  setVerifierText({ ...opts, key: 'verifier.policy' });

/** Convenience: rotate `verifier.soul`. */
export const setVerifierSoul = (opts) =>
  setVerifierText({ ...opts, key: 'verifier.soul' });

// ─── Verifier: read ─────────────────────────────────────────────────────

/** Returns the four canonical verifier text records + ownership + fuses. */
export async function readVerifier({ publicClient, resolver, nameWrapper, handle }) {
  const node = verifierNode(handle);

  const [policy, soul, runtime, lastDecision, owner, data] = await Promise.all([
    publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'verifier.policy'] }),
    publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'verifier.soul'] }),
    publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'verifier.runtime'] }),
    publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'verifier.lastDecision'] }),
    publicClient.readContract({ address: nameWrapper, abi: nameWrapperAbi, functionName: 'ownerOf', args: [BigInt(node)] }),
    publicClient.readContract({ address: nameWrapper, abi: nameWrapperAbi, functionName: 'getData', args: [BigInt(node)] }),
  ]);

  return {
    handle,
    ens:  `${handle}.verifier.phare.eth`,
    node,
    owner,
    fuses:        data[1],
    expiry:       data[2],
    policy,
    soul,
    runtime,
    lastDecision,
  };
}

// ─── Vessel: create + update (registry-only — usually NOT called by agent) ──

/**
 * Direct call to Lighthouse.nameVessel. Will revert with NotRegistry()
 * unless wallet.account == lighthouse.reportRegistry().
 *
 * For the standard end-user flow, use registry.submitReport + registry.settle
 * instead — that goes through UMA and Lighthouse mints under the hood.
 */
export async function nameVessel({
  walletClient,
  publicClient,
  lighthouse,
  imo,
  swarmRef,
}) {
  const hash = await walletClient.writeContract({
    address: lighthouse,
    abi: lighthouseAbi,
    functionName: 'nameVessel',
    args: [BigInt(imo), swarmRef],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, node: vesselNode(imo) };
}

/** Direct call to Lighthouse.recordSighting. Registry-only. */
export async function recordSighting({
  walletClient,
  publicClient,
  lighthouse,
  imo,
  swarmRef,
  sightings,
  disputed,
}) {
  const hash = await walletClient.writeContract({
    address: lighthouse,
    abi: lighthouseAbi,
    functionName: 'recordSighting',
    args: [BigInt(imo), swarmRef, Number(sightings), Number(disputed)],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, node: vesselNode(imo) };
}

/** Direct call to Lighthouse.recordOrbital. Registry-only. */
export async function recordOrbital({
  walletClient,
  publicClient,
  lighthouse,
  imo,
  imageSwarm,
  imageHash,
  teePrediction,
}) {
  const hash = await walletClient.writeContract({
    address: lighthouse,
    abi: lighthouseAbi,
    functionName: 'recordOrbital',
    args: [BigInt(imo), imageSwarm, imageHash, teePrediction],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, node: vesselNode(imo) };
}

// ─── Vessel: read ───────────────────────────────────────────────────────

/** Returns all on-chain vessel text records + ownership + fuses. */
export async function readVessel({ publicClient, resolver, nameWrapper, imo }) {
  const node = vesselNode(imo);

  const [imoTxt, swarmLog, count, disputed, image, imageHash, teePred, owner, data] =
    await Promise.all([
      publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'vessel.imo'] }),
      publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'vessel.swarm.log'] }),
      publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'vessel.sightings.count'] }),
      publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'vessel.sightings.disputed'] }),
      publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'vessel.orbital.image'] }),
      publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'vessel.orbital.imageHash'] }),
      publicClient.readContract({ address: resolver, abi: publicResolverAbi, functionName: 'text', args: [node, 'vessel.orbital.tee.prediction'] }),
      publicClient.readContract({ address: nameWrapper, abi: nameWrapperAbi, functionName: 'ownerOf', args: [BigInt(node)] }),
      publicClient.readContract({ address: nameWrapper, abi: nameWrapperAbi, functionName: 'getData', args: [BigInt(node)] }),
    ]);

  return {
    imo,
    ens:  `imo-${imo}.vessel.phare.eth`,
    node,
    owner,
    fuses:  data[1],
    expiry: data[2],
    records: {
      'vessel.imo':                  imoTxt,
      'vessel.swarm.log':            swarmLog,
      'vessel.sightings.count':      count,
      'vessel.sightings.disputed':   disputed,
      'vessel.orbital.image':        image,
      'vessel.orbital.imageHash':    imageHash,
      'vessel.orbital.tee.prediction': teePred,
    },
  };
}
