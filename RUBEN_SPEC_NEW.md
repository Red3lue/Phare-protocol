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

# SpaceComputer — confirmed fit, with explicit build-vs-mock split

The SpaceComputer team confirmed Phare is a fit. The hook: validated citizen reports trigger orbital imagery tasking; the imagery corroborates the reported position; spaceTEE inference layered on top tracks the vessel and predicts its destination. Citizens see what AIS doesn't, satellites confirm what citizens see, the TEE turns those confirmations into route intelligence.

After reading the Orbitport architecture docs and the ETHPrague guide, the design has been re-grounded to match what SpaceComputer actually ships today versus what is on their roadmap.

## What SpaceComputer ships today vs what is planned

Per [docs.spacecomputer.io](https://docs.spacecomputer.io/docs/concepts/orbitport-architecture):

| Layer | Status | Notes |
|---|---|---|
| **Celestial layer** (satellite providers) | live | cEDGE (cosmic radiation), Crypto2 |
| **Terrestrial layer** (ground stations) | live | scheduling, buffering, reception |
| **Application layer** (REST/JSON-RPC) | live | currently exposes **cTRNG** (cosmic random numbers) via `GET /api/v1/services/trng` |
| **KMS** (TRANSIT + ETHEREUM key schemes) | live, experimental | docs warn against production use |
| **spaceTEE** (trusted orbital execution) | **planned, not shipped** | listed in their architecture doc as forthcoming |
| **Imaging plugin** | **does not exist** | no current Application Plugin tasks orbital cameras |

This forces an honest framing of what we contribute and what we mock.

## What Phare BUILDS (real contributions)

### 1. `phare-imager` — a new Orbitport Application Plugin

There is no photo-tasking plugin in the Orbitport ecosystem today. Phare ships one. It is a TypeScript module conforming to the Orbitport Application Plugin contract (JSON-RPC 2.0 to the gateway endpoint, Client ID + Secret auth) exposing four methods:

| Method | Purpose |
|---|---|
| `phare.requestImagery({ imo, lat, lon, reportId })` | submit an imagery tasking for a vessel at coordinates; returns a `taskingId` immediately, the actual imagery arrives via callback |
| `phare.imageReady({ taskingId, image, captureMetadata })` | callback delivered when imagery is available — image bytes plus capture metadata (sensor, resolution, timestamp) |
| `phare.requestInference({ taskingId, imageRef, verifierLogRefs[] })` | request spaceTEE inference: given the image and a set of verifier-log references, produce a destination prediction |
| `phare.inferenceReady({ taskingId, prediction })` | callback with inference output (destination, confidence, supporting evidence refs) |

The plugin is the real artefact published to the Orbitport ecosystem, regardless of whether the underlying imaging hardware or TEE is mocked. It defines the *shape* of the integration that SpaceComputer can later wire up to a live celestial-layer plugin once they have orbital cameras and spaceTEE in production.

### 2. `orbital/` — off-chain orchestrator service

Runs alongside `minter/`. Responsibilities:

- Subscribe to `ReportRegistry.Settled` events
- For each settled report, call `phare.requestImagery()` on the plugin
- On `phare.imageReady` callback, pin the image and metadata to Swarm
- Call `phare.requestInference()` with the pinned image ref + the relevant verifier-log refs (pulled from the verifiers' ENS records)
- On `phare.inferenceReady`, pin the TEE inference output JSON to Swarm
- Sign `keccak256(reportId, imo, lat, lon, captureTimestamp, imageHash)` via SpaceComputer KMS (ETHEREUM key)
- Call `ReportRegistry.attest(reportId, captureTimestamp, lat, lon, imageHash, sig)`

### 3. `ReportRegistry.attest()` — on-chain attestation

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
    require(!reports[reportId].orbitalCorroborated, "already corroborated");
    reports[reportId].orbitalCorroborated = true;
    reports[reportId].imageHash = imageHash;
    emit OrbitallyCorroborated(reportId, imageHash, captureTimestamp);
}
```

Verified via OpenZeppelin's `ECDSA` — no precompile or custom verifier. The `orbitalAttestor` address is the KMS-derived Ethereum address baked into the contract at deploy time.

### 4. ENS orbital records (`vessel.orbital.*`)

Defined in `ENS_SPEC.md` §3.2. The minter, on `OrbitallyCorroborated` events, writes `vessel.orbital.image`, `vessel.orbital.imageHash`, `vessel.orbital.captureTimestamp`, `vessel.orbital.attestor`, `vessel.orbital.tee.prediction`, `vessel.orbital.tee.destination`, `vessel.orbital.tee.confidence`, and increments `vessel.orbital.confirmations`.

### 5. `cTRNG` integration (small, real)

The one production SpaceComputer endpoint we *don't* mock. Used by the reporter PWA to pull a fresh nonce when constructing the metadata JSON. Cosmic randomness in the citizen submission path is a small but real second integration point — it gives us a third surface for the SpaceComputer prize without scope cost.

## What Phare MOCKS (hackathon shortcuts)

### 1. Satellite tasking and imagery source

Replaced by a fixture lookup. Inside the plugin, `requestImagery` returns immediately, and a short async delay (5–30 s) simulates the orbital callback. The actual image bytes come from a pre-curated fixture set keyed by `(lat, lon)`:

- Public maritime imagery (Sentinel-2 ESA scenes for the Mediterranean, freely licensed)
- Demo-fixture photos pre-fetched for the specific coordinates used in the demo (Cyprus, Laconian Gulf)
- Where no fixture matches, a generic ocean-crop image is returned with a watermark

Each fixture has hand-attached `captureMetadata` (timestamp, fake sensor name `phare-mock-1`, resolution, lat/lon).

### 2. spaceTEE inference

Per the SpaceComputer docs, spaceTEE is on the roadmap but not yet shipped — there is no production endpoint to call. The `phare.requestInference` method runs against a local stub that:

- Accepts the image ref and verifier-log refs
- Runs a tiny rule-based predictor: combine the vessel's last-seen coordinate, an extrapolated heading from prior sightings, and a static map of likely destination ports for sanctioned-tanker routes
- Returns `{ destination: "Novorossiysk", confidence: 0.78, supporting_logs: [bzz://…], route_candidates: [...] }`
- Always pins the output JSON to Swarm with `"mocked": true` set inside, so consumers can filter

The stub is intentionally crude. The point is to demonstrate the *shape* of the integration — image + verifier logs feed in, signed prediction comes out — so that when SpaceComputer's spaceTEE is live the plugin call site doesn't need to change.

### 3. KMS ceremony fallback

Real KMS calls when the endpoint is reachable; if it fails on demo day we fall back to a locally-generated Ethereum key, with the same address baked into a redeployed `ReportRegistry`. The `mocked` flag is propagated into the dossier JSON so judges can see what was real and what wasn't.

## End-to-end flow (revised)

```
Citizen report settles ─┐
                        ▼
            orbital/ orchestrator
                        │
                        ▼
            phare.requestImagery (plugin) ──[mock fixture lookup by lat/lon]── image + metadata
                        │
                        ▼
            Swarm pin (image + capture metadata)
                        │
                        ▼
            phare.requestInference (plugin) ──[mock spaceTEE stub]── destination prediction
                        │
                        ▼
            Swarm pin (TEE inference JSON, mocked: true)
                        │
                        ▼
            SpaceComputer KMS sign (real, EIP-191 over reportId + imo + gps + t + imageHash)
                        │
                        ▼
            ReportRegistry.attest(...) on Base Sepolia
                        │
                        ▼
            OrbitallyCorroborated event
                        │
                        ▼
            minter writes vessel.orbital.* records to ENS via NameStone
```

## Why this is a meaningful fit (not a shallow API wrap)

SpaceComputer's judging criteria warn against "call an API once and wrap a UI around it." This design has three real integration surfaces and one supporting one:

1. **A new Orbitport Application Plugin** — published to the ecosystem; defines the JSON-RPC contract for imagery + inference; reusable by other projects.
2. **KMS ETHEREUM scheme used as on-chain attestation** — EIP-191 signatures verified by `ECDSA.recover` directly in `ReportRegistry`; no precompile or custom verifier.
3. **spaceTEE plugin shape, ahead of spaceTEE shipping** — we ship the call site, the data contract, and a stub implementation, so SpaceComputer can drop in their real TEE when ready without us touching code.
4. **cTRNG used in the citizen submission path** — small, real, additional integration point.

The "mocked: true" flag inside every TEE inference document is part of the contribution: it explicitly invites SpaceComputer to replace the stub with their real backend later. We are giving them a working call site, not pretending we built a spaceTEE.

## Scope cost (revised for build-vs-mock)

Roughly **24–32 hours additional** on top of the README's 55–65 hour budget (~45% increase).

| Component | Hours |
|---|---|
| `phare-imager` Orbitport plugin (real, with mock layer below) | 6–8 |
| Mock satellite tasking + image fixture set | 2–3 |
| Mock spaceTEE inference stub (rule-based destination predictor) | 3–4 |
| KMS provisioning + `orbital/` orchestrator | 4–5 |
| `ReportRegistry.attest()` + tests | 6–8 |
| Minter dossier extension + ENS `vessel.orbital.*` writes | 2–3 |
| UI orbital badge + destination panel | 2–3 |
| cTRNG integration in reporter PWA (nonce) | 0.5–1 |

Real scope decision: confirm both builders can absorb 24–32 extra hours before committing.

## Updated prize map

| Prize | $ | Confidence |
|---|---|---|
| Future Society | $2,500 | High |
| ENS — AI Agents | $2,000 | High |
| ENS — Creative Use | $2,000 | High |
| SpaceComputer | up to $6,000 | High (plugin contribution + KMS attestation + cTRNG + spaceTEE call site) |
| Best Privacy by Design | $500 | High |
| Best UX Flow | $500 | Medium |
| Sourcify | $4,000 | Free pickup |

**Realistic target: ~$17,500.** The SpaceComputer confidence is upgraded from Med-High to High because the plugin contribution and the build-vs-mock honesty are both load-bearing for the bounty's "not a shallow API wrap" criterion.

## Narrative reframing

The orbital corroboration plus mocked-but-shaped spaceTEE strengthens the Future Society and ENS pitches together. The vessel ENS dossier now contains three signed artifacts: the citizen photo, the orbital confirmation, and the destination prediction — each one a different epistemic layer, each one resolvable through ENS, each one with a clear provenance flag. For an AIS-dark sanctioned tanker, that's the closest thing to public route intelligence that exists outside government channels.

Solar-punk. End-to-end signed. Citizen-led, orbit-confirmed, route-inferred. Honest about what's mocked.
