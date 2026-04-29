import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircleIcon, XIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface ToastItem {
  id: number;
  message: string;
  type: 'success' | 'error';
}

interface ToastContextValue {
  toast: (message: string, type?: 'success' | 'error') => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback(
    (message: string, type: 'success' | 'error' = 'success') => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
    },
    []
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className={cn(
          'fixed top-4 right-4 z-[10001] flex flex-col gap-2 pointer-events-none'
        )}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex items-center gap-2 rounded-lg px-4 py-3 text-sm shadow-lg',
              'animate-in fade-in-0 slide-in-from-top-2 duration-200',
              t.type === 'success' &&
                'border border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D] dark:border-[rgba(52,211,153,0.24)] dark:bg-[rgba(34,197,94,0.12)] dark:text-[#86EFAC]',
              t.type === 'error' &&
                'border border-[#FECACA] bg-[#FFF5F5] text-[#DC2626] dark:border-[rgba(248,113,113,0.24)] dark:bg-[rgba(239,68,68,0.12)] dark:text-[#FCA5A5]'
            )}
          >
            {t.type === 'success' && (
              <CheckCircleIcon className="shrink-0" size={16} weight="fill" />
            )}
            {t.type === 'error' && (
              <XIcon className="shrink-0" size={16} weight="bold" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
