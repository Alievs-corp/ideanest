import { useEffect, useRef, useState } from 'react';
import { PAYMENT_CHECKS, PAYMENT_CHECK_INTERVAL_MS } from '@ideanest/checkout/pledge';

export function usePaymentSettling(
  settling: boolean,
  active: boolean,
  reread: () => unknown,
  epoch = 0,
): number {
  const [count, setCount] = useState({ epoch, checks: 0 });
  const checks = count.epoch === epoch ? count.checks : 0;
  const latest = useRef(reread);
  latest.current = reread;

  useEffect(() => {
    if (!settling || !active || checks >= PAYMENT_CHECKS) return;
    const timer = setTimeout(() => {
      setCount((current) => ({ epoch, checks: (current.epoch === epoch ? current.checks : 0) + 1 }));
      void latest.current();
    }, PAYMENT_CHECK_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [settling, active, checks, epoch]);

  return checks;
}
