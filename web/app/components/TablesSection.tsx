'use client';

import { motion } from 'framer-motion';
import { FLEET, ensName, ensUrl, swarmUrl, type Vessel } from '../data/fleet';
import { VERIFIERS, verifierEnsName, verifierEnsUrl, type Verifier } from '../data/verifiers';

function trim(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function bzzShort(ref: string) {
    const clean = ref.replace(/^bzz:\/\//, '');
    return `bzz://${clean.slice(0, 10)}…`;
}

function VesselRow({ v, onSelect }: { v: Vessel; onSelect: () => void }) {
    return (
        <tr className="divider transition-colors hover:bg-turq-50/50">
            <td className="px-4 py-3">
                <button
                    onClick={onSelect}
                    className="text-left"
                    title="focus on globe"
                >
                    <div className="font-display text-[13px] tracking-tight text-ink hover:text-turq-700">
                        {v.name}
                    </div>
                </button>
            </td>
            <td className="px-4 py-3 font-mono text-[12px] text-ink tabular">{v.imo}</td>
            <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-ink/55">
                {v.flag}
            </td>
            <td className="px-4 py-3">
                <div className="flex flex-wrap gap-1">
                    {v.sanctions.map((s) => (
                        <span
                            key={s}
                            className="rounded-full bg-turq-50/80 edge-soft px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-ink/80"
                        >
                            {s}
                        </span>
                    ))}
                </div>
            </td>
            <td className="px-4 py-3 font-mono text-[12px] text-ink tabular">{v.sightings}</td>
            <td className="px-4 py-3 font-mono text-[11px] text-ink/55 tabular">{v.aisGap} ago</td>
            <td className="px-4 py-3">
                <a
                    href={ensUrl(v)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-turq-700 hover:underline truncate inline-block max-w-[220px]"
                    title={ensName(v)}
                >
                    {ensName(v)} ↗
                </a>
            </td>
            <td className="px-4 py-3">
                <a
                    href={swarmUrl(`vessel-${v.imo}-dossier-mock`)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-turq-700 hover:underline"
                >
                    bzz ↗
                </a>
            </td>
        </tr>
    );
}

function VerifierRow({ a }: { a: Verifier }) {
    return (
        <tr className="divider transition-colors hover:bg-turq-50/50">
            <td className="px-4 py-3">
                <a
                    href={verifierEnsUrl(a)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-display text-[13px] tracking-tight text-ink hover:text-turq-700"
                    title={verifierEnsName(a)}
                >
                    {a.handle}
                </a>
            </td>
            <td className="px-4 py-3 font-mono text-[11px] text-ink tabular">{trim(a.principal)}</td>
            <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-ink/55">
                {a.runtime}
            </td>
            <td className="px-4 py-3 font-mono text-[12px] text-ink tabular">{a.disputes}</td>
            <td className="px-4 py-3 font-mono text-[12px] text-turq-700 tabular">{a.won}</td>
            <td className="px-4 py-3 font-mono text-[12px] text-ink/55 tabular">{a.lost}</td>
            <td className="px-4 py-3">
                <a
                    href={swarmUrl(a.lastDecision)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-turq-700 hover:underline"
                >
                    {bzzShort(a.lastDecision)} ↗
                </a>
            </td>
            <td className="px-4 py-3">
                <a
                    href={verifierEnsUrl(a)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-turq-700 hover:underline truncate inline-block max-w-[200px]"
                >
                    {verifierEnsName(a)} ↗
                </a>
            </td>
            <td className="px-4 py-3">
                <a
                    href={swarmUrl(a.soul)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-turq-700 hover:underline"
                >
                    soul ↗
                </a>
            </td>
        </tr>
    );
}

export default function TablesSection({
    onFocusVessel,
}: {
    onFocusVessel: (imo: number) => void;
}) {
    return (
        <section
            id="data"
            className="snap-start relative min-h-screen px-6 pt-28 pb-20"
        >
            <div className="mx-auto max-w-6xl">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    viewport={{ once: true, amount: 0.2 }}
                >
                    <div className="label">section · data</div>
                    <h2 className="mt-1 font-display text-[clamp(2rem,4vw,3rem)] leading-none text-ink">
                        registry
                    </h2>
                    <p className="mt-2 max-w-xl font-mono text-[12px] text-ink/55">
                        Public sightings and the AI agents that adjudicate them. Each row resolves to
                        its ENS subname and Swarm dossier.
                    </p>
                </motion.div>

                {/* VESSELS ─────────────────────────────────────────────── */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.05 }}
                    viewport={{ once: true, amount: 0.2 }}
                    className="mt-10"
                >
                    <div className="flex items-center justify-between px-1">
                        <span className="label">vessels spotted · {FLEET.length}</span>
                        <span className="label text-ink/35">⚠ illustrative entries flagged</span>
                    </div>

                    <div className="mt-3 rounded-2xl glass edge overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="divider">
                                    {[
                                        'vessel',
                                        'imo',
                                        'flag',
                                        'sanctions',
                                        'sight.',
                                        'last seen',
                                        'ens',
                                        'swarm',
                                    ].map((h) => (
                                        <th
                                            key={h}
                                            className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-ink/55"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {FLEET.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={8}
                                            className="px-4 py-10 text-center font-mono text-[11px] text-ink/35"
                                        >
                                            — no entries yet —
                                        </td>
                                    </tr>
                                ) : (
                                    FLEET.map((v) => (
                                        <VesselRow
                                            key={v.imo}
                                            v={v}
                                            onSelect={() => onFocusVessel(v.imo)}
                                        />
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </motion.div>

                {/* AI AGENTS ───────────────────────────────────────────── */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    viewport={{ once: true, amount: 0.2 }}
                    className="mt-12"
                >
                    <div className="flex items-center justify-between px-1">
                        <span className="label">ai agents · {VERIFIERS.length}</span>
                        <span className="label text-ink/35">openclaw · verifier.phare.eth</span>
                    </div>

                    <div className="mt-3 rounded-2xl glass edge overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="divider">
                                    {[
                                        'handle',
                                        'principal',
                                        'runtime',
                                        'disputes',
                                        'won',
                                        'lost',
                                        'last decision',
                                        'ens',
                                        'soul',
                                    ].map((h) => (
                                        <th
                                            key={h}
                                            className="px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-ink/55"
                                        >
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {VERIFIERS.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={9}
                                            className="px-4 py-10 text-center font-mono text-[11px] text-ink/35"
                                        >
                                            — no entries yet —
                                        </td>
                                    </tr>
                                ) : (
                                    VERIFIERS.map((a) => <VerifierRow key={a.handle} a={a} />)
                                )}
                            </tbody>
                        </table>
                    </div>
                </motion.div>

                <div className="mt-16 divider-t pt-4 flex items-center justify-between">
                    <span className="label">phare · ethprague 2026</span>
                    <span className="label text-ink/35">sepolia · uma oov3 · swarm · ens</span>
                </div>
            </div>
        </section>
    );
}
