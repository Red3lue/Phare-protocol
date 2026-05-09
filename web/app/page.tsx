'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWalletClient, custom } from 'viem';
import { sepolia } from 'viem/chains';
import type { Address } from 'viem';

import Globe         from './components/Globe';
import Header        from './components/Header';
import DossierPanel  from './components/DossierPanel';
import ReportModal   from './components/ReportModal';
import TablesSection from './components/TablesSection';
import { FLEET, type Vessel } from './data/fleet';
import { useVessels } from './hooks/useVessels';
import { vesselDisplay } from './lib/known-vessels';

// Default lat/lon for synthesized on-chain vessels that have no FLEET
// entry. DEMO_GPS from useReportSubmit (Laconian Gulf, off Cyprus per
// DESIGN_DOCUMENT §13). Each unknown IMO gets a small jitter so multiple
// don't stack on top of each other.
const DEFAULT_LL: readonly [number, number] = [34.7, 33.4];

function synthesizeOnChainVessel(imo: number): Vessel {
    const meta   = vesselDisplay(imo);
    const jitter = ((imo % 17) - 8) * 0.4; // ±3.2°, deterministic per IMO
    const ll: [number, number] = [DEFAULT_LL[0] + jitter, DEFAULT_LL[1] - jitter];
    return {
        imo,
        name:         meta.name,
        flag:         meta.flag,
        age:          0,
        riskScore:    0,
        aisGap:       'live',
        lastSeen:     'on-chain',
        lastLL:       ll,
        suspectedLL:  ll,
        suspected:    'on-chain mint',
        cargo:        '—',
        lastAisAt:    '',
        flagsSwapped: 0,
        owners:       0,
        sanctions:    meta.sanctions,
        sightings:    0,
        disputed:     0,
        color:        '#1ed1c5',
        verified:     'pinned',
        onChain:      true,
    };
}

declare global {
    interface Window {
        ethereum?: {
            request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        };
    }
}

export default function HomePage() {
    const [selectedImo, setSelectedImo] = useState<number | null>(null);
    const [address, setAddress]         = useState<Address | null>(null);
    const [reportOpen, setReportOpen]   = useState(false);
    const [globePaused, setGlobePaused] = useState(false);

    const globeSectionRef = useRef<HTMLElement>(null);

    // Pause globe rendering when section scrolls out of view.
    useEffect(() => {
        const el = globeSectionRef.current;
        if (!el) return;
        const io = new IntersectionObserver(
            ([entry]) => setGlobePaused(!entry.isIntersecting),
            { threshold: 0.05 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    // Read pre-existing wallet connection without prompting.
    useEffect(() => {
        if (!window.ethereum) return;
        (async () => {
            try {
                const accs = (await window.ethereum!.request({
                    method: 'eth_accounts',
                })) as string[];
                if (accs.length > 0) setAddress(accs[0] as Address);
            } catch {
                // ignore
            }
        })();
        const onAccChange = (accs: string[]) => {
            setAddress(accs.length > 0 ? (accs[0] as Address) : null);
        };
        // listener attach is best-effort
        const eth = window.ethereum as unknown as {
            on?: (e: string, cb: (a: string[]) => void) => void;
            removeListener?: (e: string, cb: (a: string[]) => void) => void;
        };
        eth.on?.('accountsChanged', onAccChange);
        return () => {
            eth.removeListener?.('accountsChanged', onAccChange);
        };
    }, []);

    const onConnect = useCallback(async () => {
        if (!window.ethereum) {
            alert('No injected wallet — install MetaMask');
            return;
        }
        try {
            // Force the MetaMask account picker so the user can choose between
            // their default account and any imported ones (e.g. "praga").
            // wallet_requestPermissions always re-prompts; eth_requestAccounts
            // alone would silently return whatever MetaMask was last set to.
            await window.ethereum.request({
                method: 'wallet_requestPermissions',
                params: [{ eth_accounts: {} }],
            });
            const walletClient = createWalletClient({
                chain: sepolia,
                transport: custom(window.ethereum),
            });
            const [acc] = await walletClient.requestAddresses();
            setAddress(acc);

            const chainId = (await window.ethereum.request({
                method: 'eth_chainId',
            })) as string;
            if (parseInt(chainId, 16) !== sepolia.id) {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: `0x${sepolia.id.toString(16)}` }],
                });
            }
        } catch (e) {
            console.error(e);
        }
    }, []);

    const onFocusVessel = useCallback((imo: number) => {
        setSelectedImo(imo);
        // bring globe section into view
        document.getElementById('globe')?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    // Merge on-chain vessels into the demo FLEET:
    //   - IMOs that already exist in FLEET → flagged onChain:true (visual cue
    //     on the Globe + DossierPanel).
    //   - IMOs minted on-chain that are NOT in FLEET → synthesized with a
    //     default position so they still appear on the planet.
    const onChainVessels = useVessels();
    const fleet = useMemo<readonly Vessel[]>(() => {
        const onChainImos = new Set((onChainVessels.data ?? []).map((v) => v.imo));
        const existingImos = new Set(FLEET.map((v) => v.imo));

        const annotated = FLEET.map((v) =>
            onChainImos.has(v.imo) ? { ...v, onChain: true } : v,
        );
        const synthesized = (onChainVessels.data ?? [])
            .filter((v) => !existingImos.has(v.imo))
            .map((v) => synthesizeOnChainVessel(v.imo));

        return [...annotated, ...synthesized];
    }, [onChainVessels.data]);

    const selectedVessel = selectedImo != null
        ? fleet.find((v) => v.imo === selectedImo) ?? null
        : null;

    return (
        <div className="snap-y h-screen overflow-y-scroll relative z-10">
            <Header
                address={address}
                onConnect={onConnect}
                onReport={() => setReportOpen(true)}
            />

            {/* SECTION 1 ── globe + HUD ─────────────────────────────────── */}
            <section
                id="globe"
                ref={globeSectionRef}
                className="snap-start relative h-screen w-full overflow-hidden"
            >
                {/* turquoise radial behind globe */}
                <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                        background:
                            'radial-gradient(ellipse at 50% 55%, rgba(30,209,197,0.15) 0%, rgba(247,243,235,0) 55%)',
                    }}
                />

                <div className="absolute inset-0">
                    <Globe
                        fleet={fleet}
                        selectedImo={selectedImo}
                        onSelect={(imo) => setSelectedImo(imo)}
                        paused={globePaused}
                    />
                </div>

                {/* HUD overlays */}
                <div className="pointer-events-none absolute inset-0">
                    <div className="pointer-events-auto">
                        <DossierPanel
                            vessel={selectedVessel}
                            onClose={() => setSelectedImo(null)}
                        />
                    </div>
                </div>

                {/* scroll cue */}
                <a
                    href="#data"
                    className="pointer-events-auto absolute left-1/2 bottom-1.5 -translate-x-1/2 z-10 label hover:text-ink animate-pulse-slow"
                >
                    ▼ data
                </a>
            </section>

            {/* SECTION 2 ── tables ──────────────────────────────────────── */}
            <TablesSection onFocusVessel={onFocusVessel} />

            <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} />
        </div>
    );
}
