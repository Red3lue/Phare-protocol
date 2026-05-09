# skill — Phare verifier-agent helpers (JS)

Viem-based JavaScript helpers for the Phare on-chain ENS layer. Used by the
OpenClaw verifier skill to read and write vessel + verifier ENS records.

## Install

From the repo root:

```bash
pnpm install
```

(`skill/` is a workspace; deps are pinned in `skill/package.json`.)

`.env` at the repo root must have at minimum:
- `DEPLOYER_PRIVATE_KEY` — agent / deployer wallet
- `SEPOLIA_RPC_URL`
- `LIGHTHOUSE`, `REPORT_REGISTRY` — populated by `forge script Deploy.s.sol`

## Auth model (TL;DR)

| Operation | Caller | Path |
|---|---|---|
| **Create verifier** | any wallet | `enrollVerifier(handle, policyURI, soulURI)` on Lighthouse |
| **Update verifier** | the principal that minted | `setText(node, key, value)` directly on PublicResolver |
| **Create vessel** | indirect (via UMA settlement) | `submitReport` → wait → `settleReport`; the truthful callback inside the Registry calls `Lighthouse.nameVessel` |
| **Update vessel** | indirect (via subsequent settlements) | same flow — second settlement calls `recordSighting` |
| **Attest orbital** | anyone w/ TEE signature | `attestOrbital`; signature verified against `orbitalAttestor` immutable |
| **Read** | anyone | `readVerifier`, `readVessel` |

The agent **cannot** call `Lighthouse.nameVessel` / `recordSighting` /
`recordOrbital` directly — those are gated by `onlyRegistry`. To affect a
vessel subname, go through the report submission + settlement flow.

## Quick start

```js
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import {
  enrollVerifier, setVerifierLastDecision, readVerifier,
  submitReport, settleReport, readVessel,
  resolveAddresses,
} from 'skill';

const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const transport = http(process.env.SEPOLIA_RPC_URL);
const publicClient = createPublicClient({ chain: sepolia, transport });
const walletClient = createWalletClient({ account, chain: sepolia, transport });
const cfg = resolveAddresses();

// Enroll once
const { node } = await enrollVerifier({
  walletClient, publicClient,
  lighthouse: cfg.lighthouse,
  handle: 'agent-3a4b5c',
  policyURI: 'bzz://policy-bytes32',
  soulURI:   'bzz://soul-bytes32',
});

// Update after each dispute decision
await setVerifierLastDecision({
  walletClient, publicClient,
  resolver: cfg.publicResolver,
  handle: 'agent-3a4b5c',
  value:  'bzz://decision-...',
});

// Read any vessel or verifier (no signer needed)
const vessel = await readVessel({
  publicClient,
  resolver: cfg.publicResolver,
  nameWrapper: cfg.nameWrapper,
  imo: 9133701n,
});
```

## Examples

Five runnable examples in `examples/`. They share `_clients.mjs` which
loads `../.env` and constructs the viem clients.

```bash
# 1) Enroll a fresh verifier (random handle by default)
pnpm --filter skill run example:enroll

# 2) Update an enrolled verifier's records (set VERIFIER_HANDLE first)
VERIFIER_HANDLE=agent-test01 pnpm --filter skill run example:update-verifier

# 3) Submit a vessel sighting (auto-wraps ETH→WETH and approves)
pnpm --filter skill run example:submit
#    → wait ~60s for UMA liveness ←
pnpm --filter skill run example:settle

# 4) Read both subnames
VERIFIER_HANDLE=agent-test01 VESSEL_IMO=9133701 pnpm --filter skill run example:read
```

`examples/.vessel-state.json` carries the `reportId` between submit and
settle. The settle script always re-reads the live `assertionId` from the
registry — never trust simulation-time IDs.

## Module layout

```
skill/
├── src/
│   ├── abis.js          # Lighthouse, Registry, PublicResolver, NameWrapper, OOv3, WETH ABIs
│   ├── addresses.js     # Sepolia infra pins + resolveAddresses(env-driven)
│   ├── lighthouse.js    # enrollVerifier, setVerifierText/*, nameVessel*, recordSighting*, readVerifier, readVessel
│   ├── registry.js      # submitReport, settleReport, disputeReport, attestOrbital, getReport
│   └── index.js         # barrel export
└── examples/
    ├── _clients.mjs
    ├── enroll-verifier.mjs
    ├── update-verifier.mjs
    ├── submit-vessel.mjs
    ├── settle-vessel.mjs
    └── read-records.mjs
```

## Notes

- **EIP-191 signatures.** The `attestOrbital` helper expects a 65-byte
  signature over the EIP-191-wrapped digest. Use `orbitalAttestDigest({...})`
  to get the inner hash, then `walletClient.signMessage({ message: { raw: digest } })`
  — viem adds the EIP-191 prefix automatically.
- **PCC and writes.** Burning `PARENT_CANNOT_CONTROL` does not freeze records.
  It only prevents the parent owner from interfering. The wrapped owner of
  a node can write text records freely until the name expires (we use
  `MAX_EXPIRY`, so effectively forever).
- **Vessel ownership.** Vessel subnames have `CANNOT_TRANSFER` burnt and
  are owned by the Lighthouse contract permanently. Only the registry can
  trigger updates, via the UMA settlement callback.
