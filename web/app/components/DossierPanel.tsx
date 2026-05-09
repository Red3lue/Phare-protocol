'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ensName, ensUrl, type Vessel } from '../data/fleet';

function RiskBar({ score }: { score: number }) {
    return (
        <div className="h-[3px] w-full rounded-full bg-ink/8 overflow-hidden">
            <div className="h-full bg-turq-500/80 rounded-full" style={{ width: `${score}%` }} />
        </div>
    );
}

export default function DossierPanel({
    vessel,
    onClose,
}: {
    vessel: Vessel | null;
    onClose: () => void;
}) {
    return (
        <AnimatePresence mode="wait">
            {vessel && (
                <motion.aside
                    key={vessel.imo}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.25 }}
                    className="absolute right-5 top-24 hidden w-[340px] md:block"
                >
                    <div className="rounded-2xl glass edge overflow-hidden">
                        <div className="flex items-center justify-between divider px-4 py-2.5">
                            <span className="label">dossier · imo {vessel.imo}</span>
                            <button
                                onClick={onClose}
                                className="label hover:text-ink transition-colors"
                                title="clear selection"
                            >
                                ✕ close
                            </button>
                        </div>

                        <div className="px-5 py-4">
                            <div className="font-display text-2xl leading-none text-ink">
                                {vessel.name}
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-ink/60">
                                flag {vessel.flag} · age {vessel.age}y · owners {vessel.owners}× · flag-swaps {vessel.flagsSwapped}×
                            </div>

                            {vessel.verified === 'illustrative' && (
                                <div className="mt-3 inline-block rounded-full bg-ink/5 px-2.5 py-0.5 label">
                                    ⚠ illustrative entry
                                </div>
                            )}

                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <div>
                                    <div className="label">last ais</div>
                                    <div className="mt-1 font-mono text-[12px] text-ink">
                                        {vessel.lastSeen}
                                    </div>
                                    <div className="font-mono text-[10px] text-ink/55 tabular">
                                        {vessel.lastLL[0].toFixed(2)}, {vessel.lastLL[1].toFixed(2)}
                                    </div>
                                    <div className="font-mono text-[10px] text-ink/55 tabular">
                                        {vessel.lastAisAt}
                                    </div>
                                </div>
                                <div>
                                    <div className="label">suspected</div>
                                    <div className="mt-1 font-mono text-[12px] text-turq-700">
                                        {vessel.suspected}
                                    </div>
                                    <div className="font-mono text-[10px] text-ink/55 tabular">
                                        {vessel.suspectedLL[0].toFixed(2)}, {vessel.suspectedLL[1].toFixed(2)}
                                    </div>
                                    <div className="font-mono text-[10px] text-turq-700/80 tabular">
                                        Δ ais {vessel.aisGap}
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4">
                                <div className="label">cargo</div>
                                <div className="mt-1 font-mono text-[12px] text-ink">{vessel.cargo}</div>
                            </div>

                            <div className="mt-4">
                                <div className="label">sanctions</div>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {vessel.sanctions.map((s) => (
                                        <span
                                            key={s}
                                            className="rounded-full bg-turq-50/80 edge-soft px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink/80"
                                        >
                                            {s}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-4">
                                <div className="flex items-center justify-between">
                                    <span className="label">composite risk</span>
                                    <span className="font-mono text-[11px] text-ink tabular">
                                        {vessel.riskScore}/100
                                    </span>
                                </div>
                                <div className="mt-1.5">
                                    <RiskBar score={vessel.riskScore} />
                                </div>
                            </div>

                            <div className="mt-5 flex items-center justify-between divider-t pt-3">
                                <span className="label">resolve</span>
                                <a
                                    href={ensUrl(vessel)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full glass-soft edge-soft px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-ink hover:bg-turq-50/80"
                                    title={ensName(vessel)}
                                >
                                    ens ↗
                                </a>
                            </div>
                        </div>
                    </div>
                </motion.aside>
            )}
        </AnimatePresence>
    );
}
