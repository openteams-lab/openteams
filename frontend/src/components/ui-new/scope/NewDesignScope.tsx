import { ReactNode, useState, useRef, useEffect } from 'react';
import { PortalContainerContext } from '@/contexts/PortalContainerContext';

import { SequenceTrackerProvider } from '@/keyboard/SequenceTracker';
import { SequenceIndicator } from '@/keyboard/SequenceIndicator';
import NiceModal from '@ebay/nice-modal-react';
import { useTheme } from '@/components/ThemeProvider';
import { useUserSystem } from '@/components/ConfigProvider';
import { analytics } from '@/lib/analytics';
import { ToastProvider } from '@/components/ui-new/containers/ToastContainer';
import '@/styles/new/index.css';

interface NewDesignScopeProps {
  children: ReactNode;
}

export function NewDesignScope({ children }: NewDesignScopeProps) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  const hasTracked = useRef(false);
  const { resolvedTheme } = useTheme();
  const { deployMode, loading } = useUserSystem();
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI__' in window;

  useEffect(() => {
    if (hasTracked.current || loading) {
      return;
    }

    analytics.trackUiNewAccessed(
      deployMode ?? (isTauriRuntime ? 'tauri' : 'unknown')
    );
    hasTracked.current = true;
  }, [deployMode, isTauriRuntime, loading]);

  return (
    <div
      className={`new-design h-full w-full ${
        resolvedTheme === 'dark' ? 'dark' : ''
      }`}
    >
      <div ref={setPortalContainer} />
      {portalContainer && (
        <PortalContainerContext.Provider value={portalContainer}>
          <div
            className={`h-full w-full ${
              isTauriRuntime ? '' : 'new-design--browser-scale'
            }`}
          >
            <ToastProvider>
              <SequenceTrackerProvider>
                <SequenceIndicator />
                <NiceModal.Provider>{children}</NiceModal.Provider>
              </SequenceTrackerProvider>
            </ToastProvider>
          </div>
        </PortalContainerContext.Provider>
      )}
    </div>
  );
}
