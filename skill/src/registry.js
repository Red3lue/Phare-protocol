// ReportRegistry helpers: submit a bonded sighting (which mints a vessel
// subname when settled truthful), dispute, settle, attest, and read.
//
// The end-to-end flow that creates / updates an `imo-<n>.vessel.phare.eth`
// subname:
//
//   submitReport(...)   → opens UMA assertion, escrows bond
//   wait `liveness` seconds (default 60s on Sepolia)
//   settleAssertion(...) → fires registry's resolution callback;
//                         the truthful path calls Lighthouse.nameVessel
//                         (first sighting) or recordSighting (subsequent).
//
// Disputes:
//
//   disputeAssertion(...) → optional, anyone within the liveness window;
//                          UMA's DVM votes; settle later

import {
  parseEventLogs,
  encodeAbiParameters,
  keccak256,
  toBytes,
} from 'viem';

import {
  reportRegistryAbi,
  oov3Abi,
  wethAbi,
} from './abis.js';

// ─── Submit ──────────────────────────────────────────────────────────────

/**
 * Compute the total bond required (protocol bond + UMA min bond, both in
 * the registry's bondCurrency, e.g. WETH on Sepolia).
 */
export async function getTotalBond({ publicClient, registry }) {
  const [protocolBond, oo, currency] = await Promise.all([
    publicClient.readContract({ address: registry, abi: reportRegistryAbi, functionName: 'protocolBond' }),
    publicClient.readContract({ address: registry, abi: reportRegistryAbi, functionName: 'oo' }),
    publicClient.readContract({ address: registry, abi: reportRegistryAbi, functionName: 'bondCurrency' }),
  ]);
  const umaBond = await publicClient.readContract({
    address: oo, abi: oov3Abi, functionName: 'getMinimumBond', args: [currency],
  });
  return {
    protocolBond,
    umaBond,
    total: protocolBond + umaBond,
    bondCurrency: currency,
    oo,
  };
}

/**
 * Wrap ETH → WETH if the wallet's WETH balance is short of `amount`.
 * No-op if balance is already sufficient. Returns the txHash if a wrap
 * happened, otherwise null.
 */
export async function ensureWeth({ walletClient, publicClient, weth, amount }) {
  const account = walletClient.account.address;
  const bal = await publicClient.readContract({
    address: weth, abi: wethAbi, functionName: 'balanceOf', args: [account],
  });
  if (bal >= amount) return null;
  const toWrap = amount - bal;
  const hash = await walletClient.writeContract({
    address: weth,
    abi: wethAbi,
    functionName: 'deposit',
    args: [],
    value: toWrap,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Submit a bonded sighting report. Auto-wraps ETH→WETH and approves the
 * registry to pull the bond if not already approved for this amount.
 *
 * Returns the new reportId, the on-chain assertionId, and the receipt.
 */
export async function submitReport({
  walletClient,
  publicClient,
  registry,
  imo,
  aisDark,
  photoHash,
  metadataSwarm,
  autoWrap = true,
}) {
  const { total, bondCurrency } = await getTotalBond({ publicClient, registry });
  if (autoWrap) {
    await ensureWeth({ walletClient, publicClient, weth: bondCurrency, amount: total });
  }
  // Approve. Set exactly `total` (or higher; here `total` matches what
  // the registry pulls). USDC requires zero-then-set; WETH is permissive.
  const approveHash = await walletClient.writeContract({
    address: bondCurrency,
    abi: wethAbi,
    functionName: 'approve',
    args: [registry, total],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const submitHash = await walletClient.writeContract({
    address: registry,
    abi: reportRegistryAbi,
    functionName: 'submit',
    args: [BigInt(imo), Boolean(aisDark), photoHash, metadataSwarm],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: submitHash });

  const events = parseEventLogs({
    abi: reportRegistryAbi,
    eventName: 'Submitted',
    logs: receipt.logs,
  });
  const submitted = events[0]?.args ?? null;

  return {
    txHash: submitHash,
    approveTx: approveHash,
    receipt,
    reportId: submitted?.reportId ?? null,
    assertionId: submitted?.assertionId ?? null,
  };
}

// ─── Settle / Dispute ───────────────────────────────────────────────────

/** Read the full Report struct from chain. */
export async function getReport({ publicClient, registry, reportId }) {
  return publicClient.readContract({
    address: registry,
    abi: reportRegistryAbi,
    functionName: 'getReport',
    args: [reportId],
  });
}

/** Compute when liveness expires for a given reportId, on-chain. */
export async function settleAfterTimestamp({ publicClient, registry, reportId }) {
  const [report, liveness] = await Promise.all([
    getReport({ publicClient, registry, reportId }),
    publicClient.readContract({ address: registry, abi: reportRegistryAbi, functionName: 'liveness' }),
  ]);
  return BigInt(report.submittedAt) + BigInt(liveness);
}

/**
 * Settle the assertion. Caller pays gas; UMA fires the registry's
 * resolution callback synchronously (Lighthouse.nameVessel /
 * recordSighting are called inside this same tx on truthful paths).
 *
 * Reads the actual on-chain assertionId from the report — never trust
 * a cached value from a script's simulation phase.
 */
export async function settleReport({
  walletClient,
  publicClient,
  registry,
  reportId,
}) {
  const report = await getReport({ publicClient, registry, reportId });
  if (report.status >= 2) {
    throw new Error(`report ${reportId} already settled (status=${report.status})`);
  }

  const oo = await publicClient.readContract({
    address: registry, abi: reportRegistryAbi, functionName: 'oo',
  });
  const hash = await walletClient.writeContract({
    address: oo,
    abi: oov3Abi,
    functionName: 'settleAssertion',
    args: [report.assertionId],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, receipt, assertionId: report.assertionId };
}

/**
 * Dispute an open assertion. Pulls a counter-bond (UMA min bond) from the
 * disputer's wallet — caller must have approved the OOv3 to spend it.
 * Returns txHash; final resolution still arrives later via DVM vote +
 * settle.
 */
export async function disputeReport({
  walletClient,
  publicClient,
  registry,
  reportId,
  approveAmount,
}) {
  const report = await getReport({ publicClient, registry, reportId });
  const [oo, currency] = await Promise.all([
    publicClient.readContract({ address: registry, abi: reportRegistryAbi, functionName: 'oo' }),
    publicClient.readContract({ address: registry, abi: reportRegistryAbi, functionName: 'bondCurrency' }),
  ]);
  const minBond = approveAmount ?? await publicClient.readContract({
    address: oo, abi: oov3Abi, functionName: 'getMinimumBond', args: [currency],
  });

  const approveHash = await walletClient.writeContract({
    address: currency, abi: wethAbi, functionName: 'approve', args: [oo, minBond],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  const hash = await walletClient.writeContract({
    address: oo,
    abi: oov3Abi,
    functionName: 'disputeAssertion',
    args: [report.assertionId, walletClient.account.address],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, assertionId: report.assertionId };
}

// ─── Attest (orbital corroboration; agent forwards a TEE signature) ─────

/**
 * Submit a SpaceComputer KMS-signed orbital attestation for a settled-true
 * report. Triggers Lighthouse.recordOrbital under the hood.
 *
 * `signature` is an EIP-191 signature over
 *   keccak256(abi.encode(reportId, imageHash, keccak256(teePrediction)))
 * by the immutable `orbitalAttestor` set at registry deployment.
 */
export async function attestOrbital({
  walletClient,
  publicClient,
  registry,
  reportId,
  imageSwarm,
  imageHash,
  teePrediction,
  signature,
}) {
  const hash = await walletClient.writeContract({
    address: registry,
    abi: reportRegistryAbi,
    functionName: 'attest',
    args: [reportId, imageSwarm, imageHash, teePrediction, signature],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { txHash: hash, receipt };
}

/**
 * Compute the digest a TEE signer must sign over to satisfy `attest()`.
 * Returns the inner keccak256 (pre-EIP-191). When signing with viem's
 * `walletClient.signMessage({ message: { raw: digest } })`, the EIP-191
 * prefix is added automatically — that resulting signature is what
 * `attestOrbital` expects.
 *
 * Solidity equivalent (ReportRegistry.attest):
 *   digest = keccak256(abi.encode(reportId, imageHash, keccak256(bytes(teePrediction))))
 *   signer = ecrecover(eip191(digest), signature)
 */
export function orbitalAttestDigest({ reportId, imageHash, teePrediction }) {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [reportId, imageHash, keccak256(toBytes(teePrediction))],
    ),
  );
}

// ─── Status helpers ─────────────────────────────────────────────────────

export const REPORT_STATUS = {
  PENDING:       0,
  DISPUTED:      1,
  SETTLED_TRUE:  2,
  SETTLED_FALSE: 3,
};

/** Human-readable status label. */
export function statusLabel(status) {
  return Object.entries(REPORT_STATUS).find(([, v]) => v === Number(status))?.[0] ?? `UNKNOWN(${status})`;
}
