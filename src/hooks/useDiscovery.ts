import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Category, DiscoveryResult, Scope, Sort } from '../types';

export function useDiscovery(
  query: string,
  scope: Scope,
  category: Category,
  sort: Sort,
  page: number,
  refresh: number,
) {
  const [state, setState] = useState<{
    data: DiscoveryResult | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: true, error: null });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, loading: true, error: null });
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ q: query, scope, category, sort, page: String(page) });
        void api<DiscoveryResult>(`/discover?${params}`, { signal: controller.signal })
          .then((data) => {
            if (!controller.signal.aborted) setState({ data, loading: false, error: null });
          })
          .catch((error) => {
            if (!controller.signal.aborted)
              setState({
                data: null,
                loading: false,
                error: error instanceof Error ? error.message : 'Erro na busca.',
              });
          });
      },
      query ? 220 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, scope, category, sort, page, refresh]);
  return state;
}
