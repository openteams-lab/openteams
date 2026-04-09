import { ReactNode, useState, useRef, useEffect } from 'react';
import { PortalContainerContext } from '@/contexts/PortalContainerContext';

import { SequenceTrackerProvider } from '@/keyboard/SequenceTracker';
import { SequenceIndicator } from '@/keyboard/SequenceIndicator';
import NiceModal from '@ebay/nice-modal-react';
import { useTheme } from '@/components/ThemeProvider';
import { analytics } from '@/lib/analytics';
import '@/styles/new/index.css';

interface NewDesignScopeProps {
  children: ReactNode;
}

export function NewDesignScope({ children }: NewDesignScopeProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const hasTracked = useRef(false);
  const { resolvedTheme } = useTheme();
  const isTauriRuntime = typeof window !== 'undefined' && '__TAURI__' in window;

  useEffect(() => {
    if (!hasTracked.current) {
      analytics.trackUiNewAccessed();
      hasTracked.current = true;
    }
  }, []);

  return (
    <div
      ref={setContainer}
      className={`new-design h-full ${
        resolvedTheme === 'dark' ? 'dark' : ''
      } ${isTauriRuntime ? '' : 'new-design--browser-scale'}`}
    >
      {container && (
        <PortalContainerContext.Provider value={container}>
          <SequenceTrackerProvider>
            <SequenceIndicator />
            <NiceModal.Provider>{children}</NiceModal.Provider>
          </SequenceTrackerProvider>
        </PortalContainerContext.Provider>
      )}
    </div>
  );
}
