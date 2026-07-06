import { useEffect, useState, type ReactNode } from 'react';

type DeferredMountProps = {
  children: ReactNode;
  /** Max delay in ms before forcing mount (default 4000) */
  timeout?: number;
};

/**
 * Defers mounting children until the browser is idle.
 * Prevents heavy Three.js geometry creation from blocking first paint.
 */
export function DeferredMount({ children, timeout = 4000 }: DeferredMountProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = requestIdleCallback(() => setReady(true), { timeout });
    return () => cancelIdleCallback(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
