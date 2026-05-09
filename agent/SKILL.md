---
name: phare-verifier
description: Run a Phare verifier-agent on Sepolia — generate the agent's wallet, fund-check, mint <handle>.verifier.phare.eth via Lighthouse, poll UMA OOv3 for pending bonded sighting reports, evaluate against the local ASI fixture, dispute fakes with a counter-bond, and write verifier.lastDecision. Use when user says "set up the phare verifier", "onboard the verifier", "start the verifier agent", "run the verifier", "enroll the verifier", "phare agent", "run a tick", "check for new reports", "dispute this report", or otherwise asks to operate the Phare disputer/sentinel agent. Tools live at /Users/nick/Documents/Phare-protocol/agent/tools/ and operate state under that folder — DO NOT scaffold a new project; the codebase already exists at /Users/nick/Documents/Phare-protocol.
version: 0.1.0
metadata:
  openclaw:
    requires:
      env:
        - SEPOLIA_RPC_URL
      bins:
        - node
    primaryEnv: SEPOLIA_RPC_URL
    envVars:
      - name: SEPOLIA_RPC_URL
        required: true
        description: Sepolia JSON-RPC endpoint.
      - name: REPORT_REGISTRY
        required: true
        description: Phare ReportRegistry address (patched by Deploy.s.sol).
      - name: LIGHTHOUSE
        required: true
        description: Phare Lighthouse address (patched by Deploy.s.sol).
      - name: SLASH_POOL
        required: false
        description: Phare SlashPool address (patched by Deploy.s.sol).
    emoji: "🛟"
    homepage: https://github.com/phare-protocol/phare
---

# phare-verifier

Local OpenClaw skill. Runs a single verifier agent for the Phare protocol:
photographs are bonded on-chain through `ReportRegistry` + UMA OOv3; this
agent watches the stream, judges credibility against a fixture-keyed mock
ASI, and disputes fakes with a counter-bond.

The agent has its own EOA, its own ENS subname under `verifier.phare.eth`,
and its own activity log. State lives entirely under `state/` in this
folder — no daemons, no databases.

## State machine

The agent advances through four phases. Phase is recorded in
`state/state.json`; tools read it and gate themselves accordingly.

| Phase | Entry | Behaviour |
|---|---|---|
| `init` | first run | generate wallet → `needs-funding` |
| `needs-funding` | wallet exists but ETH/WETH below thresholds | print faucets, poll balance |
| `needs-ens` | gas + WETH thresholds met | enroll `<handle>.verifier.phare.eth` → `running` |
| `running` | subname minted | per-tick: poll UMA, evaluate, dispute, write `verifier.lastDecision` |

Heartbeat ticks should only fire real work in `running`. `HEARTBEAT.md`
short-circuits when the phase is anything else.

## Tools (CLI)

All tools live under `tools/` and emit a single canonical JSON object on
stdout. Errors set `ok:false` and exit 1.

**How to invoke (important):** the tools import the workspace package `skill`
which resolves through the repo's `node_modules`. Always run from the repo
path — not from the OpenClaw skill copy. Use:

```bash
node /Users/nick/Documents/Phare-protocol/agent/tools/<name>.mjs [args]
```

The shorthand `node tools/<name>.mjs` only works when CWD is
`/Users/nick/Documents/Phare-protocol/agent`.

| Tool | Phase | Purpose |
|---|---|---|
| `gen-wallet.mjs` | init | Generate keypair, persist to `state/wallet.json`, advance to `needs-funding`. Idempotent. |
| `check-balance.mjs` | needs-funding | Read ETH + WETH for the wallet. Advances to `needs-ens` once thresholds met. |
| `enroll.mjs` | needs-ens | Mint `<handle>.verifier.phare.eth` via Lighthouse.enrollVerifier. PCC burnt, advances to `running`. |
| `poll-uma.mjs` | running | Scan `ReportRegistry.Submitted` from `lastSeenBlock` → head; return pending unprocessed reports inside their liveness window. |
| `evaluate.mjs <reportId> <imo>` | running | Local lookup against `data/asi-fixtures.json` + `data/shadow-vessels.json`. Returns `decision: ok\|fake`. |
| `dispute.mjs <reportId> "<reasoning>"` | running | Post counter-bond on UMA OOv3, persist reasoning to `state/decisions/<id>.json`, increment stats. |
| `set-last-decision.mjs <reportId> [bzzRef]` | running | Direct PublicResolver.setText for `verifier.lastDecision` on the agent's own subname. |
| `status.mjs` | any | Read-only state dump. |
| `fetch-metadata.mjs <bzz://ref>` | running | **Verified Fetch** — pulls bytes from `${SWARM_BEE_URL}/bytes/<hash>`, recomputes the BMT root via `MerkleTree.root`, throws on mismatch. Returns parsed JSON only on `verified:true`. |
| `pin-reasoning.mjs <reportId>` | running | Pins `state/decisions/<reportId>.json` via `bee.uploadData` with NULL_STAMP, prints `bzz://<root>`, stamps the bzz back into the local file for idempotency. |

The set is intentionally small. Each tool wraps an existing helper from
`/skill` (the JS lib your teammate wrote) — no business logic is
re-implemented here.

## Onboarding (init → running) — chat-driven, YOU drive it

Onboarding is conversational. The user talks to OpenClaw; YOU (the
assistant with this skill loaded) call the tools yourself based on what
they say. Heartbeat ticks are suppressed outside `running` (see
DESIGN_DOCUMENT §4.4) — do not wait for a tick, advance on user input.

Triggers and responses:

1. **User asks to set up / start / install the verifier** (or anything
   meaning "begin onboarding") → run `gen-wallet`. Reply with:
   - the generated address (so they can paste it into a faucet),
   - the two faucet URLs from the tool output,
   - a one-line ask: send Sepolia ETH and wrap ~0.01 to WETH, then say
     "funded".

2. **User confirms funding** ("funded", "done", "topped up", "I sent it",
   etc.) → run `check-balance`.
   - If `ready:true`, immediately run `enroll`. Reply with the ENS name,
     tx hash, and resolve link.
   - If `ready:false`, reply with current balances + thresholds + the
     faucets again. Do NOT run `enroll`.

3. **User asks status** at any point → run `status`. Reply with phase +
   handle + ENS resolve link if enrolled.

Hard rule: never run `enroll` before `check-balance` reports
`ready:true` — the tx reverts on insufficient gas and burns the user's
trust in the flow.

## Running tick (heartbeat) — what to do

Each heartbeat in phase `running`:

1. `poll-uma` — get candidate reports inside the liveness window.
2. For each candidate, in chronological order:
   - `fetch-metadata <metadataSwarm>` — Verified Fetch round-trip. If it
     fails (BMT mismatch / gateway error), skip this report and move on;
     do NOT dispute on unverified data.
   - `evaluate <reportId> <imo>` — get `decision`.
   - If `decision == "fake"` and `secondsLeft > 15`:
     - `dispute <reportId> "<short reasoning from evaluate output>"`
     - `pin-reasoning <reportId>` — pins the reasoning JSON to Swarm,
       returns the real `bzz://<root>`.
     - `set-last-decision <reportId> <ref from pin-reasoning>`
   - Else: skip locally. `poll-uma` already filters out reports whose
     liveness window has expired.
3. Reply `HEARTBEAT_OK` if no disputes were posted, or a short alert
   with the disputed reportIds + the new ENS resolve link otherwise.

Do not invent IMOs, addresses, or reportIds. Only act on values returned
by the tools above. Keep replies under 300 chars unless you are reporting
an alert.

## What lives where

```
agent/
  SKILL.md              ← this file (frontmatter + per-phase instructions)
  HEARTBEAT.md          ← thin tick driver; delegates here
  .env                  ← addresses (patched by Deploy.s.sol)
  data/
    asi-fixtures.json   ← ASI mock verdicts keyed by IMO
    shadow-vessels.json ← informational OpenSanctions mirror
  tools/                ← CLI scripts (above table)
  state/
    wallet.json         ← gitignored; mode 0600; PK lives here
    state.json          ← phase, handle, node, lastSeenBlock, seenReports, stats
    decisions/<id>.json ← reasoning JSON per dispute (swap to Swarm later)
```

## Constraints (don't violate)

- **Never** hardcode an address. Always read from env via the helpers in
  `tools/_common.mjs`. Deploy.s.sol patches `.env` after each deploy.
- **Never** modify `state/wallet.json` outside `gen-wallet.mjs`.
- **Never** call `Lighthouse.nameVessel` / `recordSighting` from the
  agent — those are `onlyRegistry`. Only the report submission flow can
  mint vessel names.
- **Never** dispute on a report whose `fetch-metadata` step failed (BMT
  mismatch or gateway error). Skip and let `poll-uma` re-surface it next
  tick if it's still in the window.
