// On-chain reader for the Phare ENS layer.
//
// Two scanners:
//   fetchVessels()   — every imo-<n>.vessel.phare.eth ever minted; reads
//                      the on-chain text records + sighting/disputed counts.
//   fetchVerifiers() — every <handle>.verifier.phare.eth enrolled; reads
//                      the policy/soul/runtime/lastDecision text records.
//
// Both scan VesselNamed / VerifierEnrolled events from
// NEXT_PUBLIC_DEPLOY_BLOCK (or head-49000 fallback) to head, dedupe, and
// hydrate via parallel readContract calls.
//
// All reads go through a single PublicClient against
// NEXT_PUBLIC_SEPOLIA_RPC_URL — a CORS-allowing RPC like
// https://ethereum-sepolia-rpc.publicnode.com.

import {
    createPublicClient,
    http,
    keccak256,
    namehash,
    encodePacked,
    toBytes,
    parseAbi,
    type Address,
    type Hex,
} from 'viem';
import { sepolia } from 'viem/chains';

// ─── Config ─────────────────────────────────────────────────────────────

const RPC_URL  = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';

const LIGHTHOUSE      = (process.env.NEXT_PUBLIC_LIGHTHOUSE      ?? '') as Address;
const REGISTRY        = (process.env.NEXT_PUBLIC_REPORT_REGISTRY ?? '') as Address;
const RESOLVER        = (process.env.NEXT_PUBLIC_ENS_PUBLIC_RESOLVER
                          ?? process.env.ENS_PUBLIC_RESOLVER
                          ?? '0x8FADE66B79cC9f707aB26799354482EB93a5B7dD') as Address;
const NAME_WRAPPER    = (process.env.NEXT_PUBLIC_ENS_NAMEWRAPPER
                          ?? process.env.ENS_NAMEWRAPPER
                          ?? '0x0635513f179D50A207757E05759CbD106d7dFcE8') as Address;

const VESSEL_PARENT   = process.env.NEXT_PUBLIC_VESSEL_PARENT_NODE   ?? 'vessel.phare.eth';
const VERIFIER_PARENT = process.env.NEXT_PUBLIC_VERIFIER_PARENT_NODE ?? 'verifier.phare.eth';

const DEPLOY_BLOCK    = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? '0');
// Sepolia public RPCs cap getLogs ranges. 49_000 fits inside the typical
// 50_000-block ceiling on publicnode.
const MAX_SCAN_RANGE  = 49_000n;

// ─── ABIs (minimal — only what these scans need) ────────────────────────

const lighthouseAbi = parseAbi([
    'event VesselNamed(uint256 indexed imo, bytes32 indexed node, string ens)',
    'event VerifierEnrolled(address indexed principal, string handle, bytes32 indexed node)',
]);

const registryAbi = parseAbi([
    'function sightingsByImo(uint256) view returns (uint32)',
    'function disputedByImo(uint256) view returns (uint32)',
    'function vesselNamed(uint256) view returns (bool)',
]);

const resolverAbi = parseAbi([
    'function text(bytes32 node, string key) view returns (string)',
]);

// ─── Public client ──────────────────────────────────────────────────────

export const publicClient = createPublicClient({
    chain:     sepolia,
    transport: http(RPC_URL),
});

// ─── Node helpers (mirror skill/src/lighthouse.js) ──────────────────────

function subnodeOf(label: string, parentName: string): Hex {
    const parentNode = namehash(parentName);
    const labelHash  = keccak256(toBytes(label));
    return keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, labelHash]));
}

export const vesselNode   = (imo: bigint | number) => subnodeOf(`imo-${imo}`,   VESSEL_PARENT);
export const verifierNode = (handle: string)       => subnodeOf(handle,         VERIFIER_PARENT);

// ─── Scan range ─────────────────────────────────────────────────────────

async function scanRange() {
    const head = await publicClient.getBlockNumber();
    let from = DEPLOY_BLOCK;
    if (from === 0n || head - from > MAX_SCAN_RANGE) {
        from = head > MAX_SCAN_RANGE ? head - MAX_SCAN_RANGE : 0n;
    }
    return { from, to: head };
}

// ─── Vessels ────────────────────────────────────────────────────────────

export type VesselRow = {
    imo:                number;
    node:               Hex;
    ens:                string;          // imo-<n>.vessel.phare.eth
    swarmLog:           string;          // bzz://… dossier ref
    sightings:          number;
    disputed:           number;
    country:            string;          // origin / flag-of-convenience hint
    cargo:              string;          // free-form cargo description
    lastSeen:           string;          // "lat,lon" snapshot
    orbitalImage:       string;          // bzz://… or '' if none
    orbitalImageHash:   string;
    orbitalTeePred:     string;
    firstSeenBlock:     bigint;
};

export async function fetchVessels(): Promise<VesselRow[]> {
    if (!LIGHTHOUSE)  throw new Error('NEXT_PUBLIC_LIGHTHOUSE not set');
    if (!REGISTRY)    throw new Error('NEXT_PUBLIC_REPORT_REGISTRY not set');

    const { from, to } = await scanRange();

    const logs = await publicClient.getLogs({
        address:   LIGHTHOUSE,
        event:     lighthouseAbi.find((e) => e.type === 'event' && e.name === 'VesselNamed')!,
        fromBlock: from,
        toBlock:   to,
    });

    // Dedupe by imo, keep earliest block.
    const byImo = new Map<bigint, { imo: bigint; node: Hex; ens: string; firstSeenBlock: bigint }>();
    for (const log of logs) {
        const args = log.args as { imo: bigint; node: Hex; ens: string };
        const cur  = byImo.get(args.imo);
        if (!cur || log.blockNumber < cur.firstSeenBlock) {
            byImo.set(args.imo, {
                imo:            args.imo,
                node:           args.node,
                ens:            args.ens,
                firstSeenBlock: log.blockNumber,
            });
        }
    }

    const vessels = await Promise.all(
        Array.from(byImo.values()).map(async (v) => {
            const node = v.node;
            const [
                swarmLog,
                sightings,
                disputed,
                country,
                cargo,
                lastSeen,
                orbitalImage,
                orbitalImageHash,
                orbitalTeePred,
            ] = await Promise.all([
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'vessel.swarm.log'] }),
                publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'sightingsByImo', args: [v.imo] }),
                publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'disputedByImo',  args: [v.imo] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'vessel.country'] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'vessel.cargo'] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'vessel.lastSeen'] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'vessel.orbital.image'] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'vessel.orbital.imageHash'] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [node, 'vessel.orbital.tee.prediction'] }),
            ]);

            return {
                imo:               Number(v.imo),
                node,
                ens:               v.ens,
                swarmLog:          String(swarmLog),
                sightings:         Number(sightings),
                disputed:          Number(disputed),
                country:           String(country),
                cargo:             String(cargo),
                lastSeen:          String(lastSeen),
                orbitalImage:      String(orbitalImage),
                orbitalImageHash:  String(orbitalImageHash),
                orbitalTeePred:    String(orbitalTeePred),
                firstSeenBlock:    v.firstSeenBlock,
            } satisfies VesselRow;
        }),
    );

    // Newest mint at the top.
    return vessels.sort((a, b) => Number(b.firstSeenBlock - a.firstSeenBlock));
}

// ─── Verifiers ──────────────────────────────────────────────────────────

export type VerifierRow = {
    handle:       string;
    principal:    Address;
    node:         Hex;
    ens:          string;          // <handle>.verifier.phare.eth
    runtime:      string;
    policy:       string;          // bzz://…
    soul:         string;          // bzz://…
    lastDecision: string;          // bzz://… or ''
    firstSeenBlock: bigint;
};

export async function fetchVerifiers(): Promise<VerifierRow[]> {
    if (!LIGHTHOUSE) throw new Error('NEXT_PUBLIC_LIGHTHOUSE not set');

    const { from, to } = await scanRange();

    const logs = await publicClient.getLogs({
        address:   LIGHTHOUSE,
        event:     lighthouseAbi.find((e) => e.type === 'event' && e.name === 'VerifierEnrolled')!,
        fromBlock: from,
        toBlock:   to,
    });

    // Dedupe by node (handle could in theory repeat across redeployments).
    const byNode = new Map<Hex, { handle: string; principal: Address; node: Hex; firstSeenBlock: bigint }>();
    for (const log of logs) {
        const args = log.args as { principal: Address; handle: string; node: Hex };
        const cur  = byNode.get(args.node);
        if (!cur || log.blockNumber < cur.firstSeenBlock) {
            byNode.set(args.node, {
                handle:         args.handle,
                principal:      args.principal,
                node:           args.node,
                firstSeenBlock: log.blockNumber,
            });
        }
    }

    const verifiers = await Promise.all(
        Array.from(byNode.values()).map(async (v) => {
            const [policy, soul, runtime, lastDecision] = await Promise.all([
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [v.node, 'verifier.policy'] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [v.node, 'verifier.soul'] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [v.node, 'verifier.runtime'] }),
                publicClient.readContract({ address: RESOLVER, abi: resolverAbi, functionName: 'text', args: [v.node, 'verifier.lastDecision'] }),
            ]);

            return {
                handle:       v.handle,
                principal:    v.principal,
                node:         v.node,
                ens:          `${v.handle}.${VERIFIER_PARENT}`,
                runtime:      String(runtime),
                policy:       String(policy),
                soul:         String(soul),
                lastDecision: String(lastDecision),
                firstSeenBlock: v.firstSeenBlock,
            } satisfies VerifierRow;
        }),
    );

    return verifiers.sort((a, b) => Number(b.firstSeenBlock - a.firstSeenBlock));
}

// ─── Misc helpers used by the table ──────────────────────────────────────

export function ensUrl(name: string): string {
    return `https://sepolia.app.ens.domains/${name}`;
}

export function bzzUrl(ref: string): string {
    if (!ref) return '';
    const clean = ref.replace(/^bzz:\/\//, '');
    return `https://bzz.limo/bytes/${clean}`;
}

// Used by NAME_WRAPPER reads if we ever want owner / fuses.
export const _nameWrapperAbi = parseAbi([
    'function ownerOf(uint256 id) view returns (address)',
    'function getData(uint256 id) view returns (address owner, uint32 fuses, uint64 expiry)',
]);
export const _nameWrapper = NAME_WRAPPER;
