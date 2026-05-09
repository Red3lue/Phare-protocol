'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createWalletClient, custom } from 'viem';
import { sepolia } from 'viem/chains';
import type { Address } from 'viem';

import Globe         from './components/Globe';
import Header        from './components/Header';
import DossierPanel  from './components/DossierPanel';
import ReportModal   from './components/ReportModal';
import TablesSection from './components/TablesSection';
import { FLEET } from './data/fleet';

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

    const selectedVessel = selectedImo != null
        ? FLEET.find((v) => v.imo === selectedImo) ?? null
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
                        fleet={FLEET}
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
