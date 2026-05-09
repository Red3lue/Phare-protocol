'use client';

import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import { formatEther } from 'viem';
import { useReportSubmit, type Step } from '../hooks/useReportSubmit';
import { swarmUrl } from '../data/fleet';

function StepRow({ step }: { step: Step }) {
    const { id, label, status } = step;
    return (
        <div className="divider px-5 py-3 last:border-b-0">
            <div className="flex items-center gap-3">
                <span
                    className={clsx(
                        'inline-block h-2 w-2 rounded-full',
                        status === 'done'    && 'bg-turq-500 turq-glow-soft',
                        status === 'active'  && 'bg-turq-400 animate-pulse',
                        status === 'error'   && 'bg-red-500',
                        status === 'blocked' && 'bg-amber-400',
                        status === 'pending' && 'border border-ink/30',
                    )}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/55 w-3 tabular">
                    {id}
                </span>
                <span className="flex-1 font-mono text-[12px] uppercase tracking-[0.22em] text-ink">
                    {label}
                </span>
                <span
                    className={clsx(
                        'font-mono text-[10px] uppercase tracking-[0.22em]',
                        status === 'done'    && 'text-turq-700',
                        status === 'active'  && 'text-ink',
                        status === 'error'   && 'text-red-600',
                        status === 'blocked' && 'text-amber-700',
                        status === 'pending' && 'text-ink/35',
                    )}
                >
                    {status}
                </span>
            </div>
        </div>
    );
}

export default function ReportModal({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const r = useReportSubmit();
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (r.modalState === 'execute') return;
            onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, r.modalState, onClose]);

    const lockClose = r.modalState === 'execute';

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center"
                >
                    <div
                        onClick={() => !lockClose && onClose()}
                        className="absolute inset-0 glass-ink"
                    />

                    <motion.div
                        initial={{ opacity: 0, y: 12, scale: 0.99 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.99 }}
                        transition={{ duration: 0.22 }}
                        className="relative z-10 mx-4 w-full max-w-[560px] rounded-3xl glass-strong edge overflow-hidden"
                    >
                        <div className="flex items-center justify-between divider px-5 py-3">
                            <span className="label">submit report</span>
                            <button
                                onClick={onClose}
                                disabled={lockClose}
                                className={clsx(
                                    'label transition-colors',
                                    lockClose ? 'text-ink/30 cursor-not-allowed' : 'hover:text-ink',
                                )}
                                title={lockClose ? 'wait for tx to settle' : 'close'}
                            >
                                ✕ close
                            </button>
                        </div>

                        {/* COMPOSE ───────────────────────────────────────────── */}
                        {r.modalState === 'compose' && (
                            <div className="px-5 py-5 space-y-4">
                                <div>
                                    <label className="label block mb-1.5">imo number</label>
                                    <input
                                        type="number"
                                        value={r.imo}
                                        onChange={(e) => r.setImo(e.target.value)}
                                        className="rounded-xl bg-bone edge w-full px-4 py-2.5 font-mono text-[13px] text-ink tabular outline-none focus:turq-glow-soft"
                                    />
                                </div>

                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={r.aisDark}
                                        onChange={(e) => r.setAisDark(e.target.checked)}
                                        className="h-4 w-4 accent-turq-500"
                                    />
                                    <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-ink">
                                        ais-dark
                                    </span>
                                    <span className="font-mono text-[10px] text-ink/55">
                                        — visible from my position
                                    </span>
                                </label>

                                <div>
                                    <label className="label block mb-1.5">photo</label>
                                    <div
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={async (e) => {
                                            e.preventDefault();
                                            const f = e.dataTransfer.files[0];
                                            if (f) await r.ingestFile(f);
                                        }}
                                        onClick={() => fileInputRef.current?.click()}
                                        className="rounded-xl bg-bone edge px-4 py-7 text-center cursor-pointer hover:bg-turq-50/50 transition-colors"
                                    >
                                        {r.photoName ? (
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-turq-500 text-bone text-[10px]">
                                                    ✓
                                                </span>
                                                <span className="font-mono text-[12px] text-ink">
                                                    photo uploaded
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="font-mono text-[12px] text-ink/55">
                                                drop a photo · or click to pick
                                            </div>
                                        )}
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                            const f = e.target.files?.[0];
                                            if (f) await r.ingestFile(f);
                                        }}
                                    />
                                </div>

                                {r.error && (
                                    <div className="rounded-xl bg-red-50/80 edge-soft px-3 py-2 font-mono text-[11px] text-red-700">
                                        {r.error}
                                    </div>
                                )}

                                <div className="divider-t pt-4 flex flex-col items-center gap-2">
                                    <button
                                        onClick={() => r.submit()}
                                        disabled={!r.photoHash}
                                        className={clsx(
                                            'rounded-full px-8 py-2.5 font-mono text-[11px] uppercase tracking-[0.22em] transition-all',
                                            r.photoHash
                                                ? 'bg-ink/90 text-bone hover:bg-turq-700 hover:turq-glow'
                                                : 'bg-ink/10 text-ink/30 cursor-not-allowed',
                                        )}
                                    >
                                        ▲ submit
                                    </button>
                                    <span className="label">bond ≈ 0.012 weth · sepolia</span>
                                </div>
                            </div>
                        )}

                        {/* EXECUTE ───────────────────────────────────────────── */}
                        {r.modalState === 'execute' && (
                            <div>
                                <div className="divider px-5 py-3 grid grid-cols-3 gap-3 font-mono text-[11px]">
                                    <div>
                                        <div className="label">imo</div>
                                        <div className="text-ink tabular">{r.imo}</div>
                                    </div>
                                    <div>
                                        <div className="label">ais-dark</div>
                                        <div className="text-ink">{r.aisDark ? 'yes' : 'no'}</div>
                                    </div>
                                    <div>
                                        <div className="label">photo</div>
                                        <div className="text-ink truncate">{r.photoName}</div>
                                    </div>
                                </div>

                                <div>
                                    {r.steps.map((s) => (
                                        <StepRow key={s.id} step={s} />
                                    ))}
                                </div>

                                {r.needsWrap && (
                                    <div className="divider-t bg-amber-50/70 px-5 py-3 space-y-2">
                                        <div className="font-mono text-[11px] text-amber-900">
                                            insufficient weth · have {formatEther(r.needsWrap.have)} · need {formatEther(r.needsWrap.need)}
                                        </div>
                                        <button
                                            onClick={() => r.wrapEth()}
                                            className="rounded-full bg-ink/90 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-bone hover:bg-turq-700 hover:turq-glow"
                                        >
                                            wrap 0.01 eth → weth
                                        </button>
                                    </div>
                                )}

                                {r.error && !r.needsWrap && (
                                    <div className="divider-t bg-red-50/70 px-5 py-2 font-mono text-[11px] text-red-700">
                                        {r.error}
                                    </div>
                                )}

                                <div className="flex items-center justify-between divider-t px-5 py-3">
                                    <span className="label">
                                        do not close until settled
                                    </span>
                                    <button
                                        onClick={r.cancel}
                                        disabled={r.steps[3].status === 'active' || r.steps[3].status === 'done'}
                                        className={clsx(
                                            'rounded-full edge px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em]',
                                            (r.steps[3].status === 'active' || r.steps[3].status === 'done')
                                                ? 'text-ink/30 cursor-not-allowed'
                                                : 'text-ink hover:bg-ink/5',
                                        )}
                                    >
                                        cancel
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* DONE ──────────────────────────────────────────────── */}
                        {r.modalState === 'done' && (
                            <div className="px-5 py-5 space-y-4">
                                <div className="flex items-center gap-2">
                                    <span className="inline-block h-2 w-2 rounded-full bg-turq-500 turq-glow" />
                                    <span className="font-display text-xl text-ink">submitted</span>
                                </div>
                                <div className="space-y-2 font-mono text-[11px]">
                                    <div className="flex items-baseline justify-between gap-3 divider pb-2">
                                        <span className="label">report id</span>
                                        <span className="text-ink tabular truncate">
                                            {r.result.reportId
                                                ? `${r.result.reportId.slice(0, 10)}…${r.result.reportId.slice(-4)}`
                                                : '—'}
                                        </span>
                                    </div>
                                    <div className="flex items-baseline justify-between gap-3 divider pb-2">
                                        <span className="label">tx hash</span>
                                        <a
                                            href={`https://sepolia.etherscan.io/tx/${r.result.txHash}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-turq-700 hover:underline tabular truncate"
                                        >
                                            {r.result.txHash.slice(0, 14)}… ↗
                                        </a>
                                    </div>
                                    <div className="flex items-baseline justify-between gap-3 divider pb-2">
                                        <span className="label">photo</span>
                                        <a
                                            href={swarmUrl(r.result.photoSwarm)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-turq-700 hover:underline truncate"
                                        >
                                            {r.result.photoSwarm.slice(0, 18)}… ↗
                                        </a>
                                    </div>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <span className="label">metadata</span>
                                        <a
                                            href={swarmUrl(r.result.metadataSwarm)}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-turq-700 hover:underline truncate"
                                        >
                                            {r.result.metadataSwarm.slice(0, 18)}… ↗
                                        </a>
                                    </div>
                                </div>

                                <div className="flex items-center justify-end gap-2 divider-t pt-3">
                                    <button
                                        onClick={r.reset}
                                        className="rounded-full edge px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-ink hover:bg-ink/5"
                                    >
                                        submit another
                                    </button>
                                    <button
                                        onClick={onClose}
                                        className="rounded-full bg-ink/90 px-5 py-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-bone hover:bg-turq-700"
                                    >
                                        close
                                    </button>
                                </div>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
