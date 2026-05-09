'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchVessels, type VesselRow } from '../lib/chain';

const REFRESH_MS = 30_000;

export type UseVesselsResult = {
    data:    VesselRow[] | null;
    loading: boolean;
    error:   string | null;
    refetch: () => void;
};

export function useVessels(): UseVesselsResult {
    const [data,    setData]    = useState<VesselRow[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const rows = await fetchVessels();
            setData(rows);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        load();
        const id = setInterval(() => {
            if (!cancelled) load();
        }, REFRESH_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [load]);

    return { data, loading, error, refetch: () => { void load(); } };
}
