# Lighthouse — Phare's on-chain ENS layer

> One Solidity contract that gives every sanctioned vessel and every verifier agent a real, on-chain ENS identity. No off-chain resolver, no API key, no minter service. The contract is named `Lighthouse.sol` because that's exactly what it does — it names what passes the watch.

Supersedes:
- The NameStone / CCIP-Read off-chain mint path described in `ENS_SPEC.md` §6 and `SPEC.md` §5.
- The `EnsRegistrar.sol` sketch in `NICK_SPEC.md` §10 (verifier-only). Mint logic preserved verbatim, file renamed and extended to cover vessels.
- The `VesselRegistrar.sol` sketch from earlier conversations. Folded into `Lighthouse.sol`.

---

## 1. Why one contract

Two namespaces live under `phare.eth`:

```
phare.eth
├── vessel.phare.eth          ← imo-9133701.vessel.phare.eth, …
└── verifier.phare.eth        ← agent-3a4b5c.verifier.phare.eth, …
```

Both need: a wrapped parent, a registrar address that NameWrapper has approved as operator, and a flow that calls `setSubnodeRecord` + `PublicResolver.setText` in one transaction. That's the same shape twice. Folding both into one contract gives a single Etherscan link, a single mental model for judges, and a thematic name — `Lighthouse` — that mirrors the project itself (Phare = lighthouse).

The trust models for the two namespaces are deliberately mirror-image, and the asymmetry is the most interesting part of the design.

| | Vessel subname | Verifier subname |
|---|---|---|
| Owner of the wrapped child token | `address(Lighthouse)` | the verifier's principal EOA |
| `PARENT_CANNOT_CONTROL` burnt | yes | yes |
| `CANNOT_TRANSFER` burnt | **yes** | no |
| Records writable by | `Lighthouse` (only via `ReportRegistry`) | the principal directly |
| Permanence | sealed forever to the contract | belongs to the keeper |

A vessel cannot hold a wallet, so `Lighthouse` owns the token permanently and writes records on the registry's behalf. A verifier *is* a wallet, so the principal owns the token and writes its own records — `Lighthouse` only midwifes the mint.

---

## 2. Vocabulary

- **Wrap** — convert an ENS name from the legacy Registry (one mutable `owner` slot) into the NameWrapper's ERC-1155 form, where ownership and permissions are encoded as token + `fuses`.
- **Fuses** — bitfield permissions on a wrapped name. Burn-only, irreversible. The two we use:
  - `CANNOT_UNWRAP` — burnt on each *parent* (`vessel.phare.eth`, `verifier.phare.eth`). This is the prerequisite that lets us burn any owner-controlled fuse on a *child*.
  - `PARENT_CANNOT_CONTROL` (PCC) — burnt on each *child*. Once burnt, neither the parent owner nor `Lighthouse` itself can revoke or rewrite the child. The child is sovereign.
  - `CANNOT_TRANSFER` — burnt on vessel children only. Locks the subname token to `Lighthouse` forever, so vessel identities can never be moved or sold.
- **Operator approval** — `NameWrapper.setApprovalForAll(Lighthouse, true)` granted by the parent owner. This authorizes `Lighthouse` to call `setSubnodeRecord` on either parent without owning the parent token. Cleaner than transferring the parent: parent-owner key retains the safety net to revoke approval if `Lighthouse` ships with a bug.

---

## 3. The contract

`Lighthouse.sol`. Sepolia. ~80 lines.

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
    function setContenthash(bytes32 node, bytes calldata hash) external;
}

contract Lighthouse {
    INameWrapper    public immutable nameWrapper;
    IPublicResolver public immutable resolver;
    bytes32         public immutable vesselParent;    // namehash("vessel.phare.eth")
    bytes32         public immutable verifierParent;  // namehash("verifier.phare.eth")
    address         public immutable reportRegistry;  // sole authority for vessel writes

    // PARENT_CANNOT_CONTROL only — verifier remains transferable + unwrappable
    uint32 constant FUSES_VERIFIER = 0x10000;
    // PARENT_CANNOT_CONTROL | CANNOT_TRANSFER | CANNOT_UNWRAP — vessel sealed to contract
    uint32 constant FUSES_VESSEL   = 0x10000 | 0x4 | 0x1;

    event VesselNamed     (uint256 indexed imo, bytes32 indexed node, string ens);
    event VesselSighted   (uint256 indexed imo, bytes32 indexed node, uint32 sightings, uint32 disputed);
    event VesselOrbital   (uint256 indexed imo, bytes32 indexed node, bytes32 imageHash);
    event VerifierEnrolled(address indexed principal, string handle, bytes32 indexed node);

    modifier onlyRegistry() { require(msg.sender == reportRegistry, "not registry"); _; }

    constructor(address nw, address res, bytes32 vp, bytes32 verp, address registry) {
        nameWrapper    = INameWrapper(nw);
        resolver       = IPublicResolver(res);
        vesselParent   = vp;
        verifierParent = verp;
        reportRegistry = registry;
    }

    // ─── Vessels ───────────────────────────────────────────────────────────

    function nameVessel(uint256 imo, string calldata swarmRef)
        external onlyRegistry returns (bytes32 node)
    {
        string memory label = _vesselLabel(imo); // "imo-9133701"
        node = nameWrapper.setSubnodeRecord(
            vesselParent, label,
            address(this), address(resolver),
            0, FUSES_VESSEL, type(uint64).max
        );
        resolver.setText(node, "vessel.imo", _toString(imo));
        resolver.setText(node, "vessel.swarm.log", swarmRef);
        emit VesselNamed(imo, node, string.concat(label, ".vessel.phare.eth"));
    }

    function recordSighting(
        uint256 imo, string calldata swarmRef, uint32 sightings, uint32 disputed
    ) external onlyRegistry {
        bytes32 node = _vesselNode(imo);
        resolver.setText(node, "vessel.swarm.log", swarmRef);
        resolver.setText(node, "vessel.sightings.count",    _toString(sightings));
        resolver.setText(node, "vessel.sightings.disputed", _toString(disputed));
        emit VesselSighted(imo, node, sightings, disputed);
    }

    function recordOrbital(
        uint256 imo, string calldata image, bytes32 imageHash, string calldata teePrediction
    ) external onlyRegistry {
        bytes32 node = _vesselNode(imo);
        resolver.setText(node, "vessel.orbital.image",         image);
        resolver.setText(node, "vessel.orbital.imageHash",     _toHex(imageHash));
        resolver.setText(node, "vessel.orbital.tee.prediction", teePrediction);
        emit VesselOrbital(imo, node, imageHash);
    }

    // ─── Verifiers ─────────────────────────────────────────────────────────

    function enrollVerifier(
        string calldata handle, string calldata policyURI, string calldata soulURI
    ) external returns (bytes32 node) {
        node = nameWrapper.setSubnodeRecord(
            verifierParent, handle,
            msg.sender, address(resolver),
            0, FUSES_VERIFIER, type(uint64).max
        );
        resolver.setText(node, "verifier.policy",  policyURI);
        resolver.setText(node, "verifier.soul",    soulURI);
        resolver.setText(node, "verifier.runtime", "openclaw");
        emit VerifierEnrolled(msg.sender, handle, node);
    }

    // ─── Internals: _vesselLabel, _vesselNode, _toString, _toHex ───────────
}
```

The `_vessel*` helpers are a `keccak256(parent, labelhash)` recomputation plus an `imo-<n>` formatter. Trivial.

---

## 4. Pre-event setup

One-shot, run once before the demo. Nine transactions, all by the parent-owner key.

| # | Action | Notes |
|---|---|---|
| 1 | Acquire `phare.eth` on Sepolia ENS (fallback `phare-demo.eth`) | free on Sepolia |
| 2 | Wrap `phare.eth` in NameWrapper | one tx |
| 3 | Mint subnode `vessel.phare.eth` under `phare.eth` | parent owns |
| 4 | Mint subnode `verifier.phare.eth` under `phare.eth` | parent owns |
| 5 | Burn `CANNOT_UNWRAP` on `vessel.phare.eth` | enables fuses on vessel children |
| 6 | Burn `CANNOT_UNWRAP` on `verifier.phare.eth` | enables fuses on verifier children |
| 7 | Deploy `Lighthouse.sol` with the four immutables | one tx |
| 8 | `NameWrapper.setApprovalForAll(Lighthouse, true)` on `vessel.phare.eth` | one tx |
| 9 | `NameWrapper.setApprovalForAll(Lighthouse, true)` on `verifier.phare.eth` | one tx |

After step 9, `Lighthouse` is the only contract that ever calls NameWrapper. The parent-owner key retains the right to revoke approval (escape hatch) but does not need to sign anything during the demo.

---

## 5. Runtime flows

### 5.1 Vessel: first sighting

```
Reporter PWA              ReportRegistry             Lighthouse              NameWrapper / PublicResolver
  │                           │                         │                              │
  │── submit(report) ────────▶│                         │                              │
  │                           │                         │                              │
  │           (UMA OOv3 liveness window — 1 min)        │                              │
  │                           │                         │                              │
  │                           │── _onSettled ──────────▶│                              │
  │                           │                         │── setSubnodeRecord ─────────▶│
  │                           │                         │   (FUSES_VESSEL,             │
  │                           │                         │    owner=address(this))      │
  │                           │                         │── setText("vessel.imo") ────▶│
  │                           │                         │── setText("vessel.swarm.log")▶│
  │                           │                         │                              │
  │       ✱ imo-9133701.vessel.phare.eth resolvable in any browser ✱                   │
```

### 5.2 Vessel: subsequent sighting

`ReportRegistry._onSettled` calls `Lighthouse.recordSighting(imo, swarmRef, sightings, disputed)`. `Lighthouse` already owns the wrapped child; it calls the resolver directly. No NameWrapper interaction.

### 5.3 Vessel: orbital corroboration

`ReportRegistry.OrbitallyCorroborated(imo)` → `Lighthouse.recordOrbital(...)`. Writes the three `vessel.orbital.*` records. Full corroboration JSON lives on Swarm; the discrete records are summary fields for fast UI reads.

### 5.4 Verifier: enrollment

```
Verifier wallet            Lighthouse                 NameWrapper / PublicResolver
  │                           │                              │
  │── enrollVerifier(         │                              │
  │     "agent-3a4b5c",       │                              │
  │     bzz://policy,         │                              │
  │     bzz://soul) ─────────▶│                              │
  │                           │── setSubnodeRecord ─────────▶│
  │                           │   (FUSES_VERIFIER,           │
  │                           │    owner=msg.sender)         │
  │                           │── setText × 3 ──────────────▶│
  │                           │                              │
  │   ✱ agent-3a4b5c.verifier.phare.eth resolvable, owned by verifier wallet ✱
```

### 5.5 Verifier: post-dispute writes

After each `disputeAssertion` (NICK_SPEC §8), the verifier's wallet calls `PublicResolver.setText(node, "verifier.lastDecision", bzzRef)` directly. `Lighthouse` is not involved. PCC is burnt on the child, so even the parent owner cannot interfere.

`verifier.swarm.log` and `contenthash` (the activity log JSON, ENS_SPEC §5.3) are written the same way. Counters like `verifier.stats.won` / `verifier.stats.lost` are derivable from the log; we deliberately omit them as discrete on-chain text records to save gas and avoid self-attestation surface.

---

## 6. Records on-chain vs. on Swarm

`ENS_SPEC.md` §3.1 and §4 list ~14 vessel records and ~15 verifier records. Writing all of them every settlement is gratuitous — most are derivable from the JSON pinned to Swarm.

What lives on-chain:

| Subname | Records kept on-chain |
|---|---|
| `imo-<n>.vessel.phare.eth` | `vessel.imo`, `vessel.swarm.log`, `vessel.sightings.count`, `vessel.sightings.disputed`, `vessel.orbital.image`, `vessel.orbital.imageHash`, `vessel.orbital.tee.prediction`, `contenthash` |
| `<handle>.verifier.phare.eth` | `verifier.policy`, `verifier.soul`, `verifier.runtime`, `verifier.lastDecision`, `contenthash` |

Everything else (aliases, full sighting history, reporter list, full TEE inference doc, full activity log, soul markdown) lives in the Swarm JSONs that `vessel.swarm.log` / `verifier.swarm.log` / `contenthash` already point at. This cuts per-settlement gas by roughly 70 % vs. writing the full §3.1 set, while remaining lossless — every dropped field still resolves through one extra Swarm fetch.

---

## 7. Why this wins the prizes

**Best ENS Integration for AI Agents** — the verifier is a wallet that calls `Lighthouse.enrollVerifier` from its own key during onboarding (NICK_SPEC §11), receives a wrapped ERC-1155 with `PARENT_CANNOT_CONTROL` burnt, then writes `verifier.policy` / `verifier.soul` / `verifier.lastDecision` itself after every dispute. The agent's identity, reasoning trail, and self-description are all on-chain ENS records, written by the agent. No CCIP-Read shortcut. No centralized minter. Resolve the name in any ENS browser → see the live policy + the latest reasoning JSON.

**Most Creative Use of ENS** — every sanctioned vessel becomes an ERC-1155 NameWrapper token whose owner is a smart contract, sealed by `CANNOT_TRANSFER`. ENS is being used as the public registry for a class of physical objects (shadow-fleet tankers) that has no public registry, no wallet, and actively tries not to be seen. The Lighthouse contract — not any human — is the "owner" of the vessel's identity, and it can only be updated via `ReportRegistry` settlements. ENS as tamper-evident infrastructure for civic accountability.

The two namespaces also reinforce each other on-chain: the verifier-log JSON pinned to `<handle>.verifier.phare.eth` references the IMOs it ruled on, and a vessel's Swarm log references the verifiers that disputed sightings on it. The graph is fully browsable through ENS alone.

---

## 8. Demo plan (60 seconds, ENS slice)

1. Open `agent-3a4b5c.verifier.phare.eth` in an ENS browser. Show: `verifier.policy` → bzz markdown, `verifier.soul` → bzz markdown, `verifier.lastDecision` → empty.
2. Reporter PWA submits a real-looking sighting for IMO 9133701 (PABLO). UMA liveness window (1 min) starts.
3. Liveness expires. `ReportRegistry._onSettled` fires `Lighthouse.nameVessel(9133701, swarmRef)` in the same tx. Etherscan view of the call.
4. Open `imo-9133701.vessel.phare.eth`. It resolves. Show: `vessel.imo = 9133701`, `vessel.swarm.log` → bzz log JSON, `contenthash` → Swarm dossier.
5. Second tab: reporter submits a fake sighting (IMO 9999999, suspicious photo). Within a heartbeat tick, the verifier disputes. Verifier's wallet writes `verifier.lastDecision` to its own ENS subname.
6. Re-open the verifier subname. `verifier.lastDecision` now points at the reasoning JSON pinned in step 5. Click through, read, close.

Three artifacts on the screen at the end: a vessel ENS subname, a verifier ENS subname, a reasoning trail. All resolved via stock ENS tooling. No project-controlled API in the path.

---

## 9. Migration from prior specs

| Prior reference | New status |
|---|---|
| `ENS_SPEC.md` §6 NameStone write path | **Replaced** by Lighthouse §5 flows |
| `ENS_SPEC.md` §3.1 14-record vessel set | **Reduced** per §6 of this spec; full data still in Swarm log |
| `ENS_SPEC.md` §4.4 discrete `verifier.stats.*` records | **Dropped** — derive from `verifier.swarm.log` |
| `NICK_SPEC.md` §10 `EnsRegistrar.sol` | **Renamed/extended** as `Lighthouse.sol` §3; verifier mint logic identical |
| `NICK_SPEC.md` §6 pre-event setup steps 1–6 | **Extended** with vessel-side mirror steps; see §4 |
| `NICK_SPEC.md` §7.3 `ens.tool.js` | **Compatible** — point `registerEnsAgent` at `Lighthouse.enrollVerifier` |
| `SPEC.md` §5 ReportRegistry on Base Sepolia | **Move to Sepolia** — required for same-chain ENS calls |
| `SPEC.md` §7 `minter/` service | **Deleted** — vessel records written by `Lighthouse` from inside `ReportRegistry._onSettled` |

---

## 10. Open questions

- **`ReportRegistry` mint authority.** `Lighthouse.nameVessel` is `onlyRegistry`. If we redeploy `ReportRegistry`, the immutable `reportRegistry` address becomes stale. Mitigation: deploy `Lighthouse` last, after `ReportRegistry` is final, or add an admin-set authority (loses immutability). Hackathon-acceptable: deploy in correct order.
- **Vessel-label collision.** `imo-<n>` labels are deterministic and a sanctioned IMO is unique, so collision is impossible. Re-mint guard: `nameVessel` reverts if the subname is already taken (NameWrapper rejects). Need to either guard in `ReportRegistry` (call only on first sighting) or add an existence check in `Lighthouse`.
- **Contenthash encoding.** `setContenthash` expects multicodec-prefixed bytes (0xe40101701220 + 32-byte Swarm hash). The contract takes `bytes` directly; the caller is responsible for prefixing. `ReportRegistry` and verifier client libraries both must include the prefix when calling.
- **Gas at scale.** 4 setText calls per sighting on Sepolia is fine; on mainnet at $30/gwei this is ~$8/sighting. For the demo, no concern. For a real deployment, a custom resolver that emits events instead of storing strings (CCIP-Read read path) is the right v2.
- **Verifier handle squatting.** `enrollVerifier` is permissionless and first-come-first-served. A griefer can mint `alpha`, `beta`, etc. Mitigation for hackathon: skill (NICK_SPEC §11) derives handle from `agent-<address-tail>`, which is collision-resistant. Curated handles deferred.
