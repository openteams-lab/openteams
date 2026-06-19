import { useEffect, useMemo, useState } from 'react';

type QueryOptions<T> = {
  queryKey: unknown[];
  queryFn: () => Promise<T> | T;
  enabled?: boolean;
  refetchInterval?: number | false;
  staleTime?: number;
  gcTime?: number;
};

export function useQuery<T>({
  queryKey,
  queryFn,
  enabled = true,
  refetchInterval = false,
}: QueryOptions<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const key = useMemo(() => JSON.stringify(queryKey), [queryKey]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const load = async () => {
      setIsLoading((current) => (data === undefined ? true : current));
      try {
        const result = await queryFn();
        if (!cancelled) setData(result);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    if (!refetchInterval) {
      return () => {
        cancelled = true;
      };
    }

    const intervalId = window.setInterval(() => void load(), refetchInterval);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  // queryFn intentionally follows the old react-query callsite shape.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, refetchInterval]);

  return { data, isLoading };
}
