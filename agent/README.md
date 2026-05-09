# agent — phare-verifier (local OpenClaw skill)

Single OpenClaw skill that runs a Phare verifier-agent end-to-end on
Sepolia. Wallet generation → Sepolia funding → ENS subname mint → UMA
polling → dispute → ENS-records update. State on disk, no daemons.

> Skill body, tool list, and tick semantics are in `SKILL.md` and
> `HEARTBEAT.md` in this folder. This README is for getting it wired up.

## Install

From the repo root (workspaces):

```bash
pnpm install
```

`agent/` depends on the workspace package `skill/` (the viem helpers
your teammate wrote) — pnpm wires the symlink automatically.

## Wire to OpenClaw

OpenClaw discovers personal skills under `~/.agents/skills/<slug>/` and
rejects symlinks that escape that root, so we mirror the skill via rsync
instead of symlinking. Source-of-truth stays in this repo; the install
under `~/.agents/` is a copy that gets re-synced on each edit.

First-time install:

```bash
pnpm --filter agent run install:skill        # rsync ./agent → ~/.agents/skills/phare-verifier
openclaw skills info phare-verifier          # should print ✓ Ready
```

After every edit to SKILL.md / HEARTBEAT.md / tools/, re-run:

```bash
pnpm --filter agent run install:skill
```

The tools themselves still execute against the repo path
(`/Users/nick/Documents/Phare-protocol/agent`) so the workspace
`node_modules` resolves and `state/` lives in-repo. SKILL.md and
HEARTBEAT.md tell Claude to invoke them via the absolute repo path.

Heartbeat (optional, only needed once you want autonomous ticks):

```bash
mv ~/.openclaw/workspace/HEARTBEAT.md ~/.openclaw/workspace/HEARTBEAT.md.bak 2>/dev/null
ln -s /Users/nick/Documents/Phare-protocol/agent/HEARTBEAT.md ~/.openclaw/workspace/HEARTBEAT.md
```

Tighten interval for the demo:

```jsonc
// ~/.openclaw/openclaw.json (agent block)
heartbeat: {
  every: "1m",
  prompt: "Read HEARTBEAT.md if it exists. Follow it strictly.",
}
```

## Onboarding — conversational, via OpenClaw

Onboarding is **chat-driven**, not CLI-driven. The user talks to OpenClaw;
Claude (with `phare-verifier` loaded) calls the tools itself based on the
conversation. Per DESIGN_DOCUMENT §4.4: heartbeat ticks are suppressed in
every phase except `running` — onboarding only advances on user chat input.

Typical flow:

```
user  > set up the phare verifier
agent > [runs gen-wallet] address 0xc1e2…516c — send Sepolia ETH here, then wrap ~0.01 to WETH:
        eth:  https://sepoliafaucet.com
        weth: https://app.uniswap.org/swap?chain=sepolia
user  > funded
agent > [runs check-balance] ready. enrolling…
agent > [runs enroll] minted agent-74516c.verifier.phare.eth — tx 0x…
        resolve: https://sepolia.app.ens.domains/agent-74516c.verifier.phare.eth
```

After enrollment, OpenClaw heartbeats fire `HEARTBEAT.md` periodically and
the agent disputes fakes autonomously. No further user action needed
unless balances dip.

## Dev smoke test (CLI, no OpenClaw)

For verifying tool plumbing during development. Not the user-facing flow.

```bash
cd agent
node tools/gen-wallet.mjs            # prints address + faucet links
# manually fund: Sepolia ETH + small WETH wrap
node tools/check-balance.mjs         # ready:true once thresholds met
node tools/enroll.mjs                # mints <handle>.verifier.phare.eth
node tools/status.mjs                # phase: running

node tools/poll-uma.mjs              # candidate reports
node tools/evaluate.mjs 0x… 9999999  # decision: "fake"
node tools/dispute.mjs 0x… "IMO 9999999 unallocated"
node tools/set-last-decision.mjs 0x…
```

After each step, `state/state.json` reflects the new phase / counters.

## Files

```
SKILL.md            ← OpenClaw skill manifest + per-phase instructions
HEARTBEAT.md        ← per-tick driver
.env / .env.example ← addresses (Deploy.s.sol patches in place)
data/               ← ASI fixture verdicts + shadow-vessel mirror
tools/              ← CLI tools (one per step)
state/              ← gitignored; wallet.json + state.json + decisions/
```

## Open items

- **swarm tool** — `tools/fetch-metadata.mjs` is a gateway-only stub.
  Real BMT verification (DESIGN_DOCUMENT §10.1) lands when the dedicated
  swarm tool is built. Until then, treat metadata fetched via the
  gateway as untrusted; the dispute decision is driven by the IMO-keyed
  fixture in `data/asi-fixtures.json`, not by the photo's content.

- **policy / soul URIs** — `enroll.mjs` posts placeholder bzz refs. After
  the swarm tool ships, write a real policy.md + soul.md, pin them, and
  rotate via `setVerifierPolicy` / `setVerifierSoul` (already exposed
  from `/skill`).
