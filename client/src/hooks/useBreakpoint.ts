/**
 * 响应式断点 Hook
 * mobile: < 768px
 * tablet: 768px ~ 1199px
 * desktop: >= 1200px
 */
import { useState, useEffect } from 'react';

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function getBreakpoint(width: number): Breakpoint {
  if (width < 768) return 'mobile';
  if (width < 1200) return 'tablet';
  return 'desktop';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => getBreakpoint(window.innerWidth));

  useEffect(() => {
    const handler = () => setBp(getBreakpoint(window.innerWidth));
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return bp;
}

export function useIsDesktop(): boolean {
  return useBreakpoint() === 'desktop';
}

export function useIsTabletOrDesktop(): boolean {
  const bp = useBreakpoint();
  return bp === 'tablet' || bp === 'desktop';
}
