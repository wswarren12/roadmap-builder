'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Alert } from '@pl/components/Alert';

interface Toast {
  id: number;
  variant: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

const ToastContext = createContext<(variant: Toast['variant'], message: string) => void>(
  () => {},
);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((variant: Toast['variant'], message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, variant, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <Alert
            key={toast.id}
            variant={toast.variant}
            styleType="light"
            description={toast.message}
            closable
            onClose={() => setToasts((t) => t.filter((x) => x.id !== toast.id))}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
