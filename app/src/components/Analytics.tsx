'use client';

import { useEffect } from 'react';
import { initAppAnalytics } from '@/lib/client/analytics';

/** Mounts once in the root layout; wires baseline usage analytics (kit v1.9). */
export function Analytics() {
  useEffect(() => {
    initAppAnalytics();
  }, []);
  return null;
}
