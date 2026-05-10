# HEARTBEAT — phare-verifier

Heartbeat tick driver for the phare-verifier skill. Read SKILL.md in this
folder for full context. Per OpenClaw heartbeat semantics: reply
`HEARTBEAT_OK` when nothing happens, alert text when there is something
worth surfacing.

## Pre-flight

Run `node /Users/nick/Documents/Phare-protocol/agent/tools/status.mjs`. If `phase != "running"` reply
`HEARTBEAT_OK` and stop — onboarding is interactive (user-driven), not
heartbeat-driven.

## Running tick

If `phase == "running"`:

1. Run `node /Users/nick/Documents/Phare-protocol/agent/tools/poll-uma.mjs`. If `candidates` is empty, reply
   `HEARTBEAT_OK`.

2. For each candidate (chronological — oldest `submittedAt` first):
   - Skip if `secondsLeft < 15` (not enough margin to land a dispute tx).
   - Run `node /Users/nick/Documents/Phare-protocol/agent/tools/fetch-metadata.mjs <metadataSwarm>`.
     If `ok:false` (BMT mismatch or gateway error), skip this candidate.
   - Run `node /Users/nick/Documents/Phare-protocol/agent/tools/evaluate.mjs <reportId> <imo>`.
   - If `decision == "fake"`:
     - Run `node /Users/nick/Documents/Phare-protocol/agent/tools/dispute.mjs <reportId> "<reasoning from evaluate>"`.
     - Run `node /Users/nick/Documents/Phare-protocol/agent/tools/pin-reasoning.mjs <reportId>` — captures the real `bzz://<root>`.
     - Run `node /Users/nick/Documents/Phare-protocol/agent/tools/set-last-decision.mjs <reportId> <ref from pin-reasoning>`.
     - Collect `(reportId, ens)` for the alert.

3. After processing every candidate (whether or not a dispute landed),
   run `node /Users/nick/Documents/Phare-protocol/agent/tools/publish-stats.mjs`.
   This pushes the live counters and identity refs into the verifier's
   own Swarm-KV namespace (`phare:verifier:<handle>`). It is owner-signed
   and gateway-verifiable — no NameStone round-trip per tick.

4. If at least one dispute landed, reply with a one-line alert:
   `disputed <N> report(s); ENS: <handle>.verifier.phare.eth · KV: phare:verifier:<handle>`.
   Otherwise reply `HEARTBEAT_OK`.

## Hard rules

- Never invent reportIds, IMOs, or hashes — only emit values returned by
  the tools.
- Stop on the first failed tool call; do not retry inside the tick.
- Do NOT touch `state/wallet.json` or `state/state.json` directly. Only
  the tools mutate state.
