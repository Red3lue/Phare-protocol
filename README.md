# Phare

> An open, bonded registry of citizen sightings of sanctioned tankers — built at ETHPrague 2026.

**Phare** (French for *lighthouse*) turns ordinary citizens with phones into a distributed sentinel network for the maritime "shadow fleet". Anyone can photograph a suspicious vessel, post a small crypto bond behind the report, and lock it into a tamper-evident, on-chain record. Autonomous verifier agents — and any human with the same bond — race to dispute fakes via an optimistic oracle. Reports that survive a short challenge window become permanent, ENS-resolvable identities for the vessels they sight.

The result is a credibly neutral, citizen-funded sighting log that journalists, NGOs, insurers, and enforcement bodies can consume without trusting any single party.

> ### Orbitport plugin fork
> The `orbitalimager` Orbitport External Plugin shipped as part of this build lives at **<https://github.com/Red3lue/orbitport>** (branch `pedro/ethprague`).
> The same tree is vendored under [`orbitport/`](orbitport/) in this monorepo for one-command local bring-up.

---

## Table of contents

1. [The problem](#1-the-problem)
2. [What Phare does](#2-what-phare-does)
3. [Architecture](#3-architecture)
4. [End-to-end flow](#4-end-to-end-flow)
5. [Repository layout](#5-repository-layout)
6. [Running it](#6-running-it)
7. [Sponsor integrations](#7-sponsor-integrations)

---

## 1. The problem

The "shadow fleet" is a cohort of tankers that move sanctioned oil while disabling their AIS transponders, faking their position, and re-flagging frequently to avoid attribution. The cost is concrete: sanctions failure, war financing, uninsured ecological disasters when an unflagged tanker spills or sinks with no liable party to recover from.

Outside expensive satellite-imagery and government-surveillance budgets, almost no one can see them. The information that *does* exist — port photos, AIS gaps, OSINT investigations — is scattered across journalists, NGOs, and insurance underwriters, none of whom can publish a tamper-evident, machine-readable, jointly-curated log.

Phare's wager is that a phone in a citizen's hand plus a small crypto bond is enough to bootstrap that log.

### 1.1 The solar-punk framing

- **Civic infrastructure, not state surveillance** — bottom-up, owned by no one.
- **Ecological accountability** — for an industry that resists oversight.
- **Bonds replace permission lists** — skin-in-the-game beats background checks.

---

## 2. What Phare does

Three interlocking layers, one user-visible artifact per layer:

| Layer | What it produces | Where it lives |
|---|---|---|
| **Citizen reporting** | A signed photo + GPS + IMO of a suspect vessel, escrowed behind a $5-equivalent WETH bond | Reporter PWA (`web/`) → `ReportRegistry.submit()` on Sepolia |
| **Optimistic adjudication** | Either a settled-truthful sighting, or a slashed bond split 50/30/20 between disputer / slash pool / treasury | UMA OptimisticOracleV3 → `ReportRegistry` callback |
| **Permanent identity** | A live, ENS-resolvable subname per sanctioned vessel (`imo-9133701.vessel.phare.eth`) and per autonomous verifier (`agent-3a4b5c.verifier.phare.eth`), with content-addressed Swarm dossiers behind both | `Lighthouse.sol` → ENS NameWrapper + PublicResolver on Sepolia |

On top of those three layers, an **orbital corroboration** loop optionally binds a satellite-imaged frame to each settled sighting, signed by a SpaceComputer KMS key, attested on-chain via `ReportRegistry.attest()`.

### 2.1 What's real and what's mocked

Honest about both, because sponsor criteria explicitly warn against shallow API wraps:

| Real | Mocked (designed to swap to real) |
|---|---|
| Sepolia contracts (`ReportRegistry`, `SlashPool`, `Lighthouse`) | Live AIS stream — fixtures-only suggester |
| UMA OOv3 dispute resolution | spaceTEE inference — rule-based stub returning `mocked: true` |
| ENS NameWrapper + PublicResolver writes via `Lighthouse` | Satellite tasking — pre-curated PNG fixtures keyed by image_id |
| Swarm content-addressed storage with Verified Fetch | OpenSanctions cross-reference — uses live API, but cached |
| SpaceComputer cTRNG nonce in metadata | |
| SpaceComputer KMS Ethereum-key signature on orbital attestations | |
| **`orbitalimager` Orbitport plugin** (the integration's *shape*, contributed back regardless of whether the imaging hardware behind it is mocked) | |

---

## 3. Architecture

Seven runtime components plus shared decentralised infrastructure.

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  Reporter PWA (web/)     │         │   Verifier skill         │
│                          │         │   (skill/, agent/)       │
│  capture · sign · submit │         │                          │
│                          │         │  poll · evaluate ·       │
│                          │         │  dispute · publish       │
└────────────┬─────────────┘         └────────────┬─────────────┘
             │                                    │
             │  submit()        disputeAssertion()│
             ▼                                    ▼
       ┌───────────────────────────────────────────────┐
       │            ReportRegistry.sol  (Sepolia)      │
       │   bonded sighting registry · UMA settlement   │
       │   slash split 50/30/20 · attest() entrypoint  │
       └───────────────┬───────────────────────────────┘
            Settled    │   OrbitallyCorroborated
                       ▼
       ┌───────────────────────────────────────────────┐
       │              Lighthouse.sol  (Sepolia)        │
       │  imo-<n>.vessel.phare.eth (sealed, registry-  │
       │     written) · <handle>.verifier.phare.eth    │
       │     (sovereign, principal-written)            │
       └───────────────────────────────────────────────┘
                       ▲
                       │ recordOrbital(imo, swarmRef, hash, prediction)
       ┌───────────────┴───────────────────────────────┐
       │     orbital-orchestrator/  +  orbitport/      │
       │                                               │
       │  fetch packets via gRPC plugin → recompose    │
       │  → upload to Swarm → KMS sign → attest()      │
       └───────────────────────────────────────────────┘

         Off-chain storage: Swarm  (photos · metadata · dossiers
         · verifier policy/soul · orbital imagery · TEE inference)
         All reads guarded by Verified Fetch — recompute-then-trust.
```

### 3.1 Trust boundaries

Three storage / authority layers, each carrying different content and different trust assumptions:

| Layer | Purpose | Trust property |
|---|---|---|
| **Smart contracts on Sepolia** | Bond escrow, UMA assertions, attestations, slash splits, ENS mints | Public, immutable, no proxies, no governance |
| **Swarm** | Photos, metadata JSON, vessel dossiers, verifier policy + soul, orbital imagery, TEE inference | Content-addressed, gateway-tamper-resistant via Verified Fetch |
| **ENS** (via `Lighthouse`) | Vessel + verifier identities, summary records, contenthash pointers to Swarm | On-chain, NameWrapper-backed, `PARENT_CANNOT_CONTROL` burnt on every child — sovereign once minted |

UMA OOv3 is the adjudication layer. `ReportRegistry` is the economic layer that holds the actual bond and applies Phare's slash split (UMA only sees its anti-spam minimum).

### 3.2 The two ENS namespaces

Both children are wrapped, both have `PARENT_CANNOT_CONTROL` burnt on mint, but their ownership models are deliberately mirror-image:

| | `imo-<n>.vessel.phare.eth` | `<handle>.verifier.phare.eth` |
|---|---|---|
| Owner of the wrapped child | `Lighthouse` contract | the verifier's principal EOA |
| `CANNOT_TRANSFER` burnt | yes — sealed forever | no — the keeper can transfer |
| Records writable by | only via `ReportRegistry` (gated by UMA settlement) | the principal directly via `PublicResolver.setText` |
| Why | a vessel cannot hold a wallet | a verifier *is* a wallet — let it speak for itself |

---

## 4. End-to-end flow

### 4.1 Happy path

1. Reporter opens the PWA in a browser. GPS captured.
2. PWA queries the **suggester** with the user's coordinates. Either lists nearby AIS-broadcasting vessels, or returns empty (the AIS-dark case) and the reporter types the IMO manually.
3. Reporter takes a photo; PWA recompresses to ~500 KB JPEG.
4. PWA pulls a fresh nonce from **SpaceComputer cTRNG** (live) and embeds it in the metadata.
5. PWA uploads photo + metadata JSON to **Swarm** via `bee-js`. Returns two `bzz://` references.
6. Reporter signs `ReportRegistry.submit(imo, aisDark, photoHash, metadataSwarm, country, cargo, lastSeen)`. The contract pulls `protocolBond + UMA_min_bond` in WETH, opens a UMA OOv3 assertion `"Report at bzz://<meta> is true"`, emits `Submitted`.
7. Liveness window starts (30s–60s for demo).
8. Verifier agents poll OOv3 for new assertions. Each fetches metadata via Verified Fetch, runs its policy (mocked ASI lookup keyed by IMO), skips locally if `ok`.
9. Liveness expires uncontested. UMA fires `assertionResolvedCallback(id, true)` on `ReportRegistry`. Bond is returned to the reporter; the truthful-settlement path calls `Lighthouse.nameVessel(imo, …)` if this is the first sighting (mints `imo-<n>.vessel.phare.eth`) or `recordSighting(...)` to refresh records.
10. The **orbital orchestrator** sees `Settled`, drives the `orbitalimager` Orbitport plugin through metadata + per-packet downloads + recomposition, uploads the recomposed PNG to Swarm, signs the `attest()` digest with the SpaceComputer KMS Ethereum key, calls `attest()`. The contract emits `OrbitallyCorroborated` and (via `Lighthouse.recordOrbital`) writes the `vessel.orbital.*` text records.

### 4.2 Adversarial path

1. A bad actor submits a Google-Images photo with fabricated coordinates against an unallocated IMO. Their on-chain submission is well-formed — Phare doesn't claim cryptographic proof of capture, only **bonded skin-in-the-game**.
2. Multiple verifiers see `Submitted`. Each fetches metadata via Verified Fetch. The ASI mock returns `fake` on the unallocated IMO.
3. Verifiers race to call `oo.disputeAssertion(...)` with a counter-bond. First-to-mine wins; losers see the slot taken and skip.
4. UMA voters resolve in favour of the disputer. UMA fires `assertionResolvedCallback(id, false)` on `ReportRegistry`. The slash split is applied: 50% to the disputer, 30% to `SlashPool`, 20% to treasury. `Settled(reportId, false)` fires. No vessel record is created.
5. The winning verifier's `verifier.lastDecision` text record now points at the reasoning JSON they pinned to Swarm at dispute time — a public record of why they ruled `fake`.

### 4.3 The orbital corroboration loop in detail

This is where the SpaceComputer integration lives. The flow inside `orbital-orchestrator/` and `orbitport/`:

```
Settled → orbital-orchestrator/src/pipeline.mjs
            │
            ├── orbitalImager-sdk: listImages()      ─────► gateway.plugin.Call
            ├── orbitalImager-sdk: getMetadata(id)   ─────► gateway.plugin.Call
            ├── for each missing packet:
            │     orbitalImager-sdk: getPacket(id,i) ─────► gateway.plugin.Call
            │       atomic write to state/sessions/<id>/packets/NNNN.png
            │       keccak256 verify against metadata
            ├── sharp.composite() → recomposed PNG
            ├── Swarm bee.uploadFile(recomposedPng) → bzz://<ref>
            ├── KMS sign EIP-191 over keccak(reportId, imageHash, keccak(prediction))
            └── ReportRegistry.attest(reportId, swarmRef, imageHash, prediction, sig)
                    ↓
             OrbitallyCorroborated event
                    ↓
             Lighthouse.recordOrbital → text records on imo-<n>.vessel.phare.eth
                  vessel.orbital.image       = bzz://<ref>
                  vessel.orbital.imageHash   = 0x…
                  vessel.orbital.tee.prediction = "<port>, <country> (mocked)"
```

The orbital flow is **resumable**. Each packet is fetched independently, hash-verified, and atomically written. Crash mid-pull and the next pipeline call picks up exactly where it stopped, reading `state.json` (the local extension of the server's `metadata.json`).

---

## 5. Repository layout

This is a pnpm + Foundry monorepo. Each top-level directory is a workspace.

```
phare-protocol/
├── contracts/              Foundry — ReportRegistry · SlashPool · Lighthouse
├── web/                    Reporter PWA — Next.js, bee-js, viem, three.js globe
├── skill/                  Verifier-agent helpers (viem) — used by agent/
├── agent/                  OpenClaw skill (phare-verifier) — see agent/SKILL.md
├── suggester/              AIS vessel suggester — DEMO mode (fixture-keyed)
├── minter/                 Minter service — Settled-event listener + ENS writes
├── orbital-orchestrator/   Settled-event listener · Orbitport pipeline · attest()
├── orbitalImager-sdk/      JS SDK for the orbitalimager plugin (v0.0.1 + v0.1.0)
├── orbitport/              Forked Orbitport — adds the `orbitalimager` plugin
│   └── plugins/pkg/plugin/orbitalimager/   gRPC server + fragmenter (Go)
├── openbao-eth-plugin-poc/ KMS-style Ethereum signing via OpenBao (POC)
├── swarm/                  Verified Fetch helper shared across services
├── fixtures/               OSINT photos, IMOs, suggester JSON, orbital fixture PNG
├── scripts/                Python helpers (smoke + downloader for orbitalimager)
└── spec/                   Source specs and ADRs
```

Top-level docs:

| File | Purpose |
|---|---|
| [`DESIGN_DOCUMENT.md`](DESIGN_DOCUMENT.md) | The merged System Requirements Specification. Single source of truth where specs disagreed. |
| [`LIGHTHOUSE_SPEC.md`](LIGHTHOUSE_SPEC.md) | The on-chain ENS layer — supersedes the older NameStone CCIP-Read path. |
| [`ENS_INIT.md`](ENS_INIT.md) | Step-by-step bootstrap of `phare.eth`, parents, and the Lighthouse mint approval. |
| [`ENS_DIAGRAMS.md`](ENS_DIAGRAMS.md) / `ens-diagrams.html` | Mermaid renders of the ENS hierarchy and the registry → Lighthouse callbacks. |
| [`ORBITALIMAGER_SPEC.md`](ORBITALIMAGER_SPEC.md) | The `orbitalimager` plugin contract — proto, on-disk layout, RPC surface. |
| [`ENS_VESSELS.md`](ENS_VESSELS.md) / [`ENS_VERIFIERS.md`](ENS_VERIFIERS.md) | Auto-generated `.md` mirrors of the live ENS ledgers (rebuilt on every pipeline run). |

---

## 6. Running it

### 6.1 Prerequisites

- Node 20+ via `nvm use` (`.nvmrc` pinned)
- pnpm 9.12+ (`corepack enable`)
- Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- Docker + Docker Compose (for the Orbitport sidecar stack)
- Python 3.11+ with `pip install Pillow` (for the orbital smoke + downloader scripts)
- A funded Sepolia EOA (~0.2 Sepolia ETH from <https://sepoliafaucet.com>)

### 6.2 First-time setup

```bash
pnpm install
cp .env.example .env       # fill in DEPLOYER_PRIVATE_KEY, SEPOLIA_RPC_URL, …

# Bring up the Orbitport plugin stack (gateway + orbitalimager sidecar)
cd orbitport && make devenv-up

# Verify the orbitalimager plugin end-to-end
python3 ../scripts/check_orbitalimager.py
```

### 6.3 Common commands

```bash
# Reporter PWA (port 3334)
pnpm dev:web

# Orchestrator pipeline — fetch fixture imagery, run inference, write ENS
pnpm --filter orbital-orchestrator process 9133701

# Download + recompose all packets from the orbitalimager plugin
node orbitalImager-sdk/src/download-image.mjs --image-id tanker-0 --out /tmp/tanker.png

# Smoke check the gateway
python3 scripts/check_orbitalimager.py

# Contracts
pnpm contracts:build
pnpm contracts:test
pnpm contracts:deploy        # Deploy.s.sol → ReportRegistry + SlashPool + Lighthouse on Sepolia
```

### 6.4 What proves it works

- `python3 scripts/check_orbitalimager.py` returns `ALL CHECKS PASSED` against a live gateway.
- `node orbitalImager-sdk/src/download-image.mjs` recomposes a pixel-identical copy of the source fixture — proving end-to-end gRPC → JSON-RPC → base64 transport + keccak verification + sharp reassembly.
- `pnpm --filter orbital-orchestrator process <imo>` produces a recomposed PNG at `orbital-orchestrator/images/<imo>/<ts>.png` and (with `.env` configured) writes `verifier.lastDecision` live to Sepolia.
- `pnpm contracts:test` passes the full Foundry suite for `ReportRegistry`, `SlashPool`, and `Lighthouse`.

---

## 7. Sponsor integrations

This section documents exactly **what** each sponsor's product was used for, **where** in the codebase, and **how deep** the integration goes.

### 7.1 SpaceComputer / Orbitport

**What:** Three real surfaces plus one shipped contribution back.

| Surface | Real or mocked | Where |
|---|---|---|
| **`orbitalimager` Orbitport Application Plugin** | **Shipped** — no photo plugin existed in the Orbitport ecosystem before; this fork adds one. Fork: **<https://github.com/Red3lue/orbitport>** (`pedro/ethprague`) | [`orbitport/plugins/pkg/plugin/orbitalimager/`](orbitport/plugins/pkg/plugin/orbitalimager/) |
| **KMS Ethereum-key on-chain attestation** | Real — EIP-191 signature, verifiable on-chain via `ECDSA.recover`, KMS address baked into `ReportRegistry` as immutable `orbitalAttestor` | [`contracts/src/ReportRegistry.sol`](contracts/src/ReportRegistry.sol) function `attest()`; sign path in [`orbital-orchestrator/src/onchain.mjs`](orbital-orchestrator/src/onchain.mjs) |
| **cTRNG nonce in citizen submission path** | Real — pulled from the live Orbitport gateway and embedded in the metadata JSON before `submit()` | `web/` reporter PWA |
| **spaceTEE inference** | Mocked (spaceTEE is on the SpaceComputer roadmap but not shipped) — rule-based stub returning `mocked: true` so consumers can filter | [`orbital-orchestrator/src/inference.mjs`](orbital-orchestrator/src/inference.mjs) |
| **Satellite tasking** | Mocked — pre-curated PNG fixtures keyed by `image_id`, the plugin fragments them into 256×256 PNG packets at boot | [`orbitport/plugins/pkg/plugin/orbitalimager/fragment.go`](orbitport/plugins/pkg/plugin/orbitalimager/fragment.go) |

The plugin's gRPC surface (`RequestImagery`, `ListImages`, `GetImageMetadata`, `GetImagePacket`) is reachable from any Orbitport gateway via `plugin.Call`. The wire shape — base64 packets, keccak-bound metadata, resumable per-packet downloads — is the contract that SpaceComputer can wire to real cameras and a real TEE later. **The integration's *shape* is the contribution**, regardless of what's behind it today.

A JS SDK ([`orbitalImager-sdk/`](orbitalImager-sdk/)) wraps the gateway with a high-level `downloadImage()` that handles resumable per-packet fetch, keccak verification (`@noble/hashes`), atomic on-disk caching, and sharp-based recomposition. A Python smoke checker ([`scripts/check_orbitalimager.py`](scripts/check_orbitalimager.py)) and Python downloader ([`scripts/download_orbitalimager.py`](scripts/download_orbitalimager.py)) prove the round-trip works end-to-end.

### 7.2 UMA (Optimistic Oracle V3)

**What:** Truth adjudication for every bonded sighting.

- `ReportRegistry.submit()` opens a UMA OOv3 assertion against the metadata Swarm reference. UMA holds only its anti-spam minimum bond; the real Phare bond stays in `ReportRegistry` so we can apply our own 50/30/20 slash split.
- `assertionResolvedCallback` and `assertionDisputedCallback` in `ReportRegistry` are the OOv3 callbacks that drive truthful-settlement (refund + Lighthouse mint) and disputed-settlement (slash + treasury) paths.
- Sepolia OOv3 pinned at `0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944`. Bond currency is **WETH** (`0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9`) because UMA's USDC variant on Sepolia has a 400-token minimum bond that's impractical for a hackathon demo.

**Where:** [`contracts/src/ReportRegistry.sol`](contracts/src/ReportRegistry.sol), [`skill/src/registry.js`](skill/src/registry.js).

### 7.3 ENS

**What:** Two namespaces under `phare.eth`, both real on Sepolia, both gas-efficient enough to mint per sighting.

- `imo-<n>.vessel.phare.eth` — one subname per sanctioned vessel ever sighted. Created on the first settled-truthful sighting, refreshed on each subsequent sighting. Owned by the `Lighthouse` contract, sealed by `CANNOT_TRANSFER`, written only via the `ReportRegistry` callback path.
- `<handle>.verifier.phare.eth` — one subname per autonomous verifier. Permissionless mint via `Lighthouse.enrollVerifier()`. The principal owns the wrapped child, writes its own `verifier.policy`, `verifier.soul`, `verifier.lastDecision` text records directly via `PublicResolver.setText`.
- The **soul** record is a deliberate design choice: each verifier ships with a self-authored markdown manifesto pinned to Swarm and pointed at via `verifier.soul` — not just structured stats, but the verifier's own voice.
- Both Family-A (vessel) and Family-V (verifier) records are designed to be live: the orchestrator and verifier skills write back on every pipeline tick.

**Where:** [`contracts/src/Lighthouse.sol`](contracts/src/Lighthouse.sol), [`skill/src/lighthouse.js`](skill/src/lighthouse.js), [`LIGHTHOUSE_SPEC.md`](LIGHTHOUSE_SPEC.md), [`ENS_INIT.md`](ENS_INIT.md).

### 7.4 Swarm (Ethswarm)

**What:** Content-addressed storage for everything that doesn't belong on-chain. Verified Fetch on every read.

- Reporter photo + metadata JSON pinned via `bee.uploadFile` / `bee.uploadData` in `web/`. Returned BMT root hash is what the reporter passes to `submit()` as `metadataSwarm`.
- Recomposed orbital imagery uploaded via `bee.uploadFile` in [`orbital-orchestrator/src/swarm.mjs`](orbital-orchestrator/src/swarm.mjs); the returned `bzz://` reference is what `attest()` writes on-chain.
- Verifier policy + soul markdown + per-dispute reasoning JSON pinned by the verifier skill.
- **Verified Fetch** is the discipline: every consumer (minter, verifier skill, orbital orchestrator) recomputes the BMT root locally on fetch and rejects mismatches. Implemented in [`swarm/`](swarm/), shared across services. AI agents get **two** anchors per report — the BMT root and the on-chain `keccak256(photoBytes)` — both must match.
- Mutable per-vessel state (latest dossier ref, latest known position) uses **Single Owner Chunks (SOC)**: `keccak256(identity || ownerAddress)` with signature verification, written by the minter, read by everyone.

**Where:** [`web/`](web/) (reporter uploads), [`swarm/`](swarm/) (Verified Fetch helper), [`orbital-orchestrator/src/swarm.mjs`](orbital-orchestrator/src/swarm.mjs).

### 7.5 OpenSanctions

**What:** Live cross-reference of every sighted IMO against the `maritime` scope (US OFAC, EU, UK, CA, AU, NZ, UN, Ukraine GUR sanctions lists).

- Called by the **minter** on `Settled` to enrich the vessel dossier with sanction reason, sanctioning body, and aliases before pinning to Swarm.
- The `vessel.sanctioned`, `vessel.sanctionReason`, `vessel.aliases` text records under `imo-<n>.vessel.phare.eth` are populated from this lookup.

**Where:** [`minter/`](minter/). API key in `.env` (`OPENSANCTIONS_API_KEY`).

### 7.6 OpenClaw / ClawHub

**What:** Runtime for the autonomous verifier agent.

- The verifier skill is published as `phare-verifier` on ClawHub. One install per verifier; each install owns its own self-generated EOA + ENS subname.
- The skill is structured as a four-phase state machine: `init` → `needs-funding` → `needs-ens` → `running`. The `running` phase polls UMA for new assertions on every heartbeat tick.
- ClawHub-only distribution — no standalone npm package, by design.

**Where:** [`agent/`](agent/) (the OpenClaw skill manifest + tools), [`skill/`](skill/) (the viem-based JS helpers it calls into). See [`agent/SKILL.md`](agent/SKILL.md) and [`skill/README.md`](skill/README.md).

### 7.7 OpenBao

**What:** A proof-of-concept Ethereum signing plugin for OpenBao, intended as the production substrate for the orbital attestor key (currently `DEPLOYER_PRIVATE_KEY` for hackathon expedience).

- Lives at [`openbao-eth-plugin-poc/`](openbao-eth-plugin-poc/) and as the `openbao-*` services in the Orbitport docker-compose stack ([`orbitport/docker/openbao/`](orbitport/docker/openbao)).
- Provides the architectural slot where SpaceComputer KMS would be replaced by self-hosted OpenBao for orgs that don't want to depend on a third-party KMS.


### 7.9 ETHPrague

**What:** The build constraint. Everything above was scoped to fit into ~17 person-hours at the venue, with every interface, schema, address, and credential frozen before the weekend (see `DESIGN_DOCUMENT.md` §14).

The prize alignment table for reference:

| Track | Hook |
|---|---|
| Future Society | Sustainability, sanctions accountability, civic privacy-respecting infrastructure |
| ENS — AI Agents | `<handle>.verifier.phare.eth` with policy, soul, runtime, stats, live `verifier.lastDecision` updated by the agent itself |
| ENS — Most Creative Use | `imo-<n>.vessel.phare.eth` — ENS subnames for physical assets that actively try to be invisible; contenthash → Swarm dossier |
| SpaceComputer | New Orbitport plugin + KMS-signed on-chain attestation + cTRNG nonce + spaceTEE call site (mock-now-real-later) |
| Best Privacy by Design | Anonymous EOA, rotatable per report, no off-chain auth |
| Best UX Flow | Single PWA: open, allow camera + GPS, photo, sign tx, see settlement |
| Verified Fetch (Swarm) | Minter + verifier skill + orbital orchestrator all recompute Swarm hashes locally; never trust the gateway |

---

## License

MIT for the application code. The forked [`orbitport/`](orbitport/) directory carries upstream's license (see `orbitport/LICENSE`).

## Acknowledgements

Built at ETHPrague 2026. Specs merged from contributions by Soro, Dev A, and Dev B (see [`DESIGN_DOCUMENT.md §20`](DESIGN_DOCUMENT.md#20-document-provenance)). The "shadow fleet" framing draws on reporting from OpenSanctions, the Kyiv School of Economics shadow-fleet trackers, and reporting by Bellingcat and the FT.
