'use client';

import { motion } from 'framer-motion';
import { useVessels }   from '../hooks/useVessels';
import { useVerifiers } from '../hooks/useVerifiers';
import { vesselDisplay } from '../lib/known-vessels';
import { ensUrl, bzzUrl, type VesselRow, type VerifierRow } from '../lib/chain';

function trim(addr: string) {
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function bzzShort(ref: string) {
    if (!ref) return '—';
    const clean = ref.replace(/^bzz:\/\//, '');
    return `bzz://${clean.slice(0, 10)}…`;
}

function destinationLabel(orbitalTeePred: string): string {
    // The TEE prediction record is a bzz:// ref to a JSON dossier. We
    // can't fetch it synchronously inside a row render, so just show the
    // fact that an attestation exists — the user can click the swarm
    // link to see the inferred destination.
    if (!orbitalTeePred) return '';
    return orbitalTeePred.startsWith('bzz://') ? 'attested ↗' : orbitalTeePred;
}

function VesselRowView({ v, onSelect }: { v: VesselRow; onSelect: () => void }) {
    const meta = vesselDisplay(v.imo);
    return (
        <tr className="divider transition-colors hover:bg-turq-50/50">
            <td className="px-4 py-3">
                <button onClick={onSelect} className="text-left" title="focus on globe">
                    <div className="font-display text-[13px] tracking-tight text-ink hover:text-turq-700">
                        {meta.name}
                    </div>
                </button>
            </td>
            <td className="px-4 py-3 font-mono text-[12px] text-ink tabular">{v.imo}</td>
            <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-ink/55">
                {v.country || meta.flag}
            </td>
            <td className="px-4 py-3 font-mono text-[11px] text-ink/80 truncate max-w-[180px]" title={v.cargo}>
                {v.cargo || <span className="text-ink/35">—</span>}
            </td>
            <td className="px-4 py-3 font-mono text-[12px] text-ink tabular">{v.sightings}</td>
            <td className="px-4 py-3 font-mono text-[12px] text-ink/55 tabular">{v.disputed}</td>
            <td className="px-4 py-3 font-mono text-[11px] text-ink/80 tabular">
                {v.lastSeen || <span className="text-ink/35">—</span>}
            </td>
            <td className="px-4 py-3">
                {v.orbitalTeePred ? (
                    <a
                        href={bzzUrl(v.orbitalTeePred)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-turq-700 hover:underline"
                        title={v.orbitalTeePred}
                    >
                        {destinationLabel(v.orbitalTeePred)}
                    </a>
                ) : (
                    <span className="font-mono text-[11px] text-ink/35">—</span>
                )}
            </td>
            <td className="px-4 py-3">
                <a
                    href={ensUrl(v.ens)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-turq-700 hover:underline truncate inline-block max-w-[220px]"
                    title={v.ens}
                >
                    {v.ens} ↗
                </a>
            </td>
            <td className="px-4 py-3">
                {v.swarmLog ? (
                    <a
                        href={bzzUrl(v.swarmLog)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-turq-700 hover:underline"
                        title={v.swarmLog}
                    >
                        {bzzShort(v.swarmLog)} ↗
                    </a>
                ) : (
                    <span className="font-mono text-[11px] text-ink/35">—</span>
                )}
            </td>
        </tr>
    );
}

function VerifierRowView({ a }: { a: VerifierRow }) {
    return (
        <tr className="divider transition-colors hover:bg-turq-50/50">
            <td className="px-4 py-3">
                <a
                    href={ensUrl(a.ens)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-display text-[13px] tracking-tight text-ink hover:text-turq-700"
                    title={a.ens}
                >
                    {a.handle}
                </a>
            </td>
            <td className="px-4 py-3 font-mono text-[11px] text-ink tabular">{trim(a.principal)}</td>
            <td className="px-4 py-3 font-mono text-[11px] uppercase tracking-[0.22em] text-ink/55">
                {a.runtime || '—'}
            </td>
            <td className="px-4 py-3">
                {a.lastDecision ? (
                    <a
                        href={bzzUrl(a.lastDecision)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-turq-700 hover:underline"
                        title={a.lastDecision}
                    >
                        {bzzShort(a.lastDecision)} ↗
                    </a>
                ) : (
                    <span className="font-mono text-[11px] text-ink/35">—</span>
                )}
            </td>
            <td className="px-4 py-3">
                <a
                    href={ensUrl(a.ens)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] text-turq-700 hover:underline truncate inline-block max-w-[220px]"
                >
                    {a.ens} ↗
                </a>
            </td>
            <td className="px-4 py-3">
                {a.policy ? (
                    <a
                        href={bzzUrl(a.policy)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-turq-700 hover:underline"
                    >
                        policy ↗
                    </a>
                ) : (
                    <span className="font-mono text-[11px] text-ink/35">—</span>
                )}
            </td>
            <td className="px-4 py-3">
                {a.soul ? (
                    <a
                        href={bzzUrl(a.soul)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-turq-700 hover:underline"
                    >
                        soul ↗
                    </a>
                ) : (
                    <span className="font-mono text-[11px] text-ink/35">—</span>
                )}
            </td>
        </tr>
    );
}

function StatusRow({ colSpan, message }: { colSpan: number; message: string }) {
    return (
        <tr>
            <td
                colSpan={colSpan}
                className="px-4 py-10 text-center font-mono text-[11px] text-ink/35"
            >
                {message}
            </td>
        </tr>
    );
}

export default function TablesSection({
    onFocusVessel,
}: {
    onFocusVessel: (imo: number) => void;
}) {
    const vessels   = useVessels();
    const verifiers = useVerifiers();

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
                        Live on-chain reads of <code>Lighthouse</code> + <code>ReportRegistry</code>{' '}
                        on Sepolia. Each row resolves to its ENS subname and Swarm dossier.
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
                        <span className="label">
                            vessels · {vessels.data?.length ?? 0}
                            {vessels.loading && !vessels.data ? ' · loading…' : ''}
                        </span>
                        <button
                            onClick={vessels.refetch}
                            className="label text-ink/55 hover:text-ink transition-colors"
                            title="refresh on-chain"
                        >
                            ↻ refresh
                        </button>
                    </div>

                    <div className="mt-3 rounded-2xl glass edge overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="divider">
                                    {[
                                        'vessel',
                                        'imo',
                                        'country',
                                        'cargo',
                                        'sightings',
                                        'disputed',
                                        'last seen',
                                        'destination',
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
                                {vessels.error ? (
                                    <StatusRow colSpan={10} message={`error: ${vessels.error}`} />
                                ) : vessels.loading && !vessels.data ? (
                                    <StatusRow colSpan={10} message="reading chain…" />
                                ) : !vessels.data || vessels.data.length === 0 ? (
                                    <StatusRow colSpan={10} message="— no vessels minted yet —" />
                                ) : (
                                    vessels.data.map((v) => (
                                        <VesselRowView
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
                        <span className="label">
                            ai agents · {verifiers.data?.length ?? 0}
                            {verifiers.loading && !verifiers.data ? ' · loading…' : ''}
                        </span>
                        <button
                            onClick={verifiers.refetch}
                            className="label text-ink/55 hover:text-ink transition-colors"
                            title="refresh on-chain"
                        >
                            ↻ refresh
                        </button>
                    </div>

                    <div className="mt-3 rounded-2xl glass edge overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="divider">
                                    {[
                                        'handle',
                                        'principal',
                                        'runtime',
                                        'last decision',
                                        'ens',
                                        'policy',
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
                                {verifiers.error ? (
                                    <StatusRow colSpan={7} message={`error: ${verifiers.error}`} />
                                ) : verifiers.loading && !verifiers.data ? (
                                    <StatusRow colSpan={7} message="reading chain…" />
                                ) : !verifiers.data || verifiers.data.length === 0 ? (
                                    <StatusRow colSpan={7} message="— no verifiers enrolled yet —" />
                                ) : (
                                    verifiers.data.map((a) => (
                                        <VerifierRowView key={a.node} a={a} />
                                    ))
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
