# ENS Expansion

> Detailed schema for Phare's two ENS namespaces — `vessel.phare.eth` and `verifier.phare.eth` — plus the structure of the Swarm-hosted artifacts (JSON logs, markdown souls, orbital imagery) that ENS records point to.

Supersedes the ENS sketch in §5 of `SPEC.md` (which used `disputer.phare.eth` and a thin set of records). Compatible with the orbital corroboration extension in `RUBEN_SPEC.md` — that spec adds fields here, this spec defines their schema.

---

## 1. Terminology evolution: sentinel/disputer → selector → verifier

`SPEC.md` calls the dispute-racing actor a **sentinel agent** and uses `disputer.phare.eth`. An earlier draft of this file used **selector** / `selector.phare.eth`. From this revision onward we use **verifier** / `verifier.phare.eth`.

The rename trail:
- "Disputer" overweighted the adversarial mode (raise a challenge), but most of the work is the affirmative one — *judging* which reports look credible and need no challenge.
- "Selector" captured the affirmative half but read as choosing among options, which doesn't quite match the actual job.
- "Verifier" describes both halves cleanly and is the standard term in optimistic-oracle literature.

All references in `SPEC.md` to `<handle>.disputer.phare.eth`, `agent.stats.won`, etc. should be read as `<handle>.verifier.phare.eth` and `verifier.stats.won` going forward.

---

## 2. Namespace hierarchy

```
phare.eth                                   # parent name (acquired pre-event)
├── vessel.phare.eth                        # parent for vessel subnames
│   ├── imo-9133701.vessel.phare.eth        # one per sanctioned vessel ever sighted
│   ├── imo-9259325.vessel.phare.eth
│   └── ...
└── verifier.phare.eth                      # parent for verifier subnames
    ├── alpha.verifier.phare.eth            # one per registered verifier
    ├── beta.verifier.phare.eth
    └── ...
```

Both nested levels are minted via NameStone's CCIP-Read off-chain resolver — no on-chain registrar. Pre-event checklist (`SPEC.md` §10) requires verifying nested sub-subdomains under both parents work.

---

## 3. `imo-<n>.vessel.phare.eth` records

Each settled report for a sanctioned vessel writes or updates this name. The subname is created on the **first** settled sighting; subsequent sightings update its records. Orbital corroboration (RUBEN_SPEC §"SpaceComputer") adds the `vessel.orbital.*` family.

### 3.1 Core text records

| Key | Type | Source | Updated when |
|---|---|---|---|
| `vessel.imo` | string (7-digit) | report | once, on creation |
| `vessel.sanctioned` | bool (`true`/`false`) | OpenSanctions | on creation |
| `vessel.sanctionReason` | string (e.g. `oil-transport`) | OpenSanctions | on creation, refreshed on minter restart |
| `vessel.aliases` | comma-list of `imo-<n>` | OpenSanctions | on creation |
| `vessel.aisDark` | bool | report | flips to `true` on first AIS-dark sighting; sticky |
| `vessel.firstReporter` | address `0x…` | report | once, on creation |
| `vessel.reporters` | comma-list of addresses | report | append on each new reporter (deduped) |
| `vessel.verifiers` | comma-list of `<handle>.verifier.phare.eth` | dispute resolutions | append on each verifier that ruled on a dispute touching this vessel (winner or loser, both sides recorded) |
| `vessel.sightings.count` | uint | report | increment on each settled report |
| `vessel.sightings.disputed` | uint | dispute | increment on each disputed report (regardless of who won) |
| `vessel.lastSeen` | `<unix>,<lat>,<lon>` | report | overwrite on each report |
| `vessel.swarm.log` | `bzz://<hash>` | minter | overwrite on each update — points to canonical JSON sighting log (see §5.1) |
| `contenthash` | ENS contenthash bytes (Swarm encoding of same ref as `vessel.swarm.log`) | minter | mirror of `vessel.swarm.log` for ENS-native consumers |

### 3.2 Orbital records (`vessel.orbital.*`)

Written when the orbital orchestrator successfully calls `ReportRegistry.attest()` for the most recent sighting. All fields scoped under `vessel.orbital.*` so a consumer that doesn't care about orbital corroboration can ignore them in one prefix sweep.

| Key | Type | Notes |
|---|---|---|
| `vessel.orbital.image` | `bzz://<hash>` | Swarm-pinned satellite (or mock satellite) imagery used for corroboration |
| `vessel.orbital.imageHash` | `0x…` (bytes32) | the keccak hash that was attested on-chain — lets consumers verify the image they fetch matches what the contract recorded |
| `vessel.orbital.captureTimestamp` | unix timestamp | when the imagery was captured (or, in the hackathon mock, when the fixture was selected) |
| `vessel.orbital.attestor` | address `0x…` | the SpaceComputer KMS-derived Ethereum address that signed the EIP-191 attestation |
| `vessel.orbital.tee.prediction` | `bzz://<hash>` | Swarm-pinned JSON with the spaceTEE inference output (mocked for hackathon) |
| `vessel.orbital.tee.destination` | string (e.g. `Novorossiysk`) | one-line summary of the inferred destination port — surfaced for fast UI display |
| `vessel.orbital.tee.confidence` | string (`0.0`–`1.0`) | model-reported confidence in the destination guess |
| `vessel.orbital.confirmations` | uint | counter; increments each time `attest()` lands a fresh corroboration for this vessel |

The full TEE inference document (image hashes input, verifier-log refs input, route candidates, supporting evidence) lives in the JSON pointed at by `vessel.orbital.tee.prediction`. The other `vessel.orbital.tee.*` text records are quick-read summaries.

### 3.3 Why both `vessel.swarm.log` and `contenthash`

`contenthash` is the ENS-native way to bind a name to content and is what ENS-aware browsers/resolvers read. But its byte-encoding is awkward to consume from non-ENS tooling (you must decode the multicodec prefix). The `vessel.swarm.log` text record is a plain-string mirror for everything else — Phare's own dossier viewer, journalists' scripts, insurer pipelines.

Both records always point at the **same** Swarm reference. If you can only afford one (NameStone text-record cost or rate-limit pressure), keep `contenthash` and drop `vessel.swarm.log`.

### 3.4 What `vessel.reporters` and `vessel.verifiers` do

These two records are the human-auditable trail. A consumer reading `imo-9133701.vessel.phare.eth` learns instantly:

- Which addresses staked their bond on this ship existing (`vessel.reporters`)
- Which verifiers evaluated the reports (`vessel.verifiers`) — and their reputations are themselves resolvable as ENS names

Both are append-only comma-lists. We accept the size ceiling: NameStone text records are practically capped around a few KB. At that point further detail lives in the Swarm log only.

### 3.5 Example — `imo-9133701.vessel.phare.eth` after three sightings, one disputed, one orbitally corroborated

```
vessel.imo                      = 9133701
vessel.sanctioned               = true
vessel.sanctionReason           = oil-transport
vessel.aliases                  = imo-1234567,imo-7654321
vessel.aisDark                  = true
vessel.firstReporter            = 0xA11ce0000000000000000000000000000000A11c
vessel.reporters                = 0xA11ce…A11c,0xB0b00…B0b0,0xCa1e…Ca1e
vessel.verifiers                = alpha.verifier.phare.eth,beta.verifier.phare.eth
vessel.sightings.count          = 3
vessel.sightings.disputed       = 1
vessel.lastSeen                 = 1715162400,34.7,33.0
vessel.swarm.log                = bzz://3f2a…
contenthash                     = 0xe401017012203f2a…   (Swarm contenthash encoding)

vessel.orbital.image            = bzz://orb1…
vessel.orbital.imageHash        = 0x9d3c…
vessel.orbital.captureTimestamp = 1715165000
vessel.orbital.attestor         = 0xORBITAL_ATTESTOR
vessel.orbital.tee.prediction   = bzz://tee1…
vessel.orbital.tee.destination  = Novorossiysk
vessel.orbital.tee.confidence   = 0.78
vessel.orbital.confirmations    = 1
```

---

## 4. `<handle>.verifier.phare.eth` records

Records split into **identity** (immutable once set), **soul** (self-authored markdown), **policy** (rarely changes), and **stats** (live).

### 4.1 Identity records

| Key | Type | Notes |
|---|---|---|
| `verifier.handle` | string | matches the subname's leading label |
| `verifier.principal` | address `0x…` | the human or org that runs and stakes for this verifier |
| `verifier.address` | address `0x…` | the verifier's own operating EOA — what shows up as the disputer in UMA OOv3 events |
| `verifier.runtime` | enum: `openclaw` \| `local` \| `browser` | how the verifier is executed |
| `verifier.created` | unix timestamp | when the subname was registered |

### 4.2 Soul

The "soul" is a markdown document the verifier's principal authors and pins to Swarm. It is the verifier's **self-description** — narrative, qualitative, written by the operator, distinct from the structured policy and stats. Think: an "about" page that explains *why* this verifier exists, what it cares about, what the operator stands for.

| Key | Type | Notes |
|---|---|---|
| `verifier.soul` | `bzz://<hash>` | Swarm-pinned markdown document (`<handle>.soul.md`) authored by the principal — see §5.4 for shape suggestions |

The soul is intentionally unstructured. A verifier that wants to publish a manifesto, a poem, a policy rationale, or a single-line motto can all do so with the same record. Consumers display it inline on the verifier's profile page.

### 4.3 Policy records

These tell consumers *what kind* of verifier this is — what it actually checks before raising a dispute. Two verifiers can both be honest and still disagree on whether a borderline report deserves a challenge; the policy record is how a consumer judges that disagreement.

| Key | Type | Notes |
|---|---|---|
| `verifier.policy` | `bzz://<hash>` | JSON describing the dispute checks the verifier runs (see §5.2) |
| `verifier.policy.version` | semver | bumps when policy JSON changes |
| `verifier.skill` | string (e.g. `phare/verifier@1.2.0`) | ClawHub skill identifier + pinned version, if `runtime=openclaw` |

### 4.4 Stats records

Live counters, written by the off-chain minter (or a small `verifier-stats/` service) on each settled UMA assertion the verifier touched.

| Key | Type | Notes |
|---|---|---|
| `verifier.stats.disputes` | uint | total counter-bonds posted |
| `verifier.stats.won` | uint | disputes resolved in verifier's favour |
| `verifier.stats.lost` | uint | disputes resolved against verifier |
| `verifier.stats.skipped` | uint | reports examined but not disputed (informational; useful to detect a verifier that never disputes) |
| `verifier.stats.lastActive` | unix timestamp | last on-chain action observed |
| `verifier.stats.bondBalance` | string (USDC, e.g. `45.00`) | current free counter-bond capacity, sampled |
| `verifier.swarm.log` | `bzz://<hash>` | per-verifier activity log — JSON file, one entry per dispute (see §5.3) |
| `contenthash` | ENS contenthash | mirror of `verifier.swarm.log`, same rationale as §3.3 |

### 4.5 Example — `alpha.verifier.phare.eth` after a winning dispute

```
verifier.handle             = alpha
verifier.principal          = 0x1111111111111111111111111111111111111111
verifier.address            = 0x2222222222222222222222222222222222222222
verifier.runtime            = openclaw
verifier.created            = 1714000000
verifier.soul               = bzz://7ab3…
verifier.policy             = bzz://9c7b…
verifier.policy.version     = 1.2.0
verifier.skill              = phare/verifier@1.2.0
verifier.stats.disputes     = 14
verifier.stats.won          = 12
verifier.stats.lost         = 2
verifier.stats.skipped      = 437
verifier.stats.lastActive   = 1715162430
verifier.stats.bondBalance  = 45.00
verifier.swarm.log          = bzz://5d8e…
contenthash                 = 0xe401017012205d8e…
```

---

## 5. Swarm-hosted artifacts

ENS records carry summaries and pointers; the **canonical, append-only history and the freeform descriptions** live in files on Swarm. Each update mints a new Swarm content-hash and updates the ENS pointer.

### 5.1 Vessel sighting log — `bzz://` from `vessel.swarm.log` / `contenthash`

```json
{
  "schema": "phare.vessel-log/2",
  "imo": "9133701",
  "sanctioned": true,
  "sanction_reason": "oil-transport",
  "aliases": ["1234567", "7654321"],
  "ais_dark_seen": true,
  "first_reporter": "0xA11c…A11c",
  "reporters": ["0xA11c…A11c", "0xB0b0…B0b0", "0xCa1e…Ca1e"],
  "sightings": [
    {
      "report_id": "0xreport1…",
      "reporter": "0xA11c…A11c",
      "timestamp": 1715000000,
      "gps": [34.7, 33.0],
      "ais_dark": true,
      "photo_swarm_ref": "bzz://abc1…",
      "metadata_swarm_ref": "bzz://def2…",
      "settlement": { "outcome": "uncontested", "settled_at": 1715000030 }
    },
    {
      "report_id": "0xreport2…",
      "reporter": "0xB0b0…B0b0",
      "timestamp": 1715080000,
      "gps": [34.8, 33.1],
      "ais_dark": true,
      "photo_swarm_ref": "bzz://abc3…",
      "metadata_swarm_ref": "bzz://def4…",
      "settlement": {
        "outcome": "disputed-honest",
        "disputer": "gamma.verifier.phare.eth",
        "resolution": "report_upheld",
        "settled_at": 1715090000
      }
    },
    {
      "report_id": "0xreport3…",
      "reporter": "0xCa1e…Ca1e",
      "timestamp": 1715162400,
      "gps": [34.7, 33.0],
      "ais_dark": true,
      "photo_swarm_ref": "bzz://abc5…",
      "metadata_swarm_ref": "bzz://def6…",
      "orbital_corroboration": {
        "image_hash": "0x…",
        "image_swarm_ref": "bzz://orb1…",
        "capture_timestamp": 1715165000,
        "attestor": "0xORBITAL_ATTESTOR",
        "signature": "0x…",
        "tee_inference": {
          "swarm_ref": "bzz://tee1…",
          "destination": "Novorossiysk",
          "confidence": 0.78,
          "mocked": true
        }
      },
      "settlement": { "outcome": "uncontested", "settled_at": 1715162430 }
    }
  ]
}
```

The `orbital_corroboration` block is the integration point with the SpaceComputer flow in `RUBEN_SPEC.md`. The `tee_inference.mocked` flag is set to `true` in the hackathon build and `false` in any future real-spaceTEE deployment; consumers can decide which sightings to trust accordingly.

### 5.2 Verifier policy — `bzz://` from `verifier.policy`

Static document a verifier publishes to declare its review behaviour. Helps consumers and other verifiers understand *why* a given verifier disputed (or didn't).

```json
{
  "schema": "phare.verifier-policy/1",
  "version": "1.2.0",
  "verifier": "alpha.verifier.phare.eth",
  "checks": [
    { "id": "imo-format", "description": "Reject malformed IMO numbers" },
    { "id": "ocean-bbox", "description": "Reject coordinates not on water (Sahara, Antarctic interior, etc.)" },
    { "id": "stolen-photo-bloom", "source": "phare/stolen-photo-bloom@2026-04", "description": "Reject perceptual hashes matching public maritime image archives" }
  ],
  "min_bond_required": "5.00 USDC",
  "heartbeat_seconds": 5,
  "license": "MIT"
}
```

### 5.3 Verifier activity log — `bzz://` from `verifier.swarm.log` / `contenthash`

```json
{
  "schema": "phare.verifier-log/1",
  "verifier": "alpha.verifier.phare.eth",
  "address": "0x2222…2222",
  "summary": { "disputes": 14, "won": 12, "lost": 2, "skipped": 437 },
  "entries": [
    {
      "report_id": "0xreport2…",
      "imo": "9133701",
      "action": "skipped",
      "checks_passed": ["imo-format", "ocean-bbox", "stolen-photo-bloom"],
      "observed_at": 1715080005
    },
    {
      "report_id": "0xreportX…",
      "imo": "9999999",
      "action": "disputed",
      "trigger_check": "stolen-photo-bloom",
      "evidence_swarm_ref": "bzz://evid1…",
      "counter_bond": "5.00 USDC",
      "observed_at": 1715090100,
      "resolution": "verifier_won",
      "settled_at": 1715091200
    }
  ]
}
```

### 5.4 Verifier soul — `bzz://` from `verifier.soul`

A markdown document, no schema, written by the verifier's principal. Suggested shape:

```markdown
# alpha

> "Verify the photo, not the photographer."

I run because the public deserves an evidence trail for shadow-fleet vessels
that survives the news cycle. I dispute when:

- The photo trips a known archive bloom filter.
- The coordinates fall on land or sit in a port that has no record of the IMO.
- A second, independent reporter contradicts the first within the same hour.

I do not dispute on aesthetic grounds. A blurry photo can still be a real one.

— principal: 0x1111…1111
— skill:     phare/verifier@1.2.0
```

The soul is the verifier's voice. It is the part of the record that explains *why* a particular operator chose to participate at all, in a register that the structured policy JSON cannot capture. Consumers display it on the verifier's profile page beneath the stats panel.

---

## 6. Write path — who updates what, when

| Trigger | Writer | What gets written |
|---|---|---|
| `ReportRegistry.Settled(reportId)` (uncontested) | `minter/` | first time for IMO: mint vessel subname + full record set; subsequent: update reporters, sightings.count, lastSeen, vessel.swarm.log, contenthash |
| `ReportRegistry.Settled(reportId)` (disputed, report upheld) | `minter/` | as above + append disputer to `vessel.verifiers`, increment `vessel.sightings.disputed` |
| `ReportRegistry.Slashed(reportId)` (disputed, report rejected) | `minter/` | append disputer to `vessel.verifiers` only if vessel subname already exists from prior valid sighting; otherwise nothing on the vessel side |
| `ReportRegistry.OrbitallyCorroborated(reportId)` | `minter/` | write `vessel.orbital.*` records, refresh `vessel.swarm.log` to include orbital_corroboration block, increment `vessel.orbital.confirmations` |
| Any UMA settlement involving a verifier | `minter/` (or `verifier-stats/`) | update that verifier's `verifier.stats.*` records + append entry to verifier log |
| Verifier first registration | manual / one-shot script | mint `<handle>.verifier.phare.eth` with identity + soul + policy records |
| Verifier policy change | verifier operator | update `verifier.policy` text record + bump `verifier.policy.version` |
| Verifier soul update | verifier operator | re-pin markdown to Swarm, update `verifier.soul` text record |

All writes flow through NameStone's CCIP-Read API. No on-chain transactions per record update.

---

## 7. Scope cost

Small. The schema is mostly a structured restatement of data the system already produces.

| Item | Hours | Notes |
|---|---|---|
| Extend minter to write the new vessel records (incl. `vessel.orbital.*`) | 2–3 | builds on the existing minter |
| Extend minter (or new tiny service) to write verifier stats records | 2–3 | needs to listen to UMA settlement events too, not just `ReportRegistry.Settled` |
| Verifier registration script (mints subname + identity + soul + policy) | 1 | runnable per verifier |
| Vessel sighting log JSON builder | 1–2 | gather sightings into the schema |
| Verifier activity log JSON builder | 1–2 | same shape, simpler |
| Author 2–3 demo verifier souls (markdown) | 1 | content, not code |
| Schema docs (these files) | 0 | done |

≈8–12 hours total. Fits inside the existing minter scope — no new service strictly required, though splitting verifier stats into its own watcher is cleaner.

---

## 8. Why this strengthens the ENS prizes

`SPEC.md` §9 targeted both ENS prizes. This expansion is what actually earns them.

**Best ENS Integration for AI Agents** wants substance on agent identity. With the records in §4 a consumer can resolve `alpha.verifier.phare.eth` and learn the principal, the policy, the runtime, the win/loss record, the live bond capacity, the full activity log, and the operator's narrative *soul* — *just from ENS*. No wallet, no RPC, no off-chain auth. That's the integration depth the prize is looking for. The soul, in particular, is rare among on-chain agent registries: most expose only structured stats, not the operator's voice.

**Most Creative Use of ENS** wants ENS used somewhere it normally isn't. Each shadow-fleet vessel — a physical asset that actively tries to be invisible — gets a permanent, public, citizen-attested ENS identity with a Swarm-hosted dossier and an orbital corroboration block. The vessel itself never touches a wallet; ENS is being used as the public registry for a class of objects that has no other public registry.

The two namespaces also reinforce each other: `vessel.verifiers` lists which verifiers ruled on a ship, and each entry is itself a resolvable name with its own reputation and soul. The graph is browsable end-to-end through ENS alone.

---

## 9. Open questions

- **`vessel.reporters` privacy.** The reporter is an anonymous EOA, but listing it permanently next to a sanctioned vessel is still a soft de-anonymisation surface. Option: omit `vessel.reporters` from ENS, keep it only in the Swarm log behind a salted hash. Trade-off: weakens the human-auditable trail. Decision needed before mainnet.
- **List size ceiling.** `vessel.reporters` and `vessel.verifiers` are append-only and unbounded. NameStone text records are practically capped (a few KB). At scale we either truncate to most-recent-N and rely on the Swarm log for full history, or move both fields to log-only. Demo-scale is fine.
- **Verifier self-attestation of stats.** Currently the minter writes `verifier.stats.*`. If the principal of a verifier also holds the NameStone write key for their subname, they could overwrite their own stats. Either restrict NameStone write authority to the project-owned key (centralised), or commit the stats hash on-chain as well (extra scope). Hackathon-acceptable: project-owned key writes everything.
- **Should `vessel.firstReporter` exist?** Adds one more permanent record tying an EOA to a sanctioned vessel. Same privacy concern as `vessel.reporters`; arguably worse because it singles them out. Could drop entirely.
- **Soul authenticity.** The soul markdown is human-authored and anyone can write anything. Some consumers may want signed souls (verifier signs the markdown with their `verifier.address` key). Out of hackathon scope; flag as a v2 feature.
- **`vessel.orbital.tee.mocked` exposure.** Should the ENS records say explicitly that the TEE inference was mocked, or should that flag live only inside the JSON? Decision: keep it inside the JSON (`tee_inference.mocked`) so the ENS records stay clean; consumers who want strict provenance can read the JSON.
