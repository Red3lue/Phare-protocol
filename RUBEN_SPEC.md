# Insurer Funding Model

## Problem

The `SlashPool` is not self-sustaining in a healthy system. When most reports are honest (the desired state), the pool drains steadily — each valid settlement pays a small reward out with no automatic replenishment. Relying on grants and NGO donations is an altruism dependency, not a durable economic mechanism.

However, the drain is narrower than it first appears. There are two settlement paths for honest reports:

- **Undisputed** — bond returned + $0.10 reward paid from `SlashPool`. This is the path that drains the pool.
- **Disputed but honest** — if a disputer raises a challenge and UMA voters resolve in favour of the reporter, the disputer loses their counter-bond. That slashed counter-bond funds the reporter's compensation. The `SlashPool` is not touched.

So the pool only needs to cover rewards on clean, uncontested settlements. Reports that attract a bad-faith or mistaken dispute are self-funded by the failed disputer. This makes the pool significantly more resilient than a naive reading suggests — but the slow drain from undisputed honest reports remains a real problem at scale.

## Why insurers are the right funder

Insurers have the strongest financial incentive for this data to exist and be accurate:

- Shadow fleet vessels operate with **no insurance**. When they spill or sink, there is no liable party to recover from.
- Accurate, timestamped, tamper-evident sighting records give insurers **legal and actuarial leverage** — evidence for litigation, underwriting exclusions, and reinsurance disputes.
- The alternative (satellite imagery, private maritime intelligence) costs orders of magnitude more and is not credibly neutral.

A subscription to Phare is cheap relative to a single uninsured spill claim.

## Proposed mechanism

**Consumer access fees** — entities that query vessel records (insurers, P&I clubs, NGOs, journalists) pay a small recurring fee or per-query fee to read from the registry. Funds flow directly into the `SlashPool`.

This aligns incentives cleanly:
- Consumers only pay if the data is useful → they only pay if the system is working
- A working system (mostly honest reports) is exactly the regime that drains the pool → fees replenish what honest settlements drain
- No token, no governance, no altruism required

## Rough economics

| Actor | Annual spend | Rationale |
|---|---|---|
| Large P&I club | $5,000–$20,000/yr | One uninsured spill claim can exceed $100M |
| Mid-size insurer | $1,000–$5,000/yr | Underwriting exclusion evidence |
| NGO / journalist | Free or nominal | Public interest tier, cross-subsidised |

Even two or three P&I club subscriptions would cover years of slash pool rewards at current reward rates ($0.10/report).

## Implementation sketch

- Add a `RegistryAccess` contract (or off-chain API gate) that issues time-limited read credentials on payment
- Payments route to `SlashPool` (and optionally a small protocol treasury cut)
- Access tiers: public (free, rate-limited), standard (paid, full history), enterprise (paid, webhook push on new settlements)
- Free tier preserves the credibly-neutral, open-data ethos for civic users

## Alternative: remove the reward entirely

If reporters are motivated by civic duty and skin-in-the-game (bond return on honest report is already the core mechanic), the $0.10 reward adds little incentive but does drain the pool. Cutting it would make the pool only grow (from slashed bad actors) and never shrink. The insurer subscription model and the no-reward model are compatible and complementary.

---

# Why UMA and not a custom oracle

The optimistic oracle pattern — submit claim, wait for challenge, auto-settle — is simple enough to implement directly in `ReportRegistry`. The challenge window and bond escrow are already in the contract. The problem is: **who adjudicates when a dispute is raised?**

Without UMA the options are:
- A trusted multisig → centralised, defeats the credible neutrality argument
- A custom token-based voting system → enormous scope, untested security

UMA OOv3 is a pre-deployed, battle-tested, credibly neutral arbiter already live on Base Sepolia. UMA token holders vote correctly or lose their own stake — economic alignment replaces institutional trust. For a hackathon, building a custom dispute layer would be reinventing UMA without the security guarantees.

---

# Umia — not a fit (decided after sponsor conversation)

Umia (umia.finance) is unrelated to UMA — it is a platform for tokenizing AI-agent-driven ventures so that investors can back them on-chain. On paper, Phare's sentinel agents looked like a natural fit: autonomous, on-chain reputation via ENS, capital reserves for counter-bonds, real yield from winning disputes.

After speaking to the Umia desk, **the prize is not a realistic target for Phare**. Umia is looking for projects where:

- The product itself is built using agents, not where agents are an auxiliary component
- Governance and decision-making happen on-chain — token launch, board of directors, voting structures
- The venture has its own capital-formation story (token, treasury, equity-like instruments)

Phare's sentinel network has agents but does not have on-chain governance, a token, or a capital-formation mechanism for the ventures themselves. The agentic part is real but is not the centre of gravity of the project. Reframing Phare to fit would mean adding scope (governance contracts, token, board structure) that does not serve the core product.

**Decision: drop Umia from the prize map. Reallocate the time we would have spent on Umia framing to strengthening the ENS and Future Society submissions, which are direct fits.**

Revised target: ~$6,500 (Future Society, both ENS tracks, Verified Fetch, Hardware, Privacy by Design) instead of the README's claimed $20k. More honest, more achievable.

---

# SpaceComputer — confirmed fit (after sponsor conversation)

The SpaceComputer team confirmed Phare is a fit. The hook: validated citizen reports get uplinked to the satellite network as imagery tasking requests; satellite imagery is then used to corroborate the reported position. Citizens see what AIS doesn't, satellites confirm what citizens see.

The team specifically recommended using the **Orbitport plugin** system and the **KMS API**.

## Why this is a meaningful fit (not a shallow API wrap)

SpaceComputer's judging criteria explicitly warn that "just call an API once and wrap a UI around it" scores low. This design uses three integration points:

1. **Orbitport Application Plugin** — published to the Orbitport ecosystem
2. **KMS Ethereum scheme** — EIP-191 signatures put to real use as on-chain attestations
3. **Cross-track combination** — Orbitport plugin + Security API together (bonus points for cross-track per the bounty doc)

## How Orbitport works (relevant facts)

- TypeScript/JavaScript SDK communicating via JSON-RPC 2.0 to a gateway endpoint
- Authentication via Client ID + Secret
- Plugin types: Application Plugins (orbital service interfaces), Celestial Integration Plugins, Terrestrial Integration Plugins, Orbital Plugin (egress to satellites)
- Routes data via S-Band, Iridium, Starlink — handles scheduling, packaging, transmission automatically
- Satellite passes orbit every 90–180 minutes, so the imagery callback is asynchronous on the order of minutes to hours

## How the KMS works (relevant facts)

- Two key schemes: `TRANSIT` (general purpose) and `ETHEREUM` (secp256k1, EIP-191 signing, exposes Ethereum address)
- ETHEREUM keys are signing-only — no encryption, no rotation
- Methods don't auto-retry — operations are not idempotent
- Currently experimental — fine for hackathon, the docs warn against production use
- The crucial property for Phare: EIP-191 signatures are verifiable on-chain natively via `ECDSA.recover`, no precompile or custom verifier needed

## End-to-end flow

```
Citizen report → UMA settles → Orbital tasking request uplinked
       ↓                              ↓
  ReportRegistry              Satellite passes over
       ↓                      coordinates (90-180 min)
       ↓                              ↓
       └── attest(sig) ←── KMS signs (imo, gps, image_hash, t)
                                      ↓
                          Imagery pinned to Swarm
                                      ↓
                          ENS dossier gets "Confirmed from orbit"
```

## Component-by-component implementation

### 1. New Orbitport Application Plugin (`orbital-plugin/`)

A plugin published to the Orbitport ecosystem that exposes two JSON-RPC methods:

- `phare.requestImagery({ imo, lat, lon, reportId })` — schedules a satellite tasking via the Orbital Plugin
- `phare.attestSighting({ imo, lat, lon, captureTimestamp, imageHash, reportId })` — internal callback once imagery returns. Calls KMS `sign()` with the Ethereum key over `keccak256(reportId, imo, lat, lon, t, imageHash)` (EIP-191 prefix). Returns the signature.

This is a real plugin contributed to the Orbitport ecosystem, not just an SDK wrapper.

### 2. KMS provisioning (one-time setup)

```ts
const sdk = new OrbitportSDK({ clientId, secret });
const caps = await sdk.getCapabilities();
const key = await sdk.kms.createKey({ scheme: "ETHEREUM" });
// → { keyId, ethereumAddress: "0xORBITAL_ATTESTOR" }
```

The resulting Ethereum address is hardcoded into `ReportRegistry` at deploy time as `orbitalAttestor`.

### 3. New off-chain service (`orbital/`)

Runs alongside `minter/`. Responsibilities:

- Subscribe to `ReportRegistry.Settled` events
- Call `phare.requestImagery()` on Orbitport for each settled report
- Await imagery callback (async, minutes to hours)
- On callback: pin imagery to Swarm, call `ReportRegistry.attest(reportId, captureTimestamp, lat, lon, imageHash, kmsSignature)`

### 4. New contract function `ReportRegistry.attest()`

```solidity
function attest(
    bytes32 reportId,
    uint64 captureTimestamp,
    int64 lat, int64 lon,
    bytes32 imageHash,
    bytes calldata sig
) external {
    bytes32 digest = keccak256(abi.encodePacked(
        "\x19Ethereum Signed Message:\n32",
        keccak256(abi.encode(reportId, lat, lon, captureTimestamp, imageHash))
    ));
    require(ECDSA.recover(digest, sig) == orbitalAttestor, "bad orbital sig");
    reports[reportId].orbitalCorroborated = true;
    reports[reportId].imageHash = imageHash;
    emit OrbitallyCorroborated(reportId, imageHash, captureTimestamp);
}
```

Verified via OpenZeppelin's `ECDSA` library — no Daimo verifier needed for this path.

### 5. Minter update

On `OrbitallyCorroborated`, the dossier JSON on Swarm gains:

```json
{
  "orbital_corroboration": {
    "image_hash": "0x…",
    "image_swarm_ref": "bzz://…",
    "capture_timestamp": 1715162400,
    "kms_signer": "0xORBITAL_ATTESTOR",
    "signature": "0x…"
  }
}
```

The ENS text record `vessel.orbitalConfirmations` increments. The vessel page shows a "Confirmed from orbit" badge.

## Scope cost

Roughly **22–31 hours additional** on top of the README's 55–65 hour budget (~50% increase).

| Component | Hours |
|---|---|
| Orbitport plugin | 8–12 |
| KMS provisioning + `orbital/` service | 4–6 |
| `ReportRegistry.attest()` + tests | 6–8 |
| Minter dossier update | 2–3 |
| UI orbital badge | 2 |

For $6,000 prize upside, defensible if both builders have bandwidth. Real scope decision — confirm before committing.

## Updated prize map

| Prize | $ | Confidence |
|---|---|---|
| Future Society | $2,500 | High |
| ENS — AI Agents | $2,000 | High |
| ENS — Creative Use | $2,000 | High |
| SpaceComputer | up to $6,000 | Medium-High (depends on plugin polish) |
| Verified Fetch (Swarm) | $250 | High |
| Best Hardware Usage | $500 | High |
| Best Privacy by Design | $500 | High |
| Best UX Flow | $500 | Medium |

**Realistic target with SpaceComputer in: ~$14,250.**

## Narrative reframing

The orbital corroboration also strengthens the Future Society and ENS pitches. The vessel ENS dossier now contains two artifacts: the citizen photo and the orbital confirmation, both signed, both immutable. This is the strongest possible second signal for AIS-dark vessels — ground-truth that the ship was where the citizen said it was, signed by space.

Solar-punk. End-to-end signed. Citizen-led, orbit-confirmed.

---

# UMA + Swarm as a general-purpose primitive

## The insight

Phare is not just a vessel-tracking app. The core of what we're building is a **bonded photo claim primitive**:

> Signed photo on Swarm + signed metadata on Swarm + UMA assertion + Verified Fetch + dispute via counter-bond

This pattern is domain-agnostic. The same primitive works for illegal logging, oil spills, environmental violations, citizen evidence chain-of-custody, missing-persons sightings, NGO incident reports — anything where a phone-captured photo with cryptographic provenance becomes an arbitratable record.

The Swarm team confirmed interest in framing this as a reusable module rather than a vessel-specific integration.

## How UMA + Swarm connect

Photos never touch UMA. The actual layout:

| Layer | What's stored |
|---|---|
| UMA contract | Claim string `"Report at bzz://<meta> is true"` + assertionId (~100 bytes) |
| `ancillaryData` (on-chain, in UMA) | Viewable gateway URL for voters (~1 KB) |
| Swarm | Metadata JSON `{ photo: bzz://X, gps, imo, ... }` (~1 KB) |
| Swarm | The actual JPEG (~500 KB) |

UMA voters read the claim, follow the Swarm gateway link, inspect the photo and disputer evidence, vote. Swarm is the only storage layer that makes this trustless — content-addressed (so voters verify what was asserted) and gateway-tamper-resistant (Verified Fetch recomputes the hash).

## What is general-purpose vs. vessel-specific

**Generic core (`core/`)** — ships as a reusable module:
- `BondedPhotoClaim.sol` — abstract contract: WebAuthn verify + UMA wiring + bond + slash
- Sentinel skill base class with pluggable fakeness check interface
- Verified Fetch helper (content-addressed fetch + SHA-256 recomputation)
- Web SDK primitives: camera + GPS + WebAuthn + Swarm upload

**Vessel-specific (`vessel-app/`)** — imports the core:
- `ReportRegistry.sol` — extends `BondedPhotoClaim` with IMO field + maritime hooks
- OpenSanctions lookup
- NameStone vessel subname minting + dossier assembly
- Maritime sentinel fakeness checks (ocean bounding box, perceptual hash bloom filter)
- SpaceComputer orbital corroboration

## Recommended folder structure

```
phare-protocol/
  core/
    contracts/
      BondedPhotoClaim.sol    # abstract: WebAuthn + UMA + bond + slash
    skill-base/               # base sentinel skill, pluggable fakeness checks
    swarm/                    # Verified Fetch helpers
    web-sdk/                  # camera + GPS + WebAuthn + Swarm upload primitives

  vessel-app/
    contracts/
      ReportRegistry.sol      # extends BondedPhotoClaim — IMO + maritime hooks
    web/                      # vessel-specific UI on top of web-sdk
    minter/                   # OpenSanctions + NameStone (vessel-specific)
    skill/                    # maritime fakeness checks
    orbital/                  # SpaceComputer corroboration (vessel-specific)
```

The abstraction is visible in folder layout. No extra application code needed — judges and the Swarm team see "this is a primitive, vessels are one application."

## Important practical notes

**Swarm stamps must outlive the dispute window.** If stamps expire during the 48–96h DVM resolution, voters cannot see the photo. For production, minimum ~5 days of stamp coverage. For demo (30s liveness, no real dispute), irrelevant.

**Voters need a working HTTPS gateway link.** Embed `https://gateway.ethswarm.org/bzz/<hash>` in ancillary data — not raw `bzz://` URIs. Most voters won't run a Bee node.

**UMA's liveness window vs. DVM resolution are different things.** Unchallenged assertions settle in the liveness window (30s demo / 6h+ production). Disputed assertions trigger the UMA DVM commit-reveal vote which takes 48–96 hours — no way to speed this up. For the adversarial demo, use a `mockResolve(assertionId, bool)` owner-gated function on `ReportRegistry` that simulates the UMA callback. Label clearly as demo-only.

**UMA's own bond burn affects the slash split.** UMA burns ~50% of the loser's bond internally. The README's 50/30/20 split does not match UMA's actual bond mechanics. Recommended fix: use UMA with a minimum bond (anti-spam only), hold the real $5 bond in `ReportRegistry` directly, apply Phare's split there. UMA is the truth oracle; `ReportRegistry` is the economic layer.

## Why this strengthens the Swarm pitch

The Swarm hook goes from "we use Verified Fetch" ($250 free pickup) to:

> *"We built a Swarm-native primitive for bonded photo claims. Swarm is the only storage layer that makes this work — content-addressed for voter verification, gateway-tamper-resistant via Verified Fetch, persistent across the full dispute window via postage stamps. Vessels are our first application; the primitive is general."*

## Scope discipline

Do not double the implementation work to "prove" the abstraction. The generalisation lives in the folder structure and `BondedPhotoClaim.sol` being abstract. One working vessel application is sufficient. Pitch as "designed to generalise" — do not claim a framework you did not ship.
