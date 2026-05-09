// Shared helpers for all agent CLI tools.
//
// - Loads /agent/.env into process.env (deploy script patches it).
// - Builds viem PublicClient (always) and WalletClient (only when a
//   wallet PK is on disk under state/wallet.json).
// - Reads/writes state/state.json (phase, lastSeenBlock, handle, …).
// - Resolves Phare addresses via /skill resolveAddresses.

import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia }             from 'viem/chains';

import { resolveAddresses } from 'skill/addresses';

// ─── Paths ──────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AGENT_ROOT = path.resolve(__dirname, '..');
export const STATE_DIR  = path.join(AGENT_ROOT, 'state');
export const WALLET_PATH = path.join(STATE_DIR, 'wallet.json');
export const STATE_PATH  = path.join(STATE_DIR, 'state.json');
export const DECISIONS_DIR = path.join(STATE_DIR, 'decisions');
export const DATA_DIR    = path.join(AGENT_ROOT, 'data');

// Load /agent/.env. Existing process env wins (consistent with viem usage).
dotenv.config({ path: path.join(AGENT_ROOT, '.env') });

// ─── State (state.json) ─────────────────────────────────────────────────

export const PHASES = Object.freeze({
  INIT:           'init',
  NEEDS_FUNDING:  'needs-funding',
  NEEDS_ENS:      'needs-ens',
  RUNNING:        'running',
});

const DEFAULT_STATE = {
  phase: PHASES.INIT,
  wallet: null,           // { address }
  handle: null,
  node: null,
  lastSeenBlock: null,    // bigint serialised as string
  seenReports: [],        // reportId hex strings already evaluated
  stats: { disputes: 0, won: 0, lost: 0, skipped: 0 },
};

export function readState() {
  if (!fs.existsSync(STATE_PATH)) return structuredClone(DEFAULT_STATE);
  const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  return { ...DEFAULT_STATE, ...raw };
}

export function writeState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function updateState(mutator) {
  const s = readState();
  const next = mutator(s) ?? s;
  writeState(next);
  return next;
}

// ─── Wallet (wallet.json) ───────────────────────────────────────────────

export function readWallet() {
  if (!fs.existsSync(WALLET_PATH)) return null;
  return JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'));
}

export function writeWallet({ privateKey, address }) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(
    WALLET_PATH,
    JSON.stringify({ privateKey, address }, null, 2),
    { mode: 0o600 },
  );
}

// ─── Viem clients ───────────────────────────────────────────────────────

export function rpcUrl() {
  const url = process.env.SEPOLIA_RPC_URL;
  if (!url) throw new Error('SEPOLIA_RPC_URL not set in /agent/.env');
  return url;
}

export function publicClient() {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl()) });
}

export function walletClient() {
  const w = readWallet();
  if (!w) throw new Error('no wallet — run `node tools/gen-wallet.mjs` first');
  const account = privateKeyToAccount(w.privateKey);
  return createWalletClient({ chain: sepolia, transport: http(rpcUrl()), account });
}

// ─── Phare addresses ────────────────────────────────────────────────────

export function cfg() {
  return resolveAddresses();
}

// ─── Misc ───────────────────────────────────────────────────────────────

export function emit(obj) {
  // Single canonical JSON line on stdout — easy for Claude to parse.
  console.log(JSON.stringify(obj, replacer, 2));
}

export function fail(msg, extra = {}) {
  emit({ ok: false, error: msg, ...extra });
  process.exit(1);
}

// JSON.stringify replacer: bigints → decimal strings.
function replacer(_k, v) {
  return typeof v === 'bigint' ? v.toString() : v;
}

export function ensureAddress(name, value) {
  if (!isAddress(value ?? '')) throw new Error(`${name} is not a valid address: ${value}`);
  return value;
}
