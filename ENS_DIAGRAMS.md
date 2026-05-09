# Phare — ENS Connection Diagrams

> Mermaid diagrams of the ENS layer, derived from `LIGHTHOUSE_SPEC.md`, `ENS_INIT.md`, and `DESIGN_DOCUMENT.md`. Each diagram is self-contained and renders in any Mermaid-aware viewer (GitHub, VS Code, Obsidian, etc.).

---

## 1. ENS namespace hierarchy

The two namespaces both live under `phare.eth` on Sepolia. Vessels under `vessel.phare.eth`, verifier agents under `verifier.phare.eth`.

```mermaid
graph TD
    ETH([.eth root])
    PHARE["phare.eth<br/><i>wrapped, CANNOT_UNWRAP burnt</i><br/>owner: deployer EOA"]
    VESSEL["vessel.phare.eth<br/><i>CANNOT_UNWRAP burnt</i><br/>owner: deployer EOA<br/>operator: Lighthouse"]
    VERIFIER["verifier.phare.eth<br/><i>CANNOT_UNWRAP burnt</i><br/>owner: deployer EOA<br/>operator: Lighthouse"]
    V1["imo-9133701.vessel.phare.eth<br/><i>FUSES_VESSEL: PCC + CANNOT_TRANSFER + CANNOT_UNWRAP</i><br/>owner: Lighthouse contract"]
    V2["imo-9259325.vessel.phare.eth<br/><i>(per sanctioned IMO ever sighted)</i>"]
    A1["agent-3a4b5c.verifier.phare.eth<br/><i>FUSES_VERIFIER: PCC only</i><br/>owner: verifier principal EOA"]
    A2["agent-9f2e1a.verifier.phare.eth<br/><i>(per OpenClaw skill install)</i>"]

    ETH --> PHARE
    PHARE --> VESSEL
    PHARE --> VERIFIER
    VESSEL --> V1
    VESSEL --> V2
    VERIFIER --> A1
    VERIFIER --> A2

    classDef parent fill:#1e3a5f,stroke:#5a8dcc,color:#fff
    classDef vessel fill:#3d2b4a,stroke:#a07fb8,color:#fff
    classDef agent  fill:#2b4a3d,stroke:#7fb89a,color:#fff
    class ETH,PHARE,VESSEL,VERIFIER parent
    class V1,V2 vessel
    class A1,A2 agent
```

---

## 2. Component interactions with the ENS layer

`Lighthouse.sol` is the single contract that mediates every ENS write. `ReportRegistry` is its sole authority for vessel writes; verifier wallets self-enroll directly.

```mermaid
graph LR
    subgraph offchain[Off-chain actors]
        PWA[Reporter PWA<br/>web/]
        SKILL[Verifier Skill<br/>OpenClaw]
        ORB[Orbital Orchestrator<br/>orbital/]
    end

    subgraph onchain[Sepolia on-chain]
        RR[ReportRegistry.sol]
        LH[Lighthouse.sol<br/><b>single ENS gateway</b>]
        NW[NameWrapper<br/>0x0635...dFcE8]
        PR[PublicResolver<br/>0x8FAD...B7dD]
        REG[ENS Registry<br/>0x0000...e1e]
    end

    subgraph ens[ENS subnames]
        VESS[imo-N.vessel.phare.eth]
        VERIF[handle.verifier.phare.eth]
    end

    PWA -->|submit + bond| RR
    ORB -->|attest| RR
    RR -->|nameVessel / recordSighting / recordOrbital<br/><i>onlyRegistry</i>| LH

    SKILL -->|enrollVerifier<br/><i>permissionless</i>| LH
    SKILL -->|setText verifier.lastDecision<br/><i>direct, post-PCC</i>| PR

    LH -->|setSubnodeRecord| NW
    LH -->|setText / setContenthash| PR
    NW --> REG
    PR --> REG

    NW -.mints.-> VESS
    NW -.mints.-> VERIF

    classDef contract fill:#1e3a5f,stroke:#5a8dcc,color:#fff
    classDef actor    fill:#3d2b1f,stroke:#cc8d5a,color:#fff
    classDef name     fill:#2b4a3d,stroke:#7fb89a,color:#fff
    class RR,LH,NW,PR,REG contract
    class PWA,SKILL,ORB actor
    class VESS,VERIF name
```

---

## 3. Pre-event setup — 9 transactions

One-shot bootstrap from a single deployer key. Sourced from `LIGHTHOUSE_SPEC.md §4` and the cast commands in `ENS_INIT.md`.

```mermaid
sequenceDiagram
    autonumber
    actor D as Deployer EOA
    participant ENS as ENS Manager App<br/>(browser)
    participant NW as NameWrapper
    participant LHC as Lighthouse contract

    D->>ENS: 1. Register phare.eth (commit/reveal, ~0.005 ETH)
    Note over ENS,NW: Manager app wraps by default → ERC-1155
    D->>NW: 2. setSubnodeOwner(phare, "vessel", D, 0, max)
    D->>NW: 3. setSubnodeOwner(phare, "verifier", D, 0, max)
    D->>NW: 4. setFuses(phare.eth, CANNOT_UNWRAP=1)
    D->>NW: 5. setChildFuses(phare, "vessel", PCC|CANNOT_UNWRAP=65537)
    D->>NW: 6. setChildFuses(phare, "verifier", PCC|CANNOT_UNWRAP=65537)
    D->>LHC: 7. forge create ReportRegistry(orbitalAttestor)
    D->>LHC: 8. forge create Lighthouse(NW, resolver, vesselNode, verifierNode, RR)
    D->>NW: 9. setApprovalForAll(Lighthouse, true)

    Note over D,NW: After step 9, the deployer key never signs<br/>ENS-related txs again during the demo.
```

---

## 4. Trust-model asymmetry — vessel vs verifier

The most distinctive design choice in the ENS layer. Mirror-image fuse policies for two opposite trust assumptions.

```mermaid
graph TB
    subgraph vessel_side[Vessel subname<br/>imo-N.vessel.phare.eth]
        VO[Owner: Lighthouse contract]
        VF["Fuses burnt:<br/>• PARENT_CANNOT_CONTROL<br/>• CANNOT_TRANSFER<br/>• CANNOT_UNWRAP"]
        VW["Records writable by:<br/>Lighthouse, only via ReportRegistry"]
        VP[Permanence: sealed forever<br/>to the contract]
        VR[Rationale: a vessel cannot hold<br/>a wallet — identity must be<br/>tamper-evident infrastructure]
    end

    subgraph verifier_side[Verifier subname<br/>handle.verifier.phare.eth]
        AO[Owner: verifier principal EOA]
        AF["Fuses burnt:<br/>• PARENT_CANNOT_CONTROL only"]
        AW["Records writable by:<br/>the principal directly<br/>(Lighthouse only midwifes the mint)"]
        AP[Permanence: belongs to the keeper]
        AR[Rationale: a verifier IS a wallet —<br/>policy / soul / lastDecision are<br/>self-curated public statements]
    end

    VO --- VF --- VW --- VP --- VR
    AO --- AF --- AW --- AP --- AR

    classDef vessel fill:#3d2b4a,stroke:#a07fb8,color:#fff
    classDef agent  fill:#2b4a3d,stroke:#7fb89a,color:#fff
    class VO,VF,VW,VP,VR vessel
    class AO,AF,AW,AP,AR agent
```

---

## 5. Vessel — first sighting flow

A settled `ReportRegistry` event triggers the mint and initial records. From `LIGHTHOUSE_SPEC.md §5.1`.

```mermaid
sequenceDiagram
    autonumber
    actor R as Reporter PWA
    participant RR as ReportRegistry
    participant UMA as UMA OOv3
    participant LH as Lighthouse
    participant NW as NameWrapper
    participant PR as PublicResolver

    R->>RR: submit(report, $5 USDC bond)
    RR->>UMA: assertTruth("Report at bzz://… is true")
    Note over UMA: liveness window (≈1 min for demo)
    UMA-->>RR: assertionResolvedCallback(id, true)
    RR->>RR: _onSettled
    RR->>LH: nameVessel(imo, swarmRef)
    LH->>NW: setSubnodeRecord(vesselParent, "imo-9133701",<br/>owner=address(this), FUSES_VESSEL, max)
    NW-->>LH: node
    LH->>PR: setText(node, "vessel.imo", "9133701")
    LH->>PR: setText(node, "vessel.swarm.log", "bzz://…")
    LH-->>RR: emit VesselNamed(imo, node, ens)

    Note over R,PR: imo-9133701.vessel.phare.eth now resolvable<br/>in any ENS-aware browser.
```

---

## 6. Verifier — self-enrollment flow

Permissionless. Any wallet can call `enrollVerifier` and walks away owning a wrapped ERC-1155 with PCC burnt. From `LIGHTHOUSE_SPEC.md §5.4` and `DESIGN_DOCUMENT.md §4.4`.

```mermaid
sequenceDiagram
    autonumber
    actor V as Verifier wallet<br/>(OpenClaw skill)
    participant SW as Swarm
    participant LH as Lighthouse
    participant NW as NameWrapper
    participant PR as PublicResolver

    Note over V: phase: needs-ens<br/>handle = "agent-" + last-6-hex(addr)
    V->>SW: pin policy.json → bzz://policy
    V->>SW: pin soul.md → bzz://soul
    V->>LH: enrollVerifier("agent-3a4b5c", bzz://policy, bzz://soul)
    LH->>NW: setSubnodeRecord(verifierParent, "agent-3a4b5c",<br/>owner=msg.sender, FUSES_VERIFIER, max)
    NW-->>LH: node
    LH->>PR: setText(node, "verifier.policy", bzz://policy)
    LH->>PR: setText(node, "verifier.soul", bzz://soul)
    LH->>PR: setText(node, "verifier.runtime", "openclaw")
    LH-->>V: emit VerifierEnrolled(principal, handle, node)

    Note over V,PR: phase: running.<br/>From now on, V writes verifier.lastDecision<br/>directly to PublicResolver — Lighthouse not in path.
```

---

## 7. Verifier — post-dispute self-write

After PCC is burnt, the verifier owns its name outright and writes its own reasoning trail. `Lighthouse` is no longer involved.

```mermaid
sequenceDiagram
    autonumber
    actor V as Verifier wallet
    participant UMA as UMA OOv3
    participant RR as ReportRegistry
    participant SW as Swarm
    participant PR as PublicResolver

    UMA-->>V: AssertionMade event<br/>(callback recipient = ReportRegistry)
    V->>SW: fetch metadata.json (Verified Fetch)
    V->>V: evaluate against policy → "fake"
    V->>SW: pin reasoning.json → bzz://reasoning
    V->>UMA: disputeAssertion(id, counter-bond)
    Note over UMA: voters resolve…
    UMA-->>RR: assertionResolvedCallback(id, false)
    V->>PR: setText(node, "verifier.lastDecision", bzz://reasoning)
    Note over V,PR: PCC is burnt → no parent / no Lighthouse<br/>can interfere with this write.
```

---

## 8. Records — on-chain vs Swarm

`LIGHTHOUSE_SPEC.md §6` deliberately keeps only summary fields on-chain. Everything else is reachable via one extra Swarm fetch. ~70% gas reduction vs writing the full `ENS_SPEC.md §3.1` set.

```mermaid
graph LR
    subgraph vessel_node[imo-N.vessel.phare.eth]
        direction TB
        VOC["<b>On-chain text records</b><br/>vessel.imo<br/>vessel.swarm.log<br/>vessel.sightings.count<br/>vessel.sightings.disputed<br/>vessel.orbital.image<br/>vessel.orbital.imageHash<br/>vessel.orbital.tee.prediction<br/>contenthash"]
    end

    subgraph verifier_node[handle.verifier.phare.eth]
        direction TB
        AOC["<b>On-chain text records</b><br/>verifier.policy<br/>verifier.soul<br/>verifier.runtime<br/>verifier.lastDecision<br/>contenthash"]
    end

    subgraph swarm[Swarm — content-addressed]
        direction TB
        VS["<b>Vessel dossier JSON</b><br/>full sighting history<br/>aliases / flag / AIS-dark<br/>reporter list<br/>verifier list<br/>orbital_corroboration block<br/>TEE inference doc"]
        AS["<b>Verifier artifacts</b><br/>policy JSON (full)<br/>soul markdown<br/>activity log JSON<br/>per-dispute reasoning JSON<br/>stats (derivable)"]
    end

    VOC -. vessel.swarm.log + contenthash .-> VS
    AOC -. verifier.policy / soul / lastDecision .-> AS

    classDef vessel fill:#3d2b4a,stroke:#a07fb8,color:#fff
    classDef agent  fill:#2b4a3d,stroke:#7fb89a,color:#fff
    classDef store  fill:#3d3d1f,stroke:#cccc5a,color:#fff
    class vessel_node,VOC vessel
    class verifier_node,AOC agent
    class swarm,VS,AS store
```

---

## 9. End-to-end demo slice (60 seconds, ENS perspective)

Composition of the previous flows into the live-demo timeline from `LIGHTHOUSE_SPEC.md §8`.

```mermaid
sequenceDiagram
    autonumber
    actor V as Verifier (pre-enrolled)
    actor R as Reporter PWA
    participant RR as ReportRegistry
    participant UMA as UMA OOv3
    participant LH as Lighthouse
    participant ENS as ENS browser

    Note over V: agent-3a4b5c already enrolled.<br/>verifier.lastDecision = empty.
    R->>RR: submit(IMO 9133701, photo, $5)
    RR->>UMA: assertTruth(...)
    Note over UMA: 1-min liveness — no dispute
    UMA-->>RR: resolved(true)
    RR->>LH: nameVessel(9133701, swarmRef)
    Note over LH,ENS: imo-9133701.vessel.phare.eth resolvable

    R->>RR: submit(IMO 9999999, fabricated photo)
    RR->>UMA: assertTruth(...)
    V->>UMA: disputeAssertion(id, counter-bond)
    Note over UMA: voters → false
    UMA-->>RR: resolved(false)
    V->>V: pin reasoning.json
    V->>ENS: setText(verifier.lastDecision, bzz://reasoning)

    Note over ENS: Three artifacts on screen:<br/>• imo-9133701.vessel.phare.eth (vessel identity)<br/>• agent-3a4b5c.verifier.phare.eth (agent identity)<br/>• reasoning JSON (live-updated trail)
```
