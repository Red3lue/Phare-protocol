// Phare verifier-agent helpers — barrel export.
//
// Typical agent usage:
//
//   import { createPublicClient, createWalletClient, http } from 'viem';
//   import { privateKeyToAccount }                          from 'viem/accounts';
//   import { sepolia }                                      from 'viem/chains';
//   import {
//     enrollVerifier, setVerifierLastDecision, readVerifier,
//     submitReport,   settleReport,             readVessel,
//     resolveAddresses,
//   } from 'skill';
//
//   const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
//   const transport = http(process.env.SEPOLIA_RPC_URL);
//   const publicClient = createPublicClient({ chain: sepolia, transport });
//   const walletClient = createWalletClient({ account, chain: sepolia, transport });
//   const cfg = resolveAddresses();
//
//   await enrollVerifier({
//     walletClient, publicClient,
//     lighthouse: cfg.lighthouse,
//     handle:  'agent-3a4b5c',
//     policyURI: 'bzz://...',
//     soulURI:   'bzz://...',
//   });

export * from './abis.js';
export * from './addresses.js';
export * from './lighthouse.js';
export * from './registry.js';
