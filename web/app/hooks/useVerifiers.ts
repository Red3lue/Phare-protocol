'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchVerifiers, type VerifierRow } from '../lib/chain';

const REFRESH_MS = 30_000;

export type UseVerifiersResult = {
    data:    VerifierRow[] | null;
    loading: boolean;
    error:   string | null;
    refetch: () => void;
};

export function useVerifiers(): UseVerifiersResult {
    const [data,    setData]    = useState<VerifierRow[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const rows = await fetchVerifiers();
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
