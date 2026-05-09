'use client';

import clsx from 'clsx';

function trim(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function Header({
    address,
    onConnect,
    onReport,
}: {
    address: `0x${string}` | null;
    onConnect: () => void;
    onReport: () => void;
}) {
    return (
        <header className="fixed inset-x-0 top-0 z-50">
            <div className="mx-3 mt-3 flex h-14 items-center justify-between px-5">
                <div className="flex items-center gap-4">
                    <span className="font-display text-xl tracking-tight text-ink">PHARE</span>
                    <span className="hidden md:inline label">
                        bonded sighting registry · sepolia demo
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={onConnect}
                        className={clsx(
                            'rounded-full glass-soft edge px-4 py-1.5',
                            'font-mono text-[11px] uppercase tracking-[0.22em]',
                            'transition-all hover:turq-glow-soft',
                            address ? 'text-ink' : 'text-ink/60',
                        )}
                        title={address ?? 'connect wallet'}
                    >
                        {address ? (
                            <span className="flex items-center gap-2">
                                <span className="inline-block h-1.5 w-1.5 rounded-full bg-turq-400 turq-glow-soft" />
                                <span>{trim(address)}</span>
                                <span className="text-ink/40">· sepolia</span>
                            </span>
                        ) : (
                            <span className="flex items-center gap-2">
                                <span className="inline-block h-1.5 w-1.5 rounded-full border border-ink/30" />
                                connect wallet
                            </span>
                        )}
                    </button>

                    <button
                        onClick={onReport}
                        className={clsx(
                            'rounded-full bg-ink/90 px-5 py-1.5',
                            'font-mono text-[11px] uppercase tracking-[0.22em] text-bone',
                            'transition-all hover:turq-glow hover:bg-turq-700',
                        )}
                    >
                        ▲ report
                    </button>
                </div>
            </div>
        </header>
    );
}
