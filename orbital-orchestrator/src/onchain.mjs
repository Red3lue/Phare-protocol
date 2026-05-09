// On-chain ENS writer. Uses the `skill/` SDK to talk to Lighthouse on
// Sepolia. Loads credentials from <project>/.env at module load time.
//
// Authority model (per skill/README.md):
//   - Verifier records: permissionless. The orchestrator self-enrolls
//     a `<handle>.verifier.phare.eth` subname keyed by its wallet address
//     and writes verifier.lastDecision directly via PublicResolver.setText.
//   - Vessel records (vessel.orbital.*): onlyRegistry — must go through
//     ReportRegistry.attest() with an EIP-191 sig from the orbitalAttestor.
//     Hook is exposed below but not auto-invoked (needs reportId).
//
// Graceful degradation: if DEPLOYER_PRIVATE_KEY / SEPOLIA_RPC_URL are
// missing, on-chain calls are skipped and the pipeline still produces
// images + .md ledgers.

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import {
  resolveAddresses,
  enrollVerifier,
  setVerifierLastDecision,
  setVerifierText,
  readVerifier,
} from 'skill';
import { paths } from './paths.mjs';

loadEnv({ path: resolve(paths.projectRoot, '.env') });

let _clients = null;

export function isOnChainAvailable() {
  return Boolean(process.env.DEPLOYER_PRIVATE_KEY && process.env.SEPOLIA_RPC_URL);
}

function getClients() {
  if (_clients) return _clients;
  if (!isOnChainAvailable()) {
    throw new Error('on-chain disabled: DEPLOYER_PRIVATE_KEY or SEPOLIA_RPC_URL missing in .env');
  }
  const account     = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
  const transport   = http(process.env.SEPOLIA_RPC_URL);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });
  const cfg = resolveAddresses();
  _clients = { account, publicClient, walletClient, cfg };
  return _clients;
}

/** Derive a stable, address-bound handle so re-runs hit the same subname. */
export function orchestratorHandle() {
  const { account } = getClients();
  return `agent-${account.address.slice(2, 8).toLowerCase()}`;
}

/**
 * Idempotent enrollment: read first, mint only if `verifier.runtime` is empty.
 * Returns `{ handle, alreadyEnrolled, txHash?, node? }`.
 */
export async function ensureEnrolled({
  policyURI = 'bzz://orchestrator-policy',
  soulURI   = 'bzz://orchestrator-soul',
} = {}) {
  const { walletClient, publicClient, cfg } = getClients();
  const handle = orchestratorHandle();

  let existing = null;
  try {
    existing = await readVerifier({
      publicClient,
      resolver:    cfg.publicResolver,
      nameWrapper: cfg.nameWrapper,
      handle,
    });
  } catch { /* not enrolled yet */ }

  if (existing?.runtime) {
    return { handle, alreadyEnrolled: true };
  }

  const result = await enrollVerifier({
    walletClient, publicClient,
    lighthouse: cfg.lighthouse,
    handle, policyURI, soulURI,
  });
  return { handle, alreadyEnrolled: false, ...result };
}

/** Write a free-form value to the orchestrator's verifier.lastDecision record. */
export async function writeVerifierLastDecision(value) {
  const { walletClient, publicClient, cfg } = getClients();
  const handle = orchestratorHandle();
  return setVerifierLastDecision({
    walletClient, publicClient,
    resolver: cfg.publicResolver,
    handle, value,
  });
}

/** Generic verifier text-record write. */
export async function writeVerifierText({ key, value }) {
  const { walletClient, publicClient, cfg } = getClients();
  const handle = orchestratorHandle();
  return setVerifierText({
    walletClient, publicClient,
    resolver: cfg.publicResolver,
    handle, key, value,
  });
}

/**
 * Write the standard ENS `avatar` text record on the orchestrator's verifier
 * subname. Pass a data URI (`data:image/webp;base64,...`), an https URL, or
 * any other URI scheme metadata.ens.domains understands.
 */
export async function writeVerifierAvatar(value) {
  return writeVerifierText({ key: 'avatar', value });
}

/**
 * TODO: vessel.orbital.* records are gated by `onlyRegistry`. To update
 * them, build the EIP-191 digest with `orbitalAttestDigest`, sign it with
 * the orbitalAttestor key, and call `ReportRegistry.attestOrbital(...)`
 * for a settled reportId. Skipped while we don't track reportIds in the
 * orchestrator. See skill/src/registry.js → attestOrbital.
 */
export async function attestOrbitalForReport(/* { reportId, imageHash, teePrediction } */) {
  throw new Error('attestOrbitalForReport: not wired — needs reportId tracking + orbitalAttestor sig');
}
