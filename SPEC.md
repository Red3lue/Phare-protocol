# Phare

> Open, bonded registry of citizen sightings of sanctioned tankers. Phones and cryptography for the parts that satellites can't see.

**ETH Prague 2026 hackathon project. Solar-punk theme.**

---

## 1. The idea

Some tankers carry oil that they aren't supposed to carry. They evade detection by switching off or faking the radio signal that ships normally broadcast to identify themselves at sea. They cause sanctions failure, war financing, and ecological disaster — oil spills with no accountability, no insurance, no clean-up. Outside expensive satellite imagery and government surveillance budgets, almost nobody can see them.

Phare turns ordinary citizens with phones into a distributed sentinel network for these vessels.

Anyone can take a photo of a suspicious ship, sign it with their phone's secure hardware, and stake a small amount of crypto behind the report. Autonomous agents — and any human with the same small stake — race to dispute fakes. Reports that survive a short challenge window become public records. If the vessel turns out to be on a published sanctions list, it gets its own decentralised, publicly addressable identity that anyone can query forever.

The result is a credibly neutral, citizen-funded sighting log that journalists, NGOs, insurers, and enforcement bodies can consume without trusting any single party.

**Why solar-punk**

- Civic infrastructure, not state surveillance — built bottom-up, owned by no one.
- Ecological accountability for an industry that resists oversight.
- Crypto bonds replace background checks: skin-in-the-game beats permission lists.

---

## 2. Vocabulary

Skip if you're already fluent. Each term is used freely from §3 onward.

### Maritime

- **Shadow fleet** — informal name for tankers that move sanctioned oil while evading detection. They lie about their position, hide their flag of registration, transfer cargo at sea instead of in ports, and operate with no insurance or accountability.
- **AIS** *(Automatic Identification System)* — the standard radio system every commercial ship is required to broadcast on. Carries the ship's identity, position, course, and speed. Receivable globally via terrestrial antennas and satellites.
- **AIS-dark** — a vessel has switched off its AIS transmitter. The standard shadow-fleet operating mode.
- **AIS spoofing** — a ship transmits a position different from where it actually is.
- **IMO number** — a 7-digit identifier issued once per ship hull, for life. Painted on the hull, used in every official register. The closest thing a vessel has to a passport number. Example: `9712345`.
- **MMSI** — a 9-digit number tied to a ship's AIS transmitter (not its hull). Less permanent than IMO, easier to reassign.
- **Flag of convenience** — ships register under flags of small states with lax enforcement (Liberia, Marshall Islands, Comoros). Shadow-fleet vessels often re-flag every few months.
- **Ship-to-ship (STS) transfer** — oil cargo transferred between two tankers at sea instead of in a port. The standard way to launder cargo origin.
- **OpenSanctions** — free, daily-updated open-data project that aggregates the sanctions lists of the US (OFAC), EU, UK, Canada, Australia, NZ, UN, and Ukraine GUR. Their `maritime` scope filters specifically for sanctioned vessels.

### Blockchain

- **EOA** *(Externally Owned Account)* — a regular crypto wallet, controlled by a private key. Has an address like `0x…`.
- **Bond / stake** — an amount of cryptocurrency locked in a contract while a claim is being adjudicated.
- **ENS** *(Ethereum Name Service)* — a system for human-readable names on Ethereum, like DNS but on-chain. Names like `nick.eth`. Names can have **subnames** (e.g. `agent.nick.eth`) and **text records** (key-value metadata attached to a name).
- **Optimistic oracle** — a contract that accepts truth-claims, defaults to accepting them as true after a short window, but allows anyone to challenge a claim by posting a counter-bond. If the challenge succeeds, the original claimant loses their bond.
- **UMA OOv3** — a specific implementation of an optimistic oracle, deployed on multiple chains. The one we use.
- **Liveness window** — the time during which a claim can be challenged before it auto-settles as true. We use 1 minute for demo, 6+ hours in production.

### Hardware

- **Passkey** — a private key stored inside the secure hardware of a phone or laptop (Apple Secure Enclave, Android StrongBox, Windows TPM). The key never leaves the chip.
- **WebAuthn** — the web standard that lets a browser ask the device to sign a challenge with a passkey. Works on every modern browser.

### Dependencies (other people's stuff we use)

- **Swarm** — decentralised storage. Like IPFS but separately funded. Files identified by a content-addressed hash (`bzz://<hash>`).
- **NameStone** — a service that issues ENS subnames off-chain via a standard Ethereum mechanism (CCIP-Read). Free for small projects. We use it to mint vessel and agent subnames without paying gas per mint.
- **OpenClaw** — an autonomous agent runtime — local-first agents that run on user machines, scheduled by a heartbeat.
- **ClawHub** — the public registry where OpenClaw skills are published and installed (`clawhub install <skill>`).

---

## 3. How it works

Three kinds of participants.

| Actor | What they do | What they need |
|---|---|---|
| **Reporter** | Photographs vessels, submits sightings | Phone or laptop, small USDC bond, a passkey |
| **Sentinel agent** | Watches the report stream, races to dispute fakes | OpenClaw runtime, small USDC counter-bond, an ENS name |
| **Consumer** *(out of hackathon scope)* | Reads the registry — journalists, NGOs, insurers | Just a browser |

### Components

```
+--------------------------------+
|  Reporter web app              |    user's phone or laptop
|  - capture photo + GPS         |
|  - WebAuthn sign with passkey  |
|  - upload to Swarm             |
|  - submit on-chain with bond   |
+--------------+-----------------+
               |
               | bzz://photo + bzz://meta
               v
+--------------------------------+
|  Swarm storage                 |    decentralised, content-addressed
+--------------------------------+
               |
               v
+----------------------------------------------------+
|  Smart contracts on Base Sepolia                   |
|  - ReportRegistry  (UMA-wired, bond escrow)        |
|  - SlashPool       (rewards + treasury)            |
+----------------------------------------------------+
               |
               | events
               v
+----------------------------------------------------+
|  Sentinel skill (OpenClaw / ClawHub)               |
|  - poll new reports                                |
|  - cheap fakeness checks                           |
|  - race-to-dispute via UMA OOv3                    |
+----------------------------------------------------+

side services (off-chain, run by project team):
+--------------------------------+
|  Vessel suggester              |   live AIS query at reporter time
+--------------------------------+
+--------------------------------+
|  ENS minter                    |   mints vessel subnames after settlement
+--------------------------------+   reads OpenSanctions, writes via NameStone
```

### Numbered flow

1. Reporter opens the website. The browser captures GPS coordinates.
2. The website queries the **vessel suggester** with those coordinates. The suggester returns the vessels currently broadcasting AIS at that location. Reporter picks one from the dropdown, OR ticks "AIS-dark — I see this vessel anyway" and types the IMO manually.
3. Reporter takes a photo. The website asks the device for a WebAuthn signature over `(photo_hash, gps, timestamp, imo, ais_dark_flag, nonce)`.
4. The website uploads the photo and metadata JSON to Swarm.
5. The reporter's wallet calls `ReportRegistry.submit()` on Base Sepolia, escrowing a $5 USDC bond. The contract verifies the WebAuthn signature on-chain and opens an assertion on UMA OOv3.
6. The 1-minute liveness window starts. **Anyone** with a counter-bond can dispute — sentinel agents race for it but humans can dispute too, the protocol doesn't care which.
7. If unchallenged, the report settles. The reporter's bond is returned plus a small reward from the slash pool.
8. The **ENS minter** picks up the settled event. If the IMO is in the OpenSanctions `maritime` scope, the minter calls NameStone to mint `imo-<n>.vessel.phare.eth` and writes the sighting into the vessel's text records.
9. If the assertion was disputed and the dispute resolves against the reporter, the bond is slashed: 50% to the disputer, 30% to the slash pool, 20% to treasury.

---

## 4. Walkthrough — Alice submits a sighting

Alice is on holiday on the Cypriot coast. She spots a tanker offshore that doesn't look like it should be there.

1. She opens `phare.eth` in her phone browser.
2. The site asks for camera and GPS permission. Granted. Coordinates: `34.7° N, 33.0° E`.
3. The vessel suggester queries live AIS for that area. The list comes back **empty** — no vessels are broadcasting AIS within 5 nautical miles. The form shows "no AIS-broadcasting vessels at this location" and offers a manual entry field. *(That empty list is the shadow-fleet signature.)*
4. Alice photographs the tanker. The hull markings are just legible enough to read the IMO: `9712345`.
5. She types `9712345` into the form, ticks "AIS-dark — visible from my position", and presses Submit.
6. The browser hashes `(photo, gps, timestamp, imo, ais_dark_flag, nonce)` and asks her phone for a WebAuthn signature. Touch ID. Done.
7. The browser uploads the photo (~500 KB JPEG) and the metadata JSON to Swarm. Two `bzz://` references come back.
8. Alice's wallet — an EOA she funded earlier from a faucet — signs `ReportRegistry.submit(metaRef, webAuthnAssertion, bond=5_USDC)`.
9. The contract verifies the WebAuthn signature against Alice's stored passkey public key (using Daimo's `p256-verifier`), pulls $5 USDC into escrow, and calls UMA OOv3 with the assertion `"Report at bzz://<meta> is true"`.
10. The 1-minute liveness window starts.

Meanwhile, sentinel agents `alpha`, `beta`, `gamma` each polling on a 5-second heartbeat see the new event:

- `alpha` checks the IMO format → valid. Coordinates inside an ocean bounding box → valid. Photo perceptual hash not in the stolen-photo bloom filter → valid. WebAuthn signature already verified on-chain. **No grounds to dispute. Skips.**
- `beta` and `gamma` reach the same conclusion.

1 minute passes. UMA OOv3 settles the assertion as true. `ReportRegistry.onUmaSettlement` fires:

- Alice's $5 bond returns to her wallet
- A $0.10 reward from the slash pool also lands in her wallet

The ENS minter sees the settlement event:

- Looks up IMO `9712345` in OpenSanctions `maritime` scope. Hit. Sanction reason: `oil-transport`. Aliases: `[1234567, 7654321]`.
- Calls NameStone API:
  - Mint subname `imo-9712345.vessel.phare.eth`
  - Set text records: `vessel.sanctioned=true`, `vessel.sanctionReason=oil-transport`, `vessel.aliases=imo-1234567,imo-7654321`, `vessel.lastSeen=<unix>,34.7,33.0`, `vessel.sightings.count=1`, `vessel.aisDark=true`
  - Set `contenthash` to a freshly-built dossier on Swarm

Anyone can now resolve `imo-9712345.vessel.phare.eth` and read the records. The dossier links to Alice's photo.

### And if Alice had cheated?

Suppose Alice had submitted a Google-Images photo of a tanker with fabricated coordinates. Her WebAuthn signature is still valid — the protocol does **not** claim cryptographic proof of capture, it claims **bonded skin-in-the-game**.

When the report appears, sentinel `alpha` runs the bloom-filter check first. The photo's perceptual hash hits `shipspotting.com` photo #847291 from 2023. **Stolen.** `alpha` immediately submits a UMA dispute with a $5 counter-bond, citing the source URL. `beta` and `gamma` would have caught the same fake but `alpha` mined first — the dispute slot is taken.

UMA voters see the OSINT evidence and resolve in favour of `alpha`. Alice's $5 bond is slashed:

- $2.50 to `alpha` (covers their work + counter-bond return)
- $1.50 to slash pool
- $1.00 to treasury

`alpha`'s ENS subname `<alpha-handle>.disputer.phare.eth` has its `agent.stats.won` text record incremented.

---

## 5. Technical details

### Smart contracts (Solidity, Foundry, Base Sepolia)

Two contracts. Both immutable, no proxies, no governance.

**`ReportRegistry`** — the core. Stores reports, escrows bonds, wires to UMA OOv3, distributes payouts on settlement. Uses Daimo's `p256-verifier` for on-chain WebAuthn signature verification (works on every EVM chain via RIP-7212 fallback).

**`SlashPool`** — holds slashed bonds and donor seed funds. Pays small rewards to honest reporters. Seeded with $100 USDC for the demo.

ENS subnames are issued via NameStone's off-chain API by the minter service — there are no on-chain registrar contracts.

### Off-chain services (TypeScript, run by project team)

**`suggester/`** — vessel suggester microservice. Two modes:
- **LIVE**: subscribes to AISStream WebSocket, maintains an in-memory spatial index of currently-broadcasting vessels, exposes `GET /vessels-near?lat=&lon=`.
- **DEMO**: returns pre-recorded fixtures for hackathon demo coordinates.

**`minter/`** — ENS minter. Subscribes to `ReportRegistry.Settled` events. On each settle: queries OpenSanctions `maritime` scope by IMO, then calls NameStone API to mint or update the vessel subname records.

### Sentinel skill (TypeScript, OpenClaw, ClawHub)

`phare/disputer` — public skill. One-line install: `clawhub install phare/disputer`.

On each heartbeat:

1. `rpc.getLogs` for new `ReportRegistry.Submitted` events.
2. For each: fetch metadata JSON from Swarm via Verified Fetch (recompute the hash locally, reject mismatch). Verify WebAuthn signature. Run cheap fakeness checks:
   - IMO is well-formed
   - Coordinates inside an ocean polygon (not mid-Sahara, not on land)
   - Photo perceptual hash not in the stolen-photo bloom filter
   - WebAuthn signature valid against the registered passkey pubkey
3. If any check fires, submit a dispute on UMA OOv3 with a counter-bond. First-to-mine wins.

### Storage (Swarm)

Two artifacts per report, both content-addressed:

- **Photo** — JPEG, ~500 KB, recompressed client-side.
- **Metadata JSON** — `{ photo: bzz://, gps, timestamp, imo, ais_dark_flag, signature, ... }`.

Sentinels and the minter both use **Verified Fetch**: recompute the SHA-256 of fetched payloads, compare against the reference hash. Tampered gateways are caught locally.

Vessel dossiers (an aggregated JSON with full sighting history) are stored on Swarm and referenced from the vessel ENS subname's `contenthash` field.

### Identity

| Surface | Identity | Why |
|---|---|---|
| Reporter | Anonymous EOA + WebAuthn passkey | Sybil resistance via per-device hardware; rotatable per report for privacy |
| Sentinel agent | ENS subname `<handle>.disputer.phare.eth` | Public, addressable agent identity with on-chain reputation |
| Vessel | ENS subname `imo-<n>.vessel.phare.eth` | Each shadow-fleet ship becomes a public, addressable on-chain entity |

### Validation (UMA OOv3)

Every report opens an assertion: `"Report at bzz://<meta> is true"`. Bond: $5 USDC. Liveness: 1 minute (demo) / 6+ hours (production). Anyone with a matching counter-bond can dispute.

Bond economics on settlement:

- Unchallenged → bond returned + small reward from slash pool.
- Disputer wins → 50% to disputer, 30% to slash pool, 20% to treasury.

The slash pool is **not self-sustaining** in expected steady state — most reports are honest, so it drains slowly. For the hackathon it is seeded from donor funds. In production, top-ups would come from grants, NGO contributions, or insurance-industry subscriptions.

---

## 6. Repository layout

Each component lives in its own subfolder, independently runnable.

```
phare/
  contracts/         # Foundry — ReportRegistry, SlashPool
  web/               # Reporter web app (camera + GPS + WebAuthn + viem)
  skill/             # phare/disputer — OpenClaw skill, published on ClawHub
  suggester/         # AIS vessel suggester microservice (live + demo modes)
  minter/            # OpenSanctions + NameStone ENS minter service
  fixtures/          # OSINT-sourced demo data (photos, AIS gaps, suggester fixtures)
  spec/              # this README + protocol specs + ADRs
  scripts/           # deployment, demo seeders, faucet helpers
```

---

## 7. Build scope

Two builders, hackathon weekend, ≈55–65 hours of work.

| Component | Hours | Notes |
|---|---|---|
| `contracts/` | 14–18 | UMA OOv3 wiring, Daimo p256-verifier, bond escrow, slash split |
| `web/` | 14–16 | Camera, GPS, WebAuthn, Swarm upload, viem submission, suggester dropdown |
| `skill/` | 10–12 | OpenClaw skill, race-to-dispute, cheap fakeness policies |
| `suggester/` | 4–6 | AISStream WebSocket + spatial index + REST + fixtures mode |
| `minter/` | 3 | Settled-event listener, OpenSanctions API, NameStone API |
| NameStone setup | 4 | `phare.eth` parent + sub-subdomain config |
| Demo prep | 6–8 | Fixtures, talk track, screen recording |

---

## 8. Demo plan (3 minutes)

1. **Hook** — one sentence on shadow fleet and ecological cost.
2. **Live happy-path submission** — Mac browser, demo-mode location set to "off Cyprus". Suggester returns empty list. Reporter ticks AIS-dark, types a real OpenSanctions-listed IMO (e.g. PABLO, IMO 9133701), picks an OSINT photo. Touch ID. Swarm upload. Submit. 1 min liveness ticking visibly.
3. **Adversarial submission** — second tab, deliberately stolen Google-Images tanker photo. Three sentinels (`alpha`, `beta`, `gamma`) race in mempool. Show fastest mining the dispute. Winner's `agent.stats.won` increments live via NameStone.
4. **Settlement of legit report** — 1 min expires uncontested. Bond returns to reporter with reward. Minter mints `imo-9133701.vessel.phare.eth`. Resolve in browser. Show records: shadow flag, sanction reason, AIS-dark flag, `contenthash` → Swarm dossier with the photo.
5. **Close** — three artifacts on screen: vessel ENS subname, sentinel ENS subname, Swarm dossier. *"One PWA, one ClawHub skill, a global sentinel network."*

---

## 9. Prize map

**Build-driving** (these shape the architecture):

| Prize | Sponsor | $ | Hook |
|---|---|---|---|
| Future Society | ETHPrague | $5,000 | Sustainability, sanctions accountability, civic privacy-respecting infrastructure |
| Best Agentic Venture | Umia | up to $12,000 | Sentinel skill on ClawHub, ENS-named agents, on-chain reputation, autonomous bond economy |
| Best ENS Integration for AI Agents | ENS | $1,250 | `<handle>.disputer.phare.eth` with policy CID, principal, stats |
| Most Creative Use of ENS | ENS | $1,250 | `imo-<n>.vessel.phare.eth` — ENS subnames for physical assets, `contenthash` to Swarm dossier |

**Free pickups** (work is on the critical path anyway, just submit):

| Prize | Sponsor | $ | Hook |
|---|---|---|---|
| Best Hardware Usage | ETHPrague | $249 | Daimo p256-verifier + Secure Enclave / StrongBox / TPM passkeys |
| Verified Fetch | Swarm | $250 | Sentinel + minter both recompute Swarm hashes locally, never trust gateway |
| Best Privacy by Design | ETHPrague | $249 | Reporter is anonymous EOA + passkey, rotatable per report |

Plausible target: **~$20k**. Realistic mid-case: **$5–15k**.

---

## 10. Pre-event checklist

Must be done **before** the hackathon weekend.

- [ ] Acquire `phare.eth` on Ethereum mainnet (~$5–50/yr).
- [ ] Sign up for NameStone, configure `phare.eth`, verify nested sub-subdomains under `disputer.phare.eth` and `vessel.phare.eth` work.
- [ ] Sign up for OpenSanctions API (free, non-commercial).
- [ ] Sign up for AISStream.io (free WebSocket).
- [ ] Source OSINT data for 2–3 demo fixtures: PABLO (IMO 9133701), YOUNG YONG (IMO 9259325), or alternatives from the Laconian Gulf cluster. Verify both IMOs hit OpenSanctions `maritime` scope. Pull photos from Reuters / national maritime agency press galleries with attribution. Capture AIS-gap screenshots.
- [ ] Verify on day 0 at sponsor desks:
  - UMA OOv3 deployment address on Base Sepolia (or fall back to Sepolia)
  - Swarm hackathon postage stamps available (or spin up own Bee on Gnosis — half-day budget)
  - ClawHub `phare/` namespace claimable + publishing flow works
  - Daimo `p256-verifier` already deployed on chosen chain (RIP-7212 fallback should make this no-op but verify)

---

## 11. Out of scope

- ML / vision-based deep image authenticity (we use perceptual-hash + bloom filter only).
- Polished consumer dashboard for journalists / NGOs.
- Standalone npm distribution of the sentinel — skill-only via ClawHub.
- Production hardening (rate limits, retries, monitoring, alerting).
- Multi-chain deployment.
- Decentralisation of the suggester and minter services — run by project team for hackathon.
- Live AIS production mode of the suggester — fixtures-only at demo time; live mode is a stub.
- Stealth addresses (EIP-5564) for at-risk reporters.
- DAO, governance, token launch.
- Trezor signing path.
- Agent-to-agent dispute consensus before submission.

---

## 12. Open questions

- AISStream.io free-tier rate limits sufficient for hackathon demo.
- OpenClaw heartbeat granularity — minimum interval, behaviour on operator restart.
- Optimal demo liveness window vs UMA OOv3 minimum allowed.
