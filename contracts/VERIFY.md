# Verify deployed contracts on Etherscan (Sepolia)

Etherscan retired the V1 API on May 2025. If `forge verify-contract` errors with
`You are using a deprecated V1 endpoint`, append:

```
--verifier-url "https://api.etherscan.io/v2/api?chainid=11155111"
```

## Fastest path — `--resume`

Re-runs verification only (the on-chain txs already landed):

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url $SEPOLIA_RPC_URL --ffi \
  --verify --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=11155111" \
  --resume
```

If that succeeds you're done. Otherwise run the three commands below
individually.

---

## Manual: SlashPool

```bash
forge verify-contract \
  --chain sepolia \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=11155111" \
  --constructor-args $(cast abi-encode "constructor(address)" 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9) \
  0xDE7F33d67F077c066697d67A23624275507899DB \
  src/SlashPool.sol:SlashPool
```

## Manual: ReportRegistry

```bash
forge verify-contract \
  --chain sepolia \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=11155111" \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address,uint96,uint64,string)" 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9 0x9923D42eF695B5dd9911D05Ac944d4cAca3c4EAB 0xDE7F33d67F077c066697d67A23624275507899DB 0x529cA5277c8b2F0F72B4E5993533123B0a678e30 0x529cA5277c8b2F0F72B4E5993533123B0a678e30 5000000000000000 60 "https://api.gateway.ethswarm.org/access/") \
  0x0725fbADee40bEad3626eEf48f187Ce599362919 \
  src/ReportRegistry.sol:ReportRegistry
```

## Manual: Lighthouse

```bash
forge verify-contract \
  --chain sepolia \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --verifier-url "https://api.etherscan.io/v2/api?chainid=11155111" \
  --constructor-args $(cast abi-encode "constructor(address,address,bytes32,bytes32,address)" 0x0635513f179D50A207757E05759CbD106d7dFcE8 0x8FADE66B79cC9f707aB26799354482EB93a5B7dD 0x10291dd0a534f52daec01ee88a5294198f34972aa44b9fec5a9ea4cb54dcc777 0x1d0a693788914f44825e605b794abcba12ecf39372b1c4835b16d6a99fd58447 0x0725fbADee40bEad3626eEf48f187Ce599362919) \
  0xdc2e5B1E8650A803654A1a08F2B11e45459c2C86 \
  src/Lighthouse.sol:Lighthouse
```

---

## Tools that let you click-to-run from a markdown file

If copy-paste is a pain, install one of these — they let you run code blocks
straight from this file without leaving your editor:

| Tool | Best for | How |
|---|---|---|
| **[Runme](https://runme.dev)** | VSCode users | Install the VSCode extension. Open this `.md`, hit ▶ on any block. |
| **[just](https://just.systems)** | CLI | Convert blocks into a `justfile`, then `just verify-lighthouse` etc. Simpler than Make. |
| **VSCode** built-in | Quick win | Open the `.md`, copy the inside of any code fence with one click on the copy icon (top-right of the block). |

Ghostty / Alacritty / WezTerm / Kitty are just terminal emulators — they don't
parse markdown. You need an editor extension or a task runner.
