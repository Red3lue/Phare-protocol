// Phase: init → needs-funding
// Generates a fresh secp256k1 keypair, persists it to state/wallet.json
// (mode 0600, gitignored), records the address in state.json, and prints
// the ETH + WETH faucet links for the user to fund manually.
//
// Idempotent: if a wallet already exists on disk, prints it and exits 0.

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import {
  PHASES,
  readWallet,
  writeWallet,
  updateState,
  emit,
} from './_common.mjs';

const existing = readWallet();
const account  = existing
  ? privateKeyToAccount(existing.privateKey)
  : (() => {
      const pk = generatePrivateKey();
      const a  = privateKeyToAccount(pk);
      writeWallet({ privateKey: pk, address: a.address });
      return a;
    })();

const handle = `agent-${account.address.slice(-6).toLowerCase()}`;

const state = updateState((s) => ({
  ...s,
  phase: s.phase === PHASES.INIT ? PHASES.NEEDS_FUNDING : s.phase,
  wallet: { address: account.address },
  handle: s.handle ?? handle,
}));

emit({
  ok: true,
  reused: Boolean(existing),
  phase: state.phase,
  address: account.address,
  handle: state.handle,
  faucets: {
    eth:  process.env.SEPOLIA_ETH_FAUCET,
    weth: process.env.SEPOLIA_WETH_WRAP,
  },
  next: 'fund the wallet, then run `node tools/check-balance.mjs`',
});
