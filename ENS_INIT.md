# ENS Initialization — Phare on Sepolia

> Step-by-step to bootstrap the Lighthouse ENS layer per `LIGHTHOUSE_SPEC.md §4`. All commands are copy-pasteable. Single deployer key throughout.

---

## 0. Prerequisites

- Deployer EOA funded with ~0.2 Sepolia ETH from <https://sepoliafaucet.com>.
- `cast` (Foundry) installed and on PATH.
- A working Sepolia RPC URL (Alchemy, Infura, or public).

Export environment variables in your shell. Keep this block in your `.env` and `source` it before running any of the steps below:

```bash
export SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/<KEY>"
export DEPLOYER_PRIVATE_KEY="0x..."
export DEPLOYER="0x..."   # the address of DEPLOYER_PRIVATE_KEY
export ETHERSCAN_API_KEY="..."
```

Pinned Sepolia ENS contract addresses:

```bash
export ENS_REGISTRY="0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e"
export NAME_WRAPPER="0x0635513f179D50A207757E05759CbD106d7dFcE8"
export PUBLIC_RESOLVER="0x8FADE66B79cC9f707aB26799354482EB93a5B7dD"
```

---

## Step 1 — Register `phare.eth` (browser)

The ENS Manager App handles commit/reveal + payment. No CLI here.

1. Open <https://sepolia.app.ens.domains>.
2. Connect deployer wallet, network = **Sepolia**.
3. Search `phare`. If unavailable, fallback `phare-demo`.
4. Register for 1 year (~0.005 Sepolia ETH).
5. Confirm in the success screen that the name is held as **ERC-1155 (NameWrapper)**. The Manager App wraps by default.

After this, deployer owns `phare.eth` as a NameWrapper token. Done with the browser.

---

## Step 2 — Compute namehashes

Cache the namehashes you'll reuse:

```bash
export NAMEHASH_PHARE=$(cast namehash phare.eth)
export NAMEHASH_VESSEL=$(cast namehash vessel.phare.eth)
export NAMEHASH_VERIFIER=$(cast namehash verifier.phare.eth)

echo "phare.eth         = $NAMEHASH_PHARE"
echo "vessel.phare.eth  = $NAMEHASH_VESSEL"
echo "verifier.phare.eth = $NAMEHASH_VERIFIER"
```

---

## Step 3 — Mint the two intermediate parents

`vessel.phare.eth` and `verifier.phare.eth`, both owned by deployer, no fuses yet.

```bash
cast send $NAME_WRAPPER \
  "setSubnodeOwner(bytes32,string,address,uint32,uint64)" \
  $NAMEHASH_PHARE "vessel" $DEPLOYER 0 18446744073709551615 \
  --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

```bash
cast send $NAME_WRAPPER \
  "setSubnodeOwner(bytes32,string,address,uint32,uint64)" \
  $NAMEHASH_PHARE "verifier" $DEPLOYER 0 18446744073709551615 \
  --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

The `18446744073709551615` is `type(uint64).max` — no expiry.

---

## Step 4 — Burn fuses (correct sequence)

NameWrapper enforces an order:

- To burn `CANNOT_UNWRAP` on a name, its **parent** must already have `CANNOT_UNWRAP` burnt.
- `setFuses` (caller = name's own owner) only works once `PARENT_CANNOT_CONTROL` is already burnt on that name.

So the working sequence is:

1. Burn `CANNOT_UNWRAP` on `phare.eth` itself (its parent `.eth` is the special root, no prerequisite).
2. From the `phare.eth` owner, call `setChildFuses` on each child to burn `PARENT_CANNOT_CONTROL | CANNOT_UNWRAP` in one go (= fuse value `65537`).

**All irreversible.** Verify each tx succeeds before continuing.

### 4.1 Inspect current fuses on `phare.eth`

```bash
cast call $NAME_WRAPPER \
  "getData(uint256)(address,uint32,uint64)" \
  $(cast --to-uint256 $NAMEHASH_PHARE) \
  --rpc-url $SEPOLIA_RPC_URL
```

Middle field is fuses. Bit 0 = `CANNOT_UNWRAP` (value 1). If it's already set, skip 4.2.

### 4.2 Burn `CANNOT_UNWRAP` on `phare.eth`

```bash
cast send $NAME_WRAPPER \
  "setFuses(bytes32,uint16)" \
  $NAMEHASH_PHARE 1 \
  --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

### 4.3 Burn `PCC | CANNOT_UNWRAP` on the two children

`65537` = `0x10001` = `PARENT_CANNOT_CONTROL (0x10000) | CANNOT_UNWRAP (0x1)`.

```bash
cast send $NAME_WRAPPER \
  "setChildFuses(bytes32,bytes32,uint32,uint64)" \
  $NAMEHASH_PHARE $(cast keccak "vessel") 65537 18446744073709551615 \
  --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

```bash
cast send $NAME_WRAPPER \
  "setChildFuses(bytes32,bytes32,uint32,uint64)" \
  $NAMEHASH_PHARE $(cast keccak "verifier") 65537 18446744073709551615 \
  --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

### 4.4 Verify

```bash
cast call $NAME_WRAPPER \
  "getData(uint256)(address,uint32,uint64)" \
  $(cast --to-uint256 $NAMEHASH_VESSEL) \
  --rpc-url $SEPOLIA_RPC_URL

cast call $NAME_WRAPPER \
  "getData(uint256)(address,uint32,uint64)" \
  $(cast --to-uint256 $NAMEHASH_VERIFIER) \
  --rpc-url $SEPOLIA_RPC_URL
```

Middle field on both should be ≥ `65537`.

---

## Step 5 — Deploy `ReportRegistry.sol`

Lighthouse's `reportRegistry` field is immutable, so `ReportRegistry` must exist first. From `contracts/`:

```bash
forge create src/ReportRegistry.sol:ReportRegistry \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $ORBITAL_ATTESTOR \
  --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

Save the address:

```bash
export REPORT_REGISTRY="0x..."
```

---

## Step 6 — Deploy `Lighthouse.sol`

```bash
forge create src/Lighthouse.sol:Lighthouse \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args \
    $NAME_WRAPPER \
    $PUBLIC_RESOLVER \
    $NAMEHASH_VESSEL \
    $NAMEHASH_VERIFIER \
    $REPORT_REGISTRY \
  --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

Save the address:

```bash
export LIGHTHOUSE="0x..."
```

---

## Step 7 — Approve `Lighthouse` as NameWrapper operator

`setApprovalForAll` is a single grant — covers every wrapped name held by the deployer, so **one tx, not two**.

```bash
cast send $NAME_WRAPPER \
  "setApprovalForAll(address,bool)" \
  $LIGHTHOUSE true \
  --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY
```

---

## Step 8 — Verification

Confirm everything before running the demo.

### 8.1 Operator approval

```bash
cast call $NAME_WRAPPER \
  "isApprovedForAll(address,address)(bool)" \
  $DEPLOYER $LIGHTHOUSE \
  --rpc-url $SEPOLIA_RPC_URL
```

Expected: `true`.

### 8.2 Parent ownership

```bash
cast call $NAME_WRAPPER \
  "ownerOf(uint256)(address)" \
  $(cast --to-uint256 $NAMEHASH_VESSEL) \
  --rpc-url $SEPOLIA_RPC_URL

cast call $NAME_WRAPPER \
  "ownerOf(uint256)(address)" \
  $(cast --to-uint256 $NAMEHASH_VERIFIER) \
  --rpc-url $SEPOLIA_RPC_URL
```

Both expected: `$DEPLOYER`.

### 8.3 Fuses on parents

```bash
cast call $NAME_WRAPPER \
  "getData(uint256)(address,uint32,uint64)" \
  $(cast --to-uint256 $NAMEHASH_VESSEL) \
  --rpc-url $SEPOLIA_RPC_URL

cast call $NAME_WRAPPER \
  "getData(uint256)(address,uint32,uint64)" \
  $(cast --to-uint256 $NAMEHASH_VERIFIER) \
  --rpc-url $SEPOLIA_RPC_URL
```

Expected: middle field (fuses) ≥ `65537` (`PARENT_CANNOT_CONTROL | CANNOT_UNWRAP` both burnt).

---

## Step 9 — Smoke test

Mint one vessel and one verifier subname end-to-end.

### 9.1 Vessel

`nameVessel` is `onlyRegistry`. Either call it from the `ReportRegistry` key, or temporarily expose a debug method during testing.

```bash
cast send $LIGHTHOUSE \
  "nameVessel(uint256,string)" \
  9133701 \
  "bzz://0000000000000000000000000000000000000000000000000000000000000000" \
  --rpc-url $SEPOLIA_RPC_URL --private-key $REPORT_REGISTRY_KEY
```

### 9.2 Verifier (permissionless — any wallet)

```bash
cast send $LIGHTHOUSE \
  "enrollVerifier(string,string,string)" \
  "agent-test01" \
  "bzz://policy" \
  "bzz://soul" \
  --rpc-url $SEPOLIA_RPC_URL --private-key $VERIFIER_TEST_KEY
```

### 9.3 Resolve in browser

Open in <https://sepolia.app.ens.domains>:

- `imo-9133701.vessel.phare.eth` — should show `vessel.imo` and `vessel.swarm.log` text records.
- `agent-test01.verifier.phare.eth` — should show `verifier.policy`, `verifier.soul`, `verifier.runtime` text records.

---

## Recommended order (zero rework)

1. Write + unit-test `ReportRegistry.sol` and `Lighthouse.sol` on local Anvil.
2. Step 1 — register `phare.eth` (browser).
3. Steps 2–4 — namehashes, mint parents, burn `CANNOT_UNWRAP`.
4. Step 5 — deploy `ReportRegistry`.
5. Step 6 — deploy `Lighthouse` with the live `ReportRegistry` address.
6. Step 7 — `setApprovalForAll`.
7. Step 8 — verify.
8. Step 9 — smoke test.

After this, the deployer key never signs ENS-related transactions during the demo. Lighthouse handles everything.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `setSubnodeOwner` reverts with `Unauthorised` | Parent not wrapped | Verify Step 1 minted into NameWrapper, not the legacy Registry |
| `setFuses` on a child reverts with `OperationProhibited` | `PARENT_CANNOT_CONTROL` not yet burnt on the child, or `CANNOT_UNWRAP` not burnt on the parent | Use `setChildFuses` from the parent owner instead — see §4.3 |
| `setChildFuses` reverts with `OperationProhibited` | `CANNOT_UNWRAP` not burnt on the parent yet | Run §4.2 first |
| `Lighthouse.nameVessel` reverts with `not registry` | Wrong msg.sender | Call from the address passed as `reportRegistry` in the constructor |
| `Lighthouse.enrollVerifier` reverts | Handle already taken or `Lighthouse` not approved | Pick fresh handle / re-run Step 7 |
| Etherscan verification fails | Compiler version mismatch | Match `solc_version` in `foundry.toml` to what Etherscan expects |
