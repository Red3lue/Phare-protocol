// Phare demo AI verifiers (OpenClaw skill installations).
//
// Handles follow `agent-<6hex>` per DESIGN_DOCUMENT §6.3. Principals,
// soul/policy/lastDecision Swarm references and stat counts are fabricated
// for the demo. Replace with real on-chain reads from
// `<handle>.verifier.phare.eth` once the verifier skill ships.

export type Verifier = {
    handle:        string;
    principal:     `0x${string}`;
    runtime:       string;
    disputes:      number;
    won:           number;
    lost:          number;
    skipped:       number;
    lastActiveAt:  string;
    soul:          string;
    policy:        string;
    lastDecision:  string;
};

export const VERIFIERS: readonly Verifier[] = [
    {
        handle: 'agent-3a4b5c',
        principal: '0x4f78c39ade09e2c1aaf7d3b9cee21b8a12f3a91c',
        runtime: 'openclaw',
        disputes: 12, won: 9, lost: 1, skipped: 47,
        lastActiveAt: '2026-05-08 14:22Z',
        soul:         'bzz://2f1d8c4e9a73bb5a14ec9f7321e0a7b4d',
        policy:       'bzz://9c4ef011aa728b34d02a6c5f1de98a31b',
        lastDecision: 'bzz://2f1d8c4e9a73bb5a14ec9f7321e0a7b4d',
    },
    {
        handle: 'agent-72e0d1',
        principal: '0x91a26b4cc28e08217c6e7415f829b50c189b9bc4',
        runtime: 'openclaw',
        disputes: 7, won: 5, lost: 0, skipped: 28,
        lastActiveAt: '2026-05-09 03:11Z',
        soul:         'bzz://7c08aa11ff2bcd45ab9d9013727c09e22',
        policy:       'bzz://44e1bc92fe773801ddff0b88ac220117a',
        lastDecision: 'bzz://7c08aa11ff2bcd45ab9d9013727c09e22',
    },
    {
        handle: 'agent-c91e07',
        principal: '0xc18ae84b25dd7f01b6f95b0118f22a69d0cab031',
        runtime: 'openclaw',
        disputes: 3, won: 2, lost: 1, skipped: 14,
        lastActiveAt: '2026-05-07 21:48Z',
        soul:         'bzz://aa19cd8b7ff2e7400e891dd11a37bb22f',
        policy:       'bzz://bb2a1f0e44ce2dba907c10db98e44561d',
        lastDecision: 'bzz://aa19cd8b7ff2e7400e891dd11a37bb22f',
    },
];

export function verifierEnsName(v: Verifier): string {
    return `${v.handle}.verifier.phare.eth`;
}

export function verifierEnsUrl(v: Verifier): string {
    return `https://sepolia.app.ens.domains/${verifierEnsName(v)}`;
}
