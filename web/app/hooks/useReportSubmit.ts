'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
    createWalletClient,
    createPublicClient,
    custom,
    http,
    parseAbi,
    parseEventLogs,
    keccak256,
    formatEther,
    parseEther,
    type Hex,
    type Address,
} from 'viem';
import { sepolia } from 'viem/chains';
import { Bee, NULL_STAMP } from '@ethersphere/bee-js';

const WETH_ADDRESS     = (process.env.NEXT_PUBLIC_BOND_CURRENCY    ?? '') as Address;
const OOV3_ADDRESS     = (process.env.NEXT_PUBLIC_UMA_OOV3         ?? '') as Address;
const REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_REPORT_REGISTRY  ?? '') as Address;
const SWARM_BEE_URL    = process.env.NEXT_PUBLIC_SWARM_BEE_URL ?? 'https://bzz.limo';

// DEMO_GPS — Laconian Gulf, off Cyprus per DESIGN_DOCUMENT §13.
const DEMO_GPS: [number, number] = [34.7, 33.4];

const REGISTRY_ABI = parseAbi([
    'function submit(uint256 imo, bool aisDark, bytes32 photoHash, string metadataSwarm, string country, string cargo, string lastSeen) returns (bytes32)',
    'function protocolBond() view returns (uint96)',
    'function liveness() view returns (uint64)',
    'event Submitted(bytes32 indexed reportId, address indexed reporter, uint256 indexed imo, bool aisDark, bytes32 photoHash, string metadataSwarm, bytes32 assertionId, uint96 bond, uint96 umaBond, string country, string cargo, string lastSeen)',
]);

const ERC20_ABI = parseAbi([
    'function approve(address spender, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
]);

const WETH9_ABI = parseAbi([
    'function deposit() payable',
]);

const OOV3_ABI = parseAbi([
    'function getMinimumBond(address currency) view returns (uint256)',
    'function settleAssertion(bytes32 assertionId) external',
]);

declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        };
    }
}

export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'blocked';

export type Step = {
    id:     1 | 2 | 3 | 4 | 5;
    label:  string;
    status: StepStatus;
    log?:   string;
};

const INITIAL_STEPS: Step[] = [
    { id: 1, label: 'swarm upload', status: 'pending' },
    { id: 2, label: 'wallet',       status: 'pending' },
    { id: 3, label: 'approve weth', status: 'pending' },
    { id: 4, label: 'submit',       status: 'pending' },
    { id: 5, label: 'settled',      status: 'pending' },
];

export type ModalState = 'compose' | 'execute' | 'done';

export type Result = {
    photoSwarm:    string;
    metadataSwarm: string;
    txHash:        Hex | '';
    reportId:      Hex | '';
};

// Wait for the UMA OOv3 liveness window to expire (read from
// ReportRegistry.liveness()) plus a small buffer for chain-clock drift,
// then call OOv3.settleAssertion(assertionId). Truthful settle inside
// ReportRegistry.assertionResolvedCallback fires Lighthouse.nameVessel
// (or recordSighting on subsequent settlements). Without this step the
// vessel never appears in the table.
//
// Uses the reporter's own wallet — settle is permissionless and the
// gas is tiny (~50k). Caller pays no extra bond.
async function autoSettleAfterLiveness({
    publicClient,
    walletClient,
    account,
    reportId,
    assertionId,
    setStep,
}: {
    publicClient: ReturnType<typeof createPublicClient>;
    walletClient: ReturnType<typeof createWalletClient>;
    account:      Address;
    reportId:     Hex;
    assertionId:  Hex;
    setStep:      (id: 1 | 2 | 3 | 4 | 5, patch: Partial<Step>) => void;
}) {
    if (!OOV3_ADDRESS) {
        setStep(5, { status: 'done', log: `${reportId.slice(0, 14)}… (oo3 missing — manual settle)` });
        return;
    }
    const liveness = (await publicClient.readContract({
        address:      REGISTRY_ADDRESS,
        abi:          REGISTRY_ABI,
        functionName: 'liveness',
    })) as bigint;

    const waitMs = Number(liveness) * 1_000 + 7_000; // 7 s buffer for drift
    setStep(5, {
        status: 'active',
        log:    `liveness ${liveness}s — auto-settle in ${Math.ceil(waitMs / 1000)}s`,
    });
    await new Promise((r) => setTimeout(r, waitMs));

    setStep(5, { status: 'active', log: 'sending settleAssertion…' });
    try {
        const settleHash = await walletClient.writeContract({
            chain:        sepolia,
            account,
            address:      OOV3_ADDRESS,
            abi:          OOV3_ABI,
            functionName: 'settleAssertion',
            args:         [assertionId],
        });
        await publicClient.waitForTransactionReceipt({ hash: settleHash });
        setStep(5, {
            status: 'done',
            log:    `${reportId.slice(0, 14)}… settled · ${settleHash.slice(0, 10)}…`,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStep(5, {
            status: 'error',
            log:    `auto-settle failed (${msg.slice(0, 80)}…) — settle manually`,
        });
    }
}

export function useReportSubmit() {
    // form state
    const [imo, setImo]               = useState('9133701');
    const [aisDark, setAisDark]       = useState(true);
    const [photoFile, setPhotoFile]   = useState<File | null>(null);
    const [photoName, setPhotoName]   = useState<string>('');
    const [photoHash, setPhotoHash]   = useState<Hex | ''>('');

    // execution state
    const [modalState, setModalState] = useState<ModalState>('compose');
    const [steps, setSteps]           = useState<Step[]>(INITIAL_STEPS);
    const [error, setError]           = useState<string>('');
    const [result, setResult]         = useState<Result>({
        photoSwarm:    '',
        metadataSwarm: '',
        txHash:        '',
        reportId:      '',
    });
    const [account, setAccount]       = useState<Address | null>(null);
    const [needsWrap, setNeedsWrap]   = useState<{ have: bigint; need: bigint } | null>(null);

    const cancelledRef = useRef(false);

    const setStep = useCallback((id: Step['id'], patch: Partial<Step>) => {
        setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    }, []);

    const ingestFile = useCallback(async (file: File) => {
        try {
            setError('');
            const buf  = new Uint8Array(await file.arrayBuffer());
            const hash = keccak256(buf);
            setPhotoFile(file);
            setPhotoName(`${file.name} · ${(file.size / 1024).toFixed(0)} kB`);
            setPhotoHash(hash);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, []);

    const reset = useCallback(() => {
        setSteps(INITIAL_STEPS);
        setError('');
        setResult({ photoSwarm: '', metadataSwarm: '', txHash: '', reportId: '' });
        setNeedsWrap(null);
        setModalState('compose');
        cancelledRef.current = false;
    }, []);

    const cancel = useCallback(() => {
        cancelledRef.current = true;
        reset();
    }, [reset]);

    // shared helpers --------------------------------------------------------
    const publicClient = useMemo(
        () => createPublicClient({ chain: sepolia, transport: http() }),
        [],
    );

    const wrapEth = useCallback(async () => {
        try {
            if (!window.ethereum) throw new Error('no injected wallet');
            if (!account) throw new Error('connect wallet first');
            setStep(3, { status: 'active', log: 'wrapping 0.01 ETH → WETH…' });

            const walletClient = createWalletClient({
                chain: sepolia,
                transport: custom(window.ethereum),
            });

            const hash = await walletClient.writeContract({
                account,
                address: WETH_ADDRESS,
                abi: WETH9_ABI,
                functionName: 'deposit',
                value: parseEther('0.01'),
            });
            await publicClient.waitForTransactionReceipt({ hash });

            setNeedsWrap(null);
            setStep(3, { status: 'active', log: 'wrap complete · retrying approve' });
            // continue submission — caller should re-invoke submit
            await continueAfterWrap(account);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
            setStep(3, { status: 'error', log: msg });
        }
    }, [account, publicClient, setStep]);

    // run from step 3 onward (used after wrap)
    const continueAfterWrap = useCallback(async (acct: Address) => {
        await runApproveAndSubmit(acct);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    }, []);

    // step 3+4+5 sub-pipeline; isolated so wrap can re-enter it
    const runApproveAndSubmit = useCallback(
        async (acct: Address) => {
            try {
                setStep(3, { status: 'active', log: 'reading bond amounts…' });

                const [protocolBond, umaMinBond, balance] = await Promise.all([
                    publicClient.readContract({
                        address: REGISTRY_ADDRESS,
                        abi: REGISTRY_ABI,
                        functionName: 'protocolBond',
                    }),
                    publicClient.readContract({
                        address: OOV3_ADDRESS,
                        abi: OOV3_ABI,
                        functionName: 'getMinimumBond',
                        args: [WETH_ADDRESS],
                    }),
                    publicClient.readContract({
                        address: WETH_ADDRESS,
                        abi: ERC20_ABI,
                        functionName: 'balanceOf',
                        args: [acct],
                    }),
                ]);
                const total = (protocolBond as bigint) + (umaMinBond as bigint);

                if ((balance as bigint) < total) {
                    setNeedsWrap({ have: balance as bigint, need: total });
                    setStep(3, {
                        status: 'blocked',
                        log: `weth ${formatEther(balance as bigint)} · need ${formatEther(total)}`,
                    });
                    return;
                }

                setStep(3, { status: 'active', log: 'checking allowance…' });
                const allowance = (await publicClient.readContract({
                    address: WETH_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: 'allowance',
                    args: [acct, REGISTRY_ADDRESS],
                })) as bigint;

                if (!window.ethereum) throw new Error('no injected wallet');
                const walletClient = createWalletClient({
                    chain: sepolia,
                    transport: custom(window.ethereum),
                });

                if (allowance < total) {
                    setStep(3, { status: 'active', log: `approving ${formatEther(total)} weth…` });
                    const aHash = await walletClient.writeContract({
                        account: acct,
                        address: WETH_ADDRESS,
                        abi: ERC20_ABI,
                        functionName: 'approve',
                        args: [REGISTRY_ADDRESS, total],
                    });
                    await publicClient.waitForTransactionReceipt({ hash: aHash });
                }
                setStep(3, { status: 'done', log: `approved ${formatEther(total)} weth` });

                // step 4 — submit
                setStep(4, { status: 'active', log: 'awaiting wallet…' });
                if (!photoHash) throw new Error('no photoHash');
                if (!result.metadataSwarm) throw new Error('no metadataSwarm');

                const txHash = await walletClient.writeContract({
                    account: acct,
                    address: REGISTRY_ADDRESS,
                    abi: REGISTRY_ABI,
                    functionName: 'submit',
                    args: [
                        BigInt(imo), aisDark, photoHash, result.metadataSwarm,
                        // PWA-side mocks for the demo; real reporter UI would
                        // collect these. Country/cargo are placeholders;
                        // lastSeen mirrors DEMO_GPS so the on-chain text
                        // record matches the metadata.gps field.
                        '', '', `${DEMO_GPS[0]},${DEMO_GPS[1]}`,
                    ],
                });
                setResult((r) => ({ ...r, txHash }));
                setStep(4, { status: 'done', log: txHash.slice(0, 14) + '…' });

                // step 5 — receipt + auto-settle after liveness expires
                setStep(5, { status: 'active', log: 'awaiting receipt…' });
                const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
                const submittedEvents = parseEventLogs({
                    abi: REGISTRY_ABI,
                    eventName: 'Submitted',
                    logs: receipt.logs,
                });
                const submittedArgs = submittedEvents[0]?.args as
                    | { reportId: Hex; assertionId: Hex }
                    | undefined;
                const reportId    = submittedArgs?.reportId ?? '0x' as Hex;
                const assertionId = submittedArgs?.assertionId ?? '0x' as Hex;
                setResult((r) => ({ ...r, reportId }));

                await autoSettleAfterLiveness({
                    publicClient,
                    walletClient,
                    account: acct,
                    reportId,
                    assertionId,
                    setStep,
                });

                setModalState('done');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setError(msg);
                setSteps((prev) =>
                    prev.map((s) =>
                        s.status === 'active' ? { ...s, status: 'error', log: msg } : s,
                    ),
                );
            }
        },
        [aisDark, imo, photoHash, publicClient, result.metadataSwarm, setStep],
    );

    const submit = useCallback(async () => {
        if (modalState === 'execute') return;
        setError('');
        if (!REGISTRY_ADDRESS) {
            setError('NEXT_PUBLIC_REPORT_REGISTRY missing');
            return;
        }
        if (!WETH_ADDRESS || !OOV3_ADDRESS) {
            setError('NEXT_PUBLIC_BOND_CURRENCY or NEXT_PUBLIC_UMA_OOV3 missing');
            return;
        }
        if (!photoFile || !photoHash) {
            setError('drop a photo first');
            return;
        }
        // ReportRegistry.submit() reverts on imo=0 with `require(imo != 0, "imo=0")`.
        // Guard early — empty / zero / non-numeric inputs all collapse to 0n.
        const imoNum = Number(imo);
        if (!Number.isInteger(imoNum) || imoNum <= 0) {
            setError('imo must be a positive integer');
            return;
        }
        if (!window.ethereum) {
            setError('no injected wallet (install MetaMask)');
            return;
        }

        setSteps(INITIAL_STEPS);
        setResult({ photoSwarm: '', metadataSwarm: '', txHash: '', reportId: '' });
        setNeedsWrap(null);
        setModalState('execute');
        cancelledRef.current = false;

        try {
            // step 1 — swarm
            setStep(1, { status: 'active', log: 'uploading photo…' });
            const bee = new Bee(SWARM_BEE_URL);
            const photoBytes = new Uint8Array(await photoFile.arrayBuffer());
            // Single-chunk-CAC upload (raw bytes, no Mantaray wrapper) so
            // the agent's verifyAndFetch can BMT-verify the photo against
            // /bytes/<photoRef>. Filename + content-type intentionally
            // dropped — see swarm/README.md "Scope".
            const photoUpload = await bee.uploadData(NULL_STAMP, photoBytes);
            const photoBzz = `bzz://${photoUpload.reference.toString()}`;

            const nonce = new Uint8Array(32);
            crypto.getRandomValues(nonce);
            const nonceHex =
                '0x' + Array.from(nonce).map((b) => b.toString(16).padStart(2, '0')).join('');
            const metadata = {
                photo:     photoBzz,
                photoHash: photoHash,
                gps:       DEMO_GPS,
                timestamp: Date.now(),
                imo:       Number(imo),
                ais_dark:  aisDark,
                nonce:     nonceHex,
            };
            const metaUpload = await bee.uploadData(
                NULL_STAMP,
                new TextEncoder().encode(JSON.stringify(metadata)),
            );
            const metaBzz = `bzz://${metaUpload.reference.toString()}`;
            setResult((r) => ({ ...r, photoSwarm: photoBzz, metadataSwarm: metaBzz }));
            setStep(1, { status: 'done', log: `${photoBzz.slice(0, 14)}… · ${metaBzz.slice(0, 14)}…` });

            // step 2 — wallet (force account picker so imported accounts are
            // selectable; eth_requestAccounts on its own silently returns the
            // currently-active MetaMask account).
            setStep(2, { status: 'active', log: 'requesting accounts…' });
            await window.ethereum.request({
                method: 'wallet_requestPermissions',
                params: [{ eth_accounts: {} }],
            });
            const walletClient = createWalletClient({
                chain: sepolia,
                transport: custom(window.ethereum),
            });
            const [acct] = await walletClient.requestAddresses();
            setAccount(acct);

            const chainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
            if (parseInt(chainId, 16) !== sepolia.id) {
                setStep(2, { status: 'active', log: 'switching to sepolia…' });
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${sepolia.id.toString(16)}` }],
                });
            }
            setStep(2, { status: 'done', log: `${acct.slice(0, 6)}…${acct.slice(-4)} · sepolia` });

            // we now need the freshly-set metadataSwarm, but state hasn't flushed.
            // Pass it through directly to the next phase via closure.
            await runFromHere(acct, metaBzz);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setError(msg);
            setSteps((prev) =>
                prev.map((s) =>
                    s.status === 'active' ? { ...s, status: 'error', log: msg } : s,
                ),
            );
        }

        // local closure variant of runApproveAndSubmit that uses the just-known metaBzz
        async function runFromHere(acct: Address, metaBzz: string) {
            try {
                if (!photoHash) throw new Error('no photoHash');
                const ph = photoHash as Hex;
                setStep(3, { status: 'active', log: 'reading bond amounts…' });

                const [protocolBond, umaMinBond, balance] = await Promise.all([
                    publicClient.readContract({
                        address: REGISTRY_ADDRESS,
                        abi: REGISTRY_ABI,
                        functionName: 'protocolBond',
                    }),
                    publicClient.readContract({
                        address: OOV3_ADDRESS,
                        abi: OOV3_ABI,
                        functionName: 'getMinimumBond',
                        args: [WETH_ADDRESS],
                    }),
                    publicClient.readContract({
                        address: WETH_ADDRESS,
                        abi: ERC20_ABI,
                        functionName: 'balanceOf',
                        args: [acct],
                    }),
                ]);
                const total = (protocolBond as bigint) + (umaMinBond as bigint);

                if ((balance as bigint) < total) {
                    setNeedsWrap({ have: balance as bigint, need: total });
                    setStep(3, {
                        status: 'blocked',
                        log: `weth ${formatEther(balance as bigint)} · need ${formatEther(total)}`,
                    });
                    return;
                }

                if (!window.ethereum) throw new Error('no injected wallet');
                const walletClient = createWalletClient({
                    chain: sepolia,
                    transport: custom(window.ethereum),
                });

                const allowance = (await publicClient.readContract({
                    address: WETH_ADDRESS,
                    abi: ERC20_ABI,
                    functionName: 'allowance',
                    args: [acct, REGISTRY_ADDRESS],
                })) as bigint;
                if (allowance < total) {
                    setStep(3, { status: 'active', log: `approving ${formatEther(total)} weth…` });
                    const aHash = await walletClient.writeContract({
                        account: acct,
                        address: WETH_ADDRESS,
                        abi: ERC20_ABI,
                        functionName: 'approve',
                        args: [REGISTRY_ADDRESS, total],
                    });
                    await publicClient.waitForTransactionReceipt({ hash: aHash });
                }
                setStep(3, { status: 'done', log: `approved ${formatEther(total)} weth` });

                setStep(4, { status: 'active', log: 'awaiting wallet…' });
                const txHash = await walletClient.writeContract({
                    account: acct,
                    address: REGISTRY_ADDRESS,
                    abi: REGISTRY_ABI,
                    functionName: 'submit',
                    args: [
                        BigInt(imo), aisDark, ph, metaBzz,
                        '', '', `${DEMO_GPS[0]},${DEMO_GPS[1]}`,
                    ],
                });
                setResult((r) => ({ ...r, txHash }));
                setStep(4, { status: 'done', log: txHash.slice(0, 14) + '…' });

                setStep(5, { status: 'active', log: 'awaiting receipt…' });
                const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
                const submittedEvents = parseEventLogs({
                    abi: REGISTRY_ABI,
                    eventName: 'Submitted',
                    logs: receipt.logs,
                });
                const submittedArgs = submittedEvents[0]?.args as
                    | { reportId: Hex; assertionId: Hex }
                    | undefined;
                const reportId    = submittedArgs?.reportId ?? '0x' as Hex;
                const assertionId = submittedArgs?.assertionId ?? '0x' as Hex;
                setResult((r) => ({ ...r, reportId }));

                await autoSettleAfterLiveness({
                    publicClient,
                    walletClient,
                    account: acct,
                    reportId,
                    assertionId,
                    setStep,
                });
                setModalState('done');
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                setError(msg);
                setSteps((prev) =>
                    prev.map((s) =>
                        s.status === 'active' ? { ...s, status: 'error', log: msg } : s,
                    ),
                );
            }
        }
    }, [aisDark, imo, modalState, photoFile, photoHash, publicClient, setStep]);

    // standalone connect for the header pill
    const connectWallet = useCallback(async (): Promise<Address | null> => {
        try {
            if (!window.ethereum) {
                setError('no injected wallet (install MetaMask)');
                return null;
            }
            await window.ethereum.request({
                method: 'wallet_requestPermissions',
                params: [{ eth_accounts: {} }],
            });
            const walletClient = createWalletClient({
                chain: sepolia,
                transport: custom(window.ethereum),
            });
            const [acct] = await walletClient.requestAddresses();
            setAccount(acct);

            const chainId = (await window.ethereum.request({ method: 'eth_chainId' })) as string;
            if (parseInt(chainId, 16) !== sepolia.id) {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${sepolia.id.toString(16)}` }],
                });
            }
            return acct;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return null;
        }
    }, []);

    return {
        // form
        imo, setImo,
        aisDark, setAisDark,
        photoFile, photoName, photoHash,
        ingestFile,

        // execution
        modalState,
        steps,
        error,
        result,
        needsWrap,
        account,
        submit,
        wrapEth,
        cancel,
        reset,
        connectWallet,
    } as const;
}
