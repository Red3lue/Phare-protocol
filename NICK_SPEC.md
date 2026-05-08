# Phare Verifier — OpenClaw Skill Spec

> The autonomous agent that watches Phare reports as they hit the chain, decides whether each one looks fake, and disputes the bad ones via UMA OOv3. Distributed via ClawHub. Registers its own real ENS identity on first run and publishes the reasoning behind every dispute on Swarm.

Companion to `SPEC.md`, `RUBEN_SPEC_NEW.md`, `ENS_SPEC.md`. This spec covers the **verifier skill** only — not the contracts, not the reporter PWA, not the minter. Everything here lives under `skill/` plus one Solidity file under `contracts/`.

---

## 1. Scope

What this skill is responsible for:

- Generating a wallet, helping the user fund it, registering an ENS subname for the agent on Sepolia.
- Polling UMA OOv3 every heartbeat for new `AssertionMade` events whose `callbackRecipient` is Phare's `ReportRegistry`.
- For each new assertion, fetching the report metadata from Swarm, cross-referencing the IMO against a local shadow-vessel registry, and consulting an ASI-mocked verdict.
- Disputing the assertion when the verdict says fake; otherwise skipping.
- Publishing the reasoning behind every dispute on Swarm and writing the bzz reference into the agent's ENS text records.

What this skill explicitly does **not** do:

- Submit reports (that is the reporter PWA's job).
- Mint vessel ENS subnames (that is the minter service's job).
- Run real ML / vision authenticity models (we mock ASI for the hackathon).
- Adjudicate disputes (UMA OOv3 voters do that).

---

## 2. Vocabulary additions

Skip if fluent.

- **Heartbeat** — periodic LLM tick provided by the OpenClaw runtime. Each tick reads `HEARTBEAT.md` from the skill workspace and runs an inference pass with full skill tool access.
- **State machine** — explicit `phase` enum carried in `state.json` so the heartbeat tick knows whether we're still onboarding the user or in steady-state polling.
- **Subname registrar** — a Solidity contract that holds operator approval on a parent ENS name and exposes a public function to mint child subnames under it via the ENS Name Wrapper. The canonical ENS pattern for programmatic subname issuance.
- **Fuses** — bitfield permissions on a wrapped ENS name. Once burned, irreversible. We burn `PARENT_CANNOT_CONTROL` on each minted child so the agent's identity is emancipated from the parent.

---

## 3. Architecture

```
+------------------------------------------------+
|  OpenClaw runtime (user's machine)             |
|                                                |
|  +-----------------------------+               |
|  |  phare/verifier skill       |               |
|  |  - SKILL.md                 |               |
|  |  - HEARTBEAT.md             |               |
|  |  - tools/                   |               |
|  |    wallet.tool.js           |               |
|  |    uma.tool.js              |               |
|  |    ens.tool.js              |               |
|  |    shadow.registry.tool.js  |               |
|  |    asi.tool.js              |               |
|  |  - data/                    |               |
|  |    shadow-vessels.json      |               |
|  |    asi-fixtures.json        |               |
|  |  - state/                   |               |
|  |    state.json               |               |
|  |    key.txt                  |               |
|  +--------------+--------------+               |
|                 |                              |
|                 v                              |
|  +-----------------------------+               |
|  |  Swarm MCP server           |               |
|  |  - download_data            |               |
|  |  - upload_data              |               |
|  +-----------------------------+               |
+------------------------------------------------+
                  |
                  v
+------------------------------------------------+
|  Sepolia (chainId 11155111)                    |
|                                                |
|  - UMA OOv3                                    |
|    0x9923D42eF695B5dd9911D05Ac944d4cAca3c4EAB  |
|  - ReportRegistry  (sibling team)              |
|  - EnsRegistrar    (this PR, contracts/)       |
|  - ENS Name Wrapper, Public Resolver           |
|  - Sepolia USDC, Sepolia WETH (gas)            |
+------------------------------------------------+
```

---

## 4. State machine

The skill has four phases. The current phase lives in `./state/state.json` and is read at the start of every heartbeat tick and every user message.

```
init  --->  needs-funding  --->  needs-ens  --->  running
```

| Phase | Trigger to advance | What the skill does in this phase |
|---|---|---|
| `init` | wallet keypair generated and persisted | mint keypair, write `key.txt`, print address + faucet links |
| `needs-funding` | `getEthBalance() >= 0.02` AND `getUsdcBalance() >= 5` | poll balances each interaction; re-print address + faucet links if user asks |
| `needs-ens` | `EnsRegistrar.registerEnsAgent(...)` tx confirmed | derive handle from address, upload policy and soul to Swarm, call registrar |
| `running` | — terminal — | poll UMA OOv3 for new assertions, decide, dispute or skip |

**Heartbeat is suppressed in every phase except `running`.** Ticks in `init`, `needs-funding`, and `needs-ens` reply `HEARTBEAT_OK` and do nothing — onboarding only advances when the user sends a message in chat.

---

## 5. `state.json` schema

```json
{
  "phase": "running",
  "wallet": {
    "address": "0x3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    "keyfile": "./state/key.txt"
  },
  "ens": {
    "handle": "agent-1a2b3b",
    "node": "0x...",
    "policyURI": "bzz://...",
    "soulURI": "bzz://...",
    "registeredAt": 1715000000,
    "registerTx": "0x..."
  },
  "cursor": { "lastBlock": 6234567 },
  "seen": {
    "0xassertionId1": { "decision": "skip", "reason": "asi:ok", "at": 1715000020 },
    "0xassertionId2": { "decision": "dispute", "tx": "0xabc...", "at": 1715000080 }
  }
}
```

State writes are atomic: write to `state.json.tmp`, then rename. Crash-safe.

The `seen` map is unbounded for the hackathon — demo runtime is minutes, max ~20 entries. Pruning is a v2 concern.

---

## 6. Pre-event setup (one-time, before the demo)

| Step | Action | Notes |
|---|---|---|
| 1 | Acquire `phare.eth` on Sepolia ENS (fallback `phare-demo.eth`) | free on Sepolia, registration via ENS Manager App |
| 2 | Wrap `phare.eth` in Name Wrapper | one tx |
| 3 | Mint subnode `verifier.phare.eth` under it, owned by parent | one tx |
| 4 | Burn `CANNOT_UNWRAP` on `verifier.phare.eth` (locks it for owner-controlled fuses on children) | one tx |
| 5 | Deploy `EnsRegistrar.sol` with `parentNode = namehash("verifier.phare.eth")` baked in | see §10 |
| 6 | `NameWrapper.setApprovalForAll(EnsRegistrar, true)` from the parent owner key | one tx |
| 7 | Confirm UMA OOv3 deployment + whitelisted USDC currency on Sepolia | sponsor day-of |
| 8 | Coordinate with reporter team: `ReportRegistry` must use UMA with USDC + 5 USDC bond + claim string `"Report at bzz://<meta> is true"` | shared protocol |

Once the registrar is approved, any wallet can call `registerEnsAgent("<handle>", ...)` and receive a wrapped ENS subname with `PARENT_CANNOT_CONTROL` burned.

---

## 7. Tool surface

Five tool files under `skill/tools/`. Each is a thin viem-based wrapper plus a JSON schema the LLM picks from. Plus the Solar Punk Swarm MCP server (`download_data`, `upload_data`) for all Swarm interaction — this is the hard requirement, not optional.

### 7.1 `wallet.tool.js`

| Method | Inputs | Returns | Notes |
|---|---|---|---|
| `createWallet` | — | `{ address, keyfile }` | only callable in `phase=init` |
| `address` | — | `0x...` | reads from state |
| `getEthBalance` | — | wei (string) | for gas + faucet UX |
| `getUsdcBalance` | — | base units (string, 6 decimals) | for bond + faucet UX |
| `approveUsdc` | `spender, amount` | tx hash | one-shot, max-approve UMA at first dispute |

Private key is loaded from `./state/key.txt` on each call. Plaintext disk storage. Acceptable for testnet hackathon scope.

### 7.2 `uma.tool.js`

| Method | Inputs | Returns | Notes |
|---|---|---|---|
| `pollAssertions` | `fromBlock, callbackRecipient` | `[{ assertionId, claim, asserter, callbackRecipient, currency, bond, expirationTime, blockNumber }]` | calls `getLogs` for `AssertionMade` filtered by `callbackRecipient` |
| `disputeAssertion` | `assertionId, disputerAddr` | tx hash | calls `OOv3.disputeAssertion`; assumes USDC approval already in place |

Bond is hardcoded at 5 USDC. Reporter side commits to using 5 USDC; mismatch is out of scope.

### 7.3 `ens.tool.js`

| Method | Inputs | Returns | Notes |
|---|---|---|---|
| `registerEnsAgent` | `handle, policyURI, soulURI` | tx hash + `childNode` | atomic mint + setText via `EnsRegistrar` |
| `setText` | `node, key, value` | tx hash | post-mint updates, e.g. `verifier.lastDecision` |

### 7.4 `shadow.registry.tool.js`

| Method | Inputs | Returns | Notes |
|---|---|---|---|
| `lookup` | `imo` | `{ match: bool, vessel: { imo, name, sanctionReason, ... } \| null }` | reads `data/shadow-vessels.json` |

### 7.5 `asi.tool.js`

| Method | Inputs | Returns | Notes |
|---|---|---|---|
| `assess` | `{ imo, lat, lon }` | `{ verdict: "ok" \| "fake", confidence, reason }` | fixture lookup keyed by IMO; falls back to `default` |

The mock is intentionally crude. The point is to demonstrate the integration shape. Real ASI hookup is a v2 swap-in.

### 7.6 Data files

`skill/data/shadow-vessels.json`:

```json
{
  "schema": "phare.shadow-registry/1",
  "source": "OpenSanctions maritime scope (frozen 2026-04)",
  "vessels": [
    { "imo": "9133701", "name": "PABLO", "sanctionReason": "oil-transport", "aliases": ["1234567"], "flag": "Comoros" },
    { "imo": "9259325", "name": "YOUNG YONG", "sanctionReason": "oil-transport", "aliases": [], "flag": "Marshall Islands" }
  ]
}
```

`skill/data/asi-fixtures.json`:

```json
{
  "default": { "verdict": "ok", "confidence": 0.85, "reason": "no anomaly" },
  "byImo": {
    "9133701": { "verdict": "ok", "confidence": 0.93, "reason": "matches OFAC-listed PABLO; coords plausible Mediterranean" },
    "9999999": { "verdict": "fake", "confidence": 0.91, "reason": "IMO not allocated; coords inland" }
  }
}
```

---

## 8. Decision logic

Every assertion the verifier sees in `phase=running` runs through this pipeline:

1. Filter: `callbackRecipient == ReportRegistry`. Otherwise ignore.
2. Parse `claim` bytes as UTF-8. Extract the `bzz://<ref>` substring. If parse fails, record `seen[id] = { decision: "skip", reason: "claim-shape" }`.
3. `swarmMcp.download_data(ref)` → JSON. Extract `imo`, `lat`, `lon`. If JSON malformed, `skip-reason: meta-shape`.
4. `shadow.registry.lookup(imo)` → corroboration only. Recorded in trace, does not branch the decision.
5. `asi.assess({ imo, lat, lon })` → verdict.
6. If `verdict == "fake"`:
   - Check `expirationTime > now` (still inside liveness window). If expired, skip.
   - Ensure `getUsdcBalance() >= 5e6`. If short, skip with reason.
   - Ensure UMA has USDC approval. If not, call `approveUsdc(uma, max)`.
   - Build reasoning JSON, `swarmMcp.upload_data(json)` → bzz ref.
   - `uma.disputeAssertion(assertionId, address)` → tx hash.
   - `ens.setText(node, "verifier.lastDecision", bzzRef)`.
   - Record `seen[id] = { decision: "dispute", tx, at }`.
7. Else: `seen[id] = { decision: "skip", reason: "asi:ok", at }`. **No Swarm upload, no ENS write.** Skip-decisions are local-only.

**Latest assertion only per tick.** If multiple unprocessed assertions are returned, the skill processes the most recent and leaves older ones for next tick. Keeps gas usage predictable and the trace per-tick small.

### 8.1 Reasoning blob shape

Uploaded only on dispute decisions:

```json
{
  "schema": "phare.verifier-decision/1",
  "assertionId": "0x...",
  "imo": "9999999",
  "decision": "dispute",
  "reason": "ASI verdict fake (0.91); IMO not in shadow registry",
  "shadowMatch": false,
  "asi": { "verdict": "fake", "confidence": 0.91, "reason": "IMO not allocated; coords inland" },
  "policyURI": "bzz://...",
  "disputeTx": "0xabc...",
  "verifier": "agent-1a2b3b.verifier.phare.eth",
  "at": 1715000080
}
```

Returned `bzz://<ref>` is written to ENS text record `verifier.lastDecision`. That single ENS field becomes the public, resolvable pointer to the latest reasoning.

---

## 9. `HEARTBEAT.md` content

Read by the OpenClaw LLM at every tick. The body is the agent's checklist:

```markdown
# Phare Verifier — heartbeat

You are a Phare verifier agent. Every tick:

1. Read `./state/state.json`. If `phase != "running"`, reply `HEARTBEAT_OK` and stop. Onboarding only advances when the user sends a chat message.

2. Call `uma.pollAssertions(fromBlock=cursor.lastBlock + 1, callbackRecipient=$REPORT_REGISTRY)`.

3. If the result is empty, update `cursor.lastBlock` to current head and reply `HEARTBEAT_OK`.

4. Pick the most recent assertion not in `seen`. (Older unprocessed assertions wait for the next tick.)

5. Run the decision pipeline (see NICK_SPEC.md §8). Persist `seen[id]` and update `cursor.lastBlock`.

6. On a dispute decision, also: upload reasoning JSON to Swarm, set ENS text record `verifier.lastDecision` to the returned bzz ref.

7. Reply with a one-line summary of the decision and the tx hash if any.

Never skip the liveness check before disputing. Never write state non-atomically.
```

`SKILL.md` carries the broader instructions for non-tick interactions (onboarding chat in `init`/`needs-funding`/`needs-ens`).

---

## 10. `EnsRegistrar.sol`

Lives at `contracts/EnsRegistrar.sol`. Foundry project alongside `ReportRegistry`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface INameWrapper {
    function setSubnodeRecord(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32);
}

interface IPublicResolver {
    function setText(bytes32 node, string calldata key, string calldata value) external;
}

contract EnsRegistrar {
    INameWrapper   public immutable nameWrapper;
    IPublicResolver public immutable resolver;
    bytes32        public immutable parentNode; // namehash("verifier.phare.eth")

    uint32 public constant FUSES = 65536; // PARENT_CANNOT_CONTROL

    event AgentRegistered(address indexed owner, string handle, bytes32 indexed childNode);

    constructor(address nw, address r, bytes32 p) {
        nameWrapper = INameWrapper(nw);
        resolver = IPublicResolver(r);
        parentNode = p;
    }

    function registerEnsAgent(
        string calldata handle,
        string calldata policyURI,
        string calldata soulURI
    ) external returns (bytes32 childNode) {
        bytes32 labelhash = keccak256(bytes(handle));
        childNode = keccak256(abi.encodePacked(parentNode, labelhash));

        nameWrapper.setSubnodeRecord(
            parentNode,
            handle,
            msg.sender,
            address(resolver),
            0,
            FUSES,
            type(uint64).max
        );

        resolver.setText(childNode, "verifier.policy", policyURI);
        resolver.setText(childNode, "verifier.soul", soulURI);
        resolver.setText(childNode, "verifier.runtime", "openclaw");

        emit AgentRegistered(msg.sender, handle, childNode);
    }
}
```

The registrar is approved as operator on the parent name during pre-event setup (§6). After that, any wallet can call `registerEnsAgent` and receive a wrapped ENS NFT for `<handle>.verifier.phare.eth` with `PARENT_CANNOT_CONTROL` burned.

---

## 11. Onboarding walkthrough

User installs `phare/verifier` from ClawHub. First chat message:

1. **User**: `hi`
2. **Skill** reads `state.json` → no file → creates default with `phase=init`.
3. **Skill** calls `wallet.createWallet()` → keypair minted, `key.txt` written.
   > "Wallet created. Address: `0x3a4b5c…`. To proceed, fund with **0.02 Sepolia ETH** (gas) and **5 Sepolia USDC** (bond). Faucets: <https://faucet.circle.com>, <https://sepoliafaucet.com>. Reply when done."
4. **User**: funds via faucets, replies `funded`.
5. **Skill** advances to `needs-funding`, calls `getEthBalance` and `getUsdcBalance`. If both meet thresholds, advances to `needs-ens`.
6. **Skill** in `needs-ens`: derives handle `agent-3a4b5c` from address tail. Authors a tiny policy markdown (see §12) and a soul markdown, uploads each via `swarmMcp.upload_data`, gets two bzz refs. Calls `ens.registerEnsAgent("agent-3a4b5c", policyURI, soulURI)`. On confirmation:
   > "Registered as `agent-3a4b5c.verifier.phare.eth` (tx: `0xabc…`). Resolver text records set. Going live."
7. **Skill** writes `phase=running` and the next heartbeat tick takes over.

From this point, the user may close the OpenClaw window; the heartbeat continues to run on schedule.

---

## 12. Policy and soul defaults

The skill ships with a default policy markdown and a default soul markdown. The user can override them later by editing the workspace files and triggering a re-upload (out of hackathon scope).

`skill/templates/policy.md`:

```markdown
# Phare Verifier Policy v1

This verifier disputes a Phare report when, and only when:

- The IMO field is malformed or unallocated, OR
- The ASI verdict says fake with confidence >= 0.7, OR
- The coordinates are inland by ocean polygon check (future).

Bond: 5 USDC. Currency: Sepolia USDC.
Runtime: OpenClaw, heartbeat every 20s (target).
```

`skill/templates/soul.md`:

```markdown
# agent-{addressTail}

I run because shadow-fleet sightings deserve a public, tamper-evident trail.
I dispute fakes. I corroborate the rest.
```

Both are pinned to Swarm at register-time. The bzz refs are written into the agent's ENS text records (`verifier.policy`, `verifier.soul`).

---

## 13. Repository layout

```
phare/
  contracts/
    EnsRegistrar.sol            # this PR
    ReportRegistry.sol          # sibling team
    SlashPool.sol
  skill/                        # this PR — published as phare/verifier on ClawHub
    SKILL.md
    HEARTBEAT.md
    tools/
      wallet.tool.js
      uma.tool.js
      ens.tool.js
      shadow.registry.tool.js
      asi.tool.js
    data/
      shadow-vessels.json
      asi-fixtures.json
    templates/
      policy.md
      soul.md
    config/
      sepolia.ts                # contract addresses, RPC URL
    state/                      # gitignored, generated at runtime
      state.json
      key.txt
  ...
```

---

## 14. Constants

`skill/config/sepolia.ts`:

```ts
export const SEPOLIA = {
  chainId: 11155111,
  rpcUrl: process.env.SEPOLIA_RPC_URL!,         // Alchemy / Infura
  umaOov3: "0x9923D42eF695B5dd9911D05Ac944d4cAca3c4EAB",
  reportRegistry: "0x...",                       // sibling team, day-of
  ensRegistrar: "0x...",                         // deploy output
  nameWrapper: "0x0635513f179D50A207757E05759CbD106d7dFcE8",
  publicResolver: "0x...",                       // Sepolia public resolver
  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Sepolia USDC, UMA-whitelisted
  parentEnsNode: "0x...",                        // namehash("verifier.phare.eth")
  bondAmount: 5_000_000n,                        // 5 USDC, 6 decimals
  fundingThreshold: { ethWei: 20_000_000_000_000_000n, usdcBase: 5_000_000n },
};
```

Env var, declared in `SKILL.md` frontmatter as required:

- `SEPOLIA_RPC_URL`

No private key env. The skill mints its own keypair on first run.

---

## 15. Open risks

1. **OpenClaw heartbeat min cadence.** Default is 30m, unit minutes. The 20s target is unverified. Plan B: 1m heartbeat with the SPEC's now-updated 1m liveness; on demo day, request shorter cadence from the OpenClaw operator if available.
2. **Sepolia USDC variant for UMA.** Sepolia USDC pinned at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. Verify at the UMA desk on day 0 that this exact token is whitelisted in OOv3's collateral list — wrong variant = dispute reverts.
3. **Sepolia UMA minimum bond for USDC.** If UMA's minBond is above 5 USDC, bond size must be raised, faucet instructions updated.
4. **Reporter team contract coordination.** `ReportRegistry` must emit assertions through UMA OOv3 with `currency = SEPOLIA.usdc`, `bond = 5_000_000`, claim string `"Report at bzz://<meta> is true"`. Any drift breaks the verifier filter.
5. **OpenClaw skill manifest format.** Frontmatter fields and custom tool schema declaration are not fully documented in the public OpenClaw docs we surfaced. Test publish to ClawHub early — failure here blocks distribution.
6. **ENS handle collision.** Two installations sharing the last 6 hex chars of the address would collide on `agent-<tail>`. Probability is ~1/16M; demo-acceptable. Mitigation deferred.
7. **Tx revert handling.** If `disputeAssertion` reverts (e.g. assertion expired between read and tx), the skill records `skip-reason: revert` and moves on. No retry loop.
8. **State file corruption.** Atomic-rename writes mitigate. No backup. Hackathon-acceptable.

---

## 16. Out of scope

- Onchain registration of more than one agent per machine (one wallet per skill install).
- Editing policy / soul after first registration.
- Real ASI integration (mocked via `data/asi-fixtures.json`).
- Stolen-photo bloom filter, ocean-polygon check, IMO format validator (deferred to post-hackathon).
- Slash command interface (free-form chat only, per OpenClaw skill model).
- Multi-chain deployment.
- LRU pruning on `seen` set.
- Counter-bond rebalancing across multiple disputes.

---

## 17. Demo plan (verifier slice, 60 seconds)

1. Open OpenClaw chat. Skill installed.
2. User types `let's go`. Skill mints wallet, prints address + faucets.
3. User funds wallet via faucet links (off-screen, pre-arranged).
4. User types `funded`. Skill confirms balances, derives handle, uploads policy + soul to Swarm via MCP, calls `EnsRegistrar.registerEnsAgent`. Etherscan tx visible.
5. Heartbeat ticks engage. UI shows ticks landing every 20s (or 1m fallback).
6. Reporter PWA in second window submits a fake-IMO report. Liveness window starts.
7. Within one tick: skill polls UMA, parses claim, downloads metadata via Swarm MCP, looks up shadow registry (miss), asks ASI mock (verdict: fake), checks USDC balance, approves UMA, disputes. Reasoning JSON pinned to Swarm. ENS text record `verifier.lastDecision` updated.
8. Resolve `agent-1a2b3b.verifier.phare.eth` in browser → text record points at the bzz reasoning JSON. Click through to read.

---

## 18. Prize alignment

- **Best ENS Integration for AI Agents** — agent registers a real wrapped ENS subname on Sepolia, owns the NFT, sets policy / soul / runtime / lastDecision text records itself. End-to-end on-chain identity for an autonomous agent.
- **Most Creative Use of ENS** — text record `verifier.lastDecision` updated continuously by the agent itself, pointing at a Swarm-pinned reasoning trace. ENS as a live, agent-curated public log.
- **Best Agentic Venture (if reinstated)** — the verifier is an autonomous, bonded actor with on-chain reputation, capital, and skin in the game.
- **Swarm / Verified Fetch** — Swarm MCP used for both read (UMA report metadata) and write (reasoning trail, policy, soul). Hard requirement, not optional.
- **OpenClaw / ClawHub** — skill is `phare/verifier`, distributed via ClawHub, run on the user's machine via the OpenClaw heartbeat.
