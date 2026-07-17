import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { chatRunsApi } from '@/lib/api';
import {
  RunActivityStore,
  type RunActivityState,
} from '@/lib/runActivityStore';

const RunActivityStoreContext = createContext<RunActivityStore | null>(null);

export const RunActivityProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const storeRef = useRef<RunActivityStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new RunActivityStore((runId, cursor) =>
      chatRunsApi.getActivity(runId, { cursor, limit: 200 }),
    );
  }

  return (
    <RunActivityStoreContext.Provider value={storeRef.current}>
      {children}
    </RunActivityStoreContext.Provider>
  );
};

export const useRunActivityStore = (): RunActivityStore => {
  const store = useContext(RunActivityStoreContext);
  if (!store) {
    throw new Error('useRunActivityStore must be used inside RunActivityProvider');
  }
  return store;
};

export const useRunActivity = (
  runId: string | undefined,
  options: { enabled: boolean },
): RunActivityState => {
  const store = useRunActivityStore();
  const state = useSyncExternalStore(
    (listener) => (runId ? store.subscribe(runId, listener) : () => undefined),
    () => store.getSnapshot(runId),
    () => store.getSnapshot(runId),
  );

  useEffect(() => {
    if (runId && options.enabled) store.ensureLoaded(runId);
  }, [options.enabled, runId, store]);

  return state;
};
