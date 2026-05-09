// Shared client setup used by every example. Reads ../.env (project root).

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../.env') });

import { resolveAddresses } from '../src/addresses.js';

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  throw new Error('DEPLOYER_PRIVATE_KEY missing — set it in ../.env');
}

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const rpcUrl  = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const transport = http(rpcUrl);

export const publicClient = createPublicClient({ chain: sepolia, transport });
export const walletClient = createWalletClient({ account, chain: sepolia, transport });
export const cfg = resolveAddresses();

console.log('Account            :', account.address);
console.log('Lighthouse         :', cfg.lighthouse);
console.log('ReportRegistry     :', cfg.reportRegistry);
console.log('NameWrapper        :', cfg.nameWrapper);
console.log('PublicResolver     :', cfg.publicResolver);
console.log('');
