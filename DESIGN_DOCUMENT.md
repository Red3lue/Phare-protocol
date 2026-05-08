# Phare — Design Document

> **System Requirements Specification (SRS).** High-level overview of what Phare is, what it does, what each component is responsible for, and the constraints under which it must be built. Merges the canonical `SPEC.md`, the corrections in `RUBEN_SPEC.md` and `RUBEN_SPEC_NEW.md`, the ENS schema in `ENS_SPEC.md`, the verifier-skill spec in `NICK_SPEC.md`, and the hackathon execution plan in `BUILD_PLAN.md`. Where specs disagree, the most recent supersedes — this document records the resolved view.

**Project:** Phare — open, bonded registry of citizen sightings of sanctioned tankers.
**Event:** ETHPrague 2026 hackathon, solar-punk theme.
**Builders:** three (Dev A, Dev B, Soro).
**Implementation budget at the venue:** 5h 45m per builder (~17h total) — feasible only because everything below is locked before the weekend.

---

## 1. Purpose and motivation

The "shadow fleet" is a cohort of tankers that move sanctioned oil while disabling their AIS transponders, faking their position, and re-flagging frequently to avoid attribution. They cause sanctions failure, war financing, and uninsured ecological disasters. Outside expensive satellite-imagery and government-surveillance budgets, almost no one can see them.

Phare turns ordinary citizens with phones into a distributed sentinel network. Anyone can photograph a suspicious vessel, sign the photo with their phone's secure hardware, and stake a small crypto bond behind the report. Autonomous agents — and any human with the same bond — race to dispute fakes via an optimistic oracle. Reports that survive a short challenge window become permanent, public, on-chain records. Sanctioned vessels acquire their own resolvable ENS identities; verifying agents acquire theirs; both are linked to citizen-photographed evidence persisted on decentralised storage.

The result is a credibly neutral, citizen-funded sighting log that journalists, NGOs, insurers, and enforcement bodies can consume without trusting any single party.

### 1.1 Solar-punk framing

- **Civic infrastructure, not state surveillance** — bottom-up, owned by no one.
- **Ecological accountability** — for an industry that resists oversight.
- **Bonds replace permission lists** — skin-in-the-game beats background checks.

---

## 2. Vocabulary

### 2.1 Maritime

- **Shadow fleet** — informal name for tankers that evade detection while moving sanctioned cargo.
- **AIS** *(Automatic Identification System)* — the global radio system every commercial ship is required to broadcast on.
- **AIS-dark** — a vessel that has switched off its AIS transmitter; the standard shadow-fleet signature.
- **AIS spoofing** — broadcasting a falsified position.
- **IMO number** — 7-digit, hull-bound, lifetime identifier for a ship; the closest thing a vessel has to a passport.
- **MMSI** — 9-digit identifier tied to the AIS transmitter (less permanent than IMO).
- **Flag of convenience** — registration under a lax-enforcement state (Liberia, Marshall Islands, Comoros).
- **Ship-to-ship (STS) transfer** — at-sea cargo transfer, a common cargo-laundering technique.
- **OpenSanctions** — open-data aggregator of US (OFAC), EU, UK, CA, AU, NZ, UN, Ukraine GUR sanctions lists; `maritime` scope filters specifically for sanctioned vessels.

### 2.2 Blockchain

- **EOA** — externally owned account, controlled by a private key.
- **Bond / counter-bond** — cryptocurrency locked while a claim is being adjudicated.
- **ENS** — Ethereum Name Service. Names like `nick.eth` with subnames and key-value text records.
- **Optimistic oracle** — accepts truth-claims, defaults to accepting them after a short window, but allows challenges with counter-bonds.
- **UMA OOv3** — the specific optimistic oracle implementation we use.
- **Liveness window** — challenge window before auto-settlement. 30s–1 min for demo, 6h+ in production.

### 2.3 Hardware and identity

- **Passkey** — a private key resident in a phone or laptop's secure hardware (Apple Secure Enclave, Android StrongBox, Windows TPM). Never leaves the chip.
- **WebAuthn** — the web standard that lets a browser ask the device to sign a challenge with a passkey.

### 2.4 Roles

- **Verifier** *(formerly "sentinel agent" / "disputer" / "selector")* — the actor that watches the report stream, judges credibility, and races to dispute fakes via UMA. The rename trail is documented in `ENS_SPEC.md` §1; "verifier" is canonical from this point forward. All references to `disputer.phare.eth` or `agent.stats.*` in earlier docs are read as `verifier.phare.eth` and `verifier.stats.*`.

### 2.5 Dependencies

- **Swarm** — decentralised, content-addressed storage. Files identified by `bzz://<hash>`.
- **NameStone** — service that issues ENS subnames off-chain via CCIP-Read; gas-free per mint.
- **OpenClaw** — autonomous-agent runtime; local-first agents driven by a heartbeat tick.
- **ClawHub** — public registry where OpenClaw skills are published and installed.
- **SpaceComputer / Orbitport** — orbital-services platform; we use their KMS, cTRNG, and Application Plugin layer.
- **Daimo p256-verifier** — on-chain verifier for the secp256r1 curve used by WebAuthn passkeys; falls back to RIP-7212 precompile.

---

## 3. Actors and stakeholders

| Actor | Role | Onboarding requirements |
|---|---|---|
| **Reporter** | Photographs vessels, submits sightings, posts a $5 USDC bond | Phone or laptop, an EOA funded with gas + bond, a passkey on the device |
| **Verifier** | Watches the report stream, runs cheap credibility checks, posts a counter-bond to dispute fakes | OpenClaw runtime (or a self-hosted variant), a self-generated EOA, a registered ENS subname under `verifier.phare.eth` |
| **Consumer** *(out of hackathon build scope)* | Reads the registry — journalists, NGOs, insurers, enforcement bodies, P&I clubs | A browser; ENS resolver |
| **Project team** | Operates the shared off-chain services (suggester, minter, orbital orchestrator) | Hosted infrastructure, NameStone keys, Orbitport credentials |

---

## 4. System architecture

Phare is decomposed into seven runtime components plus shared decentralised infrastructure.

### 4.1 Component map

| Component | Owner | Surface |
|---|---|---|
| **Reporter PWA** (`web/`) | Dev A | Browser-based capture, sign, upload, submit |
| **Verifier skill** (`skill/`) | Dev B | OpenClaw skill distributed via ClawHub |
| **Smart contracts** (`contracts/`) | Dev B (+ Dev A's `attest()` body) | `ReportRegistry`, `SlashPool`, `EnsRegistrar` |
| **Suggester service** (`suggester/`) | Soro | Vessel-by-coordinate lookup, demo-fixture mode |
| **Minter service** (`minter/`) | Dev A | Settled-event listener, OpenSanctions, NameStone writes |
| **Orbital orchestrator** (`orbital/`) | Dev A | Settled-event listener, Orbitport calls, KMS signing, on-chain attestation |
| **Orbital plugin** (`orbital-plugin/` / `phare-imager`) | Dev A | Orbitport Application Plugin, JSON-RPC over the Orbitport gateway |
| **Swarm helper** (`swarm/`) | Soro | Verified Fetch wrapper shared by minter and verifier skill |
| **Demo fixtures** (`fixtures/`) | Soro | OSINT photos, IMOs, suggester JSON, AIS-gap screenshots, fabricated "stolen Google Images" photo |

### 4.2 Trust boundaries

Three storage / authority layers, each carrying different content and different trust assumptions:

| Layer | Purpose | Trust property |
|---|---|---|
| **Smart contracts on Sepolia** (chainId 11155111) | Bond escrow, UMA assertions, attestations, slash splits | Public, immutable, no proxies, no governance |
| **Swarm** | Photos, metadata JSON, vessel dossiers, verifier policy + soul + activity log, mocked orbital imagery, mocked TEE inference | Content-addressed, gateway-tamper-resistant via Verified Fetch |
| **ENS via NameStone** | Vessel identities, verifier identities, summary records and contenthash pointers | Off-chain CCIP-Read resolver; project-owned write key for hackathon scope |

UMA OOv3 is the adjudication layer — voters resolve disputes; Phare's contract layer is the economic layer that holds the actual bond and applies the slash split.

### 4.3 Reporter side — `web/`

A progressive web app that runs on phones and laptops. Responsibilities:

1. Acquire camera and GPS permissions.
2. Query the suggester service with the user's coordinates and present any AIS-broadcasting vessels for selection. If the list is empty (the AIS-dark case), present a manual IMO-entry field and an "AIS-dark — visible from my position" checkbox.
3. Capture a photo, recompress client-side to roughly 500 KB JPEG.
4. Pull a fresh nonce from SpaceComputer cTRNG (real, not mocked).
5. Hash the tuple `(photo_hash, gps, timestamp, imo, ais_dark_flag, nonce)` and request a WebAuthn signature from the device's secure hardware.
6. Upload the photo and the metadata JSON to Swarm; receive two `bzz://` references.
7. Submit `ReportRegistry.submit()` from the user's EOA, escrowing a $5 USDC bond.
8. Display the 30s–1m liveness countdown, the live event stream, the eventual settlement, and — when present — the orbital corroboration badge and inferred destination.

The PWA never holds the user's identity beyond what they choose to surface. Each report can rotate the EOA. The passkey is reusable but bound to a single device.

### 4.4 Verifier — `skill/` + `contracts/EnsRegistrar.sol`

A standalone OpenClaw skill (`phare/verifier`) installed via ClawHub. Each installation is one verifier. The skill is responsible for the agent's full lifecycle: wallet, funding, ENS identity, and steady-state polling.

A four-phase state machine governs its behaviour:

| Phase | Entry condition | Behaviour |
|---|---|---|
| `init` | First run | Generate keypair, persist privately, print address and faucet links |
| `needs-funding` | Wallet exists but balances are below thresholds | Poll balances on each chat interaction; reprint faucet links |
| `needs-ens` | Wallet meets gas + bond thresholds | Derive a handle from the address tail, author default policy and soul markdown, pin both to Swarm, call the on-chain `EnsRegistrar` to mint `<handle>.verifier.phare.eth` |
| `running` | Subname registered and resolvable | Steady state — poll UMA OOv3 for new assertions, evaluate, dispute or skip |

Heartbeat ticks are suppressed in every phase except `running`; onboarding only advances on user chat input.

In `running`, on every tick the skill:

1. Polls UMA OOv3 for `AssertionMade` events whose callback recipient is `ReportRegistry`.
2. Picks the most recent unprocessed assertion (older ones wait for the next tick).
3. Filters and parses the claim string to extract the metadata Swarm reference.
4. Fetches the metadata JSON via the **Swarm MCP server** (download path), recomputing the hash.
5. Cross-references the IMO against a local shadow-vessel registry (informational only — does not branch the decision).
6. Consults a mocked ASI verdict tool, keyed by IMO with a default fallback (coordinates are passed in as inputs but do not drive the lookup).
7. If the verdict is `fake`, checks the liveness window and the verifier's USDC balance, ensures UMA has the required approval, builds a reasoning JSON, pins it to Swarm, calls `disputeAssertion` with a counter-bond, and writes the resulting `bzz://` reference into the verifier's `verifier.lastDecision` ENS text record.
8. If the verdict is `ok`, records a local-only skip — no Swarm upload, no ENS write.

A dedicated Solidity contract, `EnsRegistrar`, mediates the on-chain mint of each verifier subname. It is operator-approved by the parent name's owner during pre-event setup; afterwards, any wallet can self-register a subname. The fuse `PARENT_CANNOT_CONTROL` is burned on each child to emancipate the agent's identity from the parent.

The skill ships with default policy and soul templates the user can override post-registration (out of hackathon scope).

### 4.5 On-chain layer — `contracts/`

Two main contracts plus the verifier registrar.

| Contract | Responsibility |
|---|---|
| **`ReportRegistry`** | Stores reports keyed by report ID; escrows bonds; verifies WebAuthn signatures via Daimo p256-verifier (or RIP-7212); opens UMA OOv3 assertions; receives UMA settlement and dispute callbacks; verifies orbital attestations via `ECDSA.recover`; distributes payouts and slash shares. Immutable, no proxies, no governance. |
| **`SlashPool`** | Holds slashed-bond shares and donor seed funds; pays small per-settlement rewards to honest reporters; cannot be drained without a registered call from `ReportRegistry`. |
| **`EnsRegistrar`** | Programmatic mint of `<handle>.verifier.phare.eth` subnames via the ENS Name Wrapper, sets the verifier's three initial text records (`verifier.policy`, `verifier.soul`, `verifier.runtime`), emits an `AgentRegistered` event. |

`ReportRegistry`'s storage layout, function signatures, and events are **frozen** before the weekend — see [BUILD_PLAN.md](BUILD_PLAN.md). Both Dev A and Dev B fill in the bodies of *their* functions during the build window; no structural debate during build time.

The on-chain `attest()` function records a fresh orbital corroboration on a previously-settled report. It verifies an EIP-191 signature from the SpaceComputer KMS-derived address (baked in at deploy time as `orbitalAttestor`), sets the orbital flags on the stored report, and emits an `OrbitallyCorroborated` event consumed by the minter.

### 4.6 Off-chain services — `suggester/`, `minter/`, `orbital/`, `orbital-plugin/`

**Suggester** — for the hackathon, **DEMO mode only**. Returns pre-recorded fixture JSON keyed by demo coordinates. The live AIS-stream mode is stubbed with a "not implemented" comment. Ships as a minimal HTTP server.

**Minter** — subscribes to `ReportRegistry.Settled` events. For each settled report:

- Looks up the IMO in OpenSanctions `maritime` scope.
- If sanctioned: assembles the vessel dossier JSON (full sighting history, `orbital_corroboration` block when present, attribution), pins it to Swarm, and calls the NameStone API to mint `imo-<n>.vessel.phare.eth` on first sighting or update the records on subsequent sightings.
- Mirrors the dossier reference into both `vessel.swarm.log` (text record) and `contenthash` (ENS-native) on each update.
- On `OrbitallyCorroborated`, refreshes the dossier and writes the `vessel.orbital.*` family of records.

The minter additionally tracks UMA settlement events to update `verifier.stats.*` records (`disputes`, `won`, `lost`, `skipped`, `lastActive`, `bondBalance`) and rebuild each verifier's per-verifier activity log (re-pinned to Swarm and mirrored into `verifier.swarm.log` and `contenthash`). Splitting verifier-stats writes into a separate `verifier-stats/` watcher is cleaner but optional. Note: `verifier.lastDecision` is written by the verifier skill itself at dispute time (`NICK_SPEC.md` §8), not by the minter.

**Orbital orchestrator** — subscribes to `ReportRegistry.Settled`. For each settled report it drives the `phare-imager` plugin through three stages: imagery request, TEE inference request, and on-chain attestation. The orchestrator is real; the imagery and inference backing it is mocked (see §7).

**Orbital plugin (`phare-imager`)** — a real Orbitport Application Plugin, published to the Orbitport ecosystem, conforming to JSON-RPC 2.0 over the Orbitport gateway endpoint with Client ID + Secret authentication. It exposes four methods covering imagery tasking, the imagery-ready callback, inference request, and the inference-ready callback. The plugin is the artefact contributed to Orbitport regardless of whether the underlying imaging hardware and TEE are mocked — it defines the *shape* of the integration that SpaceComputer can later wire to real celestial-layer plugins.

---

## 5. End-to-end flows

### 5.1 Happy path — honest reporter, uncontested settlement

1. The reporter opens the PWA. The browser captures GPS coordinates.
2. The PWA queries the suggester. The list is empty (AIS-dark) or the reporter selects a vessel.
3. The reporter takes a photo and confirms the IMO.
4. The PWA pulls a fresh nonce from cTRNG, hashes the metadata tuple, and requests a WebAuthn signature.
5. The PWA uploads the photo and metadata JSON to Swarm.
6. The wallet signs `ReportRegistry.submit()`. The contract verifies the WebAuthn signature, pulls $5 USDC into escrow, opens a UMA OOv3 assertion `"Report at bzz://<meta> is true"`, and emits `Submitted`.
7. The liveness window starts (30s–1m for demo).
8. Verifiers poll, fetch metadata, run cheap fakeness checks, see no anomaly, skip locally.
9. Liveness expires uncontested. UMA fires `assertionResolvedCallback(id, true)` on `ReportRegistry`. The contract returns the bond and triggers `SlashPool.payReward()` for the small reward (when the reward is enabled — see §8).
10. The minter sees `Settled`, queries OpenSanctions, builds the dossier, pins it to Swarm, mints or updates `imo-<n>.vessel.phare.eth` via NameStone. The vessel is now publicly resolvable.
11. The orbital orchestrator sees `Settled`, drives the plugin through imagery + inference + KMS signing, and submits `attest()`. `OrbitallyCorroborated` fires; the minter refreshes the dossier and writes the `vessel.orbital.*` records.

### 5.2 Adversarial path — stolen photo, dispute and slash

1. A bad actor submits a Google-Images photo with fabricated coordinates. Their WebAuthn signature is still valid — the protocol does **not** claim cryptographic proof of capture, only bonded skin-in-the-game.
2. Multiple verifiers see the `Submitted` event. Each fetches the metadata via Verified Fetch and runs its policy.
3. One or more verifiers' policies fire (the ASI mock returns `fake` — keyed on an unallocated or otherwise suspicious IMO per `NICK_SPEC.md` §7.5). Each races to call UMA's `disputeAssertion` with a counter-bond.
4. First-to-mine wins. The losing verifiers see the slot taken and skip.
5. UMA voters resolve in favour of the disputer. UMA fires `assertionResolvedCallback(id, false)` on `ReportRegistry`.
6. `ReportRegistry` applies the slash split: 50% to the disputer, 30% to `SlashPool`, 20% to the treasury. `Settled(reportId, false)` fires.
7. The minter refreshes the disputer's `verifier.stats.won` and the disputer's activity log entry on Swarm. The verifier's `verifier.lastDecision` text record points at the reasoning JSON they pinned at dispute time.

### 5.3 Honest reporter, mistakenly disputed (self-funded path)

If a verifier disputes an honest report and UMA voters uphold the report, the verifier's counter-bond is slashed and funds the reporter's compensation. `SlashPool` is **not touched** in this path. This narrows the slash-pool drain considerably (see §8).

### 5.4 Orbital corroboration — sequence with mock layers

Independent of dispute outcome, every settled report can also receive an orbital corroboration. The orchestrator calls `phare.requestImagery` on the plugin; the plugin (mocked, fixture-keyed) returns a public maritime image plus capture metadata; the orchestrator pins both to Swarm; calls `phare.requestInference`; the plugin (mocked, rule-based stub) returns a destination prediction with a `mocked: true` flag; the orchestrator pins the inference JSON; signs the attestation digest with the SpaceComputer KMS Ethereum key (real); calls `attest()`; and the contract emits `OrbitallyCorroborated`. The minter then writes the `vessel.orbital.*` records and refreshes the dossier.

---

## 6. Identity and ENS namespace design

Two namespaces under the project's parent ENS name. Both nested levels are minted via NameStone's CCIP-Read off-chain resolver — there are no on-chain registrars except for the verifier path, which uses the Name Wrapper directly via `EnsRegistrar`.

### 6.1 Vessel namespace — `imo-<n>.vessel.phare.eth`

One subname per sanctioned vessel ever sighted. Created on the **first** settled sighting; subsequent sightings update its records.

**Core records**: IMO, sanctioned flag, sanction reason, aliases, AIS-dark flag (sticky once true), first reporter, append-only list of reporters, append-only list of verifiers that ruled on disputes touching this vessel, sightings count, disputed-sightings count, last seen `(unix, lat, lon)`, Swarm log reference, ENS contenthash mirroring the same Swarm reference.

**Orbital records** (`vessel.orbital.*`): satellite imagery Swarm reference, attested image hash, capture timestamp, KMS-derived attestor address, TEE prediction Swarm reference, TEE-predicted destination string, TEE confidence string, orbital-confirmation counter.

**Why both `vessel.swarm.log` and `contenthash`** — `contenthash` is the ENS-native binding consumed by ENS-aware browsers; its multicodec encoding is awkward for non-ENS tooling, so the plain text-record mirror is provided for everything else. Both always point at the same Swarm hash.

### 6.2 Verifier namespace — `<handle>.verifier.phare.eth`

One subname per registered verifier. Records split into four families:

| Family | Records | Update cadence |
|---|---|---|
| **Identity** | `verifier.handle`, `verifier.principal`, `verifier.address`, `verifier.runtime`, `verifier.created` | Once, at registration |
| **Soul** | `verifier.soul` — Swarm reference to a self-authored markdown document | Rarely; the verifier's own voice |
| **Policy** | `verifier.policy` (JSON Swarm reference), `verifier.policy.version` (semver), `verifier.skill` (ClawHub skill identifier + pinned version) | When the verifier changes its dispute policy |
| **Stats** | `verifier.stats.disputes`, `verifier.stats.won`, `verifier.stats.lost`, `verifier.stats.skipped`, `verifier.stats.lastActive`, `verifier.stats.bondBalance`, `verifier.swarm.log`, `contenthash`, `verifier.lastDecision` | Live — written on each settled UMA assertion the verifier touched, plus per-dispute decision reasoning |

The **soul** is a deliberate design choice — it is the verifier operator's narrative self-description (manifesto, policy rationale, motto), distinct from the structured policy JSON. Rare among on-chain agent registries, which typically expose only structured stats. The soul, plus `verifier.lastDecision` (which is rewritten on every dispute by the agent itself) is what makes the ENS records a live, agent-curated public log rather than a static profile.

### 6.3 Naming convention for verifier handles

Each OpenClaw verifier installation derives its handle from the last six hex chars of its self-generated address: `agent-<tail>`. Collisions are theoretically possible (~1 in 16M) but acceptable for the demo.

### 6.4 Write authority

For the hackathon, all NameStone writes flow through a single project-owned key. This means the project team is technically capable of overwriting any record, including `verifier.stats.*`. Acceptable for hackathon scope; flagged for future hardening (either restrict NameStone authority per name or commit stats hashes on-chain).

---

## 7. SpaceComputer integration — build vs mock vs ships

A central design principle: **be honest about what is real and what is mocked.** SpaceComputer's bounty criteria explicitly warn against shallow API wraps. This integration has three real surfaces, two mocked surfaces, and a clear path for each mock to become real once SpaceComputer ships the corresponding capability.

### 7.1 What Phare BUILDS (real contributions)

1. **`phare-imager` Orbitport Application Plugin.** No photo-tasking plugin exists in the Orbitport ecosystem today. Phare ships one — a TypeScript module conforming to the JSON-RPC 2.0 contract with four methods (imagery request + ready callback, inference request + ready callback). The plugin is published to the ecosystem regardless of the mock layers underneath. It defines the integration's *shape* that SpaceComputer can wire to real cameras and a real TEE later.

2. **KMS ETHEREUM key as on-chain attestation.** The KMS scheme produces EIP-191 signatures verifiable on-chain natively via `ECDSA.recover` — no precompile, no custom verifier. The KMS-derived Ethereum address is hardcoded into `ReportRegistry` at deploy time as `orbitalAttestor`. The orchestrator signs every corroboration through the live KMS endpoint. This is real, not mocked.

3. **`ReportRegistry.attest()` as the on-chain side of the integration.** A real, immutable contract function that any orbital attestor (today, our KMS address; tomorrow, a multi-attestor scheme) can call to bind an off-chain corroboration to a settled report.

4. **cTRNG nonce in the citizen submission path.** The reporter PWA pulls a cosmic-randomness nonce from the live cTRNG endpoint and embeds it in the metadata tuple. Small, real, additional integration surface.

### 7.2 What Phare MOCKS (hackathon shortcuts)

1. **Satellite tasking and imagery source.** Inside the plugin, `requestImagery` returns immediately and a short async delay (5–30s) simulates orbital-callback latency. The actual image bytes come from a pre-curated fixture set keyed by `(lat, lon)`: public maritime imagery (Sentinel-2 ESA scenes, freely licensed) and demo-fixture photos pre-fetched for the specific demo coordinates (Cyprus, Laconian Gulf). Each fixture has hand-attached capture metadata (timestamp, fake sensor name, resolution, lat/lon).

2. **spaceTEE inference.** Per the SpaceComputer architecture docs, spaceTEE is on the roadmap but not yet shipped. There is no production endpoint to call. The plugin runs against a local rule-based stub that combines the vessel's last-seen coordinate, an extrapolated heading from prior sightings, and a static map of likely destination ports for sanctioned-tanker routes, returning a destination string, a confidence number, supporting log references, and route candidates. The output JSON always carries `"mocked": true` so consumers can filter.

3. **KMS ceremony fallback.** If the KMS endpoint is unreachable on demo day, the orchestrator falls back to a locally-generated Ethereum key with the same address baked into a redeployed `ReportRegistry`. The `mocked` flag is propagated into the dossier JSON so judges can see what was real and what wasn't.

### 7.3 What SpaceComputer SHIPS today

Per `docs.spacecomputer.io`: the Celestial layer (cEDGE, Crypto2 — live), the Terrestrial layer (live), the Application layer REST/JSON-RPC gateway (live, currently exposes only cTRNG), the KMS with TRANSIT and ETHEREUM key schemes (live, experimental). spaceTEE is **planned, not shipped**. No Imaging plugin exists today.

This is precisely why the contribution is meaningful: Phare builds the call site and the data contract that SpaceComputer can wire up later.

---

## 8. Bond economics and the slash pool

### 8.1 Default split on dispute resolution against the reporter

| Recipient | Share |
|---|---|
| Disputer (winning verifier) | 50% |
| Slash pool | 30% |
| Treasury | 20% |

**Important coordination note**: UMA's own bond mechanics burn ~50% of the loser's bond internally if the real bond is held inside UMA. The fix recorded in `RUBEN_SPEC.md` is to use UMA with a minimum bond (anti-spam only) and hold the real $5 bond in `ReportRegistry`, applying Phare's split there. UMA is the truth oracle; `ReportRegistry` is the economic layer.

### 8.2 Honest-report rewards

On uncontested settlement, the reporter's bond is returned. Whether a small reward (originally $0.10 from `SlashPool`) is also paid is **a design decision still open**:

- **With reward**: matches the original SPEC. Drains the slash pool steadily under expected conditions (most reports honest).
- **Without reward**: the slash pool only grows (from slashed bad actors) and never shrinks. Reporters are motivated by civic duty plus bond return.

The two modes are compatible with the insurer-funding model below; the project ships either one.

### 8.3 Slash-pool sustainability and the insurer-funding model

The slash-pool drain is narrower than a naive reading suggests, because of the two settlement paths for honest reports:

- **Undisputed honest** — pool pays the reward (when enabled). This drains the pool.
- **Disputed-but-honest** — the failed disputer's counter-bond funds the reporter's compensation. The pool is **not** touched.

So the pool only needs to cover rewards on clean, uncontested settlements. Reports that attract a bad-faith or mistaken dispute are self-funded by the failed disputer.

**Funding model**: insurers (P&I clubs, marine underwriters, reinsurers) have the strongest financial incentive for accurate sighting data. Shadow-fleet vessels operate without insurance; when they spill or sink there is no liable party to recover from. Tamper-evident, timestamped sighting records give insurers legal and actuarial leverage. A subscription is cheap relative to a single uninsured spill claim.

**Mechanism**: a `RegistryAccess` contract (or off-chain API gate) issues time-limited read credentials on payment. Funds route to `SlashPool` (with an optional small treasury cut). Access tiers: free (rate-limited public), paid standard (full history), paid enterprise (webhook push on settlements). The free tier preserves the credibly-neutral, open-data ethos for civic users.

This model, the no-reward variant, and the original spec are all compatible. **Out of hackathon build scope** — designed-in but not implemented this weekend.

### 8.4 Why UMA and not a custom oracle

The optimistic-oracle pattern (submit, wait, auto-settle) is simple to implement; the hard problem is who adjudicates a dispute. The non-UMA options are a trusted multisig (centralised, defeats the credible-neutrality argument) or a custom token-based voting system (enormous scope, untested security). UMA OOv3 is pre-deployed, battle-tested, and credibly neutral. UMA token holders vote correctly or lose their own stake — economic alignment replaces institutional trust.

---

## 9. Storage model — what lives where

### 9.1 On-chain (Sepolia, chainId 11155111)

- The `reports` mapping (one `Report` struct per report ID, including the metadata Swarm reference, bond, settlement flags, dispute flags, orbital flags, and orbital image hash).
- The `assertionId → reportId` mapping for UMA callback routing.
- `SlashPool` USDC balance.
- The immutable `orbitalAttestor` address.
- UMA OOv3 assertions (claim string + ancillary data — gateway URL for voters).

### 9.2 Off-chain — Swarm (content-addressed)

- The reporter's photo (~500 KB JPEG).
- The metadata JSON (~1 KB) — `{ photo: bzz://, gps, timestamp, imo, ais_dark_flag, signature, nonce, ... }`.
- The vessel dossier JSON — full sighting history aggregated per IMO, including the `orbital_corroboration` block when present.
- The mocked orbital imagery (and its capture metadata).
- The mocked TEE inference JSON, always carrying `"mocked": true`.
- Per-verifier policy JSON.
- Per-verifier soul markdown.
- Per-verifier activity log JSON.
- Per-dispute reasoning JSON pinned by the verifier skill at dispute time.

All Swarm reads are wrapped in **Verified Fetch**: recompute the SHA-256 of the fetched payload locally, compare against the reference hash, reject mismatches. This applies symmetrically to the minter, the verifier skill, the orbital orchestrator, and any consumer.

**Stamp lifetime constraint**: Swarm postage stamps must outlive the dispute window. UMA's DVM resolution can take 48–96 hours after a dispute is raised (separate from the liveness window, which is 30s–1m for demo and 6h+ for production). For production, minimum ~5 days of stamp coverage; for the demo, irrelevant.

**Voter-readable gateway**: UMA's `ancillaryData` should include a working HTTPS Swarm gateway URL (not a raw `bzz://` URI), since most voters do not run a Bee node.

### 9.3 ENS (resolved via NameStone CCIP-Read; no per-record gas)

ENS records carry summaries and pointers; the canonical, append-only history and the freeform descriptions live on Swarm. Each Swarm update mints a new content hash; the ENS pointer is updated to the new hash via NameStone. See §6 for the full schema.

---

## 10. Verified Fetch — Swarm as a primitive

Phare's design exposes a deeper insight than a vessel-tracking application: at its core, the protocol is a **bonded photo claim primitive** — signed photo on Swarm, signed metadata on Swarm, UMA assertion, Verified Fetch, dispute via counter-bond. The pattern is domain-agnostic and applies to illegal logging, oil spills, environmental violations, citizen evidence chain-of-custody, missing-persons sightings, NGO incident reports — anything where a phone-captured photo with cryptographic provenance becomes an arbitratable record.

The recommended folder structure expresses this generality without duplicating implementation work: a `core/` module containing the abstract `BondedPhotoClaim` contract, the verifier skill base class with pluggable fakeness checks, the Verified Fetch helper, and the Web SDK primitives; and a `vessel-app/` module that imports the core and adds the maritime-specific layer (IMO field, OpenSanctions, NameStone vessel subnames, maritime fakeness checks, SpaceComputer corroboration).

**Scope discipline**: do not double the implementation work to "prove" the abstraction. If the team has time to ship the `core/` vs `vessel-app/` split (see §19), the generalisation lives in the folder structure and in `BondedPhotoClaim` being abstract; otherwise the abstraction is signalled in documentation only. One working vessel application is sufficient. The framing is "designed to generalise" — do not claim a framework that was not shipped.

---

## 11. Trust model and credible neutrality

Each layer of the system makes a different trust claim:

- **Reporter device** — trusted to hold a passkey; not trusted not to lie. Bond replaces background check.
- **Reporter EOA** — trusted to be the principal that signed the on-chain submission; rotatable per report for privacy.
- **WebAuthn signature** — verified on-chain; binds the metadata tuple to *some* device. Does not certify that the photo was captured with the device's camera; certifies only that the claim was bonded by someone with the passkey.
- **Verifier policy** — public on Swarm; consumers can judge a dispute outcome against the verifier's declared checks.
- **UMA OOv3 voters** — trusted via UMA's economic alignment, not institutional trust.
- **OpenSanctions** — trusted as a public, daily-updated open-data source; the vessel's sanction status is cached into ENS but the canonical source is OpenSanctions itself.
- **NameStone** — write authority for the demo; gateway-only-trust-on-write, the resolved values can be independently verified through NameStone's CCIP-Read mechanism.
- **SpaceComputer KMS** — trusted for the duration of the experimental key; mocked fallback documented in §7.
- **Swarm gateways** — not trusted; Verified Fetch removes the trust requirement at the consumer level.

---

## 12. Privacy model

The project explicitly targets the "Best Privacy by Design" prize.

- The reporter EOA is anonymous and rotatable per report.
- The passkey lives in the device's secure hardware and never leaves it.
- No off-chain authentication, no email, no phone, no KYC — at any layer that touches a citizen.
- The metadata JSON contains GPS and timestamp; this is the price of the report's truthfulness claim.
- The `vessel.reporters` and `vessel.firstReporter` ENS records are open privacy questions (`ENS_SPEC.md` §9) — listing an EOA permanently next to a sanctioned vessel is a soft de-anonymisation surface. Options: omit from ENS, keep only behind a salted hash in the Swarm log, or accept the trade-off. Decision needed before any mainnet launch; demo-acceptable as-is.
- The verifier identity is **public by design** — its principal, policy, soul, and stats are advertised so consumers can interpret its disputes. The verifier's principal address is in the records; this is a design feature, not a leak.

---

## 13. Demo plan (3 minutes)

1. **Hook** — one sentence on shadow fleet and ecological cost.
2. **Live happy-path submission** — a Mac browser in demo-mode location (off Cyprus). Suggester returns empty list (AIS-dark). Reporter ticks AIS-dark, types a real OpenSanctions-listed IMO (PABLO, IMO 9133701), picks an OSINT photo, taps Touch ID. Swarm upload, submit, 30s liveness ticking visibly.
3. **Adversarial submission** — second tab with a deliberately stolen Google-Images tanker photo paired with an unallocated IMO that the ASI mock flags as `fake` (per `NICK_SPEC.md` §7.5). Multiple verifier installations race in mempool. The fastest mines the dispute. Winner's `verifier.stats.won` increments live via NameStone.
4. **Settlement of legit report** — liveness expires uncontested. Bond returns to reporter (with reward, depending on §8 decision). Minter mints `imo-9133701.vessel.phare.eth` and sets the records. Resolve in browser; show the records (sanction reason, AIS-dark flag, contenthash to the Swarm dossier including the photo). Show the orbital corroboration badge once the orchestrator's pipeline lands.
5. **Close** — three artifacts on screen: vessel ENS subname, verifier ENS subname, Swarm dossier. *"One PWA, one ClawHub skill, a global sentinel network."*

A backup video is recorded **before** the live demo runs. If the live demo breaks, the video plays.

---

## 14. Build scope (hackathon)

The README's original scope is ~55–65 hours of work. SpaceComputer adds ~24–32 hours. The ENS expansion adds ~8–12 hours. Combined scope is ~87–109 hours. Total venue budget is ~17 person-hours. This is roughly an 80–85% compression and is feasible only because:

1. Every interface, schema, address, and credential is frozen before the weekend.
2. Every subfolder is scaffolded — empty-but-runnable repos with toolchain in place.
3. Every fixture is sourced and committed.
4. Every dev walks in knowing exactly which files they own and which they cannot touch.

### 14.1 Work split

| Builder | Vertical | Owns |
|---|---|---|
| **Dev A** | ENS + SpaceComputer + frontend (the **demo-visible** path) | `web/`, `minter/`, `orbital-plugin/`, `orbital/`, `attest()` body in `ReportRegistry` |
| **Dev B** | UMA + OpenClaw skill (the **protocol-economic** path) | `ReportRegistry.sol` (everything except `attest()` body), `SlashPool.sol`, `EnsRegistrar.sol`, `skill/`, deployment scripts |
| **Soro** | Swarm + suggester + demo (the **integration glue**) | `suggester/` DEMO mode, `swarm/` Verified Fetch helper, `fixtures/`, demo video |

### 14.2 Shared territory: `ReportRegistry.sol`

This is the only file two devs both need to touch. The whole contract is pre-written as an interface-only skeleton before the weekend — every function signature, every event, every storage slot, every modifier, every revert string, with empty bodies and NatSpec. Both devs fill in the bodies of *their* functions during the weekend. No structural debate during build time.

### 14.3 Coordination contracts (frozen before the weekend)

| Boundary | Owners | Frozen artifact |
|---|---|---|
| `submit()` signature + WebAuthn payload | A calls ↔ B verifies | Exact byte order, hash algo, signature encoding |
| WebAuthn signing payload | A signs ↔ B verifies | Exact ABI encoding of the metadata tuple |
| `Submitted` event | B emits ↔ minter + skill consume | Field set, indexing |
| `Settled` event | B emits ↔ minter + orbital orchestrator consume | Field set |
| `attest()` signature | A calls ↔ B's contract storage | Function signature + EIP-191 digest layout |
| Metadata JSON schema | A writes ↔ skill reads | Field names, ordering for hashing, encoding |
| Dossier JSON schema | minter writes ↔ vessel ENS contenthash resolves | Includes `orbital_corroboration` block |
| Verified Fetch helper | Soro writes ↔ minter + skill consume | Module export, error semantics on hash mismatch |
| Slash math (50 / 30 / 20) | B implements ↔ A's UI displays | Documented; not negotiated during build |

### 14.4 Pre-event checklist (highlights)

Credentials and addresses (commit `.env.example` with every name): UMA OOv3 address on Sepolia (`0x9923D42eF695B5dd9911D05Ac944d4cAca3c4EAB`), Daimo p256-verifier address on Sepolia, NameStone API key + parent + nested subdomain config, OpenSanctions API key, Swarm postage stamp ID or Bee endpoint, Orbitport Client ID + Secret, KMS Ethereum key provisioned (address recorded, hardcoded into `ReportRegistry`), Sepolia faucet (three funded EOAs for reporter / verifier / attester), Sepolia USDC (UMA-whitelisted variant — pinned at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` per `NICK_SPEC.md` §14, verify at the UMA desk on day 0).

Fixtures (committed in `fixtures/`): 2–3 vessel IMOs verified in OpenSanctions `maritime` (PABLO 9133701, YOUNG YONG 9259325, plus a backup), OSINT photos with attribution, suggester JSON, AIS-gap screenshots, one fabricated "stolen Google Images" photo paired with an unallocated IMO for the adversarial demo. The verifier skill's `asi-fixtures.json` and `shadow-vessels.json` ship inside `skill/data/` per `NICK_SPEC.md` §7.6 — not in `fixtures/`.

Scaffolding: every subfolder must compile and run an empty-but-valid main path before the weekend.

ENS pre-event setup: acquire the parent name on the chosen testnet, wrap it in the Name Wrapper, mint the `verifier.<parent>` subnode, burn `CANNOT_UNWRAP` on it, deploy `EnsRegistrar` with the parent node's namehash baked in, and approve the registrar as Name Wrapper operator from the parent owner key.

### 14.5 Day-of rules

- No design debate. If a decision was not made before the weekend, take the simplest path and move on.
- No new dependencies. If a library is not in `package.json` / `foundry.toml` already, do not add it during the build window.
- No refactoring. Bodies fill in skeletons. Names already chosen. Even if you'd write it differently, don't.
- Commit every 30 min minimum. Both senior devs touch `contracts/` — small commits keep merges manageable.
- Soro is the integration tester. As Dev A and Dev B finish each piece, Soro runs the end-to-end smoke flow and reports breakage.

---

## 15. Out of scope

- ML / vision-based deep image authenticity. The verifier skill ships only the ASI verdict mock (keyed by IMO) and the local shadow-vessel registry lookup; perceptual-hash bloom filter, ocean-polygon check, and IMO-format validator are deferred per `NICK_SPEC.md` §16.
- Polished consumer dashboard for journalists / NGOs.
- Standalone npm distribution of the verifier skill — ClawHub-only.
- Production hardening (rate limits, retries, monitoring, alerting).
- Multi-chain deployment.
- Decentralisation of the suggester and minter services — run by the project team for the hackathon.
- Live AIS production mode of the suggester — fixtures-only at demo time; live mode is a stub with a "not implemented" comment.
- Stealth addresses (EIP-5564) for at-risk reporters.
- DAO, governance, token launch.
- Trezor signing path.
- Agent-to-agent dispute consensus before submission.
- Apify, Sourcify, Umia integrations for narrative fit (Sourcify is a free pickup if the deploy-and-verify step lands; Umia was decided against after the sponsor conversation).
- Real ASI hookup in the verifier skill — fixture-keyed mock for the hackathon.
- Editing verifier policy or soul after first registration.
- Multi-agent install per machine (one wallet per skill install).
- LRU pruning on the verifier's `seen` set.

---

## 16. Most likely failure modes and mitigations

- **UMA OOv3 callback signatures mismatch on-chain reality** — confirm at the sponsor desk on day 0 before writing `submit()`. The Sepolia deployment is pinned at `0x9923D42eF695B5dd9911D05Ac944d4cAca3c4EAB` per `NICK_SPEC.md`; verify it is still live and that USDC is whitelisted as collateral.
- **KMS Ethereum scheme is experimental** — provision the key on Friday, sign a test message, recover the address on-chain. Verify before committing to the orbital flow. If broken, drop SpaceComputer to the cTRNG-only fallback (cTRNG nonce in WebAuthn signing is shallow but ships).
- **NameStone nested subdomain config not working** — test before the weekend. If broken, fall back to flat subdomains under the parent.
- **Swarm postage stamps unavailable at the venue** — run our own Bee on Gnosis (~half a day of budget — would blow up the timeline, so confirm stamps before the weekend).
- **Daimo p256-verifier not deployed on the chosen chain** — RIP-7212 should make this a no-op fallback, but verify.
- **Verifier skill takes longer than 90 min** — cut to a single fakeness check (the ASI verdict mock); the demo only needs one to fire.
- **OpenClaw heartbeat minimum cadence is too long** — default may be 30 minutes. Plan B: 1m heartbeat with 1m liveness; on demo day, request shorter cadence from the OpenClaw operator if possible.
- **Sepolia USDC variant for UMA** — Sepolia USDC is pinned at `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (the UMA-whitelisted variant per `NICK_SPEC.md`). Verify at the UMA desk on day 0 that this exact token is in OOv3's collateral list — wrong variant means dispute reverts.
- **UMA minimum bond may exceed $5** — verify on day 0; raise the bond (and faucet instructions) if needed.
- **Verifier ENS handle collisions** — ~1 in 16M; demo-acceptable; mitigation deferred.

---

## 17. Open questions

- `vessel.reporters` privacy — leave it on-chain via ENS, hash it, or omit entirely?
- Should `vessel.firstReporter` exist at all? Same privacy concern, arguably worse because it singles out one address.
- ENS list-size ceilings on `vessel.reporters` and `vessel.verifiers` — truncate to most-recent-N or migrate to log-only at scale?
- Should verifier souls be cryptographically signed by the verifier's address key? Out of hackathon scope; flagged as a v2 feature.
- Should the `tee.mocked` flag also be exposed as an ENS text record, or stay only inside the inference JSON? Decision: keep in JSON; ENS records stay clean.
- AISStream.io free-tier rate limits sufficient for a future live mode of the suggester?
- Optimal liveness window vs UMA's minimum allowed? Demo at 30s–1m; production at 6h+.
- Reward on uncontested honest settlements: keep, drop, or make it a runtime parameter? See §8.2.
- Insurer-funding model — designed-in but not implemented. Specify access-tier API, pricing, and on-chain `RegistryAccess` contract before any production launch.

---

## 18. Prize alignment

The build is structured so that work on the critical path also earns prize submissions; no scope is added purely for prize framing.

| Prize | Sponsor | Hook | Confidence |
|---|---|---|---|
| Future Society | ETHPrague | Sustainability, sanctions accountability, civic privacy-respecting infrastructure | High |
| ENS — AI Agents | ENS | `<handle>.verifier.phare.eth` with policy, soul, runtime, stats, and live `verifier.lastDecision` text record updated by the agent itself | High |
| ENS — Most Creative Use | ENS | `imo-<n>.vessel.phare.eth` — ENS subnames for physical assets that actively try to be invisible; contenthash → Swarm dossier | High |
| SpaceComputer | SpaceComputer | New Orbitport Application Plugin + KMS-signed on-chain attestation + cTRNG nonce + spaceTEE call site (mock-now-real-later) | High |
| Best Privacy by Design | ETHPrague | Anonymous EOA + WebAuthn passkey, rotatable per report, no off-chain auth | High |
| Best UX Flow | ETHPrague | Single PWA: open, allow camera + GPS, photo, Touch ID, see settlement | Medium |
| Best Hardware Usage | ETHPrague | Daimo p256-verifier + Secure Enclave / StrongBox / TPM passkeys | High |
| Verified Fetch | Swarm | Minter + verifier skill + orbital orchestrator all recompute Swarm hashes locally; never trust the gateway | High |
| Sourcify (free pickup) | Sourcify | Foundry deploy + Sourcify verification on the deploy step | Free pickup if it lands |

Realistic target: **$14k–17.5k**. Umia was dropped after the sponsor conversation — its agent-venture criteria (governance, token, capital-formation) are not where Phare's centre of gravity is, and reframing would have added scope that does not serve the core product.

---

## 19. Repository layout

```
phare-protocol/
  contracts/        # Foundry — ReportRegistry, SlashPool, EnsRegistrar
  web/              # Reporter PWA — camera + GPS + WebAuthn + Swarm upload + viem
  skill/            # phare/verifier — OpenClaw skill, published on ClawHub
  suggester/        # AIS vessel suggester (DEMO mode for hackathon)
  minter/           # OpenSanctions + NameStone vessel + verifier-stats writer
  orbital/          # Settled-event listener → Orbitport plugin → KMS sign → attest()
  orbital-plugin/   # phare-imager — Orbitport Application Plugin (JSON-RPC 2.0)
  swarm/            # Verified Fetch helper (shared by minter, skill, orbital)
  fixtures/         # OSINT photos, IMOs, suggester JSON, AIS-gap screenshots, adversarial-demo photo
  spec/             # this document, the source specs, and ADRs
  scripts/          # deployment, demo seeders, faucet helpers
```

The `core/` vs `vessel-app/` split sketched in §10 is the recommended structure if the team has time to lift the abstract `BondedPhotoClaim` contract and the verifier skill base class out of the vessel-specific code. For the hackathon, a single tree with the vessel application is acceptable; the abstraction is signalled in documentation, not shipped.

---

## 20. Document provenance

This Design Document supersedes nothing — it merges the following authoritative sources for a single readable overview:

- `SPEC.md` — original Phare specification.
- `RUBEN_SPEC.md` — adds insurer-funding model, drops Umia, adds first SpaceComputer integration design.
- `RUBEN_SPEC_NEW.md` — refines the SpaceComputer integration with explicit build-vs-mock honesty (spaceTEE is mocked; cTRNG is real).
- `ENS_SPEC.md` — defines the canonical ENS namespace and Swarm-artefact schemas; introduces the verifier rename.
- `NICK_SPEC.md` — defines the verifier skill (OpenClaw, ClawHub) and the `EnsRegistrar` contract; targets Sepolia for the verifier-side build.
- `BUILD_PLAN.md` — the hackathon execution plan: work split, frozen interfaces, pre-weekend checklist, day-of rules.

Where the source documents disagree, this Design Document records the resolved view. The canonical testnet for the entire system — contracts, verifier skill, reporter PWA, faucet seeding — is **Sepolia (chainId 11155111)** per `NICK_SPEC.md`, superseding the Base Sepolia references in the earlier `SPEC.md`, `RUBEN_SPEC_NEW.md`, and `BUILD_PLAN.md`.
