import { useEffect, useRef, useState } from 'react';
import { PAYMENT_CHECKS, PAYMENT_CHECK_INTERVAL_MS } from '@ideanest/checkout/pledge';

export function usePaymentSettling(settling: boolean, active: boolean, reread: () => unknown): number {
  const [checks, setChecks] = useState(0);
  const latest = useRef(reread);
  latest.current = reread;

  useEffect(() => {
    if (!settling || !active || checks >= PAYMENT_CHECKS) return;
    const timer = setTimeout(() => {
      setChecks((count) => count + 1);
      void latest.current();
    }, PAYMENT_CHECK_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [settling, active, checks]);

  return checks;
}
