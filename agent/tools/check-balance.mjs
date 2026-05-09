// Phase: needs-funding → needs-ens (when both balances clear thresholds)
// Reads native ETH + WETH for the agent's wallet. If both meet thresholds
// (gas + UMA min counter-bond), advances state.phase to needs-ens.
//
// Thresholds (Sepolia, demo): ETH ≥ 0.02, WETH ≥ 0.005 (covers UMA's
// 0.002 WETH min bond plus headroom for one dispute round).

import { formatEther, parseEther } from 'viem';

import { wethAbi } from 'skill/abis';

import {
  PHASES,
  cfg,
  publicClient,
  readWallet,
  readState,
  updateState,
  emit,
  fail,
} from './_common.mjs';

const ETH_MIN  = parseEther('0.02');
const WETH_MIN = parseEther('0.005');

const w = readWallet();
if (!w) fail('no wallet — run `node tools/gen-wallet.mjs` first');

const pc  = publicClient();
const cf  = cfg();

const [eth, weth] = await Promise.all([
  pc.getBalance({ address: w.address }),
  pc.readContract({ address: cf.weth, abi: wethAbi, functionName: 'balanceOf', args: [w.address] }),
]);

const ready = eth >= ETH_MIN && weth >= WETH_MIN;

const state = readState();
const nextPhase = ready && state.phase === PHASES.NEEDS_FUNDING
  ? PHASES.NEEDS_ENS
  : state.phase;

if (nextPhase !== state.phase) {
  updateState((s) => ({ ...s, phase: nextPhase }));
}

emit({
  ok: true,
  ready,
  phase: nextPhase,
  address: w.address,
  balances: {
    eth:      formatEther(eth),
    weth:     formatEther(weth),
    ethRaw:   eth,
    wethRaw:  weth,
  },
  thresholds: {
    eth:  formatEther(ETH_MIN),
    weth: formatEther(WETH_MIN),
  },
  faucets: ready ? null : {
    eth:  process.env.SEPOLIA_ETH_FAUCET,
    weth: process.env.SEPOLIA_WETH_WRAP,
  },
  next: ready
    ? 'run `node tools/enroll.mjs` to mint <handle>.verifier.phare.eth'
    : 'fund the wallet from the faucets above and re-run check-balance',
});
